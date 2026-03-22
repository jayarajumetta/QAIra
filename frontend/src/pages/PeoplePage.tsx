import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { SubnavTabs } from "../components/SubnavTabs";
import { useAuth } from "../auth/AuthContext";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import type { Role, User } from "../types";

type PeopleView = "users" | "roles";

export function PeoplePage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { users, roles } = useWorkspaceData();
  const [message, setMessage] = useState("");
  const [view, setView] = useState<PeopleView>("users");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [userDraft, setUserDraft] = useState({ name: "", email: "", password_hash: "", role_id: "" });
  const [roleDraft, setRoleDraft] = useState({ name: "" });

  const userItems = users.data || [];
  const roleItems = roles.data || [];
  const selectedUser = useMemo(
    () => userItems.find((item) => item.id === selectedUserId) || userItems[0],
    [selectedUserId, userItems]
  );
  const selectedRole = useMemo(
    () => roleItems.find((item) => item.id === selectedRoleId) || roleItems[0],
    [selectedRoleId, roleItems]
  );
  const isAdmin = session?.user.role === "admin";
  const defaultMemberRoleId = useMemo(
    () => roleItems.find((item) => item.name === "member")?.id || roleItems[0]?.id || "",
    [roleItems]
  );

  useEffect(() => {
    if (selectedUser) {
      const matchedRole = roleItems.find((item) => item.name === selectedUser.role);
      setSelectedUserId(selectedUser.id);
      setUserDraft({
        name: selectedUser.name || "",
        email: selectedUser.email,
        password_hash: "",
        role_id: matchedRole?.id || defaultMemberRoleId
      });
    }
  }, [defaultMemberRoleId, roleItems, selectedUser?.id]);

  useEffect(() => {
    if (selectedRole) {
      setSelectedRoleId(selectedRole.id);
      setRoleDraft({ name: selectedRole.name });
    }
  }, [selectedRole?.id]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users"] }),
      queryClient.invalidateQueries({ queryKey: ["roles"] })
    ]);
  };

  const createUser = useMutation({
    mutationFn: api.users.create,
    onSuccess: async () => {
      setMessage("User created.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create user")
  });

  const updateUser = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ email: string; password_hash: string; name: string; role_id: string }> }) =>
      api.users.update(id, input),
    onSuccess: async () => {
      setMessage("User updated.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update user")
  });

  const deleteUser = useMutation({
    mutationFn: api.users.delete,
    onSuccess: async () => {
      setMessage("User removed.");
      setSelectedUserId("");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete user")
  });

  const createRole = useMutation({
    mutationFn: api.roles.create,
    onSuccess: async () => {
      setMessage("Role created.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create role")
  });

  const updateRole = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name: string } }) => api.roles.update(id, input),
    onSuccess: async () => {
      setMessage("Role updated.");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update role")
  });

  const deleteRole = useMutation({
    mutationFn: api.roles.delete,
    onSuccess: async () => {
      setMessage("Role removed.");
      setSelectedRoleId("");
      await invalidate();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete role")
  });

  const handleUserCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    createUser.mutate({
      email: String(formData.get("email") || ""),
      password_hash: String(formData.get("password_hash") || ""),
      name: String(formData.get("name") || ""),
      role_id: String(formData.get("role_id") || defaultMemberRoleId)
    });
    event.currentTarget.reset();
  };

  const handleRoleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    createRole.mutate({ name: String(formData.get("name") || "") });
    event.currentTarget.reset();
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="People & Access"
        title="People & Access"
        description={isAdmin
          ? "Manage users and roles from a calmer split view, with role-aware editing and clear admin-only actions."
          : "People & Access is read-only for members. You can browse users and roles, but only admins can change them."}
        actions={isAdmin ? <button className="primary-button" onClick={() => setView("users")} type="button">Add User</button> : null}
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <SubnavTabs
        value={view}
        onChange={setView}
        items={[
          { value: "users", label: "Users", meta: `${userItems.length} records` },
          { value: "roles", label: "Roles", meta: `${roleItems.length} records` }
        ]}
      />

      {view === "users" ? (
        <div className="workspace-grid">
          <Panel title="User directory" subtitle="Pick a record to inspect or update it without juggling modal prompts.">
            <div className="record-list">
              {userItems.map((user) => (
                <button
                  key={user.id}
                  className={selectedUser?.id === user.id ? "record-card is-active" : "record-card"}
                  onClick={() => setSelectedUserId(user.id)}
                  type="button"
                >
                  <div>
                    <strong>{user.name || "Unnamed user"}</strong>
                    <span>{user.email}</span>
                  </div>
                  <small>{user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "Member"}</small>
                </button>
              ))}
            </div>
            {!userItems.length ? <div className="empty-state compact">No users found yet.</div> : null}
          </Panel>

          <div className="stack-grid">
            <Panel title="Selected user" subtitle={selectedUser ? "Refine the record without leaving the list." : "Create your first user to begin."}>
              {selectedUser ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedUser.name || "Unnamed user"}</strong>
                    <span>{selectedUser.email}</span>
                    <span>{selectedUser.role === "admin" ? "Admin access" : "Member access"}</span>
                  </div>
                  {isAdmin ? (
                    <form
                      className="form-grid"
                      onSubmit={(event) => {
                        event.preventDefault();
                        updateUser.mutate({
                          id: selectedUser.id,
                          input: {
                            name: userDraft.name,
                            email: userDraft.email,
                            role_id: userDraft.role_id,
                            ...(userDraft.password_hash ? { password_hash: userDraft.password_hash } : {})
                          }
                        });
                      }}
                    >
                      <FormField label="Name">
                        <input
                          name="name"
                          value={userDraft.name}
                          onChange={(event) => setUserDraft((current) => ({ ...current, name: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="Email">
                        <input
                          name="email"
                          type="email"
                          value={userDraft.email}
                          onChange={(event) => setUserDraft((current) => ({ ...current, email: event.target.value }))}
                        />
                      </FormField>
                      <FormField label="Role">
                        <select
                          name="role_id"
                          value={userDraft.role_id}
                          onChange={(event) => setUserDraft((current) => ({ ...current, role_id: event.target.value }))}
                        >
                          {roleItems.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name === "admin" ? "Admin" : role.name === "member" ? "Member" : role.name}
                            </option>
                          ))}
                        </select>
                      </FormField>
                      <FormField label="Password hash">
                        <input
                          name="password_hash"
                          placeholder="Leave blank to keep current value"
                          value={userDraft.password_hash}
                          onChange={(event) => setUserDraft((current) => ({ ...current, password_hash: event.target.value }))}
                        />
                      </FormField>
                      <div className="action-row">
                        <button className="primary-button" type="submit">Save user</button>
                        <button className="ghost-button danger" onClick={() => deleteUser.mutate(selectedUser.id)} type="button">
                          Delete user
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="empty-state compact">Read-only access. Ask an admin to update this record.</div>
                  )}
                </div>
              ) : (
                <div className="empty-state compact">No user selected.</div>
              )}
            </Panel>

            {isAdmin ? (
              <Panel title="Add user" subtitle="Use this form for direct CRUD inserts into the workspace.">
                <form className="form-grid" onSubmit={handleUserCreate}>
                  <FormField label="Name">
                    <input name="name" placeholder="Quality lead" />
                  </FormField>
                  <FormField label="Email">
                    <input name="email" type="email" required />
                  </FormField>
                  <FormField label="Role">
                    <select name="role_id" required>
                      <option value="">Select a role</option>
                      {roleItems.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name.charAt(0).toUpperCase() + role.name.slice(1)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Password hash">
                    <input name="password_hash" required placeholder="Stored password value" />
                  </FormField>
                  <button className="primary-button" type="submit">Create user</button>
                </form>
              </Panel>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="workspace-grid">
          <Panel title="Role library" subtitle="Keep role naming compact and reusable across projects.">
            <div className="record-list">
              {roleItems.map((role) => (
                <button
                  key={role.id}
                  className={selectedRole?.id === role.id ? "record-card is-active" : "record-card"}
                  onClick={() => setSelectedRoleId(role.id)}
                  type="button"
                >
                  <div>
                    <strong>{role.name}</strong>
                    <span>Project membership label</span>
                  </div>
                </button>
              ))}
            </div>
            {!roleItems.length ? <div className="empty-state compact">No roles defined yet.</div> : null}
          </Panel>

          <div className="stack-grid">
            <Panel title="Selected role" subtitle={selectedRole ? "Adjust the role name in place." : "Create a role to start reusing it in memberships."}>
              {selectedRole ? (
                <div className="detail-stack">
                  <div className="detail-summary">
                    <strong>{selectedRole.name}</strong>
                    <span>Reusable access label</span>
                  </div>
                  {isAdmin ? (
                    <form
                      className="form-grid"
                      onSubmit={(event) => {
                        event.preventDefault();
                        updateRole.mutate({ id: selectedRole.id, input: { name: roleDraft.name } });
                      }}
                    >
                      <FormField label="Role name">
                        <input
                          name="name"
                          value={roleDraft.name}
                          onChange={(event) => setRoleDraft({ name: event.target.value })}
                        />
                      </FormField>
                      <div className="action-row">
                        <button className="primary-button" type="submit">Save role</button>
                        <button className="ghost-button danger" onClick={() => deleteRole.mutate(selectedRole.id)} type="button">
                          Delete role
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="empty-state compact">Read-only access. Ask an admin to change role definitions.</div>
                  )}
                </div>
              ) : (
                <div className="empty-state compact">No role selected.</div>
              )}
            </Panel>

            {isAdmin ? (
              <Panel title="Add role" subtitle="Keep names short so they read well in assignment lists and filters.">
                <form className="form-grid" onSubmit={handleRoleCreate}>
                  <FormField label="Role name">
                    <input name="name" required placeholder="qa-manager" />
                  </FormField>
                  <button className="primary-button" type="submit">Create role</button>
                </form>
              </Panel>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
