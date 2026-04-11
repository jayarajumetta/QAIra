import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatusBadge } from "../components/StatusBadge";
import { ToastMessage } from "../components/ToastMessage";
import { TileCardStatusIndicator } from "../components/TileCardPrimitives";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
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
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_password: string;
  sender_email: string;
  sender_name: string;
  google_client_id: string;
};

const DEFAULT_EMAIL_SENDER = "support@qualipal.in";
const DEFAULT_EMAIL_SENDER_NAME = "QAira Support";

const EMPTY_DRAFT: IntegrationDraft = {
  type: "llm",
  name: "",
  base_url: "https://api.openai.com/v1",
  api_key: "",
  model: "",
  project_key: "",
  username: "",
  is_active: true,
  smtp_host: "",
  smtp_port: "587",
  smtp_secure: false,
  smtp_password: "",
  sender_email: DEFAULT_EMAIL_SENDER,
  sender_name: DEFAULT_EMAIL_SENDER_NAME,
  google_client_id: ""
};

function getIntegrationTypeLabel(type: Integration["type"]) {
  if (type === "llm") {
    return "LLM";
  }

  if (type === "jira") {
    return "Jira";
  }

  if (type === "email") {
    return "Email Sender";
  }

  return "Google Sign-In";
}

function getIntegrationTypeIcon(type: Integration["type"]) {
  if (type === "llm") {
    return "AI";
  }

  if (type === "jira") {
    return "JI";
  }

  if (type === "email") {
    return "EM";
  }

  return "GO";
}

function applyDraftDefaultsForType(type: Integration["type"], current: IntegrationDraft): IntegrationDraft {
  if (type === "llm") {
    return {
      ...current,
      type,
      base_url: current.base_url || "https://api.openai.com/v1"
    };
  }

  if (type === "email") {
    return {
      ...current,
      type,
      smtp_port: current.smtp_port || "587",
      sender_email: current.sender_email || DEFAULT_EMAIL_SENDER,
      sender_name: current.sender_name || DEFAULT_EMAIL_SENDER_NAME
    };
  }

  return {
    ...current,
    type
  };
}

function getDraftFromIntegration(integration: Integration): IntegrationDraft {
  const config: Record<string, unknown> = integration.config || {};

  return applyDraftDefaultsForType(integration.type, {
    ...EMPTY_DRAFT,
    type: integration.type,
    name: integration.name,
    base_url: integration.base_url || (integration.type === "llm" ? "https://api.openai.com/v1" : ""),
    api_key: integration.api_key || "",
    model: integration.model || "",
    project_key: integration.project_key || "",
    username: integration.username || "",
    is_active: integration.is_active,
    smtp_host: typeof config.host === "string" ? config.host : "",
    smtp_port:
      typeof config.port === "number"
        ? String(config.port)
        : typeof config.port === "string"
          ? config.port
          : "587",
    smtp_secure: Boolean(config.secure),
    smtp_password: typeof config.password === "string" ? config.password : "",
    sender_email: typeof config.sender_email === "string" ? config.sender_email : DEFAULT_EMAIL_SENDER,
    sender_name: typeof config.sender_name === "string" ? config.sender_name : DEFAULT_EMAIL_SENDER_NAME,
    google_client_id: typeof config.client_id === "string" ? config.client_id : ""
  });
}

function buildIntegrationConfig(draft: IntegrationDraft): Record<string, unknown> {
  if (draft.type === "email") {
    return {
      host: draft.smtp_host.trim(),
      port: Number.parseInt(draft.smtp_port, 10),
      secure: draft.smtp_secure,
      password: draft.smtp_password,
      sender_email: draft.sender_email.trim() || DEFAULT_EMAIL_SENDER,
      sender_name: draft.sender_name.trim() || DEFAULT_EMAIL_SENDER_NAME
    };
  }

  if (draft.type === "google_auth") {
    return {
      client_id: draft.google_client_id.trim()
    };
  }

  return {};
}

