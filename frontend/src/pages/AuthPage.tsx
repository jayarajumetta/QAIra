import { FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";

export function AuthPage() {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const { login, signup, forgotPassword, resetPassword } = useAuth();
  const [mode, setMode] = useState<"login" | "signup" | "forgot" | "signup-success" | "reset-success">("login");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePassword = (password: string): string | null => {
    if (password.length < 6) {
      return "Password must be at least 6 characters long";
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldErrors({});
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim().toLowerCase();
    const password = String(formData.get("password") || "");
    const name = String(formData.get("name") || "").trim();
    const newPassword = String(formData.get("newPassword") || "");

    const errors: Record<string, string> = {};

    // Validate email
    if (!email) {
      errors.email = "Email is required";
    } else if (!validateEmail(email)) {
      errors.email = "Please enter a valid email address";
    }

    // Validate password
    if (mode === "login" || mode === "signup") {
      if (!password) {
        errors.password = "Password is required";
      } else {
        const passwordError = validatePassword(password);
        if (passwordError) {
          errors.password = passwordError;
        }
      }
    }

    // Validate new password for reset
    if (mode === "forgot") {
      if (!newPassword) {
        errors.newPassword = "New password is required";
      } else {
        const passwordError = validatePassword(newPassword);
        if (passwordError) {
          errors.newPassword = passwordError;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setIsSubmitting(false);
      return;
    }

    try {
      if (mode === "login") {
        await login({ email, password });
        // Success - navigate will happen automatically when session is set
        setTimeout(() => {
          navigate("/", { replace: true });
        }, 300);
      } else if (mode === "signup") {
        await signup({ email, password, name: name || undefined });
        // Show success screen instead of auto-logging in
        setMode("signup-success");
      } else if (mode === "forgot") {
        // First, request password reset
        await forgotPassword({ email });
        // Then, reset the password
        await resetPassword({
          email,
          newPassword
        });
        // Show success screen instead of auto-logging in
        setMode("reset-success");
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Operation failed. Please try again.");
      setIsSubmitting(false);
      // Don't clear error automatically - keep it persistent until user dismisses it
    }
  };

  const handleForgotClick = () => {
    setMode("forgot");
    setError("");
    setFieldErrors({});
    if (formRef.current) {
      formRef.current.reset();
    }
  };

  const handleBackClick = () => {
    setMode("login");
    setError("");
    setFieldErrors({});
    setIsSubmitting(false);
    if (formRef.current) {
      formRef.current.reset();
    }
  };

  const handleLoginClick = () => {
    setMode("login");
    setError("");
    setFieldErrors({});
    setIsSubmitting(false);
    if (formRef.current) {
      formRef.current.reset();
    }
  };

  const dismissError = () => {
    setError("");
  };

  return (
    <div className="auth-layout">
      <section className="auth-hero">
        <div className="brand-mark large">QAIra</div>
        <p className="eyebrow">Quality Operations Hub</p>
        <h1>Design, execute, and trace QA work without losing the plot.</h1>
        <p>
          QAIra brings project setup, test design, execution runs, and result tracking into one
          fast workspace built around your current API model.
        </p>
      </section>

      <section className="auth-panel">
        {mode === "forgot" || mode === "signup-success" || mode === "reset-success" ? null : (
          <div className="tab-row">
            <button
              className={mode === "login" ? "tab-button is-active" : "tab-button"}
              onClick={() => handleLoginClick()}
              type="button"
              aria-label="Login tab"
            >
              Login
            </button>
            <button
              className={mode === "signup" ? "tab-button is-active" : "tab-button"}
              onClick={() => setMode("signup")}
              type="button"
              aria-label="Sign up tab"
            >
              Sign up
            </button>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate ref={formRef}>
          {mode === "login" && (
            <>
              <FormField label="Email" error={fieldErrors.email}>
                <input 
                  name="email" 
                  type="email" 
                  placeholder="you@company.com" 
                  required
                  disabled={isSubmitting}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                />
              </FormField>

              <FormField label="Password" error={fieldErrors.password}>
                <input 
                  name="password" 
                  type="password" 
                  placeholder="At least 6 characters" 
                  required
                  disabled={isSubmitting}
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                />
              </FormField>

              {error && (
                <div className="form-error-box" role="alert">
                  <p>{error}</p>
                  <button 
                    className="form-error-dismiss"
                    onClick={dismissError}
                    type="button"
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
              )}

              <button 
                className="primary-button" 
                disabled={isSubmitting} 
                type="submit"
                aria-busy={isSubmitting}
              >
                {isSubmitting ? "Working…" : "Enter workspace"}
              </button>

              <button
                className="link-button"
                onClick={handleForgotClick}
                type="button"
                style={{ marginTop: "1rem", textAlign: "center" }}
                disabled={isSubmitting}
              >
                Forgot password?
              </button>
            </>
          )}

          {mode === "signup" && (
            <>
              <FormField label="Full name" error={fieldErrors.name}>
                <input 
                  name="name" 
                  placeholder="QA Lead"
                  disabled={isSubmitting}
                />
              </FormField>

              <FormField label="Email" error={fieldErrors.email}>
                <input 
                  name="email" 
                  type="email" 
                  placeholder="you@company.com" 
                  required
                  disabled={isSubmitting}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                />
              </FormField>

              <FormField label="Password" error={fieldErrors.password}>
                <input 
                  name="password" 
                  type="password" 
                  placeholder="At least 6 characters" 
                  required
                  disabled={isSubmitting}
                  aria-invalid={!!fieldErrors.password}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                />
              </FormField>

              {error && (
                <div className="form-error-box" role="alert">
                  <p>{error}</p>
                  <button 
                    className="form-error-dismiss"
                    onClick={dismissError}
                    type="button"
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
              )}

              <button 
                className="primary-button" 
                disabled={isSubmitting} 
                type="submit"
                aria-busy={isSubmitting}
              >
                {isSubmitting ? "Working…" : "Create account"}
              </button>
            </>
          )}

          {mode === "forgot" && (
            <>
              <div className="forgot-password-header">
                <h3>Reset your password</h3>
                <p>Enter your email and new password to reset your account.</p>
              </div>

              <FormField label="Email" error={fieldErrors.email}>
                <input 
                  name="email" 
                  type="email" 
                  placeholder="you@company.com" 
                  required
                  disabled={isSubmitting}
                  aria-invalid={!!fieldErrors.email}
                  aria-describedby={fieldErrors.email ? "email-error" : undefined}
                />
              </FormField>

              <FormField label="New Password" error={fieldErrors.newPassword}>
                <input
                  name="newPassword"
                  type="password"
                  placeholder="At least 6 characters"
                  required
                  disabled={isSubmitting}
                  aria-invalid={!!fieldErrors.newPassword}
                  aria-describedby={fieldErrors.newPassword ? "newPassword-error" : undefined}
                />
              </FormField>

              {error && (
                <div className="form-error-box" role="alert">
                  <p>{error}</p>
                  <button 
                    className="form-error-dismiss"
                    onClick={dismissError}
                    type="button"
                    aria-label="Dismiss error"
                  >
                    ✕
                  </button>
                </div>
              )}

              <button 
                className="primary-button" 
                disabled={isSubmitting} 
                type="submit"
                aria-busy={isSubmitting}
              >
                {isSubmitting ? "Resetting…" : "Reset password"}
              </button>

              <button
                className="link-button"
                onClick={handleBackClick}
                type="button"
                style={{ marginTop: "1rem", textAlign: "center" }}
                disabled={isSubmitting}
              >
                Back to login
              </button>
            </>
          )}

          {mode === "signup-success" && (
            <div className="success-screen">
              <div className="success-icon">✓</div>
              <h2>Account Created</h2>
              <p className="success-message">
                Your account has been created successfully! Please log in with your credentials.
              </p>
              <button
                className="primary-button"
                onClick={handleLoginClick}
                type="button"
              >
                Back to Login
              </button>
            </div>
          )}

          {mode === "reset-success" && (
            <div className="success-screen">
              <div className="success-icon">✓</div>
              <h2>Password Reset</h2>
              <p className="success-message">
                Your password has been reset successfully! Please log in with your new password.
              </p>
              <button
                className="primary-button"
                onClick={handleLoginClick}
                type="button"
              >
                Back to Login
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
