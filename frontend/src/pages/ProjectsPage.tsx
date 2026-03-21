import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { SubnavTabs } from "../components/SubnavTabs";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { useAuth } from "../auth/AuthContext";
import type { AppType } from "../types";

type ProjectSection = "members" | "appTypes";

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
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["project-members"] }),
      queryClient.invalidateQueries({ queryKey: ["app-types"] })
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
        title="Project & Scope"
        description="Pick one project, review its summary, and move through memberships and app boundaries without clutter."
        actions={<button className="primary-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} type="button">Create Project</button>}
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
                    <strong>{(requirements.data || []).filter((item) => item.project_id === projectId).length}</strong>
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

        </div>
      </div>
    </div>
  );
}
