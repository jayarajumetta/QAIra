import { Fragment, FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StepParameterDialog } from "../components/StepParameterDialog";
import { StepParameterizedText } from "../components/StepParameterizedText";
import { SharedStepsIcon as SharedStepsIconGraphic } from "../components/SharedStepsIcon";
import { StatusBadge } from "../components/StatusBadge";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceSectionTabs } from "../components/WorkspaceSectionTabs";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { removeSharedStepGroupFromCache, upsertSharedStepGroupInCache } from "../lib/sharedStepGroupCache";
import { collectStepParameters, filterStepParameterValues, type StepParameterDefinition } from "../lib/stepParameters";
import { TEST_AUTHORING_SECTION_ITEMS } from "../lib/workspaceSections";
import type { SharedStepGroup } from "../types";

type SharedGroupDraftStep = {
  id: string;
  action: string;
  expected_result: string;
};

type SharedGroupDraft = {
  name: string;
  description: string;
  steps: SharedGroupDraftStep[];
};

type SharedGroupStepInput = Pick<SharedGroupDraftStep, "action" | "expected_result">;

type SharedGroupStepActionMenuAction = {
  label: string;
  description?: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
};

const EMPTY_GROUP_DRAFT: SharedGroupDraft = {
  name: "",
  description: "",
  steps: []
};

const EMPTY_SHARED_GROUP_STEP_INPUT: SharedGroupStepInput = {
  action: "",
  expected_result: ""
};

