import { FormEvent, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AddIcon } from "../components/AppIcons";
import { api } from "../lib/api";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import {
  TileCardAppTypesIcon,
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardProjectIcon,
  TileCardRequirementIcon,
  TileCardUsersIcon
} from "../components/TileCardPrimitives";
import { SubnavTabs } from "../components/SubnavTabs";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { useAuth } from "../auth/AuthContext";
import type { AppType } from "../types";

type ProjectSection = "members" | "appTypes";

type ProjectAppTypeDraft = {
  id: string;
  name: string;
  type: AppType["type"];
  is_unified: boolean;
};

type ProjectCreateDraft = {
  name: string;
  description: string;
  memberIds: string[];
  appTypes: ProjectAppTypeDraft[];
};

type ProjectRequirementCoverage = {
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercent: number;
};

const createDraftId = () =>
  globalThis.crypto?.randomUUID?.() || `project-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createProjectAppTypeDraft = (defaultType: string): ProjectAppTypeDraft => ({
  id: createDraftId(),
  name: "",
  type: (defaultType || "web") as AppType["type"],
  is_unified: false
});

const createInitialProjectDraft = (defaultType: string): ProjectCreateDraft => ({
  name: "",
  description: "",
  memberIds: [],
  appTypes: [createProjectAppTypeDraft(defaultType)]
});

const emptyRequirementCoverage: ProjectRequirementCoverage = {
  totalRequirements: 0,
  coveredRequirements: 0,
  coveragePercent: 0
};

const getCoverageClassName = (coverage: ProjectRequirementCoverage) => {
  if (!coverage.totalRequirements) {
    return "project-coverage-circle is-empty";
  }

  if (coverage.coveragePercent >= 100) {
    return "project-coverage-circle is-complete";
  }

  if (coverage.coveredRequirements > 0) {
    return "project-coverage-circle is-partial";
  }

  return "project-coverage-circle is-uncovered";
};

const getCoverageTitle = (coverage: ProjectRequirementCoverage) =>
  coverage.totalRequirements
    ? `Requirements coverage: ${coverage.coveragePercent}% (${coverage.coveredRequirements}/${coverage.totalRequirements} requirements linked to test cases)`
    : "Requirements coverage: 0% (no requirements yet)";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const domainMetadataQuery = useDomainMetadata();
  const { projects, users, roles, projectMembers, appTypes, requirements, testCases } = useWorkspaceData();
  const [selectedProjectId, setSelectedProjectId] = useCurrentProject();
  const [focusedProjectId, setFocusedProjectId] = useState("");
  const [section, setSection] = useState<ProjectSection>("members");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [projectAppTypeFilter, setProjectAppTypeFilter] = useState("all");
  const [projectMemberFilter, setProjectMemberFilter] = useState("all");
  const defaultAppTypeValue = domainMetadataQuery.data?.app_types.default_type || "web";
  const appTypeTypeOptions = domainMetadataQuery.data?.app_types.types || [];
  const [projectDraft, setProjectDraft] = useState<ProjectCreateDraft>(() => createInitialProjectDraft(defaultAppTypeValue));

  const projectItems = projects.data || [];
  const isProjectCatalogLoading =
    projects.isPending ||
    projectMembers.isPending ||
    appTypes.isPending ||
    requirements.isPending ||
    testCases.isPending;

  useEffect(() => {
    if (projects.isPending) {
      return;
    }

    if (!projectItems.length) {
      if (selectedProjectId) {
        setSelectedProjectId("");
      }
      return;
    }

    if (!selectedProjectId || !projectItems.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projectItems[0].id);
    }
  }, [projectItems, projects.isPending, selectedProjectId, setSelectedProjectId]);

  const selectedProject = useMemo(
    () => projectItems.find((project) => project.id === selectedProjectId) || projectItems[0],
    [projectItems, selectedProjectId]
  );
  const focusedProject = useMemo(
    () => projectItems.find((project) => project.id === focusedProjectId) || null,
    [focusedProjectId, projectItems]
  );
  const projectId = selectedProject?.id;

  useEffect(() => {
    if (focusedProjectId && !projectItems.some((project) => project.id === focusedProjectId)) {
      setFocusedProjectId("");
    }
  }, [focusedProjectId, projectItems]);

  useEffect(() => {
    if (focusedProjectId && selectedProjectId && focusedProjectId !== selectedProjectId) {
      setFocusedProjectId(selectedProjectId);
    }
  }, [focusedProjectId, selectedProjectId]);

  const memberCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (projectMembers.data || []).forEach((member) => {
      counts[member.project_id] = (counts[member.project_id] || 0) + 1;
    });

    return counts;
  }, [projectMembers.data]);

  const projectMemberUserIdsByProjectId = useMemo(() => {
    const map = new Map<string, Set<string>>();

    (projectMembers.data || []).forEach((member) => {
      const current = map.get(member.project_id) || new Set<string>();
      current.add(member.user_id);
      map.set(member.project_id, current);
    });

    return map;
  }, [projectMembers.data]);

  const userSearchValueById = useMemo(() => {
    const map = new Map<string, string>();

    (users.data || []).forEach((user) => {
      map.set(user.id, [user.name, user.email].filter(Boolean).join(" ").toLowerCase());
    });

    return map;
  }, [users.data]);

  const appTypesByProjectId = useMemo(() => {
    const map: Record<string, AppType[]> = {};

    (appTypes.data || []).forEach((appType) => {
      map[appType.project_id] = [...(map[appType.project_id] || []), appType];
    });

    return map;
  }, [appTypes.data]);

  const appTypeCountByProjectId = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(appTypesByProjectId).map(([currentProjectId, projectAppTypes]) => [currentProjectId, projectAppTypes.length])
      ) as Record<string, number>,
    [appTypesByProjectId]
  );

  const requirementCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (requirements.data || []).forEach((requirement) => {
      counts[requirement.project_id] = (counts[requirement.project_id] || 0) + 1;
    });

    return counts;
  }, [requirements.data]);

  const projectIdByAppTypeId = useMemo(() => {
    const map = new Map<string, string>();

    (appTypes.data || []).forEach((appType) => {
      map.set(appType.id, appType.project_id);
    });

    return map;
  }, [appTypes.data]);

  const testCaseCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (testCases.data || []).forEach((testCase) => {
      if (!testCase.app_type_id) {
        return;
      }

      const owningProjectId = projectIdByAppTypeId.get(testCase.app_type_id);
      if (!owningProjectId) {
        return;
      }

      counts[owningProjectId] = (counts[owningProjectId] || 0) + 1;
    });

    return counts;
  }, [projectIdByAppTypeId, testCases.data]);

  const requirementCoverageByProjectId = useMemo(() => {
    const requirementProjectById = new Map((requirements.data || []).map((requirement) => [requirement.id, requirement.project_id]));
    const coveredRequirementIdsByProjectId = new Map<string, Set<string>>();

    const markRequirementCovered = (projectId: string, requirementId: string) => {
      const current = coveredRequirementIdsByProjectId.get(projectId) || new Set<string>();
      current.add(requirementId);
      coveredRequirementIdsByProjectId.set(projectId, current);
    };

    (requirements.data || []).forEach((requirement) => {
      if ((requirement.test_case_ids || []).filter(Boolean).length) {
        markRequirementCovered(requirement.project_id, requirement.id);
      }
    });

    (testCases.data || []).forEach((testCase) => {
      const owningProjectId = testCase.app_type_id ? projectIdByAppTypeId.get(testCase.app_type_id) : "";
      const linkedRequirementIds = [...(testCase.requirement_ids || []), testCase.requirement_id].filter(Boolean) as string[];

      linkedRequirementIds.forEach((requirementId) => {
        const requirementProjectId = requirementProjectById.get(requirementId);

        if (!requirementProjectId || (owningProjectId && owningProjectId !== requirementProjectId)) {
          return;
        }

        markRequirementCovered(requirementProjectId, requirementId);
      });
    });

    const coverageByProjectId: Record<string, ProjectRequirementCoverage> = {};

    projectItems.forEach((project) => {
      const totalRequirements = requirementCountByProjectId[project.id] || 0;
      const coveredRequirements = Math.min(coveredRequirementIdsByProjectId.get(project.id)?.size || 0, totalRequirements);

      coverageByProjectId[project.id] = {
        totalRequirements,
        coveredRequirements,
        coveragePercent: totalRequirements ? Math.round((coveredRequirements / totalRequirements) * 100) : 0
      };
    });

    return coverageByProjectId;
  }, [projectIdByAppTypeId, projectItems, requirementCountByProjectId, requirements.data, testCases.data]);

  const filteredProjectItems = useMemo(() => {
    const normalizedSearch = projectSearch.trim().toLowerCase();

    return projectItems.filter((project) => {
      const projectAppTypes = appTypesByProjectId[project.id] || [];
      const projectMemberUserIds = projectMemberUserIdsByProjectId.get(project.id) || new Set<string>();
      const searchContent = [
        project.name,
        project.display_id,
        project.description,
        ...projectAppTypes.flatMap((appType) => [appType.name, appType.type]),
        ...Array.from(projectMemberUserIds).map((userId) => userSearchValueById.get(userId))
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (normalizedSearch && !searchContent.includes(normalizedSearch)) {
        return false;
      }

      if (projectAppTypeFilter === "with-app-types" && !projectAppTypes.length) {
        return false;
      }

      if (projectAppTypeFilter === "without-app-types" && projectAppTypes.length) {
        return false;
      }

      if (
        projectAppTypeFilter !== "all" &&
        projectAppTypeFilter !== "with-app-types" &&
        projectAppTypeFilter !== "without-app-types" &&
        !projectAppTypes.some((appType) => appType.type === projectAppTypeFilter)
      ) {
        return false;
      }

      if (projectMemberFilter === "with-members" && !projectMemberUserIds.size) {
        return false;
      }

      if (projectMemberFilter === "without-members" && projectMemberUserIds.size) {
        return false;
      }

      if (
        projectMemberFilter !== "all" &&
        projectMemberFilter !== "with-members" &&
        projectMemberFilter !== "without-members" &&
        !projectMemberUserIds.has(projectMemberFilter)
      ) {
        return false;
      }

      return true;
    });
  }, [
    appTypesByProjectId,
    projectAppTypeFilter,
    projectItems,
    projectMemberFilter,
    projectMemberUserIdsByProjectId,
    projectSearch,
    userSearchValueById
  ]);

  const activeProjectFilterCount =
    (projectAppTypeFilter !== "all" ? 1 : 0) + (projectMemberFilter !== "all" ? 1 : 0);

  const scopedMembers = useMemo(
    () => (projectMembers.data || []).filter((member) => member.project_id === projectId),
    [projectMembers.data, projectId]
  );
  const scopedAppTypes = useMemo(
    () => (appTypes.data || []).filter((item) => item.project_id === projectId),
    [appTypes.data, projectId]
  );

  const projectMemberOptions = useMemo(
    () =>
      [...(users.data || [])].sort((left, right) => {
        const leftAuto = left.id === session?.user.id || left.role === "admin";
        const rightAuto = right.id === session?.user.id || right.role === "admin";

        if (leftAuto !== rightAuto) {
          return leftAuto ? -1 : 1;
        }

        return String(left.name || left.email).localeCompare(String(right.name || right.email));
      }),
    [session?.user.id, users.data]
  );
  const selectableProjectMemberIds = useMemo(
    () =>
      projectMemberOptions
        .filter((user) => user.id !== session?.user.id && user.role !== "admin")
        .map((user) => user.id),
    [projectMemberOptions, session?.user.id]
  );
  const areAllSelectableProjectMembersSelected =
    Boolean(selectableProjectMemberIds.length) &&
    selectableProjectMemberIds.every((userId) => projectDraft.memberIds.includes(userId));

  const selectedProjectRequirementCount = projectId ? requirementCountByProjectId[projectId] || 0 : 0;
  const selectedProjectTestCaseCount = projectId ? testCaseCountByProjectId[projectId] || 0 : 0;
  const selectedProjectAppTypeCount = projectId ? appTypeCountByProjectId[projectId] || 0 : 0;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project-members"] }),
      queryClient.invalidateQueries({ queryKey: ["app-types"] })
    ]);
  };

  const createProject = useMutation({
    mutationFn: api.projects.create,
    onSuccess: async (response) => {
      setMessageTone("success");
      setMessage(
        `Project created. ${response.members_added} members linked and ${response.app_types_created} app type${response.app_types_created === 1 ? "" : "s"} added.`
      );
      setSelectedProjectId(response.id);
      setFocusedProjectId(response.id);
      setIsCreateModalOpen(false);
      setProjectDraft(createInitialProjectDraft(defaultAppTypeValue));
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to create project");
    }
  });

  useEffect(() => {
    if (!isCreateModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createProject.isPending) {
        setIsCreateModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createProject.isPending, isCreateModalOpen]);

  const createMember = useMutation({
    mutationFn: api.projectMembers.create,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("Project member added.");
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to add project member");
    }
  });

  const createAppType = useMutation({
    mutationFn: api.appTypes.create,
    onSuccess: async () => {
      setMessageTone("success");
      setMessage("App type added.");
      await invalidate();
    },
    onError: (error) => {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to add app type");
    }
  });

  const openCreateProjectModal = () => {
    setProjectDraft(createInitialProjectDraft(defaultAppTypeValue));
    setIsCreateModalOpen(true);
  };

  const closeCreateProjectModal = () => {
    if (createProject.isPending) {
      return;
    }

    setIsCreateModalOpen(false);
  };

  const updateProjectDraft = (input: Partial<ProjectCreateDraft>) => {
    setProjectDraft((current) => ({ ...current, ...input }));
  };

  const toggleProjectDraftMember = (userId: string) => {
    setProjectDraft((current) => ({
      ...current,
      memberIds: current.memberIds.includes(userId)
        ? current.memberIds.filter((id) => id !== userId)
        : [...current.memberIds, userId]
    }));
  };

  const addProjectAppTypeRow = () => {
    setProjectDraft((current) => ({
      ...current,
      appTypes: [...current.appTypes, createProjectAppTypeDraft(defaultAppTypeValue)]
    }));
  };

  const updateProjectAppType = (draftId: string, input: Partial<Omit<ProjectAppTypeDraft, "id">>) => {
    setProjectDraft((current) => ({
      ...current,
      appTypes: current.appTypes.map((appType) => (appType.id === draftId ? { ...appType, ...input } : appType))
    }));
  };

  const removeProjectAppType = (draftId: string) => {
    setProjectDraft((current) => {
      if (current.appTypes.length === 1) {
        return {
          ...current,
          appTypes: [createProjectAppTypeDraft(defaultAppTypeValue)]
        };
      }

      return {
        ...current,
        appTypes: current.appTypes.filter((appType) => appType.id !== draftId)
      };
    });
  };

  const handleProjectCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      setMessageTone("error");
      setMessage("You need an active session to create a project.");
      return;
    }

    const normalizedName = projectDraft.name.trim();
    if (!normalizedName) {
      setMessageTone("error");
      setMessage("Project name is required.");
      return;
    }

    const normalizedAppTypes = projectDraft.appTypes
      .map((appType) => ({
        name: appType.name.trim(),
        type: appType.type,
        is_unified: appType.is_unified
      }))
      .filter((appType) => appType.name);

    if (!normalizedAppTypes.length) {
      setMessageTone("error");
      setMessage("At least one app type is required.");
      return;
    }

    createProject.mutate({
      name: normalizedName,
      description: projectDraft.description.trim() || undefined,
      member_ids: projectDraft.memberIds,
      app_types: normalizedAppTypes
    });
  };

  const handleRemoveMember = async (member: { id: string; user_id: string }) => {
    if (member.user_id === session?.user.id) {
      const confirmed = window.confirm(
        "You are removing yourself from this project. You will no longer be able to access it. Continue?"
      );
      if (!confirmed) return;
    }

    try {
      await api.projectMembers.delete(member.id);
      setMessageTone("success");
      setMessage(`Member removed. ${member.user_id === session?.user.id ? "You have been removed from this project." : ""}`);
      await invalidate();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to remove member");
    }
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Projects & Scope"
        title="Projects"
        description="Define workspace scope, onboard collaborators, and configure the delivery surfaces each team owns."
        meta={[
          { label: "Projects", value: projectItems.length },
          { label: "Members in scope", value: selectedProject ? scopedMembers.length : 0 },
          { label: "App types", value: selectedProject ? selectedProjectAppTypeCount : 0 }
        ]}
        actions={<button className="primary-button" onClick={openCreateProjectModal} type="button"><AddIcon />Create Project</button>}
      />

      <ToastMessage
        message={message}
        onDismiss={() => setMessage("")}
        tone={messageTone}
      />

      <WorkspaceMasterDetail
        browseView={(
          <Panel
            title="Projects list"
            subtitle="Browse workspace scope, then open a focused project workspace when you want to edit members or app types."
            actions={(
              <CatalogSearchFilter
                activeFilterCount={activeProjectFilterCount}
                ariaLabel="Search projects"
                onChange={setProjectSearch}
                placeholder="Search projects"
                subtitle="Filter projects by app type scope or project members."
                title="Filter projects"
                type="search"
                value={projectSearch}
              >
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-field">
                    <span>App type</span>
                    <select onChange={(event) => setProjectAppTypeFilter(event.target.value)} value={projectAppTypeFilter}>
                      <option value="all">All app types</option>
                      <option value="with-app-types">Has app types</option>
                      <option value="without-app-types">No app types</option>
                      {appTypeTypeOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="catalog-filter-field">
                    <span>Project member</span>
                    <select onChange={(event) => setProjectMemberFilter(event.target.value)} value={projectMemberFilter}>
                      <option value="all">All members</option>
                      <option value="with-members">Has members</option>
                      <option value="without-members">No members</option>
                      {projectMemberOptions.map((user) => (
                        <option key={user.id} value={user.id}>{user.name || user.email}</option>
                      ))}
                    </select>
                  </label>
                  <div className="catalog-filter-actions">
                    <button
                      className="ghost-button"
                      disabled={!activeProjectFilterCount}
                      onClick={() => {
                        setProjectAppTypeFilter("all");
                        setProjectMemberFilter("all");
                      }}
                      type="button"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>
              </CatalogSearchFilter>
            )}
          >
            {isProjectCatalogLoading ? <TileCardSkeletonGrid className="catalog-grid compact" /> : null}
            {!isProjectCatalogLoading ? (
              <div className="catalog-grid compact">
                {filteredProjectItems.map((project) => {
                  const isSelected = selectedProject?.id === project.id;
                  const memberCount = memberCountByProjectId[project.id] || 0;
                  const appTypeCount = appTypeCountByProjectId[project.id] || 0;
                  const requirementCount = requirementCountByProjectId[project.id] || 0;
                  const testCaseCount = testCaseCountByProjectId[project.id] || 0;
                  const coverage = requirementCoverageByProjectId[project.id] || emptyRequirementCoverage;
                  const coverageTitle = getCoverageTitle(coverage);

                  return (
                    <button
                      key={project.id}
                      aria-pressed={isSelected}
                      className={isSelected ? "catalog-card tile-card project-catalog-card is-active" : "catalog-card tile-card project-catalog-card"}
                      onClick={() => {
                        setSelectedProjectId(project.id);
                        setFocusedProjectId(project.id);
                      }}
                      type="button"
                    >
                      <div className="tile-card-main">
                        <div className="tile-card-header project-card-header">
                          <div className="project-card-icon-row">
                            <TileCardIconFrame className="project-card-icon" tone={isSelected ? "success" : "info"}>
                              <TileCardProjectIcon />
                            </TileCardIconFrame>
                            <DisplayIdBadge value={project.display_id || project.id} />
                          </div>
                          <span
                            aria-label={`${project.name} ${coverageTitle}`}
                            className={getCoverageClassName(coverage)}
                            style={{ "--project-coverage": `${coverage.coveragePercent}%` } as CSSProperties}
                            title={coverageTitle}
                          >
                            <span>{coverage.coveragePercent}%</span>
                          </span>
                        </div>
                        <div className="tile-card-title-group project-card-title-group">
                          <strong>{project.name}</strong>
                        </div>
                        <p className="tile-card-description">{project.description || "No description yet."}</p>
                        <div className="tile-card-facts" aria-label={`${project.name} facts`}>
                          <TileCardFact label={String(memberCount)} title={`${memberCount} member${memberCount === 1 ? "" : "s"}`} tone={memberCount ? "info" : "neutral"}>
                            <TileCardUsersIcon />
                          </TileCardFact>
                          <TileCardFact label={String(appTypeCount)} title={`${appTypeCount} app type${appTypeCount === 1 ? "" : "s"}`} tone={appTypeCount ? "success" : "neutral"}>
                            <TileCardAppTypesIcon />
                          </TileCardFact>
                          <TileCardFact label={String(requirementCount)} title={`${requirementCount} requirement${requirementCount === 1 ? "" : "s"}`} tone={requirementCount ? "warning" : "neutral"}>
                            <TileCardRequirementIcon />
                          </TileCardFact>
                          <TileCardFact label={String(testCaseCount)} title={`${testCaseCount} test case${testCaseCount === 1 ? "" : "s"}`} tone={testCaseCount ? "success" : "neutral"}>
                            <TileCardCaseIcon />
                          </TileCardFact>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {!isProjectCatalogLoading && !projectItems.length ? <div className="empty-state compact">No projects yet. Create the first project to add scope, app types, and the initial team in one flow.</div> : null}
            {!isProjectCatalogLoading && projectItems.length > 0 && !filteredProjectItems.length ? <div className="empty-state compact">No projects match the current search or filters.</div> : null}
          </Panel>
        )}
        detailView={(
          <div className="stack-grid">
            <Panel
              actions={<WorkspaceBackButton label="Back to projects list" onClick={() => setFocusedProjectId("")} />}
              title={focusedProject ? focusedProject.name : "Project summary"}
              subtitle={focusedProject ? "Quick orientation before you dive into related records." : "Select a project to reveal its scoped data."}
            >
              {focusedProject ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{focusedProject.name}</strong>
                    <span>{focusedProject.description || "No description provided yet."}</span>
                  </div>
                  <div className="metric-strip">
                    <div className="mini-card">
                      <strong>{scopedMembers.length}</strong>
                      <span>Members</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedProjectAppTypeCount}</strong>
                      <span>App types</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedProjectRequirementCount}</strong>
                      <span>Requirements</span>
                    </div>
                    <div className="mini-card">
                      <strong>{selectedProjectTestCaseCount}</strong>
                      <span>Test cases</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state compact">Choose a project to continue.</div>
              )}
            </Panel>

            <SubnavTabs
              value={section}
              onChange={setSection}
              items={[
                { value: "members", label: "Members", meta: `${scopedMembers.length}` },
                { value: "appTypes", label: "App Types", meta: `${scopedAppTypes.length}` }
              ]}
            />

            {section === "members" ? (
              <Panel title="Project members" subtitle={projectId ? `Assignments for ${selectedProject?.name}` : "Select a project first"}>
              <form
                className="elevated-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!projectId) return;
                  const formData = new FormData(event.currentTarget);
                  createMember.mutate({
                    project_id: projectId,
                    user_id: String(formData.get("user_id") || ""),
                    role_id: String(formData.get("role_id") || "")
                  });
                  event.currentTarget.reset();
                }}
              >
                <select name="user_id" required defaultValue="">
                  <option value="" disabled>Select user</option>
                  {(users.data || []).map((user) => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}
                </select>
                <select name="role_id" required defaultValue="">
                  <option value="" disabled>Select role</option>
                  {(roles.data || []).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
                <button className="primary-button" disabled={!projectId || createMember.isPending} type="submit">
                  {createMember.isPending ? "Adding…" : "Add member"}
                </button>
              </form>

              <div className="record-grid">
                {scopedMembers.map((member) => {
                  const user = users.data?.find((item) => item.id === member.user_id);
                  const role = roles.data?.find((item) => item.id === member.role_id);
                  const isCurrentUser = member.user_id === session?.user.id;

                  return (
                    <article className="mini-card" key={member.id}>
                      <strong>{user?.name || user?.email || member.user_id}</strong>
                      <span>{role?.name || member.role_id}</span>
                      {isCurrentUser ? <span className="text-muted project-member-note">You</span> : null}
                      <button
                        className="ghost-button danger"
                        onClick={() => void handleRemoveMember(member)}
                        type="button"
                      >
                        Remove
                      </button>
                    </article>
                  );
                })}
              </div>
              {!scopedMembers.length ? <div className="empty-state compact">No members assigned yet.</div> : null}
              </Panel>
            ) : null}

            {section === "appTypes" ? (
              <Panel title="App types" subtitle="Keep platform boundaries readable and lightweight.">
              <form
                className="elevated-toolbar"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!projectId) return;
                  const formData = new FormData(event.currentTarget);
                  createAppType.mutate({
                    project_id: projectId,
                    name: String(formData.get("name") || ""),
                    type: String(formData.get("type") || defaultAppTypeValue) as AppType["type"],
                    is_unified: String(formData.get("is_unified") || "") === "on"
                  });
                  event.currentTarget.reset();
                }}
              >
                <input name="name" required placeholder="Web app" />
                <select name="type" defaultValue={defaultAppTypeValue}>
                  {appTypeTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <label className="checkbox-field">
                  <input name="is_unified" type="checkbox" />
                  Unified
                </label>
                <button className="primary-button" disabled={!projectId || createAppType.isPending} type="submit">
                  {createAppType.isPending ? "Adding…" : "Add app type"}
                </button>
              </form>

              <div className="record-grid">
                {scopedAppTypes.map((item) => (
                  <article className="mini-card" key={item.id}>
                    <strong>{item.name}</strong>
                    <span>{item.type}{item.is_unified ? " · unified" : ""}</span>
                    <button
                      className="ghost-button danger"
                      onClick={() => void api.appTypes.delete(item.id).then(() => {
                        setMessageTone("success");
                        setMessage("App type deleted.");
                        return invalidate();
                      }).catch((error: Error) => {
                        setMessageTone("error");
                        setMessage(error.message);
                      })}
                      type="button"
                    >
                      Delete
                    </button>
                  </article>
                ))}
              </div>
              {!scopedAppTypes.length ? <div className="empty-state compact">No app types defined yet.</div> : null}
              </Panel>
            ) : null}
          </div>
        )}
        isDetailOpen={Boolean(focusedProject)}
      />

      {isCreateModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateProjectModal}>
          <div
            aria-labelledby="create-project-title"
            aria-modal="true"
            className="modal-card project-create-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="project-create-header">
              <div className="project-create-title">
                <p className="eyebrow">Projects & Scope</p>
                <h3 id="create-project-title">Create project</h3>
                <p>Create the project, attach app types, and select any extra members. Admins are added automatically, and your account is linked as a member.</p>
              </div>
              <button className="ghost-button" disabled={createProject.isPending} onClick={closeCreateProjectModal} type="button">
                Close
              </button>
            </div>

            <form className="project-create-modal-form" onSubmit={handleProjectCreate}>
              <div className="project-create-modal-body">
                <div className="form-grid">
                  <FormField label="Project name" inputId="project-name-input" required>
                    <input
                      autoComplete="organization"
                      autoFocus
                      id="project-name-input"
                      onChange={(event) => updateProjectDraft({ name: event.target.value })}
                      value={projectDraft.name}
                    />
                  </FormField>
                  <FormField label="Description" inputId="project-description-input">
                    <textarea
                      id="project-description-input"
                      onChange={(event) => updateProjectDraft({ description: event.target.value })}
                      rows={3}
                      value={projectDraft.description}
                    />
                  </FormField>
                </div>

                <div className="metric-strip compact">
                  <div className="mini-card">
                    <strong>{projectDraft.memberIds.length}</strong>
                    <span>Extra members selected</span>
                  </div>
                  <div className="mini-card">
                    <strong>{projectDraft.appTypes.filter((appType) => appType.name.trim()).length}</strong>
                    <span>App types ready</span>
                  </div>
                </div>

                <div className="detail-summary">
                  <strong>Automatic membership is handled for you</strong>
                  <span>Admins are linked automatically with admin access, while the project creator is linked automatically as a member. Extra selected users are added as project members in the same create action.</span>
                </div>

                <section className="project-create-section">
                  <div className="project-create-section-head">
                    <div>
                      <h4>App types</h4>
                      <p>Add one or more app types so the project is ready for design work immediately.</p>
                    </div>
                    <button className="ghost-button" onClick={addProjectAppTypeRow} type="button">
                      Add app type
                    </button>
                  </div>

                  <div className="project-app-type-list">
                    {projectDraft.appTypes.map((appType, index) => (
                      <div className="project-app-type-row" key={appType.id}>
                        <div className="project-app-type-grid">
                          <FormField label={`App type ${index + 1} name`}>
                            <input
                              onChange={(event) => updateProjectAppType(appType.id, { name: event.target.value })}
                              placeholder="Web app"
                              required
                              value={appType.name}
                            />
                          </FormField>
                          <FormField label="Platform type">
                            <select
                              onChange={(event) => updateProjectAppType(appType.id, { type: event.target.value as AppType["type"] })}
                              required
                              value={appType.type}
                            >
                              {appTypeTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </FormField>
                          <label className="checkbox-field project-app-type-checkbox">
                            <input
                              checked={appType.is_unified}
                              onChange={(event) => updateProjectAppType(appType.id, { is_unified: event.target.checked })}
                              type="checkbox"
                            />
                            Unified
                          </label>
                          <button className="ghost-button danger" onClick={() => removeProjectAppType(appType.id)} type="button">
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="project-create-section">
                  <div className="project-create-section-head">
                    <div>
                      <h4>Project members</h4>
                      <p>All existing users are listed here. Admins are auto-added, your account is auto-added as a member, and any other users can be selected now.</p>
                    </div>
                    <div className="panel-head-actions">
                      <span className="status-pill tone-neutral">{projectDraft.memberIds.length} selected</span>
                      <button
                        className="ghost-button"
                        disabled={!selectableProjectMemberIds.length || areAllSelectableProjectMembersSelected}
                        onClick={() => updateProjectDraft({ memberIds: selectableProjectMemberIds })}
                        type="button"
                      >
                        Select all
                      </button>
                      <button
                        className="ghost-button"
                        disabled={!projectDraft.memberIds.length}
                        onClick={() => updateProjectDraft({ memberIds: [] })}
                        type="button"
                      >
                        Clear selection
                      </button>
                    </div>
                  </div>

                  {projectMemberOptions.length ? (
                    <div className="modal-case-picker project-member-picker">
                      {projectMemberOptions.map((user) => {
                        const isAutoIncluded = user.id === session?.user.id || user.role === "admin";

                        return (
                          <label className={isAutoIncluded ? "modal-case-option project-member-option is-auto-included" : "modal-case-option project-member-option"} key={user.id}>
                            <input
                              checked={isAutoIncluded || projectDraft.memberIds.includes(user.id)}
                              disabled={isAutoIncluded}
                              onChange={() => toggleProjectDraftMember(user.id)}
                              type="checkbox"
                            />
                            <div>
                              <strong>{user.name || user.email}</strong>
                              <span>{user.email}</span>
                              <span className="project-member-option-meta">
                                {isAutoIncluded ? (user.id === session?.user.id ? "Project creator • auto-added as member" : "Admin • auto-added") : "Selectable member"}
                              </span>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-state compact">No users exist yet to add to this project.</div>
                  )}
                </section>
              </div>

              <div className="action-row project-create-modal-actions">
                <button className="ghost-button danger" disabled={createProject.isPending} onClick={closeCreateProjectModal} type="button">
                  Cancel
                </button>
                <button className="primary-button" disabled={createProject.isPending} type="submit">
                  {createProject.isPending ? "Creating…" : "Create project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
