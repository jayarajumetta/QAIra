import { Fragment, FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { AddIcon } from "../components/AppIcons";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { FormField } from "../components/FormField";
import { LinkedTestCaseModal } from "../components/LinkedTestCaseModal";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StepParameterDialog } from "../components/StepParameterDialog";
import { StepParameterizedText } from "../components/StepParameterizedText";
import { SharedStepsIcon as SharedStepsIconGraphic } from "../components/SharedStepsIcon";
import { StatusBadge } from "../components/StatusBadge";
import { TileCardLinkIcon } from "../components/TileCardPrimitives";
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
import type { SharedStepGroup, TestCase } from "../types";

type SharedGroupDraftStep = {
  id: string;
  action: string;
  expected_result: string;
};

type CopiedSharedGroupStep = SharedGroupDraftStep;

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

const cloneSharedGroupStep = (step: Pick<SharedGroupDraftStep, "action" | "expected_result">): SharedGroupDraftStep => ({
  id: createDraftStepId(),
  action: step.action,
  expected_result: step.expected_result
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [catalogViewMode, setCatalogViewMode] = useState<"tile" | "list">("tile");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isHeaderSectionExpanded, setIsHeaderSectionExpanded] = useState(true);
  const [groupDraft, setGroupDraft] = useState<SharedGroupDraft>(EMPTY_GROUP_DRAFT);
  const [stepInsertIndex, setStepInsertIndex] = useState<number | null>(null);
  const [newStepDraft, setNewStepDraft] = useState<SharedGroupStepInput>(EMPTY_SHARED_GROUP_STEP_INPUT);
  const [expandedStepIds, setExpandedStepIds] = useState<string[]>([]);
  const [linkedPreviewCaseId, setLinkedPreviewCaseId] = useState("");
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [copiedSteps, setCopiedSteps] = useState<CopiedSharedGroupStep[]>([]);
  const [cutStepIds, setCutStepIds] = useState<string[]>([]);
  const [isParameterDialogOpen, setIsParameterDialogOpen] = useState(false);
  const [sharedParameterValues, setSharedParameterValues] = useState<Record<string, string>>({});
  const [isUsageDialogOpen, setIsUsageDialogOpen] = useState(false);

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
  const requirementsQuery = useQuery({
    queryKey: ["shared-steps-requirements", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const testCasesQuery = useQuery({
    queryKey: ["shared-steps-test-cases", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId)
  });
  const suitesQuery = useQuery({
    queryKey: ["shared-steps-test-suites", appTypeId],
    queryFn: () => api.testSuites.list({ app_type_id: appTypeId }),
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
  const requirements = requirementsQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const suites = suitesQuery.data || [];

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
    setSelectedGroupIds([]);
    setIsCreating(false);
    setGroupDraft(EMPTY_GROUP_DRAFT);
    setExpandedStepIds([]);
    setSelectedStepIds([]);
    setCutStepIds([]);
    setSharedParameterValues({});
    setIsParameterDialogOpen(false);
    setIsUsageDialogOpen(false);
    resetStepComposer();
  }, [appTypeId]);

  useEffect(() => {
    const nextStepIds = groupDraft.steps.map((step) => step.id);

    setExpandedStepIds((current) => {
      const nextExpandedIds = current.filter((id) => nextStepIds.includes(id));
      return nextExpandedIds.length === current.length ? current : nextExpandedIds;
    });
  }, [groupDraft.steps]);

  useEffect(() => {
    const validStepIds = new Set(groupDraft.steps.map((step) => step.id));
    setSelectedStepIds((current) => current.filter((id) => validStepIds.has(id)));
    setCutStepIds((current) => current.filter((id) => validStepIds.has(id)));
  }, [groupDraft.steps]);

  useEffect(() => {
    setSharedParameterValues({});
    setIsParameterDialogOpen(false);
    setIsUsageDialogOpen(false);
  }, [isCreating, selectedGroupId]);

  useEffect(() => {
    setIsHeaderSectionExpanded(true);
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
    const validGroupIds = new Set(sharedGroups.map((group) => group.id));
    setSelectedGroupIds((current) => current.filter((groupId) => validGroupIds.has(groupId)));
  }, [sharedGroups]);

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
  const visibleGroupIds = useMemo(() => filteredGroups.map((group) => group.id), [filteredGroups]);
  const selectedVisibleGroupIds = useMemo(
    () => selectedGroupIds.filter((groupId) => visibleGroupIds.includes(groupId)),
    [selectedGroupIds, visibleGroupIds]
  );

  const selectedProject = projects.find((project) => project.id === projectId) || null;
  const selectedAppType = appTypes.find((appType) => appType.id === appTypeId) || null;
  const linkedPreviewCase = useMemo(
    () => testCases.find((testCase) => testCase.id === linkedPreviewCaseId) || null,
    [linkedPreviewCaseId, testCases]
  );

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
    setSelectedStepIds([]);
    setCutStepIds([]);
    resetStepComposer();
  };

  const closeWorkspace = () => {
    setSelectedGroupId("");
    setIsCreating(false);
    setGroupDraft(EMPTY_GROUP_DRAFT);
    setExpandedStepIds([]);
    setSelectedStepIds([]);
    setCutStepIds([]);
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

  const toggleDraftStepSelected = (stepId: string, checked: boolean) => {
    setSelectedStepIds((current) => (checked ? Array.from(new Set([...current, stepId])) : current.filter((id) => id !== stepId)));
  };

  const copyDraftSteps = (stepIds: string[]) => {
    const stepsToCopy = groupDraft.steps
      .filter((step) => stepIds.includes(step.id))
      .map((step) => ({ action: step.action, expected_result: step.expected_result, id: step.id }));

    if (!stepsToCopy.length) {
      return;
    }

    setCopiedSteps(stepsToCopy);
    setCutStepIds([]);
  };

  const cutDraftSteps = (stepIds: string[]) => {
    const stepsToCut = groupDraft.steps
      .filter((step) => stepIds.includes(step.id))
      .map((step) => ({ action: step.action, expected_result: step.expected_result, id: step.id }));

    if (!stepsToCut.length) {
      return;
    }

    setCopiedSteps(stepsToCut);
    setCutStepIds(stepIds);
  };

  const pasteDraftStepsAt = (index: number) => {
    if (!copiedSteps.length) {
      return;
    }

    setGroupDraft((current) => {
      const filteredSteps = cutStepIds.length ? current.steps.filter((step) => !cutStepIds.includes(step.id)) : current.steps;
      const insertIndex = Math.max(0, Math.min(index, filteredSteps.length));
      const nextSteps = [...filteredSteps];
      nextSteps.splice(insertIndex, 0, ...copiedSteps.map((step) => cloneSharedGroupStep(step)));

      return {
        ...current,
        steps: nextSteps
      };
    });

    if (cutStepIds.length) {
      setSelectedStepIds((current) => current.filter((id) => !cutStepIds.includes(id)));
      setCutStepIds([]);
    }
  };

  const deleteDraftSteps = (stepIds: string[]) => {
    if (!stepIds.length) {
      return;
    }

    setGroupDraft((current) => ({
      ...current,
      steps: current.steps.filter((step) => !stepIds.includes(step.id))
    }));
    setSelectedStepIds((current) => current.filter((id) => !stepIds.includes(id)));
    setCutStepIds((current) => current.filter((id) => !stepIds.includes(id)));
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

  const handleDeleteSelectedGroups = async () => {
    const groupsToDelete = sharedGroups.filter((group) => selectedVisibleGroupIds.includes(group.id));

    if (!groupsToDelete.length) {
      showError(new Error("Select one or more visible shared groups to delete."), "Unable to delete selected shared groups");
      return;
    }

    if (!window.confirm(`Delete ${groupsToDelete.length} shared group${groupsToDelete.length === 1 ? "" : "s"}? Linked test cases will keep their steps as local groups.`)) {
      return;
    }

    try {
      const results = await Promise.allSettled(groupsToDelete.map((group) => deleteSharedGroup.mutateAsync(group.id)));
      const deletedIds = groupsToDelete
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((group) => group.id);

      deletedIds.forEach((groupId) => removeSharedStepGroupFromCache(queryClient, appTypeId, groupId));

      setSelectedGroupIds((current) => current.filter((groupId) => !deletedIds.includes(groupId)));

      if (selectedGroupId && deletedIds.includes(selectedGroupId)) {
        setSelectedGroupId("");
        setGroupDraft(EMPTY_GROUP_DRAFT);
        resetStepComposer();
      }

      await refreshGroups();
      showSuccess(
        deletedIds.length
          ? `${deletedIds.length} shared group${deletedIds.length === 1 ? "" : "s"} deleted.`
          : "No shared groups were deleted."
      );
    } catch (error) {
      showError(error, "Unable to delete selected shared groups");
    }
  };

  const coverageMeta = {
    total: sharedGroups.length,
    totalSteps: sharedGroups.reduce((count, group) => count + (group.step_count || group.steps.length || 0), 0),
    usedInCases: sharedGroups.reduce((count, group) => count + (group.usage_count || 0), 0)
  };
  const openTestCaseWorkspace = (testCaseId: string) => setLinkedPreviewCaseId(testCaseId);
  const authoringSectionItems = useMemo(
    () =>
      TEST_AUTHORING_SECTION_ITEMS.map((item) => ({
        ...item,
        meta:
          item.to === "/requirements"
            ? String(requirements.length)
            : item.to === "/test-cases"
              ? String(testCases.length)
              : item.to === "/shared-steps"
                ? String(sharedGroups.length)
                : item.to === "/design"
                  ? String(suites.length)
                  : undefined
      })),
    [requirements.length, sharedGroups.length, suites.length, testCases.length]
  );
  const allStepsSelected = Boolean(groupDraft.steps.length) && selectedStepIds.length === groupDraft.steps.length;
  const sharedEditorActions: SharedGroupStepActionMenuAction[] = [
    {
      label: "Expand all steps",
      description: "Open every shared step editor in this group.",
      icon: <SharedGroupStepExpandAllIcon />,
      onClick: () => setExpandedStepIds(groupDraft.steps.map((step) => step.id)),
      disabled: !groupDraft.steps.length
    },
    {
      label: "Collapse all steps",
      description: "Close every shared step editor in this group.",
      icon: <SharedGroupStepCollapseAllIcon />,
      onClick: () => setExpandedStepIds([]),
      disabled: !expandedStepIds.length
    },
    {
      label: "Copy selected steps",
      description: "Place the selected shared steps in the clipboard.",
      icon: <SharedGroupStepCopyIcon />,
      onClick: () => copyDraftSteps(selectedStepIds),
      disabled: !selectedStepIds.length
    },
    {
      label: "Cut selected steps",
      description: "Move the selected shared steps after you paste them somewhere else.",
      icon: <SharedGroupStepCutIcon />,
      onClick: () => cutDraftSteps(selectedStepIds),
      disabled: !selectedStepIds.length
    },
    {
      label: "Paste at end",
      description: "Insert the clipboard steps after the current shared group steps.",
      icon: <SharedGroupStepPasteIcon />,
      onClick: () => pasteDraftStepsAt(groupDraft.steps.length),
      disabled: !copiedSteps.length
    },
    {
      label: "Delete selected steps",
      description: "Remove the selected shared steps from this group.",
      icon: <SharedGroupStepDeleteIcon />,
      onClick: () => deleteDraftSteps(selectedStepIds),
      disabled: !selectedStepIds.length,
      tone: "danger"
    }
  ];

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
            <AddIcon />
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

      <WorkspaceSectionTabs ariaLabel="Test authoring sections" items={authoringSectionItems} />

      <WorkspaceMasterDetail
        browseView={(
          <Panel
            title="Shared step list"
            subtitle={appTypeId ? undefined : "Choose an app type to begin."}
          >
            <div className="design-list-toolbar test-case-catalog-toolbar">
              <CatalogViewToggle onChange={setCatalogViewMode} value={catalogViewMode} />
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
              <button
                className="ghost-button"
                disabled={!visibleGroupIds.length || selectedVisibleGroupIds.length === visibleGroupIds.length}
                onClick={() => setSelectedGroupIds((current) => Array.from(new Set([...current, ...visibleGroupIds])))}
                type="button"
              >
                Select visible
              </button>
              <button
                className="ghost-button"
                disabled={!selectedGroupIds.length}
                onClick={() => setSelectedGroupIds([])}
                type="button"
              >
                Clear selection
              </button>
              <button
                className="ghost-button danger"
                disabled={!selectedVisibleGroupIds.length || deleteSharedGroup.isPending}
                onClick={() => void handleDeleteSelectedGroups()}
                type="button"
              >
                Delete selected
              </button>
              <button className="ghost-button" disabled={!appTypeId} onClick={beginCreateGroup} type="button">
                New group
              </button>
            </div>

            <TileBrowserPane className="test-case-library-scroll">
              {sharedGroupsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
              {!sharedGroupsQuery.isLoading && filteredGroups.length && catalogViewMode === "tile" ? (
                <div className="tile-browser-grid">
                  {filteredGroups.map((group) => {
                    const isActive = !isCreating && selectedGroupId === group.id;
                    const isSelected = selectedGroupIds.includes(group.id);
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
                          setSelectedStepIds([]);
                          setCutStepIds([]);
                          resetStepComposer();
                        }}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row">
                            <label className="checkbox-field" onClick={(event) => event.stopPropagation()}>
                              <input
                                checked={isSelected}
                                onChange={(event) => {
                                  setSelectedGroupIds((current) =>
                                    event.target.checked
                                      ? [...current, group.id]
                                      : current.filter((groupId) => groupId !== group.id)
                                  );
                                }}
                                type="checkbox"
                              />
                              <DisplayIdBadge value={group.display_id || group.id} />
                            </label>
                          </div>
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
              {!sharedGroupsQuery.isLoading && filteredGroups.length && catalogViewMode === "list" ? (
                <div className="table-wrap catalog-table-wrap">
                  <table className="data-table catalog-data-table">
                    <thead>
                      <tr>
                        <th />
                        <th>ID</th>
                        <th>Group</th>
                        <th>Steps</th>
                        <th>Used in cases</th>
                        <th>Updated</th>
                        <th>Scope</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGroups.map((group) => {
                        const stepCount = group.step_count || group.steps.length;
                        const usageCount = group.usage_count || 0;

                        return (
                          <tr
                            className={!isCreating && selectedGroupId === group.id ? "is-active-row" : ""}
                            key={group.id}
                            onClick={() => {
                              setSelectedGroupId(group.id);
                              setIsCreating(false);
                              setSelectedStepIds([]);
                              setCutStepIds([]);
                              resetStepComposer();
                            }}
                          >
                            <td onClick={(event) => event.stopPropagation()}>
                              <input
                                checked={selectedGroupIds.includes(group.id)}
                                onChange={(event) => {
                                  setSelectedGroupIds((current) =>
                                    event.target.checked ? [...new Set([...current, group.id])] : current.filter((groupId) => groupId !== group.id)
                                  );
                                }}
                                type="checkbox"
                              />
                            </td>
                            <td><DisplayIdBadge value={group.display_id || group.id} /></td>
                            <td>
                              <strong>{group.name}</strong>
                              <div className="catalog-row-subcopy">{group.description || "Reusable shared step group"}</div>
                            </td>
                            <td>{stepCount}</td>
                            <td>{usageCount}</td>
                            <td>{formatSharedStepDate(group.updated_at)}</td>
                            <td>{selectedAppType?.name || "App type"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
            title="Shared step workspace"
            subtitle={selectedGroupId || isCreating ? "Edit the shared group and keep its step sequence ready for test case insertion." : "Select a shared step group or create a new one."}
          >
            {selectedGroupId || isCreating ? (
              <form className="detail-stack shared-step-workspace-form" onSubmit={(event) => void handleSaveGroup(event)}>
                <div className="shared-step-workspace-nav">
                  <WorkspaceBackButton label="Back to shared step list" onClick={closeWorkspace} />
                </div>
                <SharedStepAccordionSection
                  countLabel={groupDraft.name.trim() ? "Ready" : "Draft"}
                  isExpanded={isHeaderSectionExpanded}
                  onToggle={() => setIsHeaderSectionExpanded((current) => !current)}
                  summary="Set the shared group name and description before curating the linked reusable steps."
                  title="Shared step group details"
                >
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
                </SharedStepAccordionSection>

                  <div className="step-editor step-editor--embedded step-editor--shared">
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
                      {selectedGroup.usage_count ? (
                        <button className="ghost-button inline-button" onClick={() => setIsUsageDialogOpen(true)} type="button">
                          <LinkedCasesIcon />
                          <span>View linked cases</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  {!groupDraft.steps.length ? (
                    <div className="empty-state compact">No shared steps yet. Add at least one step so this group is useful across cases.</div>
                  ) : null}

                          <div className="action-row step-editor-toolbar">
                    <label className="checkbox-field step-select-all">
                      <input
                        checked={allStepsSelected}
                        disabled={!groupDraft.steps.length}
                        onChange={(event) =>
                          setSelectedStepIds(event.target.checked ? groupDraft.steps.map((step) => step.id) : [])
                        }
                        type="checkbox"
                      />
                      Select all steps
                    </label>
                    <button className="ghost-button" onClick={() => setIsParameterDialogOpen(true)} type="button">
                      <SharedGroupParameterIcon />
                      <span>{detectedSharedParameters.length ? `Params · ${detectedSharedParameters.length}` : "Params"}</span>
                    </button>
                    <SharedGroupStepActionMenu
                      actions={sharedEditorActions}
                      className="step-card-menu--inline step-card-menu--inline-right"
                      label="Shared step actions"
                      previewActions={sharedEditorActions}
                    />
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
                          canPaste={Boolean(copiedSteps.length)}
                          isExpanded={expandedStepIds.includes(step.id)}
                          isSelected={selectedStepIds.includes(step.id)}
                          parameterValues={sharedParameterValues}
                          onChange={(input) => updateDraftStep(step.id, input)}
                          onCopy={() => copyDraftSteps([step.id])}
                          onCut={() => cutDraftSteps([step.id])}
                          onDelete={() => deleteDraftSteps([step.id])}
                          onInsertAbove={() => activateStepInsert(index)}
                          onInsertBelow={() => activateStepInsert(index + 1)}
                          onMoveDown={() => moveDraftStep(step.id, "down")}
                          onMoveUp={() => moveDraftStep(step.id, "up")}
                          onPasteAbove={() => pasteDraftStepsAt(index)}
                          onPasteBelow={() => pasteDraftStepsAt(index + 1)}
                          onToggle={() => toggleDraftStepExpanded(step.id)}
                          onToggleSelect={(checked) => toggleDraftStepSelected(step.id, checked)}
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

      {isUsageDialogOpen && selectedGroup ? (
        <SharedStepUsageDialog
          groupName={selectedGroup.name}
          onClose={() => setIsUsageDialogOpen(false)}
          onViewTestCase={openTestCaseWorkspace}
          usedTestCases={selectedGroup.used_test_cases || []}
        />
      ) : null}

      {linkedPreviewCase ? (
        <LinkedTestCaseModal
          appTypeName={selectedAppType?.name || ""}
          projectName={selectedProject?.name || ""}
          requirements={requirements}
          suites={suites}
          testCase={linkedPreviewCase}
          onClose={() => setLinkedPreviewCaseId("")}
        />
      ) : null}
    </div>
  );
}

function SharedStepUsageDialog({
  groupName,
  usedTestCases,
  onClose,
  onViewTestCase
}: {
  groupName: string;
  usedTestCases: Array<{
    id: string;
    title: string;
    status: string | null;
    referenced_step_count: number;
  }>;
  onClose: () => void;
  onViewTestCase: (testCaseId: string) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-labelledby="shared-step-usage-title"
        aria-modal="true"
        className="modal-card shared-step-usage-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="import-modal-header">
          <div className="import-modal-title">
            <p className="eyebrow">Linked Cases</p>
            <h3 id="shared-step-usage-title">{groupName}</h3>
            <p>These test cases are currently linked to this shared group.</p>
          </div>
          <button aria-label="Close linked cases dialog" className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="stack-list">
          {usedTestCases.map((testCase) => (
            <div className="stack-item shared-step-usage-row" key={testCase.id}>
              <div className="shared-step-usage-copy">
                <strong>{testCase.title}</strong>
                <span>{testCase.referenced_step_count} linked step{testCase.referenced_step_count === 1 ? "" : "s"} from this group</span>
              </div>
              <div className="shared-step-usage-actions">
                <StatusBadge value={testCase.status || "draft"} />
                <button className="ghost-button inline-button" onClick={() => onViewTestCase(testCase.id)} type="button">
                  <TileCardLinkIcon />
                  <span>View test case</span>
                </button>
              </div>
            </div>
          ))}
          {!usedTestCases.length ? <div className="empty-state compact">No linked test cases yet.</div> : null}
        </div>
      </div>
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

function LinkedCasesIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 1 0-7.07-7.07L10.8 5.1" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.8 13.12a5 5 0 0 0 7.07 7.07l1.33-1.29" />
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

function SharedGroupStepExpandAllIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 12V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M12 12v8" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepCollapseAllIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M12 4v8" />
      <path d="m8.5 8.5 3.5 3.5 3.5-3.5" />
      <path d="M12 20v-8" />
      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepCopyIcon() {
  return (
    <SharedGroupStepIconShell>
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepCutIcon() {
  return (
    <SharedGroupStepIconShell>
      <circle cx="6" cy="7" r="2" />
      <circle cx="6" cy="17" r="2" />
      <path d="M8 8.5 19 18" />
      <path d="M8 15.5 19 6" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepPasteIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepPasteAboveIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 16V10" />
      <path d="m8.5 12.5 3.5-3.5 3.5 3.5" />
    </SharedGroupStepIconShell>
  );
}

function SharedGroupStepPasteBelowIcon() {
  return (
    <SharedGroupStepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m8.5 15.5 3.5 3.5 3.5-3.5" />
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
  actions,
  previewActions,
  openOnHover = false,
  className = ""
}: {
  label: string;
  actions: SharedGroupStepActionMenuAction[];
  previewActions?: SharedGroupStepActionMenuAction[];
  openOnHover?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const visiblePreviewActions = previewActions?.filter((action) => !action.disabled).slice(0, 3) || [];

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
    <div
      className={["step-card-menu", "step-card-menu--floating", className].filter(Boolean).join(" ")}
      onMouseEnter={openOnHover ? () => setIsOpen(true) : undefined}
      onMouseLeave={openOnHover ? () => setIsOpen(false) : undefined}
    >
      {visiblePreviewActions.length ? (
        <div className="step-card-menu-preview" aria-hidden="true">
          {visiblePreviewActions.map((action) => (
            <span className="step-card-menu-preview-icon" key={action.label} title={action.label}>
              {action.icon}
            </span>
          ))}
        </div>
      ) : null}
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
          <FormField label="Expected result">
            <textarea
              rows={3}
              value={draft.expected_result}
              onChange={(event) => onChange({ ...draft, expected_result: event.target.value })}
            />
          </FormField>
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
  isSelected,
  isExpanded,
  canPaste,
  canMoveUp,
  canMoveDown,
  onChange,
  onCopy,
  onCut,
  onDelete,
  onInsertAbove,
  onInsertBelow,
  onMoveUp,
  onMoveDown,
  onPasteAbove,
  onPasteBelow,
  onToggle,
  onToggleSelect
}: {
  step: SharedGroupDraftStep;
  stepNumber: number;
  parameterValues: Record<string, string>;
  isSelected: boolean;
  isExpanded: boolean;
  canPaste: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (input: SharedGroupStepInput) => void;
  onCopy: () => void;
  onCut: () => void;
  onDelete: () => void;
  onInsertAbove: () => void;
  onInsertBelow: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onPasteAbove: () => void;
  onPasteBelow: () => void;
  onToggle: () => void;
  onToggleSelect: (checked: boolean) => void;
}) {
  const stepLabel = "Shared group step";
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
    ...(canPaste
      ? [{
          label: "Paste above",
          description: "Insert the clipboard steps before this shared step.",
          icon: <SharedGroupStepPasteAboveIcon />,
          onClick: onPasteAbove
        }, {
          label: "Paste below",
          description: "Insert the clipboard steps after this shared step.",
          icon: <SharedGroupStepPasteBelowIcon />,
          onClick: onPasteBelow
        }]
      : []),
    {
      label: "Copy step",
      description: "Place this shared step in the clipboard.",
      icon: <SharedGroupStepCopyIcon />,
      onClick: onCopy
    },
    {
      label: "Cut step",
      description: "Move this shared step after you paste it somewhere else.",
      icon: <SharedGroupStepCutIcon />,
      onClick: onCut
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
        <label className="checkbox-field step-card-select">
          <input
            aria-label={`Select step ${stepNumber}`}
            checked={isSelected}
            onChange={(event) => onToggleSelect(event.target.checked)}
            type="checkbox"
          />
        </label>
        <button
          aria-label={isExpanded ? `Hide shared step ${stepNumber} details` : `Show shared step ${stepNumber} details`}
          className="step-card-toggle"
          onClick={onToggle}
          type="button"
        >
          <div className="step-card-summary">
            <div className="step-card-summary-top">
              <span aria-label={stepLabel} className="step-kind-badge is-shared" title={stepLabel}>
                <SharedStepsIconGraphic size={16} />
              </span>
              <strong>Step {stepNumber}</strong>
              <span className="step-group-chip is-shared">{stepLabel}</span>
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
          previewActions={stepActions}
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
          <FormField label="Expected result">
            <textarea
              rows={3}
              value={step.expected_result}
              onChange={(event) => onChange({ action: step.action, expected_result: event.target.value })}
            />
          </FormField>
        </div>
      ) : null}
    </article>
  );
}

function SharedStepAccordionSection({
  title,
  summary,
  countLabel,
  isExpanded,
  onToggle,
  children
}: {
  title: string;
  summary: string;
  countLabel: string;
  isExpanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={isExpanded ? "requirement-accordion-section is-expanded" : "requirement-accordion-section"}>
      <button
        aria-expanded={isExpanded}
        className="requirement-accordion-toggle"
        onClick={onToggle}
        type="button"
      >
        <div className="requirement-accordion-toggle-main">
          <span aria-hidden="true" className={isExpanded ? "requirement-accordion-icon is-expanded" : "requirement-accordion-icon"}>
            <SharedStepAccordionChevronIcon />
          </span>
          <div className="requirement-accordion-toggle-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
        </div>
        <div className="requirement-accordion-toggle-meta">
          <span className="requirement-accordion-toggle-count">{countLabel}</span>
          <span className="requirement-accordion-toggle-state">{isExpanded ? "Collapse" : "Expand"}</span>
        </div>
      </button>
      {isExpanded ? <div className="requirement-accordion-body">{children}</div> : null}
    </section>
  );
}

function SharedStepAccordionChevronIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