const createDraftStepId = () =>
  globalThis.crypto?.randomUUID?.() || `shared-step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createEmptyDraftStep = (): SharedGroupDraftStep => ({
  id: createDraftStepId(),
  action: "",
  expected_result: ""
});

const draftFromGroup = (group: SharedStepGroup): SharedGroupDraft => ({
  name: group.name,
  description: group.description || "",
  steps: (group.steps || []).map((step) => ({
    id: createDraftStepId(),
    action: step.action || "",
    expected_result: step.expected_result || ""
  }))
});

const normalizeGroupSteps = (steps: SharedGroupDraftStep[]) =>
  steps
    .map((step, index) => ({
      step_order: index + 1,
      action: step.action.trim(),
      expected_result: step.expected_result.trim()
    }))
    .filter((step) => step.action || step.expected_result);

const sharedStepDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric"
});

const formatSharedStepDate = (value?: string) => {
  if (!value) {
    return "Recently updated";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : sharedStepDateFormatter.format(parsed);
};

export function SharedStepsPage() {
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [groupDraft, setGroupDraft] = useState<SharedGroupDraft>(EMPTY_GROUP_DRAFT);
  const [stepInsertIndex, setStepInsertIndex] = useState<number | null>(null);
  const [newStepDraft, setNewStepDraft] = useState<SharedGroupStepInput>(EMPTY_SHARED_GROUP_STEP_INPUT);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [isParameterDialogOpen, setIsParameterDialogOpen] = useState(false);
  const [sharedParameterValues, setSharedParameterValues] = useState<Record<string, string>>({});

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const sharedGroupsQuery = useQuery({
    queryKey: ["shared-step-groups", appTypeId],
    queryFn: () => api.sharedStepGroups.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });

  const createSharedGroup = useMutation({ mutationFn: api.sharedStepGroups.create });
  const updateSharedGroup = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.sharedStepGroups.update>[1] }) =>
      api.sharedStepGroups.update(id, input)
  });
  const deleteSharedGroup = useMutation({ mutationFn: api.sharedStepGroups.delete });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const sharedGroups = sharedGroupsQuery.data || [];

  const resetStepComposer = () => {
    setStepInsertIndex(null);
    setNewStepDraft(EMPTY_SHARED_GROUP_STEP_INPUT);
  };

  useEffect(() => {
    if (projectsQuery.isPending) {
      return;
    }

    if (!projects.length) {
      if (projectId) {
        setProjectId("");
      }
      return;
    }

    if (!projects.some((project) => project.id === projectId)) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects, projectsQuery.isPending, setProjectId]);

  useEffect(() => {
    if (!appTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!appTypes.some((appType) => appType.id === appTypeId)) {
      setAppTypeId(appTypes[0].id);
    }
  }, [appTypeId, appTypes]);

  useEffect(() => {
    setSelectedGroupId("");
    setIsCreating(false);
    setGroupDraft(EMPTY_GROUP_DRAFT);
    setExpandedStepIds([]);
    setSharedParameterValues({});
    setIsParameterDialogOpen(false);
    resetStepComposer();
  }, [appTypeId]);

  useEffect(() => {
    const nextStepIds = groupDraft.steps.map((step) => step.id);

    setExpandedStepIds((current) => {
      const keptIds = current.filter((id) => nextStepIds.includes(id));
      const addedIds = nextStepIds.filter((id) => !keptIds.includes(id));
      const nextExpandedIds = [...keptIds, ...addedIds];

      if (
        nextExpandedIds.length === current.length
        && nextExpandedIds.every((id, index) => id === current[index])
      ) {
        return current;
      }

      return nextExpandedIds;
    });
  }, [groupDraft.steps]);

  useEffect(() => {
    setSharedParameterValues({});
    setIsParameterDialogOpen(false);
  }, [isCreating, selectedGroupId]);

  const selectedGroup = useMemo(
    () => sharedGroups.find((group) => group.id === selectedGroupId) || null,
    [selectedGroupId, sharedGroups]
  );
  const detectedSharedParameters = useMemo<StepParameterDefinition[]>(
    () =>
      collectStepParameters(
        groupDraft.steps.map((step) => ({
          id: step.id,
          action: step.action,
          expected_result: step.expected_result
        })) as Array<{ id: string; action: string; expected_result: string }>
      ),
    [groupDraft.steps]
  );

  useEffect(() => {
    setSharedParameterValues((current) => {
      const next = filterStepParameterValues(current, detectedSharedParameters);
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);

      if (
        currentKeys.length === nextKeys.length
        && currentKeys.every((key) => current[key] === next[key])
      ) {
        return current;
      }

      return next;
    });
  }, [detectedSharedParameters]);

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (!selectedGroupId) {
      setGroupDraft(EMPTY_GROUP_DRAFT);
      resetStepComposer();
      return;
    }

    if (selectedGroup) {
      setGroupDraft(draftFromGroup(selectedGroup));
      resetStepComposer();
      return;
    }

    if (sharedGroupsQuery.isLoading || sharedGroupsQuery.isFetching) {
      return;
    }

    setSelectedGroupId("");
    setGroupDraft(EMPTY_GROUP_DRAFT);
    resetStepComposer();
  }, [isCreating, selectedGroup, selectedGroupId, sharedGroupsQuery.isFetching, sharedGroupsQuery.isLoading]);

  const filteredGroups = useMemo(() => {
    const search = deferredSearchTerm.trim().toLowerCase();

    return sharedGroups.filter((group) => {
      if (!search) {
        return true;
      }

      return [group.name, group.description || "", ...(group.steps || []).map((step) => `${step.action || ""} ${step.expected_result || ""}`)]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [deferredSearchTerm, sharedGroups]);

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const refreshGroups = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups"] }),
      queryClient.invalidateQueries({ queryKey: ["shared-step-groups", appTypeId] })
    ]);
  };

  const beginCreateGroup = () => {
    setIsCreating(true);
    setSelectedGroupId("");
    setGroupDraft({
      ...EMPTY_GROUP_DRAFT,
      steps: [createEmptyDraftStep()]
    });
    setExpandedStepIds([]);
    resetStepComposer();
  };

  const closeWorkspace = () => {
    setSelectedGroupId("");
    setIsCreating(false);
    setGroupDraft(EMPTY_GROUP_DRAFT);
    setExpandedStepIds([]);
    resetStepComposer();
  };

  const updateDraftStep = (stepId: string, input: Partial<SharedGroupDraftStep>) => {
    setGroupDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...input } : step))
    }));
  };

  const activateStepInsert = (index: number) => {
    setStepInsertIndex(index);
    setNewStepDraft(EMPTY_SHARED_GROUP_STEP_INPUT);
  };

  const insertDraftStepAt = (index: number, stepInput: SharedGroupStepInput) => {
    const nextStep: SharedGroupDraftStep = {
      id: createDraftStepId(),
      action: stepInput.action.trim(),
      expected_result: stepInput.expected_result.trim()
    };

    setGroupDraft((current) => {
      const nextSteps = [...current.steps];
      const boundedIndex = Math.max(0, Math.min(index, nextSteps.length));
      nextSteps.splice(boundedIndex, 0, nextStep);

      return {
        ...current,
        steps: nextSteps
      };
    });
  };

  const handleInsertStep = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (stepInsertIndex === null) {
      return;
    }

    const nextAction = newStepDraft.action.trim();
    const nextExpectedResult = newStepDraft.expected_result.trim();

    if (!nextAction && !nextExpectedResult) {
      return;
    }

    insertDraftStepAt(stepInsertIndex, {
      action: nextAction,
      expected_result: nextExpectedResult
    });
    resetStepComposer();
  };

  const removeDraftStep = (stepId: string) => {
    setGroupDraft((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.id !== stepId)
    }));
  };

  const moveDraftStep = (stepId: string, direction: "up" | "down") => {
    setGroupDraft((current) => {
      const currentIndex = current.steps.findIndex((step) => step.id === stepId);
      const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

      if (currentIndex === -1 || nextIndex < 0 || nextIndex >= current.steps.length) {
        return current;
      }

      const nextSteps = [...current.steps];
      const [movedStep] = nextSteps.splice(currentIndex, 1);
      nextSteps.splice(nextIndex, 0, movedStep);

      return {
        ...current,
        steps: nextSteps
      };
    });
  };

  const toggleDraftStepExpanded = (stepId: string) => {
    setExpandedStepIds((current) =>
      current.includes(stepId)
        ? current.filter((id) => id !== stepId)
        : [...current, stepId]
    );
  };

  const handleSaveGroup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!appTypeId) {
      showError(new Error("Select an app type before saving a shared step group."), "Unable to save shared step group");
      return;
    }

    const steps = normalizeGroupSteps(groupDraft.steps);

    try {
      if (isCreating) {
        const response = await createSharedGroup.mutateAsync({
          app_type_id: appTypeId,
          name: groupDraft.name.trim(),
          description: groupDraft.description.trim() || undefined,
          steps
        });
        const createdGroup = await api.sharedStepGroups.get(response.id);

        upsertSharedStepGroupInCache(queryClient, appTypeId, createdGroup);

        setSelectedGroupId(createdGroup.id);
        setIsCreating(false);
        setGroupDraft(draftFromGroup(createdGroup));
        showSuccess("Shared step group created.");
      } else if (selectedGroup) {
        await updateSharedGroup.mutateAsync({
          id: selectedGroup.id,
          input: {
            app_type_id: appTypeId,
            name: groupDraft.name.trim(),
            description: groupDraft.description.trim(),
            steps
          }
        });
        const refreshedGroup = await api.sharedStepGroups.get(selectedGroup.id);

        upsertSharedStepGroupInCache(queryClient, appTypeId, refreshedGroup);
        setGroupDraft(draftFromGroup(refreshedGroup));

        showSuccess(
          selectedGroup.usage_count
            ? `Shared step group updated. ${selectedGroup.usage_count} linked test case${selectedGroup.usage_count === 1 ? "" : "s"} refreshed.`
            : "Shared step group updated."
        );
      }

      await refreshGroups();
    } catch (error) {
      showError(error, "Unable to save shared step group");
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroup) {
      return;
    }

    if (!window.confirm(`Delete shared step group "${selectedGroup.name}"? Linked test cases will keep their steps as local groups.`)) {
      return;
    }

    try {
      await deleteSharedGroup.mutateAsync(selectedGroup.id);
      removeSharedStepGroupFromCache(queryClient, appTypeId, selectedGroup.id);
      setSelectedGroupId("");
      setGroupDraft(EMPTY_GROUP_DRAFT);
      resetStepComposer();
      showSuccess("Shared step group deleted. Linked test cases kept their steps as local groups.");
      await refreshGroups();
    } catch (error) {
      showError(error, "Unable to delete shared step group");
    }
  };

  const coverageMeta = {
    total: sharedGroups.length,
    totalSteps: sharedGroups.reduce((count, group) => count + (group.step_count || group.steps.length || 0), 0),
    usedInCases: sharedGroups.reduce((count, group) => count + (group.usage_count || 0), 0)
  };

  return (
    <div className="page-content page-content--library-full">
      <PageHeader
        eyebrow="Shared Step Groups"
        title="Shared Step Groups"
        description="Curate repeatable step blocks once. Shared groups promoted from test cases and groups created here land in the same reusable library."
        meta={[
          { label: "Groups", value: coverageMeta.total },
          { label: "Reusable steps", value: coverageMeta.totalSteps },
          { label: "Case links", value: coverageMeta.usedInCases }
        ]}
        actions={
          <button className="primary-button" disabled={!appTypeId} onClick={beginCreateGroup} type="button">
            New shared group
          </button>
        }
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={setAppTypeId}
        onProjectChange={(value) => {
          setProjectId(value);
          setAppTypeId("");
        }}
        projectId={projectId}
        projects={projects}
      />

      <WorkspaceSectionTabs ariaLabel="Test authoring sections" items={TEST_AUTHORING_SECTION_ITEMS} />

      <WorkspaceMasterDetail
        browseView={(
          <Panel
            title="Shared step tiles"
            subtitle={appTypeId ? "Browse shared groups as tiles first, including ones promoted from test cases, then open one for editing." : "Choose an app type to begin."}
          >
            <div className="design-list-toolbar test-case-catalog-toolbar">
              <CatalogSearchFilter
                activeFilterCount={Number(Boolean(searchTerm.trim()))}
                ariaLabel="Search shared step groups"
                onChange={setSearchTerm}
                placeholder="Search group name, description, or step text"
                subtitle="Find shared groups by intent, summary, or step content."
                title="Filter shared step groups"
                value={searchTerm}
              >
                <div className="catalog-filter-grid">
                  <div className="catalog-filter-actions">
                    <button className="ghost-button" disabled={!searchTerm.trim()} onClick={() => setSearchTerm("")} type="button">
                      Clear search
                    </button>
                  </div>
                </div>
              </CatalogSearchFilter>
              <button className="ghost-button" disabled={!appTypeId} onClick={beginCreateGroup} type="button">
                New group
              </button>
            </div>

            <TileBrowserPane className="test-case-library-scroll">
              {sharedGroupsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
              {!sharedGroupsQuery.isLoading && filteredGroups.length ? (
                <div className="tile-browser-grid">
                  {filteredGroups.map((group) => {
                    const isActive = !isCreating && selectedGroupId === group.id;
                    const stepCount = group.step_count || group.steps.length;
                    const usageCount = group.usage_count || 0;
                    const preview = group.steps[0]?.action || group.steps[0]?.expected_result || "No step preview yet";

                    return (
                      <button
                        className={["record-card tile-card test-case-card test-case-catalog-card", isActive ? "is-active" : ""].filter(Boolean).join(" ")}
                        key={group.id}
                        onClick={() => {
                          setSelectedGroupId(group.id);
                          setIsCreating(false);
                          resetStepComposer();
                        }}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-header">
                            <span aria-label="Shared Steps" className="step-kind-badge is-shared" title="Shared Steps">
                              <SharedStepsIconGraphic size={16} />
                            </span>
                            <div className="tile-card-title-group">
                              <strong>{group.name}</strong>
                              <span className="tile-card-kicker">{formatSharedStepDate(group.updated_at)}</span>
                            </div>
                          </div>
                          <p className="tile-card-description">{group.description || preview}</p>
                          <div className="tile-card-facts" aria-label={`${group.name} facts`}>
                            <span className="tile-card-fact">
                              <strong>{stepCount}</strong>
                              <small>steps</small>
                            </span>
                            <span className="tile-card-fact">
                              <strong>{usageCount}</strong>
                              <small>{usageCount === 1 ? "case" : "cases"}</small>
                            </span>
                            <span className="tile-card-fact">
                              <strong>{selectedAppType?.name || "App type"}</strong>
                              <small>scope</small>
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {!sharedGroupsQuery.isLoading && !filteredGroups.length ? (
                <div className="empty-state compact">{sharedGroups.length ? "No shared groups match the current search." : "No shared step groups exist for this app type yet."}</div>
              ) : null}
            </TileBrowserPane>
          </Panel>
        )}
        detailView={(
          <Panel
            actions={<WorkspaceBackButton label="Back to shared step tiles" onClick={closeWorkspace} />}
            title="Shared step workspace"
            subtitle={selectedGroupId || isCreating ? "Edit the shared group and keep its step sequence ready for test case insertion." : "Select a shared step group or create a new one."}
          >
            {selectedGroupId || isCreating ? (
              <form className="detail-stack" onSubmit={(event) => void handleSaveGroup(event)}>
                <div className="form-grid">
                  <div className="record-grid">
                    <FormField label="Group name" required>
                      <input
                        data-autofocus="true"
                        required
                        value={groupDraft.name}
                        onChange={(event) => setGroupDraft((current) => ({ ...current, name: event.target.value }))}
                      />
                    </FormField>
                  </div>

                  <FormField label="Description">
                    <textarea
                      rows={3}
                      value={groupDraft.description}
                      onChange={(event) => setGroupDraft((current) => ({ ...current, description: event.target.value }))}
                    />
                  </FormField>
                </div>

                  <div className="step-editor step-editor--embedded">
                    <div className="detail-summary">
                      <strong>{groupDraft.steps.length} step{groupDraft.steps.length === 1 ? "" : "s"}</strong>
                      <span>These steps stay linked anywhere this shared group is referenced.</span>
                    </div>

                    {detectedSharedParameters.length ? (
                      <div className="detail-summary step-parameter-summary">
                        <strong>{detectedSharedParameters.length} parameter{detectedSharedParameters.length === 1 ? "" : "s"} detected</strong>
                        <span>{detectedSharedParameters.map((parameter) => parameter.token).join(", ")}</span>
                      </div>
                    ) : null}

                  {!isCreating && selectedGroup ? (
                    <div className="detail-summary">
                      <strong>
                        {selectedGroup.usage_count
                          ? `Used in ${selectedGroup.usage_count} test case${selectedGroup.usage_count === 1 ? "" : "s"}`
                          : "Not used in any test cases yet"}
                      </strong>
                      <span>
                        {selectedGroup.usage_count
                          ? "Editing this shared group updates every linked test case while preserving execution history snapshots."
                          : "Once this group is inserted into a test case, linked case usage will appear here."}
                      </span>
                    </div>
                  ) : null}

                  {!groupDraft.steps.length ? (
                    <div className="empty-state compact">No shared steps yet. Add at least one step so this group is useful across cases.</div>
                  ) : null}

                  <div className="action-row step-editor-toolbar">
                    <button className="ghost-button" onClick={() => setIsParameterDialogOpen(true)} type="button">
                      <SharedGroupParameterIcon />
                      <span>{detectedSharedParameters.length ? `Params · ${detectedSharedParameters.length}` : "Params"}</span>
                    </button>
                    <SharedGroupStepIconButton
                      ariaLabel="Add shared step"
                      onClick={() => activateStepInsert(groupDraft.steps.length)}
                      title="Add shared step"
                      type="button"
                    >
                      <SharedGroupStepInsertIcon />
                    </SharedGroupStepIconButton>
                  </div>

                  <div className="step-list">
                    {!groupDraft.steps.length ? (
                      <InlineSharedGroupStepInsertSlot
                        draft={newStepDraft}
                        index={0}
                        isActive={stepInsertIndex === 0}
                        parameterValues={sharedParameterValues}
                        isVisibleByDefault={true}
                        onActivate={() => activateStepInsert(0)}
                        onCancel={resetStepComposer}
                        onChange={setNewStepDraft}
                        onSubmit={handleInsertStep}
                      />
                    ) : null}

                    {groupDraft.steps.map((step, index) => (
                      <Fragment key={step.id}>
                        <InlineSharedGroupStepInsertSlot
                          draft={newStepDraft}
                          index={index}
                          isActive={stepInsertIndex === index}
                          parameterValues={sharedParameterValues}
                          onActivate={() => activateStepInsert(index)}
                          onCancel={resetStepComposer}
                          onChange={setNewStepDraft}
                          onSubmit={handleInsertStep}
                        />
                        <SharedGroupDraftStepCard
                          canMoveDown={index < groupDraft.steps.length - 1}
                          canMoveUp={index > 0}
                          isExpanded={expandedStepIds.includes(step.id)}
                          parameterValues={sharedParameterValues}
                          onChange={(input) => updateDraftStep(step.id, input)}
                          onDelete={() => removeDraftStep(step.id)}
                          onInsertAbove={() => activateStepInsert(index)}
                          onInsertBelow={() => activateStepInsert(index + 1)}
                          onMoveDown={() => moveDraftStep(step.id, "down")}
                          onMoveUp={() => moveDraftStep(step.id, "up")}
                          onToggle={() => toggleDraftStepExpanded(step.id)}
                          step={step}
                          stepNumber={index + 1}
                        />
                        {index === groupDraft.steps.length - 1 ? (
                          <InlineSharedGroupStepInsertSlot
                            draft={newStepDraft}
                            index={index + 1}
                            isActive={stepInsertIndex === index + 1}
                            parameterValues={sharedParameterValues}
                            onActivate={() => activateStepInsert(index + 1)}
                            onCancel={resetStepComposer}
                            onChange={setNewStepDraft}
                            onSubmit={handleInsertStep}
                          />
                        ) : null}
                      </Fragment>
                    ))}
                  </div>
                </div>

                <div className="action-row">
                  <button className="primary-button" disabled={createSharedGroup.isPending || updateSharedGroup.isPending} type="submit">
                    {isCreating ? (createSharedGroup.isPending ? "Creating…" : "Create shared group") : (updateSharedGroup.isPending ? "Saving…" : "Save shared group")}
                  </button>
                  {isCreating ? (
                    <button className="ghost-button" onClick={closeWorkspace} type="button">
                      Cancel
                    </button>
                  ) : null}
                  {!isCreating && selectedGroup ? (
                    <button className="ghost-button danger" disabled={deleteSharedGroup.isPending} onClick={() => void handleDeleteGroup()} type="button">
                      Delete group
                    </button>
                  ) : null}
                </div>

                <div className="detail-summary">
                  <strong>How shared groups behave</strong>
                  <span>When you insert this group into a test case, the shared block stays linked. Editing its steps updates every linked test case while existing execution history remains preserved.</span>
                </div>

                {!isCreating && selectedGroup?.used_test_cases?.length ? (
                  <div className="stack-list">
                    {selectedGroup.used_test_cases.map((testCase) => (
                      <div className="stack-item" key={testCase.id}>
                        <div>
                          <strong>{testCase.title}</strong>
                          <span>{testCase.referenced_step_count} referenced step{testCase.referenced_step_count === 1 ? "" : "s"} from this shared group</span>
                        </div>
                        <StatusBadge value={testCase.status || "draft"} />
                      </div>
                    ))}
                  </div>
                ) : null}
              </form>
            ) : (
              <div className="empty-state compact">
                {selectedProject && selectedAppType
                  ? `Select a shared step group for ${selectedProject.name} / ${selectedAppType.name}, or create a new one.`
                  : "Choose a project and app type, then select a shared step group or create a new one."}
              </div>
            )}
          </Panel>
        )}
        isDetailOpen={Boolean(selectedGroupId) || isCreating}
      />

      {isParameterDialogOpen ? (
        <StepParameterDialog
          onChange={(name, value) =>
            setSharedParameterValues((current) => ({
              ...current,
              [name]: value
            }))
          }
          onClose={() => setIsParameterDialogOpen(false)}
          parameters={detectedSharedParameters}
          subtitle="Detected @params from the current shared-group steps. These values are previewed inline so reusable flows stay readable."
          title="Shared step parameter values"
          values={sharedParameterValues}
        />
      ) : null}
    </div>
  );
}

function SharedGroupStepIconButton({
  children,
  ariaLabel,
  title,
  onClick,
  disabled = false,
  type = "button"
}: {
  children: ReactNode;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
}) {
  return (
    <button aria-label={ariaLabel} className="step-action-button" disabled={disabled} onClick={onClick} title={title} type={type}>
      {children}
    </button>
  );
}

function SharedGroupStepIconShell({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {children}
    </svg>
  );
}

function SharedGroupStepInsertIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <path d="M7 5h10" />
      <path d="M7 19h10" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupParameterIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M5 7.5h14" />
      <path d="M7 12h10" />
      <path d="M9 16.5h6" />
      <path d="m5 5 2.5 2.5L5 10" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepInsertAboveIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 19V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
      <path d="M6 4h12" />
      <path d="M8 15h8" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepInsertBelowIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 5v12" />
      <path d="m8.5 13.5 3.5 3.5 3.5-3.5" />
      <path d="M8 9h8" />
      <path d="M6 20h12" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepMoveUpIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="m12 6-4 4" />
      <path d="m12 6 4 4" />
      <path d="M12 6v12" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepMoveDownIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="m12 18-4-4" />
      <path d="m12 18 4-4" />
      <path d="M12 6v12" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepDeleteIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M4 7h16" />
      <path d="M9 7V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7" />
      <path d="M7 7l.8 11.1A2 2 0 0 0 9.8 20h4.4a2 2 0 0 0 2-1.9L17 7" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepKebabIcon() {
  return (
    <SharedGroupStepIconShell>
      <circle cx="12" cy="6" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="18" r="1.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepActionMenu({
  label,
  actions
}: {
  label: string;
  actions: SharedGroupStepActionMenuAction[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen]);

  return (
    <div className="step-card-menu step-card-menu--floating">
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={label}
        className="step-card-menu-trigger"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title={label}
        type="button"
      >
        <SharedGroupStepKebabIcon />
      </button>
      {isOpen ? (
        <div className="step-card-menu-panel" ref={menuRef} role="menu">
          {actions.map((action) => (
            <button
              className={["step-card-menu-item", action.tone ? `is-${action.tone}` : ""].filter(Boolean).join(" ")}
              disabled={action.disabled}
              key={action.label}
              onClick={() => {
                action.onClick();
                setIsOpen(false);
              }}
              role="menuitem"
              title={action.label}
              type="button"
            >
              {action.icon}
              <span className="step-card-menu-item-content">
                <span className="step-card-menu-item-label">{action.label}</span>
                {action.description ? <span className="step-card-menu-item-description">{action.description}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function InlineSharedGroupStepInsertSlot({
  index,
  isActive,
  isVisibleByDefault = false,
  draft,
  parameterValues,
  onActivate,
  onCancel,
  onChange,
  onSubmit
}: {
  index: number;
  isActive: boolean;
  isVisibleByDefault?: boolean;
  draft: SharedGroupStepInput;
  parameterValues: Record<string, string>;
  onActivate: () => void;
  onCancel: () => void;
  onChange: (draft: SharedGroupStepInput) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const insertTitle = index === 0 ? "Add first shared step" : "Insert shared step here";

  if (!isActive && !isVisibleByDefault) {
    return null;
  }

  return (
    <div className={["step-insert-slot", isActive ? "is-active" : "", isVisibleByDefault ? "is-visible" : ""].filter(Boolean).join(" ")}>
      {!isActive ? (
        <div className="step-insert-actions">
          <SharedGroupStepIconButton ariaLabel={insertTitle} onClick={onActivate} title={insertTitle} type="button">
            <SharedGroupStepInsertIcon />
          </SharedGroupStepIconButton>
        </div>
      ) : (
        <form className="step-create step-create--inline" onSubmit={onSubmit}>
          <div className="step-card-summary-top">
            <span aria-label="Shared Steps" className="step-kind-badge is-shared" title="Shared Steps">
              <SharedStepsIconGraphic size={16} />
            </span>
            <strong>{index === 0 ? "+ Add Shared Step" : "+ Insert Shared Step"}</strong>
          </div>
          <FormField label="Action">
            <input
              autoFocus
              value={draft.action}
              onChange={(event) => onChange({ ...draft, action: event.target.value })}
            />
          </FormField>
          {draft.action ? (
            <div className="step-parameter-preview">
              <span className="step-parameter-preview-label">Resolved action</span>
              <StepParameterizedText text={draft.action} values={parameterValues} />
            </div>
          ) : null}
          <FormField label="Expected result">
            <textarea
              rows={3}
              value={draft.expected_result}
              onChange={(event) => onChange({ ...draft, expected_result: event.target.value })}
            />
          </FormField>
          {draft.expected_result ? (
            <div className="step-parameter-preview">
              <span className="step-parameter-preview-label">Resolved expected result</span>
              <StepParameterizedText text={draft.expected_result} values={parameterValues} />
            </div>
          ) : null}
          <div className="action-row">
            <button className="primary-button" type="submit">Save step</button>
            <button className="ghost-button" onClick={onCancel} type="button">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function SharedGroupDraftStepCard({
  step,
  stepNumber,
  parameterValues,
  isExpanded,
  canMoveUp,
  canMoveDown,
  onChange,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onMoveUp,
  onMoveDown,
  onToggle
}: {
  step: SharedGroupDraftStep;
  stepNumber: number;
  parameterValues: Record<string, string>;
  isExpanded: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (input: SharedGroupStepInput) => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggle: () => void;
}) {
  const stepActions: SharedGroupStepActionMenuAction[] = [
    {
      label: "Insert above",
      description: "Open a new shared step slot right above this step.",
      icon: <SharedGroupStepInsertAboveIcon />,
      onClick: onInsertAbove
    },
    {
      label: "Insert below",
      description: "Open a new shared step slot right below this step.",
      icon: <SharedGroupStepInsertBelowIcon />,
      onClick: onInsertBelow
    },
    {
      label: "Move up",
      description: "Shift this shared step earlier in the group.",
      icon: <SharedGroupStepMoveUpIcon />,
      onClick: onMoveUp,
      disabled: !canMoveUp
    },
    {
      label: "Move down",
      description: "Shift this shared step later in the group.",
      icon: <SharedGroupStepMoveDownIcon />,
      onClick: onMoveDown,
      disabled: !canMoveDown
    },
    {
      label: "Delete step",
      description: "Remove this shared step from the group.",
      icon: <SharedGroupStepDeleteIcon />,
      onClick: onDelete,
      tone: "danger"
    }
  ];

  return (
    <article className={["step-card step-card--shared", isExpanded ? "is-expanded" : ""].join(" ")}>
      <div className="step-card-top">
        <button
          aria-label={isExpanded ? `Hide shared step ${stepNumber} details` : `Show shared step ${stepNumber} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-top">
              <span aria-label="Shared Steps" className="step-kind-badge is-shared" title="Shared Steps">
                <SharedStepsIconGraphic size={16} />
              </span>
              <strong>Step {stepNumber}</strong>
            </div>
            <StepParameterizedText
              className="step-card-parameterized"
              fallback="Shared step details"
              text={step.action || step.expected_result}
              values={parameterValues}
            />
          </div>
          <span aria-hidden="true" className="step-card-toggle-state">
            <SharedGroupStepKebabIcon />
          </span>
        </button>
        <SharedGroupStepActionMenu
          actions={stepActions}
          label={`Shared step ${stepNumber} actions`}
        />
      </div>

      {isExpanded ? (
        <div className="step-card-body">
          <FormField label="Action">
            <input
              value={step.action}
              onChange={(event) => onChange({ action: event.target.value, expected_result: step.expected_result })}
            />
          </FormField>
          {step.action ? (
            <div className="step-parameter-preview">
              <span className="step-parameter-preview-label">Resolved action</span>
              <StepParameterizedText text={step.action} values={parameterValues} />
            </div>
          ) : null}
          <FormField label="Expected result">
            <textarea
              rows={3}
              value={step.expected_result}
              onChange={(event) => onChange({ action: step.action, expected_result: event.target.value })}
            />
          </FormField>
          {step.expected_result ? (
            <div className="step-parameter-preview">
              <span className="step-parameter-preview-label">Resolved expected result</span>
              <StepParameterizedText text={step.expected_result} values={parameterValues} />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
