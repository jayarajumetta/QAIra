import type { ReactNode } from "react";
import { FormField } from "./FormField";
import type { StepParameterDefinition } from "../lib/stepParameters";

type StepParameterDialogInputState = {
  disabled?: boolean;
  hint?: string;
  placeholder?: string;
};

export function StepParameterDialog({
  title,
  subtitle,
  parameters,
  values,
  onChange,
  onClose,
  headerContent,
  getInputState
}: {
  title: string;
  subtitle: string;
  parameters: StepParameterDefinition[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onClose: () => void;
  headerContent?: ReactNode;
  getInputState?: (parameter: StepParameterDefinition) => StepParameterDialogInputState;
}) {
  const groupedParameters = [
    {
      scope: "t",
      title: "Test case data",
      items: parameters.filter((parameter) => parameter.scope === "t")
    },
    {
      scope: "s",
      title: "Suite-shared data",
      items: parameters.filter((parameter) => parameter.scope === "s")
    },
    {
      scope: "r",
      title: "Run data",
      items: parameters.filter((parameter) => parameter.scope === "r")
    }
  ].filter((group) => group.items.length);
  const parameterCount = parameters.length;

  return (
    <div className="modal-backdrop modal-backdrop--scroll" onClick={onClose} role="presentation">
      <div
        aria-label={title}
        aria-modal="true"
        className="modal-card suite-create-modal step-parameter-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-create-header step-parameter-dialog-header">
          <div className="suite-create-title">
            <p className="eyebrow">Test data</p>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <div className="step-parameter-dialog-head-meta">
            <span className="count-pill">{parameterCount} field{parameterCount === 1 ? "" : "s"}</span>
            <button className="ghost-button" onClick={onClose} type="button">
              Close
            </button>
          </div>
        </div>

        <div className="step-parameter-dialog-body">
          {headerContent ? <div className="step-parameter-dialog-header-slot">{headerContent}</div> : null}
          {parameters.length ? (
            <div className="step-parameter-list">
              {groupedParameters.map((group) => (
                <section className="step-parameter-group" key={group.scope}>
                  <div className="step-parameter-group-head">
                    <strong>{group.title}</strong>
                    <span>{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                  </div>
                  {group.items.map((parameter) => {
                    const inputState = getInputState?.(parameter) || {};

                    return (
                      <div className="step-parameter-row" key={parameter.name}>
                        <FormField
                          label={parameter.token}
                          hint={[
                            `${parameter.occurrenceCount} mention${parameter.occurrenceCount === 1 ? "" : "s"} across ${parameter.stepIds.length} step${parameter.stepIds.length === 1 ? "" : "s"}.`,
                            inputState.hint || ""
                          ].filter(Boolean).join(" ")}
                        >
                          <input
                            disabled={inputState.disabled}
                            placeholder={inputState.placeholder || `Value for ${parameter.token}`}
                            value={values[parameter.name] || ""}
                            onChange={(event) => onChange(parameter.name, event.target.value)}
                          />
                        </FormField>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">No `@params` detected in these steps yet.</div>
          )}
        </div>

        <div className="step-parameter-dialog-footer">
          <span>
            {parameterCount
              ? `${parameterCount} detected field${parameterCount === 1 ? "" : "s"} stay scoped to this case, suite, or run context.`
              : "Detected params will appear here once steps reference @tokens."}
          </span>
          <button className="ghost-button" onClick={onClose} type="button">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