function getIntegrationSummary(integration: Integration) {
  const config: Record<string, unknown> = integration.config || {};

  if (integration.type === "llm") {
    return {
      primary: integration.model || "Model not set",
      secondary: integration.base_url || "No base URL configured"
    };
  }

  if (integration.type === "jira") {
    return {
      primary: integration.project_key || "Project key not set",
      secondary: integration.base_url || "No base URL configured"
    };
  }

  if (integration.type === "email") {
    const host = typeof config.host === "string" ? config.host : "";
    const port = typeof config.port === "number" ? config.port : typeof config.port === "string" ? config.port : "";

    return {
      primary: typeof config.sender_email === "string" ? config.sender_email : DEFAULT_EMAIL_SENDER,
      secondary: host ? `${host}${port ? `:${port}` : ""}` : "SMTP server not set"
    };
  }

  return {
    primary: typeof config.client_id === "string" ? config.client_id : "Client ID not set",
    secondary: "Used on the login page for Google sign-in"
  };
}

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
  const selectedIntegration = useMemo(
    () => integrations.find((item) => item.id === selectedIntegrationId) || null,
    [integrations, selectedIntegrationId]
  );
  const activeIntegrationCount = integrations.filter((item) => item.is_active).length;
  const isAdmin = session?.user.role === "admin";
  const isLlm = draft.type === "llm";
  const isJira = draft.type === "jira";
  const isEmail = draft.type === "email";
  const isGoogle = draft.type === "google_auth";

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (!selectedIntegrationId) {
      setDraft(EMPTY_DRAFT);
      return;
    }

    if (selectedIntegration) {
      setDraft(getDraftFromIntegration(selectedIntegration));
      return;
    }

    setSelectedIntegrationId("");
    setDraft(EMPTY_DRAFT);
  }, [isCreating, selectedIntegration, selectedIntegrationId]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["integrations"] });
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      const input = {
        type: draft.type,
        name: draft.name.trim(),
        base_url: draft.base_url.trim() || undefined,
        api_key: draft.api_key.trim() || undefined,
        model: draft.model.trim() || undefined,
        project_key: draft.project_key.trim() || undefined,
        username: draft.username.trim() || undefined,
        config: buildIntegrationConfig(draft),
        is_active: draft.is_active
      };

      if (isCreating || !selectedIntegration) {
        const response = await createIntegration.mutateAsync(input);
        setSelectedIntegrationId(response.id);
        setIsCreating(false);
        showSuccess("Integration created.");
      } else {
        await updateIntegration.mutateAsync({
          id: selectedIntegration.id,
          input
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

  const openCreateForm = () => {
    setIsCreating(true);
    setSelectedIntegrationId("");
    setDraft(EMPTY_DRAFT);
  };

  const closeIntegrationWorkspace = () => {
    setSelectedIntegrationId("");
    setIsCreating(false);
    setDraft(EMPTY_DRAFT);
  };

  return (
    <div className="page-content">
      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone === "error" ? "error" : "success"} />

      <PageHeader
        eyebrow="Administration"
        title="Integrations"
        description="Manage the external systems QAira uses for AI generation, Jira sync, Google sign-in, and email verification delivery."
        meta={[
          { label: "Configured", value: integrations.length },
          { label: "Active", value: activeIntegrationCount },
          { label: "Selected type", value: isCreating ? getIntegrationTypeLabel(draft.type) : selectedIntegration ? getIntegrationTypeLabel(selectedIntegration.type) : "None" }
        ]}
        actions={
          isAdmin ? (
            <button
              className="primary-button"
              onClick={openCreateForm}
              type="button"
            >
              + New Integration
            </button>
          ) : null
        }
      />

      {!isAdmin ? (
        <Panel title="Access required" subtitle="Only admins can manage integrations.">
          <div className="empty-state compact">Ask an admin to manage LLM, Jira, Email Sender, and Google Sign-In integrations.</div>
        </Panel>
      ) : (
        <WorkspaceMasterDetail
          browseView={(
            <Panel title="Integration tiles" subtitle="Review configured connections as tiles first, then open one profile into a focused editor.">
              <div className="tile-browser-grid">
                {integrations.map((integration) => {
                  const summary = getIntegrationSummary(integration);

                  return (
                    <button
                      key={integration.id}
                      className={selectedIntegrationId === integration.id ? "record-card tile-card is-active" : "record-card tile-card"}
                      onClick={() => {
                        setSelectedIntegrationId(integration.id);
                        setIsCreating(false);
                      }}
                      type="button"
                    >
                      <div className="tile-card-main">
                        <div className="tile-card-header">
                          <span className="integration-type-badge">{getIntegrationTypeIcon(integration.type)}</span>
                          <div className="tile-card-title-group">
                            <strong>{integration.name}</strong>
                            <span className="tile-card-kicker">{getIntegrationTypeLabel(integration.type)}</span>
                          </div>
                          <TileCardStatusIndicator title={integration.is_active ? "Active" : "Inactive"} tone={integration.is_active ? "success" : "neutral"} />
                        </div>
                        <p className="tile-card-description">{summary.primary}</p>
                        <div className="integration-card-footer">
                          <StatusBadge value={integration.is_active ? "active" : "inactive"} />
                          <span className="count-pill">{summary.secondary}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {!integrations.length ? <div className="empty-state compact">No integrations configured yet.</div> : null}
            </Panel>
          )}
          detailView={(
            <Panel
              actions={<WorkspaceBackButton label="Back to integration tiles" onClick={closeIntegrationWorkspace} />}
              title={isCreating ? "New integration" : selectedIntegration ? "Integration details" : "Integration editor"}
              subtitle="Store the credentials and provider settings QAira needs to call external systems and power secure authentication flows."
            >
              {isCreating || selectedIntegration ? (
                <form className="form-grid" onSubmit={(event) => void handleSave(event)}>
                <div className="record-grid">
                  <FormField label="Type">
                    <select
                      value={draft.type}
                      onChange={(event) =>
                        setDraft((current) =>
                          applyDraftDefaultsForType(event.target.value as Integration["type"], current)
                        )
                      }
                    >
                      <option value="llm">LLM</option>
                      <option value="jira">Jira</option>
                      <option value="email">Email Sender</option>
                      <option value="google_auth">Google Sign-In</option>
                    </select>
                  </FormField>

                  <FormField label="Name">
                    <input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                  </FormField>
                </div>

                {(isLlm || isJira) ? (
                  <>
                    <div className="record-grid">
                      <FormField label="Base URL">
                        <input
                          placeholder={isLlm ? "https://api.openai.com/v1" : "https://your-company.atlassian.net"}
                          value={draft.base_url}
                          onChange={(event) => setDraft((current) => ({ ...current, base_url: event.target.value }))}
                        />
                      </FormField>

                      {isLlm ? (
                        <FormField label="Model">
                          <input
                            placeholder="gpt-5.4-mini"
                            value={draft.model}
                            onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))}
                          />
                        </FormField>
                      ) : (
                        <FormField label="Jira Project Key">
                          <input
                            placeholder="QA"
                            value={draft.project_key}
                            onChange={(event) => setDraft((current) => ({ ...current, project_key: event.target.value }))}
                          />
                        </FormField>
                      )}
                    </div>

                    <div className="record-grid">
                      <FormField label="API Key">
                        <input type="password" value={draft.api_key} onChange={(event) => setDraft((current) => ({ ...current, api_key: event.target.value }))} />
                      </FormField>

                      {isJira ? (
                        <FormField label="Username / Email">
                          <input value={draft.username} onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))} />
                        </FormField>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {isEmail ? (
                  <>
                    <div className="empty-state compact integration-helper">
                      QAira sends signup and forgot-password verification codes through this SMTP profile. Set the sender email to <strong>{DEFAULT_EMAIL_SENDER}</strong> when that mailbox is configured on your mail provider.
                    </div>

                    <div className="record-grid">
                      <FormField label="SMTP Host">
                        <input
                          placeholder="smtp.zoho.in"
                          value={draft.smtp_host}
                          onChange={(event) => setDraft((current) => ({ ...current, smtp_host: event.target.value }))}
                        />
                      </FormField>

                      <FormField label="SMTP Port">
                        <input
                          inputMode="numeric"
                          placeholder="587"
                          value={draft.smtp_port}
                          onChange={(event) => setDraft((current) => ({ ...current, smtp_port: event.target.value }))}
                        />
                      </FormField>
                    </div>

                    <div className="record-grid">
                      <FormField label="SMTP Username / Email">
                        <input
                          placeholder="support@qualipal.in"
                          value={draft.username}
                          onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
                        />
                      </FormField>

                      <FormField label="SMTP Password">
                        <input
                          type="password"
                          value={draft.smtp_password}
                          onChange={(event) => setDraft((current) => ({ ...current, smtp_password: event.target.value }))}
                        />
                      </FormField>
                    </div>

                    <div className="record-grid">
                      <FormField label="Sender Email">
                        <input
                          placeholder={DEFAULT_EMAIL_SENDER}
                          value={draft.sender_email}
                          onChange={(event) => setDraft((current) => ({ ...current, sender_email: event.target.value }))}
                        />
                      </FormField>

                      <FormField label="Sender Name">
                        <input
                          placeholder={DEFAULT_EMAIL_SENDER_NAME}
                          value={draft.sender_name}
                          onChange={(event) => setDraft((current) => ({ ...current, sender_name: event.target.value }))}
                        />
                      </FormField>
                    </div>

                    <label className="checkbox-field">
                      <input
                        checked={draft.smtp_secure}
                        onChange={(event) => setDraft((current) => ({ ...current, smtp_secure: event.target.checked }))}
                        type="checkbox"
                      />
                      <span>Use secure SMTP connection</span>
                    </label>
                  </>
                ) : null}

                {isGoogle ? (
                  <>
                    <div className="empty-state compact integration-helper">
                      Add the Google OAuth web client ID that should power the sign-in button on the QAira login page.
                    </div>

                    <div className="record-grid">
                      <FormField label="Google Client ID">
                        <input
                          placeholder="1234567890-abcdef.apps.googleusercontent.com"
                          value={draft.google_client_id}
                          onChange={(event) => setDraft((current) => ({ ...current, google_client_id: event.target.value }))}
                        />
                      </FormField>
                    </div>
                  </>
                ) : null}

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
                <div className="empty-state compact">Choose an integration tile or create a new one.</div>
              )}
            </Panel>
          )}
          isDetailOpen={isCreating || Boolean(selectedIntegration)}
        />
      )}
    </div>
  );
}
