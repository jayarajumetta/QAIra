import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { SubnavTabs } from "../components/SubnavTabs";
import { ToastMessage } from "../components/ToastMessage";
import { useCurrentProject } from "../hooks/useCurrentProject";
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

const createDraftId = () =>
  globalThis.crypto?.randomUUID?.() || `project-draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const createProjectAppTypeDraft = (): ProjectAppTypeDraft => ({
  id: createDraftId(),
  name: "",
  type: "web",
  is_unified: false
});

const createInitialProjectDraft = (): ProjectCreateDraft => ({
  name: "",
  description: "",
  memberIds: [],
  appTypes: [createProjectAppTypeDraft()]
});

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { projects, users, roles, projectMembers, appTypes, requirements, testCases } = useWorkspaceData();
  const [selectedProjectId, setSelectedProjectId] = useCurrentProject();
  const [section, setSection] = useState<ProjectSection>("members");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [projectDraft, setProjectDraft] = useState<ProjectCreateDraft>(createInitialProjectDraft);

  const projectItems = projects.data || [];

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
  const projectId = selectedProject?.id;

  const memberCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (projectMembers.data || []).forEach((member) => {
      counts[member.project_id] = (counts[member.project_id] || 0) + 1;
    });

    return counts;
  }, [projectMembers.data]);

  const appTypeCountByProjectId = useMemo(() => {
    const counts: Record<string, number> = {};

    (appTypes.data || []).forEach((appType) => {
      counts[appType.project_id] = (counts[appType.project_id] || 0) + 1;
    });

    return counts;
  }, [appTypes.data]);

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
      setIsCreateModalOpen(false);
      setProjectDraft(createInitialProjectDraft());
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
    setProjectDraft(createInitialProjectDraft());
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
      appTypes: [...current.appTypes, createProjectAppTypeDraft()]
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
          appTypes: [createProjectAppTypeDraft()]
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

    const duplicateType = normalizedAppTypes.find(
      (appType, index) => normalizedAppTypes.findIndex((candidate) => candidate.type === appType.type) !== index
    );

    if (duplicateType) {
      setMessageTone("error");
      setMessage(`App type '${duplicateType.type}' can only be added once while creating a project.`);
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
        actions={<button className="primary-button" onClick={openCreateProjectModal} type="button">Create Project</button>}
      />

      <ToastMessage
        message={message}
        onDismiss={() => setMessage("")}
        tone={messageTone}
      />

      <div className="workspace-grid">
        <Panel title="Project catalog" subtitle="Select a project card to switch context. Create Project opens a guided setup modal for scope, app types, and initial members.">
          <div className="catalog-grid compact">
            {projectItems.map((project) => (
              <button
                key={project.id}
                className={selectedProject?.id === project.id ? "catalog-card tile-card project-catalog-card is-active" : "catalog-card tile-card project-catalog-card"}
                onClick={() => setSelectedProjectId(project.id)}
                type="button"
              >
                <div className="tile-card-main">
                  <div className="tile-card-header">
                    <div className="record-card-icon project-card-icon">PR</div>
                    <div className="tile-card-title-group">
                      <strong>{project.name}</strong>
                      <span className="tile-card-kicker">Created workspace scope</span>
                    </div>
                    <span className="object-type-badge">PROJECT</span>
                  </div>
                  <p className="tile-card-description">{project.description || "No description yet."}</p>
                  <div className="tile-card-metrics">
                    <span className="tile-metric">{memberCountByProjectId[project.id] || 0} members</span>
                    <span className="tile-metric">{requirementCountByProjectId[project.id] || 0} requirements</span>
                    <span className="tile-metric">{testCaseCountByProjectId[project.id] || 0} test cases</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {!projectItems.length ? <div className="empty-state compact">No projects yet. Create the first project to add scope, app types, and the initial team in one flow.</div> : null}
        </Panel>

        <div className="stack-grid">
          <Panel title={selectedProject ? selectedProject.name : "Project summary"} subtitle={selectedProject ? "Quick orientation before you dive into related records." : "Select a project to reveal its scoped data."}>
            {selectedProject ? (
              <div className="detail-stack">
                <div className="detail-summary">
                  <strong>{selectedProject.name}</strong>
                  <span>{selectedProject.description || "No description provided yet."}</span>
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
                    type: String(formData.get("type") || "web") as AppType["type"],
                    is_unified: String(formData.get("is_unified") || "") === "on"
                  });
                  event.currentTarget.reset();
                }}
              >
                <input name="name" required placeholder="Web app" />
                <select name="type" defaultValue="web">
                  <option value="web">web</option>
                  <option value="api">api</option>
                  <option value="android">android</option>
                  <option value="ios">ios</option>
                  <option value="unified">unified</option>
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
      </div>

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
                <p>Create the project, attach app types, and select any extra members. Admins and your account are added automatically.</p>
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
                  <span>Admins and the project creator are linked by the backend automatically. Extra selected users are added as project members in the same create action.</span>
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
                              value={appType.name}
                            />
                          </FormField>
                          <FormField label="Platform type">
                            <select
                              onChange={(event) => updateProjectAppType(appType.id, { type: event.target.value as AppType["type"] })}
                              value={appType.type}
                            >
                              <option value="web">web</option>
                              <option value="api">api</option>
                              <option value="android">android</option>
                              <option value="ios">ios</option>
                              <option value="unified">unified</option>
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
                      <p>All existing users are listed here. Admins and your account are shown as auto-added, and any other users can be selected now.</p>
                    </div>
                    <span className="status-pill tone-neutral">{projectDraft.memberIds.length} selected</span>
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
                                {isAutoIncluded ? (user.id === session?.user.id ? "Project creator • auto-added" : "Admin • auto-added") : "Selectable member"}
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
                <button className="ghost-button" disabled={createProject.isPending} onClick={closeCreateProjectModal} type="button">
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
