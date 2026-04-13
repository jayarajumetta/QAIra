import { ChangeEvent, FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";
import { ToastMessage } from "../components/ToastMessage";
import { api } from "../lib/api";
import type { AuthSetupPayload } from "../types";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: "outline" | "filled_blue" | "filled_black";
              size?: "large" | "medium" | "small";
              text?: "signin_with" | "signup_with" | "continue_with" | "signin";
              shape?: "rectangular" | "pill" | "circle" | "square";
              width?: number;
              logo_alignment?: "left" | "center";
            }
          ) => void;
        };
      };
    };
  }
}

type FormMode =
  | "login"
  | "signup"
  | "signup-code"
  | "forgot"
  | "forgot-code"
  | "signup-success"
  | "reset-success";
type FieldName = "name" | "email" | "password" | "newPassword" | "verificationCode";
type FormValues = Record<FieldName, string>;
type FieldErrors = Partial<Record<FieldName, string>>;
type TouchedFields = Partial<Record<FieldName, boolean>>;
type CapabilityTheme = "blue" | "amber" | "teal";
type CapabilityVisual = "design" | "execution" | "traceability";
type PendingVerification = {
  type: "signup" | "forgot";
  email: string;
};

const EMPTY_AUTH_SETUP: AuthSetupPayload = {
  google: {
    enabled: false,
    clientId: null
  },
  emailVerification: {
    enabled: false,
    senderEmail: null,
    senderName: null
  }
};

const INITIAL_FORM_VALUES: FormValues = {
  name: "",
  email: "",
  password: "",
  newPassword: "",
  verificationCode: ""
};

const AUTH_CAPABILITY_SLIDES: Array<{
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  theme: CapabilityTheme;
  visual: CapabilityVisual;
  metrics: Array<{ value: string; label: string }>;
  highlights: Array<{ title: string; detail: string }>;
  footer: string;
}> = [
  {
    id: "design",
    eyebrow: "AI Design Studio",
    title: "Convert release notes and requirements into execution-ready test design.",
    description: "QAira helps teams move from raw change input to structured coverage faster, while still keeping reviewer control, reusable steps, and enterprise-grade consistency.",
    theme: "blue",
    visual: "design",
    metrics: [
      { value: "3x", label: "faster design cycles" },
      { value: "126", label: "mapped test steps" },
      { value: "94%", label: "coverage guidance" }
    ],
    highlights: [
      {
        title: "Requirement-aware drafting",
        detail: "Generate cases with linked priorities, descriptions, and structured step suggestions."
      },
      {
        title: "Reusable quality assets",
        detail: "Keep suites, shared step groups, and app-type coverage organized as your library grows."
      },
      {
        title: "Human review by default",
        detail: "AI accelerates authoring without taking reviewers or release owners out of the approval loop."
      }
    ],
    footer: "From requirement changes to execution-ready coverage in one connected workspace."
  },
  {
    id: "execution",
    eyebrow: "Smart Execution",
    title: "Plan, run, and triage execution with live context instead of scattered status updates.",
    description: "Bring impact-based planning, step-level evidence, assignment, and blocker visibility into a single execution workspace built for fast release decisions.",
    theme: "amber",
    visual: "execution",
    metrics: [
      { value: "48", label: "active run snapshots" },
      { value: "7", label: "blockers surfaced early" },
      { value: "2m", label: "to failure context" }
    ],
    highlights: [
      {
        title: "Impact-based execution",
        detail: "Use AI Smart Execution to stage the most affected cases from release scope and context."
      },
      {
        title: "Evidence at the step level",
        detail: "Capture notes, images, and result state exactly where the tester is working."
      },
      {
        title: "Cleaner triage handoff",
        detail: "Keep ownership, suite status, and execution history connected when teams need to act fast."
      }
    ],
    footer: "Every run, log, screenshot, and rerun decision stays visible for the whole team."
  },
  {
    id: "traceability",
    eyebrow: "Release Readiness",
    title: "Turn traceability into a real release signal, not another reporting chore.",
    description: "QAira connects requirements, suites, cases, shared steps, and execution evidence so teams can explain coverage, gaps, and risk with confidence.",
    theme: "teal",
    visual: "traceability",
    metrics: [
      { value: "100%", label: "lineage connected" },
      { value: "14", label: "gaps highlighted" },
      { value: "1", label: "release-ready view" }
    ],
    highlights: [
      {
        title: "Requirement-to-evidence lineage",
        detail: "Show exactly which requirements are covered, at risk, or still missing proof."
      },
      {
        title: "Audit-friendly history",
        detail: "Keep execution snapshots and reusable resource context preserved for later review."
      },
      {
        title: "Risk-first release visibility",
        detail: "Help engineering, QA, and leadership align around what is truly safe to ship."
      }
    ],
    footer: "Confidence comes from linked evidence and execution history, not disconnected status updates."
  }
];

