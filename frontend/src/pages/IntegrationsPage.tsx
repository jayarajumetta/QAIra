import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { api } from "../lib/api";
import type { Integration } from "../types";

type IntegrationDraft = {
  type: Integration["type"];
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  project_key: string;
  username: string;
  is_active: boolean;
};

const EMPTY_DRAFT: IntegrationDraft = {
  type: "llm",
  name: "",
  base_url: "https://api.openai.com/v1",
  api_key: "",
  model: "",
  project_key: "",
  username: "",
  is_active: true
};

export function IntegrationsPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [draft, setDraft] = useState<IntegrationDraft>(EMPTY_DRAFT);

  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.integrations.list(),
    enabled: session?.user.role === "admin"
  });

  const createIntegration = useMutation({ mutationFn: api.integrations.create });
  const updateIntegration = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.integrations.update>[1] }) =>
      api.integrations.update(id, input)
  });
  const deleteIntegration = useMutation({ mutationFn: api.integrations.delete });

  const integrations = integrationsQuery.data || [];
  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const selectedIntegration = useMemo(
    () => integrations.find((item) => item.id === selectedIntegrationId) || integrations[0] || null,
    [integrations, selectedIntegrationId]
  );

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (selectedIntegration) {
      setSelectedIntegrationId(selectedIntegration.id);
      setDraft({
        type: selectedIntegration.type,
        name: selectedIntegration.name,
        base_url: selectedIntegration.base_url || (selectedIntegration.type === "llm" ? "https://api.openai.com/v1" : ""),
        api_key: selectedIntegration.api_key || "",
        model: selectedIntegration.model || "",
        project_key: selectedIntegration.project_key || "",
        username: selectedIntegration.username || "",
        is_active: selectedIntegration.is_active
      });
      return;
    }

    setSelectedIntegrationId("");
    setDraft(EMPTY_DRAFT);
  }, [isCreating, selectedIntegration]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      if (isCreating || !selectedIntegration) {
        const response = await createIntegration.mutateAsync({
          type: draft.type,
          name: draft.name,
          base_url: draft.base_url || undefined,
          api_key: draft.api_key || undefined,
          model: draft.model || undefined,
          project_key: draft.project_key || undefined,
          username: draft.username || undefined,
          is_active: draft.is_active
        });
        setSelectedIntegrationId(response.id);
        setIsCreating(false);
        showSuccess("Integration created.");
      } else {
        await updateIntegration.mutateAsync({
          id: selectedIntegration.id,
          input: {
            type: draft.type,
            name: draft.name,
            base_url: draft.base_url,
            api_key: draft.api_key,
            model: draft.model,
            project_key: draft.project_key,
            username: draft.username,
            is_active: draft.is_active
          }
        });
        showSuccess("Integration updated.");
      }

      await refresh();
    } catch (error) {
      showError(error, "Unable to save integration");
    }
  };

  const handleDelete = async () => {
    if (!selectedIntegration || !window.confirm(`Delete integration "${selectedIntegration.name}"?`)) {
      return;
    }

    try {
      await deleteIntegration.mutateAsync(selectedIntegration.id);
      setSelectedIntegrationId("");
      setDraft(EMPTY_DRAFT);
      setIsCreating(false);
      showSuccess("Integration deleted.");
      await refresh();
    } catch (error) {
      showError(error, "Unable to delete integration");
    }
  };

  const isAdmin = session?.user.role === "admin";
  const isLlm = draft.type === "llm";

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Administration"
        title="Integrations"
        actions={
          isAdmin ? (
            <button
              className="primary-button"
              onClick={() => {
                setIsCreating(true);
                setSelectedIntegrationId("");
                setDraft(EMPTY_DRAFT);
              }}
              type="button"
            >
              + New Integration
            </button>
          ) : null
        }
      />

      {message ? <p className={messageTone === "error" ? "inline-message error-message" : "inline-message success-message"}>{message}</p> : null}

      {!isAdmin ? (
        <Panel title="Access required" subtitle="Only admins can manage integrations.">
          <div className="empty-state compact">Ask an admin to create or update integration keys for LLM and Jira access.</div>
        </Panel>
      ) : (
        <div className="workspace-grid">
          <Panel title="Configured integrations" subtitle="Choose a connection profile to update, activate, or replace.">
            <div className="record-list">
              {integrations.map((integration) => (
                <button
                  key={integration.id}
                  className={selectedIntegrationId === integration.id ? "record-card is-active" : "record-card"}
                  onClick={() => {
                    setSelectedIntegrationId(integration.id);
                    setIsCreating(false);
                  }}
                  type="button"
                >
                  <div className="record-card-body">
                    <div className="record-card-header">
                      <div className="record-card-icon execution">{integration.type === "llm" ? "AI" : "JI"}</div>
                      <strong>{integration.name}</strong>
                    </div>
                    <span>{integration.type === "llm" ? integration.model || "Model not set" : integration.project_key || "Project key not set"}</span>
                    <span>{integration.base_url || "No base URL configured"}</span>
                  </div>
                  <StatusBadge value={integration.is_active ? "active" : "inactive"} />
                </button>
              ))}
            </div>
            {!integrations.length ? <div className="empty-state compact">No integrations configured yet.</div> : null}
          </Panel>

          <Panel title={isCreating ? "New integration" : selectedIntegration ? "Integration details" : "Integration editor"} subtitle="Store the essentials the platform needs to call an LLM provider or connect to Jira.">
            {isCreating || selectedIntegration ? (
              <form className="form-grid" onSubmit={(event) => void handleSave(event)}>
                <div className="record-grid">
                  <FormField label="Type">
                    <select
                      value={draft.type}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          type: event.target.value as Integration["type"],
                          base_url: event.target.value === "llm" ? current.base_url || "https://api.openai.com/v1" : current.base_url
                        }))
                      }
                    >
                      <option value="llm">llm</option>
                      <option value="jira">jira</option>
                    </select>
                  </FormField>

                  <FormField label="Name">
                    <input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                  </FormField>

                  <FormField label="Base URL">
                    <input
                      placeholder={isLlm ? "https://api.openai.com/v1" : "https://your-company.atlassian.net"}
                      value={draft.base_url}
                      onChange={(event) => setDraft((current) => ({ ...current, base_url: event.target.value }))}
                    />
                  </FormField>

                  {isLlm ? (
                    <FormField label="Model">
                      <input placeholder="gpt-4.1-mini" value={draft.model} onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} />
                    </FormField>
                  ) : (
                    <FormField label="Jira Project Key">
                      <input placeholder="QA" value={draft.project_key} onChange={(event) => setDraft((current) => ({ ...current, project_key: event.target.value }))} />
                    </FormField>
                  )}
                </div>

                <div className="record-grid">
                  <FormField label="API Key">
                    <input type="password" value={draft.api_key} onChange={(event) => setDraft((current) => ({ ...current, api_key: event.target.value }))} />
                  </FormField>

                  {!isLlm ? (
                    <FormField label="Username / Email">
                      <input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} />
                    </FormField>
                  ) : null}
                </div>

                <label className="checkbox-field">
                  <input
                    checked={draft.is_active}
                    onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))}
                    type="checkbox"
                  />
                  <span>Mark as active</span>
                </label>

                <div className="action-row">
                  <button className="primary-button" type="submit">{isCreating ? "Create integration" : "Save integration"}</button>
                  {!isCreating && selectedIntegration ? (
                    <button className="ghost-button danger" onClick={() => void handleDelete()} type="button">
                      Delete integration
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="empty-state compact">Choose an integration from the left or create a new one.</div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
