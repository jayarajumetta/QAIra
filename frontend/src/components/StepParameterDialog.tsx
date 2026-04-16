import { FormField } from "./FormField";
import type { StepParameterDefinition } from "../lib/stepParameters";

export function StepParameterDialog({
  title,
  subtitle,
  parameters,
  values,
  onChange,
  onClose
}: {
  title: string;
  subtitle: string;
  parameters: StepParameterDefinition[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label={title}
        aria-modal="true"
        className="modal-card suite-create-modal step-parameter-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="suite-create-header">
          <div className="suite-create-title">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>

        <div className="step-parameter-dialog-body">
          {parameters.length ? (
            <div className="step-parameter-list">
              {parameters.map((parameter) => (
                <div className="step-parameter-row" key={parameter.name}>
                  <FormField
                    label={parameter.token}
                    hint={`${parameter.occurrenceCount} mention${parameter.occurrenceCount === 1 ? "" : "s"} across ${parameter.stepIds.length} step${parameter.stepIds.length === 1 ? "" : "s"}.`}
                  >
                    <input
                      placeholder={`Value for ${parameter.token}`}
                      value={values[parameter.name] || ""}
                      onChange={(event) => onChange(parameter.name, event.target.value)}
                    />
                  </FormField>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">No `@params` detected in these steps yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
