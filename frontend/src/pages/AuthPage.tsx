import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FormField } from "../components/FormField";

export function AuthPage() {
  const navigate = useNavigate();
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "");
    const password = String(formData.get("password") || "");
    const name = String(formData.get("name") || "");

    try {
      if (mode === "login") {
        await login({ email, password });
        setSuccess("Login successful. Entering workspace...");
      } else {
        await signup({ email, password, name });
        setSuccess("Signup successful. Your account was created and your session is active.");
      }

      window.setTimeout(() => {
        navigate("/", { replace: true });
      }, 800);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Authentication failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-layout">
      <section className="auth-hero">
        <div className="brand-mark large">QA</div>
        <p className="eyebrow">Quality Operations Hub</p>
        <h1>Design, execute, and trace QA work without losing the plot.</h1>
        <p>
          QAIra brings project setup, test design, execution runs, and result tracking into one
          fast workspace built around your current API model.
        </p>
      </section>

      <section className="auth-panel">
        <div className="tab-row">
          <button
            className={mode === "login" ? "tab-button is-active" : "tab-button"}
            onClick={() => setMode("login")}
            type="button"
          >
            Login
          </button>
          <button
            className={mode === "signup" ? "tab-button is-active" : "tab-button"}
            onClick={() => setMode("signup")}
            type="button"
          >
            Sign up
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "signup" ? (
            <FormField label="Full name">
              <input name="name" placeholder="QA Lead" />
            </FormField>
          ) : null}

          <FormField label="Email">
            <input name="email" type="email" placeholder="you@company.com" required />
          </FormField>

          <FormField label="Password">
            <input name="password" type="password" placeholder="At least 6 characters" required />
          </FormField>

          {success ? <p className="form-success">{success}</p> : null}
          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Working…" : mode === "login" ? "Enter workspace" : "Create account"}
          </button>
        </form>
      </section>
    </div>
  );
}
