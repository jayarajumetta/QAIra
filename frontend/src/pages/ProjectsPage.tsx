import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { SubnavTabs } from "../components/SubnavTabs";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { useAuth } from "../auth/AuthContext";
import type { AppType, Requirement } from "../types";

type ProjectSection = "members" | "appTypes" | "requirements";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { projects, users, roles, projectMembers, appTypes, requirements } = useWorkspaceData();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [section, setSection] = useState<ProjectSection>("members");
  const [message, setMessage] = useState("");

  const projectItems = projects.data || [];
  const selectedProject = useMemo(
    () => projectItems.find((project) => project.id === selectedProjectId) || projectItems[0],
    [projectItems, selectedProjectId]
  );
  const projectId = selectedProject?.id;

  const scopedMembers = useMemo(
    () => (projectMembers.data || []).filter((member) => member.project_id === projectId),
    [projectMembers.data, projectId]
  );
  const scopedAppTypes = useMemo(
    () => (appTypes.data || []).filter((item) => item.project_id === projectId),
    [appTypes.data, projectId]
  );
  const scopedRequirements = useMemo(
    () => (requirements.data || []).filter((item) => item.project_id === projectId),
    [requirements.data, projectId]
  );

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project-members"] }),
      queryClient.invalidateQueries({ queryKey: ["app-types"] }),
      queryClient.invalidateQueries({ queryKey: ["requirements"] })
    ]);
  };

  const createProject = useMutation({
    mutationFn: api.projects.create,
    onSuccess: async () => {
      setMessage("Project created.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create project")
  });

  const createMember = useMutation({
    mutationFn: api.projectMembers.create,
    onSuccess: async () => {
      setMessage("Project member added.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to add project member")
  });

  const createAppType = useMutation({
    mutationFn: api.appTypes.create,
    onSuccess: async () => {
      setMessage("App type added.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to add app type")
  });

  const createRequirement = useMutation({
    mutationFn: api.requirements.create,
    onSuccess: async () => {
      setMessage("Requirement added.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to add requirement")
  });

  const handleProjectCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    createProject.mutate({
      name: String(formData.get("name") || ""),
      description: String(formData.get("description") || ""),
      created_by: session!.user.id
    });
    event.currentTarget.reset();
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Projects & Scope"
        title="Browse one project at a time without losing context"
        description="Turn the project area into a scoped workspace: pick a project, review its summary, then move through memberships, app boundaries, and requirements in smaller views."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="workspace-grid">
        <Panel title="Projects" subtitle="Treat this as the project rail for the rest of the page.">
          <form className="form-grid" onSubmit={handleProjectCreate}>
            <FormField label="Project name">
              <input name="name" required placeholder="Checkout modernization" />
            </FormField>
            <FormField label="Description">
              <textarea name="description" rows={3} placeholder="Scope, notes, or release focus" />
            </FormField>
            <button className="primary-button" type="submit">Create project</button>
          </form>

          <div className="record-list">
            {projectItems.map((project) => (
              <button
                key={project.id}
                className={selectedProject?.id === project.id ? "record-card is-active" : "record-card"}
                onClick={() => setSelectedProjectId(project.id)}
                type="button"
              >
                <div>
                  <strong>{project.name}</strong>
                  <span>{project.description || "No description yet"}</span>
                </div>
              </button>
            ))}
          </div>
          {!projectItems.length ? <div className="empty-state compact">No projects created yet.</div> : null}
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
                    <strong>{scopedAppTypes.length}</strong>
                    <span>App types</span>
                  </div>
                  <div className="mini-card">
                    <strong>{scopedRequirements.length}</strong>
                    <span>Requirements</span>
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
              { value: "appTypes", label: "App Types", meta: `${scopedAppTypes.length}` },
              { value: "requirements", label: "Requirements", meta: `${scopedRequirements.length}` }
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
                <button className="primary-button" disabled={!projectId} type="submit">Add member</button>
              </form>

              <div className="record-grid">
                {scopedMembers.map((member) => {
                  const user = users.data?.find((item) => item.id === member.user_id);
                  const role = roles.data?.find((item) => item.id === member.role_id);
                  return (
                    <article className="mini-card" key={member.id}>
                      <strong>{user?.name || user?.email || member.user_id}</strong>
                      <span>{role?.name || member.role_id}</span>
                      <button
                        className="ghost-button danger"
                        onClick={() => void api.projectMembers.delete(member.id).then(invalidate).catch((error: Error) => setMessage(error.message))}
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
                <button className="primary-button" disabled={!projectId} type="submit">Add app type</button>
              </form>

              <div className="record-grid">
                {scopedAppTypes.map((item) => (
                  <article className="mini-card" key={item.id}>
                    <strong>{item.name}</strong>
                    <span>{item.type}{item.is_unified ? " · unified" : ""}</span>
                    <button
                      className="ghost-button danger"
                      onClick={() => void api.appTypes.delete(item.id).then(invalidate).catch((error: Error) => setMessage(error.message))}
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

          {section === "requirements" ? (
            <Panel title="Requirements" subtitle="Show scope records as readable cards instead of another dense table.">
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!projectId) return;
                  const formData = new FormData(event.currentTarget);
                  createRequirement.mutate({
                    project_id: projectId,
                    title: String(formData.get("title") || ""),
                    description: String(formData.get("description") || ""),
                    priority: Number(formData.get("priority") || 3),
                    status: String(formData.get("status") || "")
                  });
                  event.currentTarget.reset();
                }}
              >
                <div className="record-grid">
                  <FormField label="Title">
                    <input name="title" required placeholder="User can complete checkout" />
                  </FormField>
                  <FormField label="Description">
                    <textarea name="description" rows={3} />
                  </FormField>
                  <FormField label="Priority">
                    <input name="priority" defaultValue="3" min="1" max="5" type="number" />
                  </FormField>
                  <FormField label="Status">
                    <input name="status" placeholder="open" />
                  </FormField>
                </div>
                <button className="primary-button" disabled={!projectId} type="submit">Add requirement</button>
              </form>

              <div className="record-grid">
                {scopedRequirements.map((item: Requirement) => (
                  <article className="mini-card" key={item.id}>
                    <strong>{item.title}</strong>
                    <span>{item.description || "No description"}</span>
                    <span>Priority {item.priority ?? "n/a"} · {item.status || "unset"}</span>
                    <button
                      className="ghost-button danger"
                      onClick={() => void api.requirements.delete(item.id).then(invalidate).catch((error: Error) => setMessage(error.message))}
                      type="button"
                    >
                      Delete
                    </button>
                  </article>
                ))}
              </div>
              {!scopedRequirements.length ? <div className="empty-state compact">No requirements mapped yet.</div> : null}
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
