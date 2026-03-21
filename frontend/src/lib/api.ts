import type {
  ApiError,
  AppType,
  Execution,
  ExecutionResult,
  Project,
  ProjectMember,
  Requirement,
  Role,
  SessionPayload,
  TestCase,
  TestStep,
  TestSuite,
  User
} from "../types";

declare global {
  interface Window {
    __QAIRA_CONFIG__?: {
      API_BASE_URL?: string;
    };
  }
}

const API_BASE_URL =
  window.__QAIRA_CONFIG__?.API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000";
const SESSION_KEY = "qaira.session";

const getStoredToken = () => {
  const raw = window.localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw) as SessionPayload;
    return session.token;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
};

export const sessionStorage = {
  read(): SessionPayload | null {
    const raw = window.localStorage.getItem(SESSION_KEY);

    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as SessionPayload;
    } catch {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
  },
  write(session: SessionPayload) {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  },
  clear() {
    window.localStorage.removeItem(SESSION_KEY);
  }
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const token = getStoredToken();

  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers
    });
  } catch {
    throw new Error(`Unable to reach API at ${API_BASE_URL}`);
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = (payload || {}) as ApiError;
    throw new Error(error.message || "Request failed");
  }

  return payload as T;
}

export const api = {
  auth: {
    signup: (input: { email: string; password: string; name?: string }) =>
      request<SessionPayload>("/auth/signup", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    login: (input: { email: string; password: string }) =>
      request<SessionPayload>("/auth/login", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    session: () => request<SessionPayload>("/auth/session")
  },
  users: {
    list: () => request<User[]>("/users"),
    create: (input: { email: string; password_hash: string; name?: string }) =>
      request<{ id: string }>("/users", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ email: string; password_hash: string; name: string }>) =>
      request<{ updated: boolean }>(`/users/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/users/${id}`, { method: "DELETE" })
  },
  roles: {
    list: () => request<Role[]>("/roles"),
    create: (input: { name: string }) =>
      request<{ id: string }>("/roles", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string }>) =>
      request<{ updated: boolean }>(`/roles/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/roles/${id}`, { method: "DELETE" })
  },
  projects: {
    list: () => request<Project[]>("/projects"),
    create: (input: { name: string; description?: string; created_by: string }) =>
      request<{ id: string }>("/projects", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; description: string }>) =>
      request<{ updated: boolean }>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/projects/${id}`, { method: "DELETE" })
  },
  projectMembers: {
    list: (query?: { project_id?: string; user_id?: string; role_id?: string }) =>
      request<ProjectMember[]>(`/project-members${toQueryString(query)}`),
    create: (input: { project_id: string; user_id: string; role_id: string }) =>
      request<{ id: string }>("/project-members", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; user_id: string; role_id: string }>) =>
      request<{ updated: boolean }>(`/project-members/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/project-members/${id}`, { method: "DELETE" })
  },
  appTypes: {
    list: (query?: { project_id?: string }) => request<AppType[]>(`/app-types${toQueryString(query)}`),
    create: (input: { project_id: string; name: string; type: AppType["type"]; is_unified?: boolean }) =>
      request<{ id: string }>("/app-types", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; is_unified: boolean }>) =>
      request<{ updated: boolean }>(`/app-types/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/app-types/${id}`, { method: "DELETE" })
  },
  requirements: {
    list: (query?: { project_id?: string; status?: string; priority?: number }) =>
      request<Requirement[]>(`/requirements${toQueryString(query)}`),
    create: (input: { project_id: string; title: string; description?: string; priority?: number; status?: string }) =>
      request<{ id: string }>("/requirements", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ project_id: string; title: string; description: string; priority: number; status: string }>) =>
      request<{ updated: boolean }>(`/requirements/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/requirements/${id}`, { method: "DELETE" })
  },
  testSuites: {
    list: (query?: { app_type_id?: string; parent_id?: string }) =>
      request<TestSuite[]>(`/test-suites${toQueryString(query)}`),
    create: (input: { app_type_id: string; name: string; parent_id?: string }) =>
      request<{ id: string }>("/test-suites", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ name: string; parent_id: string }>) =>
      request<{ updated: boolean }>(`/test-suites/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    assignTestCases: (id: string, test_case_ids: string[]) =>
      request<{ updated: boolean; assigned: number }>(`/test-suites/${id}/assign-test-cases`, {
        method: "POST",
        body: JSON.stringify({ test_case_ids })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-suites/${id}`, { method: "DELETE" })
  },
  testCases: {
    list: (query?: { suite_id?: string; requirement_id?: string; status?: string }) =>
      request<TestCase[]>(`/test-cases${toQueryString(query)}`),
    create: (input: { suite_id: string; title: string; description?: string; priority?: number; status?: string; requirement_id?: string }) =>
      request<{ id: string }>("/test-cases", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ suite_id: string; title: string; description: string; priority: number; status: string; requirement_id: string }>) =>
      request<{ updated: boolean }>(`/test-cases/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-cases/${id}`, { method: "DELETE" })
  },
  testSteps: {
    list: (query?: { test_case_id?: string }) =>
      request<TestStep[]>(`/test-steps${toQueryString(query)}`),
    create: (input: { test_case_id: string; step_order: number; action?: string; expected_result?: string }) =>
      request<{ id: string }>("/test-steps", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ test_case_id: string; step_order: number; action: string; expected_result: string }>) =>
      request<{ updated: boolean }>(`/test-steps/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    reorder: (test_case_id: string, step_ids: string[]) =>
      request<{ reordered: boolean }>(`/test-cases/${test_case_id}/test-steps/reorder`, {
        method: "POST",
        body: JSON.stringify({ step_ids })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-steps/${id}`, { method: "DELETE" })
  },
  executions: {
    list: (query?: { project_id?: string; status?: string }) =>
      request<Execution[]>(`/executions${toQueryString(query)}`),
    create: (input: { project_id: string; name?: string; created_by: string }) =>
      request<{ id: string }>("/executions", { method: "POST", body: JSON.stringify(input) }),
    start: (id: string) => request<{ started: boolean }>(`/executions/${id}/start`, { method: "POST" }),
    complete: (id: string, input: { status: "completed" | "failed" }) =>
      request<{ completed: boolean }>(`/executions/${id}/complete`, { method: "POST", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/executions/${id}`, { method: "DELETE" })
  },
  executionResults: {
    list: (query?: { execution_id?: string; test_case_id?: string; app_type_id?: string }) =>
      request<ExecutionResult[]>(`/execution-results${toQueryString(query)}`),
    create: (input: { execution_id: string; test_case_id: string; app_type_id: string; status: ExecutionResult["status"]; duration_ms?: number; error?: string; logs?: string; executed_by?: string }) =>
      request<{ id: string }>("/execution-results", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ status: ExecutionResult["status"]; duration_ms: number; error: string; logs: string }>) =>
      request<{ updated: boolean }>(`/execution-results/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/execution-results/${id}`, { method: "DELETE" })
  }
};

function toQueryString(query?: Record<string, string | number | undefined>) {
  if (!query) {
    return "";
  }

  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  });

  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}
