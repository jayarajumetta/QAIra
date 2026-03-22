import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, sessionStorage } from "../lib/api";
import type { SessionPayload } from "../types";

type AuthContextValue = {
  session: SessionPayload | null;
  isLoading: boolean;
  error: string | null;
  login: (input: { email: string; password: string }) => Promise<void>;
  signup: (input: { email: string; password: string; name?: string }) => Promise<void>;
  forgotPassword: (input: { email: string }) => Promise<{ success: boolean }>;
  resetPassword: (input: { email: string; newPassword: string }) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
  clearError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(() => sessionStorage.read());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = async () => {
    const stored = sessionStorage.read();

    if (!stored) {
      setSession(null);
      setIsLoading(false);
      return;
    }

    try {
      const next = await api.auth.session();
      sessionStorage.write(next);
      setSession(next);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Session verification failed";
      setError(errorMessage);
      sessionStorage.clear();
      setSession(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refreshSession();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    isLoading,
    error,
    async login(input) {
      try {
        setError(null);
        const next = await api.auth.login(input);
        sessionStorage.write(next);
        setSession(next);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Login failed";
        setError(errorMessage);
        throw err;
      }
    },
    async signup(input) {
      try {
        setError(null);
        const next = await api.auth.signup(input);
        sessionStorage.write(next);
        setSession(next);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Signup failed";
        setError(errorMessage);
        throw err;
      }
    },
    async forgotPassword(input) {
      try {
        setError(null);
        return await api.auth.forgotPassword(input);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Password reset request failed";
        setError(errorMessage);
        throw err;
      }
    },
    async resetPassword(input) {
      try {
        setError(null);
        const next = await api.auth.resetPassword(input);
        sessionStorage.write(next);
        setSession(next);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Password reset failed";
        setError(errorMessage);
        throw err;
      }
    },
    logout() {
      sessionStorage.clear();
      setSession(null);
      setError(null);
    },
    refreshSession,
    clearError() {
      setError(null);
    }
  }), [session, isLoading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
