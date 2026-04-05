import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";

type FormMode = "login" | "signup" | "forgot" | "signup-success" | "reset-success";
type FieldName = "name" | "email" | "password" | "newPassword";
type FormValues = Record<FieldName, string>;
type FieldErrors = Partial<Record<FieldName, string>>;
type TouchedFields = Partial<Record<FieldName, boolean>>;
type CapabilityTheme = "blue" | "amber" | "teal";
type CapabilityVisual = "design" | "execution" | "traceability";

const INITIAL_FORM_VALUES: FormValues = {
  name: "",
  email: "",
  password: "",
  newPassword: ""
};

const FORM_COPY = {
  login: {
    eyebrow: "Secure login",
    title: "Welcome back",
    description: "Sign in to continue managing test design, execution, and traceability in one place.",
    submitLabel: "Sign in to QAira",
    loadingLabel: "Signing in…"
  },
  signup: {
    eyebrow: "Create account",
    title: "Set up your QAira access",
    description: "Create an account for secure access to the workspace.",
    submitLabel: "Create account",
    loadingLabel: "Creating account…"
  },
  forgot: {
    eyebrow: "Reset password",
    title: "Reset your password",
    description: "Enter your work email and a new password to regain access quickly.",
    submitLabel: "Reset password",
    loadingLabel: "Resetting password…"
  }
} as const;

const AUTH_CAPABILITY_SLIDES: Array<{
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  theme: CapabilityTheme;
  visual: CapabilityVisual;
  metrics: Array<{ value: string; label: string }>;
  capabilities: string[];
  footer: string;
}> = [
  {
    id: "design",
    eyebrow: "AI Test Design",
    title: "Turn raw requirements into reusable test design in minutes.",
    description: "Generate review-ready test cases, attach structured steps, and keep human approval in the loop without losing speed.",
    theme: "blue",
    visual: "design",
    metrics: [
      { value: "3x", label: "faster authoring" },
      { value: "126", label: "steps mapped" },
      { value: "94%", label: "coverage hints" }
    ],
    capabilities: ["Requirement-aware drafting", "Reusable suites and steps", "Human-reviewed AI output"],
    footer: "From requirement changes to execution-ready coverage in one workspace."
  },
  {
    id: "execution",
    eyebrow: "Execution Intelligence",
    title: "Keep live runs, blockers, and failure signals obvious at a glance.",
    description: "Watch execution status in real time, isolate risky failures faster, and keep logs, reruns, and ownership aligned.",
    theme: "amber",
    visual: "execution",
    metrics: [
      { value: "48", label: "live runs" },
      { value: "7", label: "blockers surfaced" },
      { value: "2m", label: "to failure context" }
    ],
    capabilities: ["Real-time execution board", "Failure trend clustering", "Faster triage handoff"],
    footer: "Every run, log, and rerun decision stays connected for the whole team."
  },
  {
    id: "traceability",
    eyebrow: "Release Readiness",
    title: "See what is truly ready to ship with AI-backed traceability.",
    description: "Connect requirements, suites, test cases, and evidence so release risk is visible before it spreads into production.",
    theme: "teal",
    visual: "traceability",
    metrics: [
      { value: "100%", label: "lineage mapped" },
      { value: "14", label: "gaps highlighted" },
      { value: "1", label: "release view" }
    ],
    capabilities: ["Requirement-to-evidence graph", "Audit-ready proof trails", "Risk-first release visibility"],
    footer: "Confidence comes from linked evidence, not disconnected status updates."
  }
];

function mergeIds(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ") || undefined;
}

function getFieldsForMode(mode: FormMode): FieldName[] {
  if (mode === "forgot") {
    return ["email", "newPassword"];
  }

  if (mode === "signup") {
    return ["email", "password"];
  }

  return ["email", "password"];
}

