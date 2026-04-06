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
type FeedbackTone = "success" | "error";

const createEmptyUserDraft = (roleId = "") => ({ name: "", email: "", password_hash: "", role_id: roleId });
const EMPTY_ROLE_DRAFT = { name: "" };

export function PeoplePage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { users, roles } = useWorkspaceData();
  const [feedback, setFeedback] = useState<{ message: string; tone: FeedbackTone } | null>(null);
  const [view, setView] = useState<PeopleView>("users");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [userDraft, setUserDraft] = useState(createEmptyUserDraft());
  const [roleDraft, setRoleDraft] = useState(EMPTY_ROLE_DRAFT);
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [isCreateRoleModalOpen, setIsCreateRoleModalOpen] = useState(false);
  const [createUserDraft, setCreateUserDraft] = useState(createEmptyUserDraft());
  const [createRoleDraft, setCreateRoleDraft] = useState(EMPTY_ROLE_DRAFT);

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

  const showFeedback = (message: string, tone: FeedbackTone) => {
    setFeedback({ message, tone });
  };

  const openCreateUserModal = () => {
    setCreateUserDraft(createEmptyUserDraft(defaultMemberRoleId));
    setIsCreateUserModalOpen(true);
  };

  const closeCreateUserModal = () => {
    if (createUser.isPending) {
      return;
    }

    setIsCreateUserModalOpen(false);
    setCreateUserDraft(createEmptyUserDraft(defaultMemberRoleId));
  };

  const openCreateRoleModal = () => {
    setCreateRoleDraft(EMPTY_ROLE_DRAFT);
    setIsCreateRoleModalOpen(true);
  };

  const closeCreateRoleModal = () => {
    if (createRole.isPending) {
      return;
    }

    setIsCreateRoleModalOpen(false);
    setCreateRoleDraft(EMPTY_ROLE_DRAFT);
  };

  const createUser = useMutation({
    mutationFn: api.users.create,
    onSuccess: async (response) => {
      showFeedback("User created.", "success");
      setSelectedUserId(response.id);
      setIsCreateUserModalOpen(false);
      setCreateUserDraft(createEmptyUserDraft(defaultMemberRoleId));
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to create user", "error")
  });

  const updateUser = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<{ email: string; password_hash: string; name: string; role_id: string }> }) =>
      api.users.update(id, input),
    onSuccess: async () => {
      showFeedback("User updated.", "success");
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to update user", "error")
  });

  const deleteUser = useMutation({
    mutationFn: api.users.delete,
    onSuccess: async () => {
      showFeedback("User removed.", "success");
      setSelectedUserId("");
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to delete user", "error")
  });

  const createRole = useMutation({
    mutationFn: api.roles.create,
    onSuccess: async (response) => {
      showFeedback("Role created.", "success");
      setSelectedRoleId(response.id);
      setIsCreateRoleModalOpen(false);
      setCreateRoleDraft(EMPTY_ROLE_DRAFT);
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to create role", "error")
  });

  const updateRole = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { name: string } }) => api.roles.update(id, input),
    onSuccess: async () => {
      showFeedback("Role updated.", "success");
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to update role", "error")
  });

  const deleteRole = useMutation({
    mutationFn: api.roles.delete,
    onSuccess: async () => {
      showFeedback("Role removed.", "success");
      setSelectedRoleId("");
      await invalidate();
    },
    onError: (error) => showFeedback(error instanceof Error ? error.message : "Unable to delete role", "error")
  });

  const handleUserCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createUser.mutate({
      email: createUserDraft.email,
      password_hash: createUserDraft.password_hash,
      name: createUserDraft.name,
      role_id: createUserDraft.role_id || defaultMemberRoleId
    });
  };

  const handleRoleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createRole.mutate({ name: createRoleDraft.name });
  };

  useEffect(() => {
    if (!isCreateUserModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createUser.isPending) {
        closeCreateUserModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createUser.isPending, isCreateUserModalOpen]);

  useEffect(() => {
    if (!isCreateRoleModalOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !createRole.isPending) {
        closeCreateRoleModal();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [createRole.isPending, isCreateRoleModalOpen]);

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="People & Access"
        title="User Management"
        actions={
          isAdmin ? (
            view === "users" ? (
              <button className="primary-button" onClick={openCreateUserModal} type="button">Create user</button>
            ) : (
              <button className="primary-button" onClick={openCreateRoleModal} type="button">Create role</button>
            )
          ) : null
        }
      />

      {feedback ? (
        <p className={`inline-message ${feedback.tone === "success" ? "success-message" : "error-message"}`}>
          {feedback.message}
        </p>
      ) : null}

      <SubnavTabs
        value={view}
        onChange={setView}
        items={[
          { value: "users", label: "Users", meta: `${userItems.length} records` },
          { value: "roles", label: "Roles", meta: `${roleItems.length} records` }
        ]}
      />

      {view === "users" ? (
        <div className="workspace-grid people-users-grid">
          <Panel title="User directory" subtitle="Review users in a stable table, then inspect the selected record on the right.">
            <div className="table-wrap">
              <table className="data-table workspace-table selectable-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>User type</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {userItems.map((user) => (
                    <tr
                      className={selectedUser?.id === user.id ? "is-selected" : undefined}
                      key={user.id}
                      onClick={() => setSelectedUserId(user.id)}
                    >
                      <td><strong>{user.name || "Unnamed user"}</strong></td>
                      <td>{user.email}</td>
                      <td>{user.role === "admin" ? "Org Admin" : "Member"}</td>
                      <td><span className={`status-pill ${user.role === "admin" ? "tone-info" : "tone-success"}`}>{user.role === "admin" ? "admin" : "active"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

          </div>
        </div>
      ) : (
        <div className="workspace-grid">
          <Panel title="Role library" subtitle="Keep role naming compact and reusable across projects.">
            <div className="catalog-grid compact">
              {roleItems.map((role) => (
                <button
                  key={role.id}
                  className={selectedRole?.id === role.id ? "catalog-card is-active" : "catalog-card"}
                  onClick={() => setSelectedRoleId(role.id)}
                  type="button"
                >
                  <strong>{role.name}</strong>
                  <p>Project membership label used across assignments and access views.</p>
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

          </div>
        </div>
      )}

      {isCreateUserModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateUserModal} role="presentation">
          <div
            aria-labelledby="create-user-title"
            aria-modal="true"
            className="modal-card people-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="people-modal-header">
              <div className="people-modal-title">
                <p className="eyebrow">People & Access</p>
                <h3 id="create-user-title">Create user</h3>
                <p>Add a workspace user without leaving the directory view.</p>
              </div>
              <button
                aria-label="Close create user dialog"
                className="ghost-button"
                onClick={closeCreateUserModal}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="people-modal-form" onSubmit={handleUserCreate}>
              <div className="people-modal-body">
                <div className="record-grid">
                  <FormField label="Name">
                    <input
                      name="name"
                      placeholder="Quality lead"
                      value={createUserDraft.name}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, name: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Email" required>
                    <input
                      name="email"
                      type="email"
                      value={createUserDraft.email}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, email: event.target.value }))}
                    />
                  </FormField>
                  <FormField label="Role" required>
                    <select
                      name="role_id"
                      value={createUserDraft.role_id}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, role_id: event.target.value }))}
                    >
                      <option value="">Select a role</option>
                      {roleItems.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name.charAt(0).toUpperCase() + role.name.slice(1)}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Password hash" required>
                    <input
                      name="password_hash"
                      placeholder="Stored password value"
                      value={createUserDraft.password_hash}
                      onChange={(event) => setCreateUserDraft((current) => ({ ...current, password_hash: event.target.value }))}
                    />
                  </FormField>
                </div>
              </div>

              <div className="action-row people-modal-actions">
                <button className="primary-button" disabled={createUser.isPending} type="submit">
                  {createUser.isPending ? "Creating…" : "Create user"}
                </button>
                <button className="ghost-button" disabled={createUser.isPending} onClick={closeCreateUserModal} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {isCreateRoleModalOpen ? (
        <div className="modal-backdrop" onClick={closeCreateRoleModal} role="presentation">
          <div
            aria-labelledby="create-role-title"
            aria-modal="true"
            className="modal-card people-modal-card people-role-modal-card"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="people-modal-header">
              <div className="people-modal-title">
                <p className="eyebrow">People & Access</p>
                <h3 id="create-role-title">Create role</h3>
                <p>Keep the role library concise and reusable across assignments.</p>
              </div>
              <button
                aria-label="Close create role dialog"
                className="ghost-button"
                onClick={closeCreateRoleModal}
                type="button"
              >
                Close
              </button>
            </div>

            <form className="people-modal-form" onSubmit={handleRoleCreate}>
              <div className="people-modal-body">
                <FormField label="Role name" required>
                  <input
                    name="name"
                    placeholder="qa-manager"
                    value={createRoleDraft.name}
                    onChange={(event) => setCreateRoleDraft({ name: event.target.value })}
                  />
                </FormField>
              </div>

              <div className="action-row people-modal-actions">
                <button className="primary-button" disabled={createRole.isPending} type="submit">
                  {createRole.isPending ? "Creating…" : "Create role"}
                </button>
                <button className="ghost-button" disabled={createRole.isPending} onClick={closeCreateRoleModal} type="button">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
