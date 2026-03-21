import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { DataTable } from "../components/DataTable";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import type { Role, User } from "../types";

export function PeoplePage() {
  const queryClient = useQueryClient();
  const { users, roles } = useWorkspaceData();
  const [message, setMessage] = useState("");

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
    mutationFn: ({ id, input }: { id: string; input: Partial<{ email: string; password_hash: string; name: string }> }) =>
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

  const deleteRole = useMutation({
    mutationFn: api.roles.delete,
    onSuccess: async () => {
      setMessage("Role removed.");
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
      name: String(formData.get("name") || "")
    });

    event.currentTarget.reset();
  };

  const handleRoleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    createRole.mutate({
      name: String(formData.get("name") || "")
    });

    event.currentTarget.reset();
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="People & Access"
        title="Manage users and role vocabulary"
        description="Bootstrap workspace operators first, then use role definitions across project memberships."
      />

      {message ? <p className="inline-message">{message}</p> : null}

      <div className="two-column-grid">
        <Panel title="Create user" subtitle="Direct insert into the current users endpoint">
          <form className="form-grid" onSubmit={handleUserCreate}>
            <FormField label="Name">
              <input name="name" placeholder="Quality lead" />
            </FormField>
            <FormField label="Email">
              <input name="email" type="email" required />
            </FormField>
            <FormField label="Password hash">
              <input name="password_hash" required placeholder="For direct CRUD, send the stored value" />
            </FormField>
            <button className="primary-button" type="submit">Create user</button>
          </form>
        </Panel>

        <Panel title="Create role" subtitle="Role names are reused by project memberships">
          <form className="form-grid" onSubmit={handleRoleCreate}>
            <FormField label="Role name">
              <input name="name" required placeholder="qa-manager" />
            </FormField>
            <button className="primary-button" type="submit">Create role</button>
          </form>
        </Panel>
      </div>

      <div className="two-column-grid">
        <Panel title="Users" subtitle="Edit names inline or remove users when dependencies allow">
          <DataTable<User>
            emptyMessage="No users found."
            rows={users.data || []}
            columns={[
              { key: "identity", label: "Identity", render: (row) => <div><strong>{row.name || "Unnamed user"}</strong><span>{row.email}</span></div> },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="action-row">
                    <button
                      className="ghost-button"
                      onClick={() => {
                        const name = window.prompt("Update name", row.name || "");
                        if (name !== null) {
                          updateUser.mutate({ id: row.id, input: { name } });
                        }
                      }}
                    >
                      Rename
                    </button>
                    <button className="ghost-button danger" onClick={() => deleteUser.mutate(row.id)}>
                      Delete
                    </button>
                  </div>
                )
              }
            ]}
          />
        </Panel>

        <Panel title="Roles" subtitle="Tight, reusable access labels">
          <DataTable<Role>
            emptyMessage="No roles found."
            rows={roles.data || []}
            columns={[
              { key: "name", label: "Role", render: (row) => <strong>{row.name}</strong> },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <div className="action-row">
                    <button className="ghost-button" onClick={() => {
                      const name = window.prompt("Rename role", row.name);
                      if (name !== null) {
                        void api.roles.update(row.id, { name }).then(invalidate).catch((error: Error) => setMessage(error.message));
                      }
                    }}>
                      Rename
                    </button>
                    <button className="ghost-button danger" onClick={() => deleteRole.mutate(row.id)}>
                      Delete
                    </button>
                  </div>
                )
              }
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}
