import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import { useAuth } from "../auth/AuthContext";
import type { AppType, Project, ProjectMember, Requirement } from "../types";

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { projects, users, roles, projectMembers, appTypes, requirements } = useWorkspaceData();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [message, setMessage] = useState("");

  const selectedProject = projects.data?.find((project) => project.id === selectedProjectId) || projects.data?.[0];
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
        title="Connect ownership, platforms, and requirement intent"
        description="Projects anchor the rest of the workspace. Once selected, bind team access, app-type boundaries, and scoped requirements in one view."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="workspace-grid">
        <Panel title="Projects" subtitle="Select a project to reveal scoped relationships">
          <form className="form-grid" onSubmit={handleProjectCreate}>
            <FormField label="Project name">
              <input name="name" required placeholder="Checkout modernization" />
            </FormField>
            <FormField label="Description">
              <textarea name="description" rows={3} placeholder="Scope, notes, or release focus" />
            </FormField>
            <button className="primary-button" type="submit">Create project</button>
          </form>

          <div className="segmented-list">
            {(projects.data || []).map((project) => (
              <button
                key={project.id}
                className={projectId === project.id ? "segment is-active" : "segment"}
                onClick={() => setSelectedProjectId(project.id)}
                type="button"
              >
                <strong>{project.name}</strong>
                <span>{project.description || "No description yet"}</span>
              </button>
            ))}
          </div>
        </Panel>

        <div className="stack-grid">
          <Panel title="Project members" subtitle={projectId ? `Assignments for ${selectedProject?.name}` : "Select a project first"}>
            <form className="inline-form" onSubmit={(event) => {
              event.preventDefault();
              if (!projectId) {
                return;
              }
              const formData = new FormData(event.currentTarget);
              createMember.mutate({
                project_id: projectId,
                user_id: String(formData.get("user_id") || ""),
                role_id: String(formData.get("role_id") || "")
              });
              event.currentTarget.reset();
            }}>
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

            <DataTable<ProjectMember>
              emptyMessage="No project members yet."
              rows={scopedMembers}
              columns={[
                { key: "user", label: "User", render: (row) => users.data?.find((user) => user.id === row.user_id)?.email || row.user_id },
                { key: "role", label: "Role", render: (row) => roles.data?.find((role) => role.id === row.role_id)?.name || row.role_id },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => <button className="ghost-button danger" onClick={() => void api.projectMembers.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>Remove</button>
                }
              ]}
            />
          </Panel>

          <Panel title="App types" subtitle="Platform or boundary definitions for the selected project">
            <form className="inline-form" onSubmit={(event) => {
              event.preventDefault();
              if (!projectId) {
                return;
              }
              const formData = new FormData(event.currentTarget);
              createAppType.mutate({
                project_id: projectId,
                name: String(formData.get("name") || ""),
                type: String(formData.get("type") || "web") as AppType["type"],
                is_unified: String(formData.get("is_unified") || "") === "on"
              });
              event.currentTarget.reset();
            }}>
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

            <DataTable<AppType>
              emptyMessage="No app types defined."
              rows={scopedAppTypes}
              columns={[
                { key: "name", label: "Name", render: (row) => row.name },
                { key: "type", label: "Type", render: (row) => row.type },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => <button className="ghost-button danger" onClick={() => void api.appTypes.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>Delete</button>
                }
              ]}
            />
          </Panel>

          <Panel title="Requirements" subtitle="Scope statements tied directly to project planning">
            <form className="form-grid" onSubmit={(event) => {
              event.preventDefault();
              if (!projectId) {
                return;
              }
              const formData = new FormData(event.currentTarget);
              createRequirement.mutate({
                project_id: projectId,
                title: String(formData.get("title") || ""),
                description: String(formData.get("description") || ""),
                priority: Number(formData.get("priority") || 3),
                status: String(formData.get("status") || "")
              });
              event.currentTarget.reset();
            }}>
              <FormField label="Title">
                <input name="title" required placeholder="User can complete checkout" />
              </FormField>
              <FormField label="Description">
                <textarea name="description" rows={2} />
              </FormField>
              <FormField label="Priority">
                <input name="priority" defaultValue="3" min="1" max="5" type="number" />
              </FormField>
              <FormField label="Status">
                <input name="status" placeholder="open" />
              </FormField>
              <button className="primary-button" disabled={!projectId} type="submit">Add requirement</button>
            </form>

            <DataTable<Requirement>
              emptyMessage="No requirements mapped."
              rows={scopedRequirements}
              columns={[
                { key: "title", label: "Requirement", render: (row) => <div><strong>{row.title}</strong><span>{row.description || "No description"}</span></div> },
                { key: "priority", label: "Priority", render: (row) => row.priority ?? "n/a" },
                {
                  key: "actions",
                  label: "Actions",
                  render: (row) => <button className="ghost-button danger" onClick={() => void api.requirements.delete(row.id).then(invalidate).catch((error: Error) => setMessage(error.message))}>Delete</button>
                }
              ]}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}