let googleScriptPromise: Promise<void> | null = null;

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

  if (mode === "signup-code" || mode === "forgot-code") {
    return ["verificationCode"];
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

  if (fieldName === "verificationCode" && (mode === "signup-code" || mode === "forgot-code")) {
    const normalizedCode = value.replace(/\s+/g, "");

    if (!normalizedCode) {
      return "Verification code is required.";
    }

    if (!/^\d{6}$/.test(normalizedCode)) {
      return "Enter the 6-digit verification code from your email.";
    }
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

function loadGoogleIdentityScript() {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-google-identity='true']");

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google sign-in could not be loaded.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      googleScriptPromise = null;
      reject(new Error("Google sign-in could not be loaded."));
    };
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

function getCurrentCopy(
  mode: FormMode,
  pendingVerification: PendingVerification | null,
  authSetup: AuthSetupPayload
) {
  const senderEmail = authSetup.emailVerification.senderEmail || "support@qualipal.in";
  const emailReady = authSetup.emailVerification.enabled;

  if (mode === "signup") {
    return {
      eyebrow: "Create account",
      title: "Set up your QAira access",
      description: emailReady
        ? `Create an account for secure access to the workspace. We'll send a 6-digit verification code from ${senderEmail} before the account goes live.`
        : "Create an account for secure access to the workspace. An admin needs to finish the Email Sender integration before signup can be completed.",
      submitLabel: "Send verification code",
      loadingLabel: "Sending code…"
    };
  }

  if (mode === "forgot") {
    return {
      eyebrow: "Reset password",
      title: "Reset your password",
      description: emailReady
        ? `Enter your work email and a new password. We'll send a 6-digit verification code from ${senderEmail} to confirm the reset.`
        : "Enter your work email and a new password. An admin needs to finish the Email Sender integration before password reset can be completed.",
      submitLabel: "Send reset code",
      loadingLabel: "Sending code…"
    };
  }

  if (mode === "signup-code") {
    return {
      eyebrow: "Verify email",
      title: "Enter your signup code",
      description: `We sent a 6-digit verification code to ${pendingVerification?.email || "your email"}. Enter it below to finish creating the account.`,
      submitLabel: "Verify and create account",
      loadingLabel: "Verifying code…"
    };
  }

  if (mode === "forgot-code") {
    return {
      eyebrow: "Verify reset",
      title: "Enter your reset code",
      description: `Enter the 6-digit code sent to ${pendingVerification?.email || "your email"} to confirm the password reset.`,
      submitLabel: "Verify and reset password",
      loadingLabel: "Verifying code…"
    };
  }

  return {
    eyebrow: "Secure login",
    title: "Welcome back",
    description: "Sign in to continue managing test design, execution, and traceability in one place.",
    submitLabel: "Sign in to QAira",
    loadingLabel: "Signing in…"
  };
}

export function AuthPage() {
  const navigate = useNavigate();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const {
    login,
    loginWithGoogle,
    requestSignupCode,
    verifySignupCode,
    requestPasswordResetCode,
    verifyPasswordResetCode
  } = useAuth();
  const [mode, setMode] = useState<FormMode>("login");
  const [formValues, setFormValues] = useState<FormValues>(INITIAL_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [touchedFields, setTouchedFields] = useState<TouchedFields>({});
  const [error, setError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [authSetup, setAuthSetup] = useState<AuthSetupPayload>(EMPTY_AUTH_SETUP);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [isResendingCode, setIsResendingCode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [activeCapabilityIndex, setActiveCapabilityIndex] = useState(0);
  const [pendingVerification, setPendingVerification] = useState<PendingVerification | null>(null);

  const isSuccessMode = mode === "signup-success" || mode === "reset-success";
  const isCodeMode = mode === "signup-code" || mode === "forgot-code";
  const isEmailVerificationReady = authSetup.emailVerification.enabled;
  const isGoogleReady = authSetup.google.enabled && Boolean(authSetup.google.clientId);
  const currentCopy = getCurrentCopy(mode, pendingVerification, authSetup);
  const activeCapability = AUTH_CAPABILITY_SLIDES[activeCapabilityIndex];
  const isBusy = isSubmitting || isGoogleSubmitting || isResendingCode;

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      try {
        const nextSetup = await api.auth.setup();

        if (!isMounted) {
          return;
        }

        setAuthSetup(nextSetup);
      } catch (nextError) {
        if (!isMounted) {
          return;
        }

        setError(
          nextError instanceof Error
            ? nextError.message
            : "Authentication setup could not be loaded. Please refresh and try again."
        );
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

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

  useEffect(() => {
    if (mode !== "login" || !isGoogleReady || !authSetup.google.clientId || !googleButtonRef.current) {
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }

      return;
    }

    const googleClientId = authSetup.google.clientId;
    let isActive = true;

    void loadGoogleIdentityScript()
      .then(() => {
        if (!isActive || !googleButtonRef.current || !window.google?.accounts?.id) {
          return;
        }

        googleButtonRef.current.innerHTML = "";
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: ({ credential }) => {
            if (!credential) {
              setError("Google sign-in did not return a credential. Please try again.");
              return;
            }

            void (async () => {
              setIsGoogleSubmitting(true);
              setError("");

              try {
                await loginWithGoogle({ idToken: credential });
                navigate("/", { replace: true });
              } catch (nextError) {
                setError(
                  nextError instanceof Error
                    ? nextError.message
                    : "Google sign-in could not be completed."
                );
              } finally {
                setIsGoogleSubmitting(false);
              }
            })();
          }
        });
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: 360,
          logo_alignment: "left"
        });
      })
      .catch((nextError) => {
        if (!isActive) {
          return;
        }

        setError(
          nextError instanceof Error
            ? nextError.message
            : "Google sign-in could not be loaded."
        );
      });

    return () => {
      isActive = false;

      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
      }
    };
  }, [authSetup.google.clientId, isGoogleReady, loginWithGoogle, mode, navigate]);

  const resetFormState = (nextMode: FormMode) => {
    setMode(nextMode);
    setFormValues(INITIAL_FORM_VALUES);
    setFieldErrors({});
    setTouchedFields({});
    setError("");
    setInfoMessage("");
    setPendingVerification(null);
    setIsSubmitting(false);
    setIsResendingCode(false);
    setShowPassword(false);
    setShowNewPassword(false);
  };

  const moveToVerificationMode = (nextMode: "signup-code" | "forgot-code", email: string) => {
    setMode(nextMode);
    setPendingVerification({
      type: nextMode === "signup-code" ? "signup" : "forgot",
      email
    });
    setFieldErrors({});
    setTouchedFields({});
    setError("");
    setFormValues((current) => ({
      ...current,
      email,
      verificationCode: ""
    }));
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
    let { value } = event.currentTarget;

    if (fieldName === "verificationCode") {
      value = value.replace(/\D+/g, "").slice(0, 6);
    }

    setFormValues((current) => ({
      ...current,
      [fieldName]: value
    }));

    if (error) {
      setError("");
    }

    if (infoMessage) {
      setInfoMessage("");
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

    if (isBusy || isSuccessMode) {
      return;
    }

    const normalizedValues: FormValues = {
      ...formValues,
      email: formValues.email.trim().toLowerCase(),
      name: formValues.name.trim(),
      verificationCode: formValues.verificationCode.replace(/\s+/g, "")
    };
    const nextErrors = getModeErrors(mode, normalizedValues);

    setFormValues(normalizedValues);
    setFieldErrors(nextErrors);
    setTouchedFields(getTouchedState(mode));
    setError("");

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    if ((mode === "signup" || mode === "forgot") && !isEmailVerificationReady) {
      setError("Email verification is not configured yet. Ask an admin to finish the Email Sender integration.");
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
        await requestSignupCode({
          email: normalizedValues.email,
          password: normalizedValues.password,
          name: normalizedValues.name || undefined
        });
        moveToVerificationMode("signup-code", normalizedValues.email);
        setInfoMessage(`A 6-digit verification code has been sent to ${normalizedValues.email}.`);
      } else if (mode === "signup-code") {
        const verificationEmail = pendingVerification?.email || normalizedValues.email;

        await verifySignupCode({
          email: verificationEmail,
          code: normalizedValues.verificationCode
        });
        resetFormState("signup-success");
      } else if (mode === "forgot") {
        await requestPasswordResetCode({
          email: normalizedValues.email,
          newPassword: normalizedValues.newPassword
        });
        moveToVerificationMode("forgot-code", normalizedValues.email);
        setInfoMessage(`If ${normalizedValues.email} is registered, a 6-digit verification code is on its way.`);
      } else if (mode === "forgot-code") {
        const verificationEmail = pendingVerification?.email || normalizedValues.email;

        await verifyPasswordResetCode({
          email: verificationEmail,
          code: normalizedValues.verificationCode
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

  const handleResendCode = async () => {
    if (!pendingVerification || isBusy) {
      return;
    }

    setIsResendingCode(true);
    setError("");

    try {
      if (pendingVerification.type === "signup") {
        await requestSignupCode({
          email: pendingVerification.email,
          password: formValues.password,
          name: formValues.name.trim() || undefined
        });
        setInfoMessage(`A fresh signup code has been sent to ${pendingVerification.email}.`);
      } else {
        await requestPasswordResetCode({
          email: pendingVerification.email,
          newPassword: formValues.newPassword
        });
        setInfoMessage(`If ${pendingVerification.email} is registered, a fresh reset code is on its way.`);
      }

      setFormValues((current) => ({
        ...current,
        verificationCode: ""
      }));
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "We couldn't resend the verification code."
      );
    } finally {
      setIsResendingCode(false);
    }
  };

  const handleBackFromVerification = () => {
    const nextMode = pendingVerification?.type === "signup" ? "signup" : "forgot";

    setMode(nextMode);
    setPendingVerification(null);
    setFieldErrors({});
    setTouchedFields({});
    setError("");
    setInfoMessage("");
    setFormValues((current) => ({
      ...current,
      verificationCode: ""
    }));
  };

  const loginPasswordDescribedBy = mergeIds(
    fieldErrors.password ? "password-input-error" : undefined,
    "password-input-hint"
  );
  const resetPasswordDescribedBy = mergeIds(
    fieldErrors.newPassword ? "new-password-input-error" : undefined,
    "new-password-input-hint"
  );
  const verificationCodeDescribedBy = mergeIds(
    fieldErrors.verificationCode ? "verification-code-error" : undefined,
    pendingVerification ? "verification-code-hint" : undefined
  );

  return (
    <div className="page auth-page">
      <ToastMessage message={infoMessage} onDismiss={() => setInfoMessage("")} tone="info" />

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

              <div className="auth-carousel-stage" aria-live="polite">
                <div
                  className="auth-carousel-track"
                  style={{ transform: `translateX(-${activeCapabilityIndex * 100}%)` }}
                >
                  {AUTH_CAPABILITY_SLIDES.map((slide, index) => (
                    <article
                      aria-hidden={index === activeCapabilityIndex ? undefined : true}
                      className="auth-carousel-slide"
                      key={slide.id}
                    >
                      <div className="auth-carousel-copy-block">
                        <p className="eyebrow">{slide.eyebrow}</p>
                        <h1>{slide.title}</h1>
                        <p className="auth-aside-copy">{slide.description}</p>

                        <div className="auth-carousel-stat-grid" aria-label={`${slide.eyebrow} highlights`}>
                          {slide.metrics.map((metric) => (
                            <div className="auth-carousel-stat-card" key={metric.label}>
                              <strong>{metric.value}</strong>
                              <span>{metric.label}</span>
                            </div>
                          ))}
                        </div>

                        <div className="auth-carousel-feature-list" aria-label={`${slide.eyebrow} product capabilities`}>
                          {slide.highlights.map((highlight) => (
                            <div className="auth-carousel-feature-card" key={highlight.title}>
                              <strong>{highlight.title}</strong>
                              <span>{highlight.detail}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="auth-carousel-visual-wrap">
                        <AuthCapabilityGraphic visual={slide.visual} />
                      </div>
                    </article>
                  ))}
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
                <div className="auth-carousel-counter" aria-label="Current slide">
                  <strong>{String(activeCapabilityIndex + 1).padStart(2, "0")}</strong>
                  <span>/ {String(AUTH_CAPABILITY_SLIDES.length).padStart(2, "0")}</span>
                </div>
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
                      disabled={isBusy}
                    >
                      Login
                    </button>
                    <button
                      className={mode === "signup" ? "tab-button is-active" : "tab-button"}
                      onClick={() => resetFormState("signup")}
                      type="button"
                      role="tab"
                      aria-selected={mode === "signup"}
                      disabled={isBusy}
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
                    ? "Your email has been verified and your account is ready. Sign in with your new credentials to enter the workspace."
                    : "Your verification code checked out and the new password is now active. Sign in with the updated password to continue."}
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
                      disabled={isBusy}
                      id="name-input"
                      name="name"
                      onBlur={handleFieldBlur("name")}
                      onChange={handleFieldChange("name")}
                      type="text"
                      value={formValues.name}
                    />
                  </FormField>
                )}

                {!isCodeMode ? (
                  <FormField
                    error={fieldErrors.email}
                    inputId="email-input"
                    label="Email"
                    required
                  >
                    <input
                      autoComplete="email"
                      autoFocus
                      disabled={isBusy}
                      inputMode="email"
                      name="email"
                      onBlur={handleFieldBlur("email")}
                      onChange={handleFieldChange("email")}
                      ref={emailInputRef}
                      type="email"
                      value={formValues.email}
                    />
                  </FormField>
                ) : (
                  <div className="auth-verification-panel">
                    <span className="auth-verification-label">Verification target</span>
                    <strong className="auth-verification-target">{pendingVerification?.email || formValues.email}</strong>
                    <p className="auth-verification-caption">
                      Check that inbox for the latest 6-digit code before continuing.
                    </p>
                  </div>
                )}

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
                        disabled={isBusy}
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
                        disabled={isBusy}
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
                        disabled={isBusy}
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
                        disabled={isBusy}
                        onClick={() => setShowNewPassword((current) => !current)}
                        tabIndex={-1}
                        type="button"
                      >
                        {showNewPassword ? "Hide" : "Show"}
                      </button>
                    </div>
                  </FormField>
                )}

                {isCodeMode && (
                  <FormField
                    error={fieldErrors.verificationCode}
                    hint="Enter the 6-digit code from your email."
                    inputId="verification-code-input"
                    label="Verification code"
                    required
                  >
                    <input
                      aria-describedby={verificationCodeDescribedBy}
                      aria-invalid={Boolean(fieldErrors.verificationCode)}
                      autoComplete="one-time-code"
                      disabled={isBusy}
                      id="verification-code-input"
                      inputMode="numeric"
                      name="verificationCode"
                      onBlur={handleFieldBlur("verificationCode")}
                      onChange={handleFieldChange("verificationCode")}
                      pattern="[0-9]*"
                      type="text"
                      value={formValues.verificationCode}
                    />
                  </FormField>
                )}

                {(mode === "signup" || mode === "forgot") && !isEmailVerificationReady ? (
                  <div className="auth-note-box" role="status">
                    Email verification is not configured yet. Ask an admin to finish the Email Sender integration in Integrations.
                  </div>
                ) : null}

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

                {mode === "login" && isGoogleReady ? (
                  <>
                    <div className="auth-google-section">
                      <div className="auth-google-button-shell">
                        <div aria-label="Continue with Google" ref={googleButtonRef} />
                      </div>
                    </div>

                    <div className="auth-provider-divider" aria-hidden="true">
                      <span>or continue with email</span>
                    </div>
                  </>
                ) : null}

                <button
                  className="primary-button auth-submit"
                  disabled={
                    isBusy ||
                    ((mode === "signup" || mode === "forgot") && !isEmailVerificationReady)
                  }
                  type="submit"
                >
                  {isSubmitting ? <span className="button-spinner" aria-hidden="true" /> : null}
                  <span>{isSubmitting ? currentCopy.loadingLabel : currentCopy.submitLabel}</span>
                </button>

                {mode === "login" || mode === "forgot" || isCodeMode ? (
                  <div className="auth-secondary-actions">
                    {mode === "login" ? (
                      <button
                        className="link-button"
                        disabled={isBusy}
                        onClick={() => resetFormState("forgot")}
                        type="button"
                      >
                        Forgot password?
                      </button>
                    ) : null}

                    {mode === "forgot" ? (
                      <button
                        className="link-button"
                        disabled={isBusy}
                        onClick={() => resetFormState("login")}
                        type="button"
                      >
                        Back to login
                      </button>
                    ) : null}

                    {isCodeMode ? (
                      <>
                        <button
                          className="link-button"
                          disabled={isBusy || !isEmailVerificationReady}
                          onClick={() => void handleResendCode()}
                          type="button"
                        >
                          {isResendingCode ? "Resending…" : "Resend code"}
                        </button>
                        <button
                          className="link-button"
                          disabled={isBusy}
                          onClick={handleBackFromVerification}
                          type="button"
                        >
                          Change details
                        </button>
                      </>
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
            <span>Ready for release</span>
            <strong>Yes</strong>
          </div>
        </div>
      </div>
    </div>
  );
}
