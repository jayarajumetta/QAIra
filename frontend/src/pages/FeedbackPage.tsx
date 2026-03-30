import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { api } from "../lib/api";
import { useWorkspaceData } from "../hooks/useWorkspaceData";
import type { Feedback } from "../types";

type FeedbackDraft = {
  title: string;
  message: string;
  status: string;
};

const EMPTY_DRAFT: FeedbackDraft = {
  title: "",
  message: "",
  status: "open"
};

export function FeedbackPage() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { feedback } = useWorkspaceData();
  const [selectedFeedbackId, setSelectedFeedbackId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_DRAFT);
  const [message, setMessage] = useState("");

  const items = feedback.data || [];
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedFeedbackId) || items[0] || null,
    [items, selectedFeedbackId]
  );

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (selectedItem) {
      setSelectedFeedbackId(selectedItem.id);
      setDraft({
        title: selectedItem.title,
        message: selectedItem.message,
        status: selectedItem.status || "open"
      });
      return;
    }

    setSelectedFeedbackId("");
    setDraft(EMPTY_DRAFT);
  }, [isCreating, selectedItem]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["feedback"] });
  };

  const createFeedback = useMutation({
    mutationFn: api.feedback.create,
    onSuccess: async () => {
      setMessage("Feedback saved.");
      await refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to save feedback")
  });

  const updateFeedback = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.feedback.update>[1] }) =>
      api.feedback.update(id, input),
    onSuccess: async () => {
      setMessage("Feedback updated.");
      await refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update feedback")
  });

  const deleteFeedback = useMutation({
    mutationFn: api.feedback.delete,
    onSuccess: async () => {
      setMessage("Feedback deleted.");
      setSelectedFeedbackId("");
      setDraft(EMPTY_DRAFT);
      setIsCreating(false);
      await refresh();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete feedback")
  });

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!session?.user.id) {
      return;
    }

    if (isCreating || !selectedItem) {
      const response = await createFeedback.mutateAsync({
        user_id: session.user.id,
        title: draft.title,
        message: draft.message,
        status: draft.status
      });
      setSelectedFeedbackId(response.id);
      setIsCreating(false);
      return;
    }

    await updateFeedback.mutateAsync({
      id: selectedItem.id,
      input: {
        title: draft.title,
        message: draft.message,
        status: draft.status
      }
    });
  };

  return (
    <div className="page-content">
      <PageHeader
        eyebrow="Reporting & Feedback"
        title="Reporting & Feedback"
        description="Capture requests, issues, and shared feedback in a cleaner reporting stream that sits alongside the rest of the QA workspace."
        actions={
          <button
            className="primary-button"
            onClick={() => {
              setIsCreating(true);
              setSelectedFeedbackId("");
              setDraft(EMPTY_DRAFT);
            }}
            type="button"
          >
            + Add Feedback
          </button>
        }
      />

      {message ? <p className="inline-message success-message">{message}</p> : null}

      <div className="workspace-grid">
        <Panel title="Feedback stream" subtitle="All submitted feedback is shown here, independent of project scope.">
          {feedback.isLoading ? (
            <div className="record-list">
              <div className="skeleton-block" />
              <div className="skeleton-block" />
              <div className="skeleton-block" />
            </div>
          ) : null}

          <div className="record-list">
            {items.map((item: Feedback) => (
              <button
                key={item.id}
                className={selectedFeedbackId === item.id ? "record-card is-active" : "record-card"}
                onClick={() => {
                  setSelectedFeedbackId(item.id);
                  setIsCreating(false);
                }}
                type="button"
              >
                <div className="record-card-body">
                  <strong>{item.title}</strong>
                  <span>{item.message}</span>
                  <span>{item.user_name || item.user_email || item.user_id}</span>
                </div>
                <span className="count-pill">{item.status || "open"}</span>
              </button>
            ))}
          </div>

          {!feedback.isLoading && !items.length ? <div className="empty-state compact">No feedback submitted yet.</div> : null}
        </Panel>

        <Panel title={isCreating ? "New feedback" : selectedItem ? "Selected feedback" : "Feedback editor"} subtitle="Use this space to capture requests, issues, or ideas and keep the thread visible to the whole team.">
          {(isCreating || selectedItem) ? (
            <form className="form-grid" onSubmit={(event) => void handleSave(event)}>
              <FormField label="Title">
                <input required value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} />
              </FormField>
              <FormField label="Status">
                <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>
                  <option value="open">open</option>
                  <option value="reviewed">reviewed</option>
                  <option value="planned">planned</option>
                  <option value="closed">closed</option>
                </select>
              </FormField>
              <FormField label="Message">
                <textarea required rows={8} value={draft.message} onChange={(event) => setDraft((current) => ({ ...current, message: event.target.value }))} />
              </FormField>
              <div className="action-row">
                <button className="primary-button" type="submit">{isCreating ? "Save feedback" : "Update feedback"}</button>
                {!isCreating && selectedItem ? (
                  <button
                    className="ghost-button danger"
                    onClick={() => {
                      if (window.confirm(`Delete feedback "${selectedItem.title}"?`)) {
                        void deleteFeedback.mutateAsync(selectedItem.id);
                      }
                    }}
                    type="button"
                  >
                    Delete feedback
                  </button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="empty-state compact">Select feedback from the left or create a new entry.</div>
          )}
        </Panel>
      </div>
    </div>
  );
}