function validateEmail(email: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validatePassword(password: string) {
  if (password.length < 6) {
    return "Password must be at least 6 characters long.";
  }

  return "";
}

function getFieldError(fieldName: FieldName, value: string, mode: FormMode) {
  const trimmedValue = fieldName === "email" || fieldName === "name" ? value.trim() : value;

  if (fieldName === "email") {
    if (!trimmedValue) {
      return "Email is required.";
    }

    if (!validateEmail(trimmedValue)) {
      return "Please enter a valid email address.";
    }
  }

  if (fieldName === "password" && (mode === "login" || mode === "signup")) {
    if (!trimmedValue) {
      return "Password is required.";
    }

    return validatePassword(trimmedValue);
  }

  if (fieldName === "newPassword" && mode === "forgot") {
    if (!trimmedValue) {
      return "New password is required.";
    }

    return validatePassword(trimmedValue);
  }

  return "";
}

function getModeErrors(mode: FormMode, values: FormValues) {
  const nextErrors: FieldErrors = {};

  for (const fieldName of getFieldsForMode(mode)) {
    const error = getFieldError(fieldName, values[fieldName], mode);

    if (error) {
      nextErrors[fieldName] = error;
    }
  }

  return nextErrors;
}

function getTouchedState(mode: FormMode) {
  return getFieldsForMode(mode).reduce<TouchedFields>((state, fieldName) => {
    state[fieldName] = true;
    return state;
  }, {});
}

export function AuthPage() {
  const navigate = useNavigate();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const { login, signup, forgotPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState<FormMode>("login");
  const [formValues, setFormValues] = useState<FormValues>(INITIAL_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touchedFields, setTouchedFields] = useState<TouchedFields>({});
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0);

  const isSuccessMode = mode === "signup-success" || mode === "reset-success";
  const currentCopy = mode === "signup" || mode === "forgot" ? FORM_COPY[mode] : FORM_COPY.login;
  const activeCapability = AUTH_CAPABILITY_SLIDES[activeCapabilityIndex];

  useEffect(() => {
    if (isSuccessMode) {
      return;
    }

    emailInputRef.current?.focus();
  }, [isSuccessMode, mode]);

  useEffect(() => {
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setActiveCapabilityIndex((current) => (current + 1) % AUTH_CAPABILITY_SLIDES.length);
    }, 4800);

    return () => window.clearInterval(intervalId);
  }, []);

  const resetFormState = (nextMode: FormMode) => {
    setMode(nextMode);
    setFormValues(INITIAL_FORM_VALUES);
    setFieldErrors({});
    setTouchedFields({});
    setError("");
    setIsSubmitting(false);
    setShowPassword(false);
    setShowNewPassword(false);
  };

  const updateFieldError = (fieldName: FieldName, value: string) => {
    const nextError = getFieldError(fieldName, value, mode);

    setFieldErrors((current) => {
      const nextErrors = { ...current };

      if (nextError) {
        nextErrors[fieldName] = nextError;
      } else {
        delete nextErrors[fieldName];
      }

      return nextErrors;
    });
  };

  const handleFieldChange = (fieldName: FieldName) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;

    setFormValues((current) => ({
      ...current,
      [fieldName]: value
    }));

    if (error) {
      setError("");
    }

    if (touchedFields[fieldName] || fieldErrors[fieldName]) {
      updateFieldError(fieldName, value);
    }
  };

  const handleFieldBlur = (fieldName: FieldName) => () => {
    setTouchedFields((current) => ({
      ...current,
      [fieldName]: true
    }));
    updateFieldError(fieldName, formValues[fieldName]);
  };

  const handlePasswordShortcut =
    (fieldName: "password" | "newPassword") => (event: KeyboardEvent<HTMLInputElement>) => {
      if (!(event.altKey && event.key.toLowerCase() === "v")) {
        return;
      }

      event.preventDefault();

      if (fieldName === "password") {
        setShowPassword((current) => !current);
        return;
      }

      setShowNewPassword((current) => !current);
    };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting || isSuccessMode) {
      return;
    }

    const normalizedValues: FormValues = {
      ...formValues,
      email: formValues.email.trim().toLowerCase(),
      name: formValues.name.trim()
    };
    const nextErrors = getModeErrors(mode, normalizedValues);

    setFormValues(normalizedValues);
    setFieldErrors(nextErrors);
    setTouchedFields(getTouchedState(mode));
    setError("");

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === "login") {
        await login({
          email: normalizedValues.email,
          password: normalizedValues.password
        });
        navigate("/", { replace: true });
      } else if (mode === "signup") {
        await signup({
          email: normalizedValues.email,
          password: normalizedValues.password,
          name: normalizedValues.name || undefined
        });
        resetFormState("signup-success");
      } else if (mode === "forgot") {
        await forgotPassword({ email: normalizedValues.email });
        await resetPassword({
          email: normalizedValues.email,
          newPassword: normalizedValues.newPassword
        });
        resetFormState("reset-success");
      }
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "We couldn't complete the request. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const loginPasswordDescribedBy = mergeIds(
    fieldErrors.password ? "password-input-error" : undefined,
    "password-input-hint"
  );
  const resetPasswordDescribedBy = mergeIds(
    fieldErrors.newPassword ? "new-password-input-error" : undefined,
    "new-password-input-hint"
  );

  return (
    <div className="page auth-page">
      <div className="container auth-shell">
        <section className="left auth-aside" aria-label="QAira product overview">
          <div className={`auth-aside-panel auth-carousel-panel theme-${activeCapability.theme}`}>
            <div className="auth-carousel-grid">
              <div className="auth-carousel-head">
                <div className="auth-carousel-brand">
                  <div className="brand-mark">Q</div>
                  <div>
                    <strong>QAira AI</strong>
                    <p>Secure workspace intelligence</p>
                  </div>
                </div>
                <span className="auth-carousel-status">Autoplay</span>
              </div>

              <div className="auth-carousel-slide" key={activeCapability.id}>
                <div className="auth-carousel-copy-block">
                  <p className="eyebrow">{activeCapability.eyebrow}</p>
                  <h1>{activeCapability.title}</h1>
                  <p className="auth-aside-copy">{activeCapability.description}</p>

                  <div className="auth-carousel-stat-grid" aria-label="Capability highlights">
                    {activeCapability.metrics.map((metric) => (
                      <div className="auth-carousel-stat-card" key={metric.label}>
                        <strong>{metric.value}</strong>
                        <span>{metric.label}</span>
                      </div>
                    ))}
                  </div>

                  <div className="auth-trust-list" aria-label="Core capabilities">
                    {activeCapability.capabilities.map((capability) => (
                      <span className="auth-trust-pill" key={capability}>{capability}</span>
                    ))}
                  </div>
                </div>

                <div className="auth-carousel-visual-wrap">
                  <AuthCapabilityGraphic visual={activeCapability.visual} />
                </div>
              </div>

              <div className="auth-carousel-footer-row">
                <div className="auth-carousel-dots" aria-label="Capability slides">
                  {AUTH_CAPABILITY_SLIDES.map((slide, index) => (
                    <button
                      aria-label={`Show capability: ${slide.eyebrow}`}
                      className={index === activeCapabilityIndex ? "auth-carousel-dot is-active" : "auth-carousel-dot"}
                      key={slide.id}
                      onClick={() => setActiveCapabilityIndex(index)}
                      type="button"
                    />
                  ))}
                </div>
                <p className="auth-aside-footer">{activeCapability.footer}</p>
              </div>
            </div>
          </div>
        </section>

        <main className="right auth-main">
          <div className="login-card" aria-live="polite">
            <div className="auth-card-brand">
              <div className="brand-mark">Q</div>
              <div>
                <strong>QAIra</strong>
                <p>Secure workspace access</p>
              </div>
            </div>

            {isSuccessMode ? null : (
              <>
                <header className="auth-card-header">
                  <p className="eyebrow">{currentCopy.eyebrow}</p>
                  <div className="auth-card-title" role="heading" aria-level={2}>
                    {currentCopy.title}
                  </div>
                  <p>{currentCopy.description}</p>
                </header>

                {(mode === "login" || mode === "signup") && (
                  <div className="tab-row" role="tablist" aria-label="Authentication options">
                    <button
                      className={mode === "login" ? "tab-button is-active" : "tab-button"}
                      onClick={() => resetFormState("login")}
                      type="button"
                      role="tab"
                      aria-selected={mode === "login"}
                      disabled={isSubmitting}
                    >
                      Login
                    </button>
                    <button
                      className={mode === "signup" ? "tab-button is-active" : "tab-button"}
                      onClick={() => resetFormState("signup")}
                      type="button"
                      role="tab"
                      aria-selected={mode === "signup"}
                      disabled={isSubmitting}
                    >
                      Sign up
                    </button>
                  </div>
                )}
              </>
            )}

            {isSuccessMode ? (
              <div className="success-screen">
                <div className="success-icon" aria-hidden="true">✓</div>
                <div className="success-screen-title" role="heading" aria-level={2}>
                  {mode === "signup-success" ? "Account created" : "Password updated"}
                </div>
                <p className="success-message">
                  {mode === "signup-success"
                    ? "Your account is ready. Sign in with your new credentials to enter the workspace."
                    : "Your password has been reset. Sign in with the updated password to continue."}
                </p>
                <button
                  className="primary-button auth-submit"
                  onClick={() => resetFormState("login")}
                  type="button"
                >
                  Back to login
                </button>
              </div>
            ) : (
              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                {mode === "signup" && (
                  <FormField label="Full name" inputId="name-input">
                    <input
                      autoComplete="name"
                      disabled={isSubmitting}
                      id="name-input"
                      name="name"
                      onBlur={handleFieldBlur("name")}
                      onChange={handleFieldChange("name")}
                      type="text"
                      value={formValues.name}
                    />
                  </FormField>
                )}

                <FormField
                  error={fieldErrors.email}
                  inputId="email-input"
                  label="Email"
                  required
                >
                  <input
                    autoComplete="email"
                    autoFocus
                    disabled={isSubmitting}
                    inputMode="email"
                    name="email"
                    onBlur={handleFieldBlur("email")}
                    onChange={handleFieldChange("email")}
                    ref={emailInputRef}
                    type="email"
                    value={formValues.email}
                  />
                </FormField>

                {(mode === "login" || mode === "signup") && (
                  <FormField
                    error={fieldErrors.password}
                    hint="Minimum 6 characters. Press Alt+V to show or hide."
                    inputId="password-input"
                    label="Password"
                    required
                  >
                    <div className={fieldErrors.password ? "password-field is-error" : "password-field"}>
                      <input
                        aria-describedby={loginPasswordDescribedBy}
                        aria-invalid={Boolean(fieldErrors.password)}
                        autoComplete={mode === "login" ? "current-password" : "new-password"}
                        disabled={isSubmitting}
                        id="password-input"
                        name="password"
                        onBlur={handleFieldBlur("password")}
                        onChange={handleFieldChange("password")}
                        onKeyDown={handlePasswordShortcut("password")}
                        aria-keyshortcuts="Alt+V"
                        type={showPassword ? "text" : "password"}
                        value={formValues.password}
                      />
                      <button
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="password-toggle"
                        disabled={isSubmitting}
                        onClick={() => setShowPassword((current) => !current)}
                        tabIndex={-1}
                        type="button"
                      >
                        {showPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </FormField>
                )}

                {mode === "forgot" && (
                  <FormField
                    error={fieldErrors.newPassword}
                    hint="Minimum 6 characters. Press Alt+V to show or hide."
                    inputId="new-password-input"
                    label="New password"
                    required
                  >
                    <div className={fieldErrors.newPassword ? "password-field is-error" : "password-field"}>
                      <input
                        aria-describedby={resetPasswordDescribedBy}
                        aria-invalid={Boolean(fieldErrors.newPassword)}
                        autoComplete="new-password"
                        disabled={isSubmitting}
                        id="new-password-input"
                        name="newPassword"
                        onBlur={handleFieldBlur("newPassword")}
                        onChange={handleFieldChange("newPassword")}
                        onKeyDown={handlePasswordShortcut("newPassword")}
                        aria-keyshortcuts="Alt+V"
                        type={showNewPassword ? "text" : "password"}
                        value={formValues.newPassword}
                      />
                      <button
                        aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                        className="password-toggle"
                        disabled={isSubmitting}
                        onClick={() => setShowNewPassword((current) => !current)}
                        tabIndex={-1}
                        type="button"
                      >
                        {showNewPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </FormField>
                )}

                {error ? (
                  <div className="form-error-box" role="alert">
                    <p>{error}</p>
                    <button
                      aria-label="Dismiss error"
                      className="form-error-dismiss"
                      onClick={() => setError("")}
                      type="button"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}

                <button
                  className="primary-button auth-submit"
                  disabled={isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? <span className="button-spinner" aria-hidden="true" /> : null}
                  <span>{isSubmitting ? currentCopy.loadingLabel : currentCopy.submitLabel}</span>
                </button>

                {mode === "login" || mode === "forgot" ? (
                  <div className="auth-secondary-actions">
                    {mode === "login" ? (
                      <button
                        className="link-button"
                        disabled={isSubmitting}
                        onClick={() => resetFormState("forgot")}
                        type="button"
                      >
                        Forgot password?
                      </button>
                    ) : null}

                    {mode === "forgot" ? (
                      <button
                        className="link-button"
                        disabled={isSubmitting}
                        onClick={() => resetFormState("login")}
                        type="button"
                      >
                        Back to login
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </form>
            )}

            <footer className="auth-card-footer">Secure login • QAira</footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function AuthCapabilityGraphic({ visual }: { visual: CapabilityVisual }) {
  if (visual === "design") {
    return (
      <div className="auth-capability-visual auth-visual-design" aria-hidden="true">
        <div className="auth-visual-halo auth-visual-halo-one" />
        <div className="auth-visual-halo auth-visual-halo-two" />
        <div className="auth-visual-command">
          <span className="auth-visual-command-label">AI prompt</span>
          <strong>Generate release-ready checkout coverage from updated requirements.</strong>
        </div>
        <div className="auth-visual-floating-chip">Steps attached automatically</div>
        <div className="auth-visual-design-grid">
          <div className="auth-visual-column">
            <span>Requirements</span>
            <strong>12 signals</strong>
            <div className="auth-visual-bar"><span style={{ width: "82%" }} /></div>
          </div>
          <div className="auth-visual-column">
            <span>Reusable cases</span>
            <strong>24 drafted</strong>
            <div className="auth-visual-bar"><span style={{ width: "74%" }} /></div>
          </div>
          <div className="auth-visual-column">
            <span>Review confidence</span>
            <strong>Ready to refine</strong>
            <div className="auth-visual-bar"><span style={{ width: "91%" }} /></div>
          </div>
        </div>
      </div>
    );
  }

  if (visual === "execution") {
    return (
      <div className="auth-capability-visual auth-visual-execution" aria-hidden="true">
        <div className="auth-visual-halo auth-visual-halo-one" />
        <div className="auth-visual-dashboard">
          <div className="auth-visual-kpi-row">
            <div className="auth-visual-kpi">
              <strong>31</strong>
              <span>Passing</span>
            </div>
            <div className="auth-visual-kpi">
              <strong>07</strong>
              <span>Blocked</span>
            </div>
            <div className="auth-visual-kpi">
              <strong>10</strong>
              <span>Needs triage</span>
            </div>
          </div>
          <div className="auth-visual-chart">
            <span className="auth-visual-chart-bar is-muted" style={{ height: "42%" }} />
            <span className="auth-visual-chart-bar" style={{ height: "58%" }} />
            <span className="auth-visual-chart-bar" style={{ height: "76%" }} />
            <span className="auth-visual-chart-bar" style={{ height: "48%" }} />
            <span className="auth-visual-chart-bar" style={{ height: "88%" }} />
            <span className="auth-visual-chart-bar" style={{ height: "62%" }} />
          </div>
          <div className="auth-visual-log-stream">
            <div className="auth-visual-log is-success">
              <span>Checkout smoke</span>
              <strong>passed</strong>
            </div>
            <div className="auth-visual-log is-warning">
              <span>Payments fallback</span>
              <strong>blocked</strong>
            </div>
            <div className="auth-visual-log is-danger">
              <span>Role matrix sync</span>
              <strong>failed</strong>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-capability-visual auth-visual-traceability" aria-hidden="true">
      <div className="auth-visual-halo auth-visual-halo-one" />
      <div className="auth-visual-halo auth-visual-halo-two" />
      <div className="auth-visual-trace-grid">
        <div className="auth-visual-network">
          <span className="auth-network-line" style={{ top: "28%", left: "32%", width: "34%", transform: "rotate(10deg)" }} />
          <span className="auth-network-line" style={{ top: "46%", left: "31%", width: "36%", transform: "rotate(-7deg)" }} />
          <span className="auth-network-line" style={{ top: "52%", left: "18%", width: "28%", transform: "rotate(38deg)" }} />
          <span className="auth-network-line" style={{ top: "38%", left: "55%", width: "22%", transform: "rotate(42deg)" }} />
          <div className="auth-network-node is-primary" style={{ top: "34%", left: "36%" }}>Release</div>
          <div className="auth-network-node" style={{ top: "12%", left: "10%" }}>Requirement</div>
          <div className="auth-network-node" style={{ top: "14%", right: "8%" }}>Suite</div>
          <div className="auth-network-node" style={{ bottom: "14%", left: "12%" }}>Case</div>
          <div className="auth-network-node" style={{ bottom: "12%", right: "10%" }}>Evidence</div>
        </div>

        <div className="auth-visual-sidecard">
          <span className="auth-visual-command-label">Risk lens</span>
          <div className="auth-risk-row">
            <span>Coverage gap</span>
            <strong>4 flows</strong>
          </div>
          <div className="auth-risk-row">
            <span>Orphan evidence</span>
            <strong>0</strong>
          </div>
          <div className="auth-risk-row">
            <span>Ready for sign-off</span>
            <strong>86%</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
