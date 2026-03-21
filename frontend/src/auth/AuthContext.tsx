import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, sessionStorage } from "../lib/api";
import type { SessionPayload } from "../types";

type AuthContextValue = {
  session: SessionPayload | null;
  isLoading: boolean;
  login: (input: { email: string; password: string }) => Promise<void>;
  signup: (input: { email: string; password: string; name?: string }) => Promise<void>;
  logout: () => void;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionPayload | null>(() => sessionStorage.read());
  const [isLoading, setIsLoading] = useState(true);

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
    } catch {
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
    async login(input) {
      const next = await api.auth.login(input);
      sessionStorage.write(next);
      setSession(next);
    },
    async signup(input) {
      const next = await api.auth.signup(input);
      sessionStorage.write(next);
      setSession(next);
    },
    logout() {
      sessionStorage.clear();
      setSession(null);
    },
    refreshSession
  }), [session, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return context;
}
