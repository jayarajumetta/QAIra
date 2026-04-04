import type {
  ApiError,
  AppType,
  Execution,
  ExecutionResult,
  Feedback,
  Integration,
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
      headers,
      signal: AbortSignal.timeout(30000) // 30 second timeout
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timeout: ${path} took too long to respond`);
    }
    throw new Error(`Unable to reach API at ${API_BASE_URL}. Check your connection and try again.`);
  }

  // Handle authentication errors
  if (response.status === 401) {
    sessionStorage.clear();
    window.location.href = "/auth";
  }

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = (payload || {}) as ApiError;
    const message = error.message || `Request failed with status ${response.status}`;
    throw new Error(message);
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
    forgotPassword: (input: { email: string }) =>
      request<{ success: boolean; resetToken?: string }>("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    resetPassword: (input: { email: string; newPassword: string }) =>
      request<SessionPayload>("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    session: () => request<SessionPayload>("/auth/session")
  },
  users: {
    list: () => request<User[]>("/users"),
    create: (input: { email: string; password_hash: string; name?: string; role_id: string }) =>
      request<{ id: string }>("/users", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ email: string; password_hash: string; name: string; role_id: string }>) =>
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
    create: (input: { name: string; description?: string; created_by?: string; member_ids?: string[]; app_types?: Array<{ name: string; type: AppType["type"]; is_unified?: boolean }> }) =>
      request<{ id: string; members_added: number; app_types_created: number }>("/projects", { method: "POST", body: JSON.stringify(input) }),
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
    previewDesignedTestCases: (id: string, input: { app_type_id: string; integration_id?: string; max_cases?: number }) =>
      request<{ generated: number; cases: Array<{ client_id: string; title: string; description: string | null; priority: number; steps: Array<{ step_order: number; action: string | null; expected_result: string | null }>; step_count: number }>; integration: { id: string; name: string; type: string; model?: string | null } }>(`/requirements/${id}/design-test-cases-preview`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    acceptDesignedTestCases: (id: string, input: { app_type_id: string; status?: string; cases: Array<{ title: string; description?: string | null; priority?: number; steps?: Array<{ step_order?: number; action?: string | null; expected_result?: string | null }> }> }) =>
      request<{ accepted: number; created: Array<{ id: string; title: string; step_count: number }> }>(`/requirements/${id}/design-test-cases-accept`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    generateTestCases: (id: string, input: { app_type_id: string; integration_id?: string; max_cases?: number; status?: string }) =>
      request<{ generated: number; created: Array<{ id: string; title: string; step_count: number }>; integration: { id: string; name: string; type: string; model?: string | null } }>(`/requirements/${id}/generate-test-cases`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<{ project_id: string; title: string; description: string; priority: number; status: string }>) =>
      request<{ updated: boolean }>(`/requirements/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/requirements/${id}`, { method: "DELETE" })
  },
  feedback: {
    list: (query?: { user_id?: string; status?: string }) =>
      request<Feedback[]>(`/feedback${toQueryString(query)}`),
    create: (input: { user_id: string; title: string; message: string; status?: string }) =>
      request<{ id: string }>("/feedback", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ user_id: string; title: string; message: string; status: string }>) =>
      request<{ updated: boolean }>(`/feedback/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/feedback/${id}`, { method: "DELETE" })
  },
  integrations: {
    list: (query?: { type?: Integration["type"]; is_active?: boolean }) =>
      request<Integration[]>(`/integrations${toQueryString(query)}`),
    create: (input: { type: Integration["type"]; name: string; base_url?: string; api_key?: string; model?: string; project_key?: string; username?: string; is_active?: boolean }) =>
      request<{ id: string }>("/integrations", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ type: Integration["type"]; name: string; base_url: string; api_key: string; model: string; project_key: string; username: string; is_active: boolean }>) =>
      request<{ updated: boolean }>(`/integrations/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/integrations/${id}`, { method: "DELETE" })
  },
  requirementTestCases: {
    list: (query?: { requirement_id?: string; test_case_id?: string }) =>
      request<Array<{ requirement_id: string; test_case_id: string }>>(`/requirement-test-cases${toQueryString(query)}`),
    replace: (requirement_id: string, test_case_ids: string[]) =>
      request<{ updated: boolean; mapped: number }>(`/requirement-test-cases/replace`, {
        method: "PUT",
        body: JSON.stringify({ requirement_id, test_case_ids })
      })
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
    list: (query?: { suite_id?: string; requirement_id?: string; status?: string; app_type_id?: string }) =>
      request<TestCase[]>(`/test-cases${toQueryString(query)}`),
    create: (input: { app_type_id?: string; suite_id?: string; suite_ids?: string[]; title: string; description?: string; priority?: number; status?: string; requirement_id?: string; requirement_ids?: string[]; steps?: Array<{ step_order?: number; action?: string; expected_result?: string }> }) =>
      request<{ id: string }>("/test-cases", { method: "POST", body: JSON.stringify(input) }),
    bulkImport: (input: { app_type_id: string; requirement_id?: string; rows: Array<Record<string, string | number | null | undefined>> }) =>
      request<{ imported: number; failed: number; created: Array<{ row: number; id: string; title: string }>; errors: Array<{ row: number; title?: string | null; message: string }> }>("/test-cases/import", {
        method: "POST",
        body: JSON.stringify(input)
      }),
    update: (id: string, input: Partial<{ app_type_id: string; suite_id: string; suite_ids: string[]; title: string; description: string; priority: number; status: string; requirement_id: string; requirement_ids: string[]; steps: Array<{ step_order?: number; action?: string; expected_result?: string }> }>) =>
      request<{ updated: boolean }>(`/test-cases/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-cases/${id}`, { method: "DELETE" })
  },
  suiteTestCases: {
    list: (query?: { suite_id?: string; test_case_id?: string }) =>
      request<Array<{ suite_id: string; test_case_id: string; sort_order: number }>>(`/suite-test-cases${toQueryString(query)}`),
    reorder: (suite_id: string, test_case_ids: string[]) =>
      request<{ reordered: boolean }>(`/suite-test-cases/reorder`, {
        method: "PUT",
        body: JSON.stringify({ suite_id, test_case_ids })
      })
  },
  testSteps: {
    list: (query?: { test_case_id?: string }) =>
      request<TestStep[]>(`/test-steps${toQueryString(query)}`),
    create: (input: { test_case_id: string; step_order: number; action?: string; expected_result?: string }) =>
      request<{ id: string }>("/test-steps", { method: "POST", body: JSON.stringify(input) }),
    update: (id: string, input: Partial<{ test_case_id: string; step_order: number; action: string; expected_result: string }>) =>
      request<{ updated: boolean }>(`/test-steps/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    reorder: (test_case_id: string, step_ids: string[]) =>
      request<{ reordered: boolean }>(`/test-steps/reorder`, {
        method: "PUT",
        body: JSON.stringify({ test_case_id, step_ids })
      }),
    delete: (id: string) => request<{ deleted: boolean }>(`/test-steps/${id}`, { method: "DELETE" })
  },
  executions: {
    list: (query?: { project_id?: string; status?: string }) =>
      request<Execution[]>(`/executions${toQueryString(query)}`),
    get: (id: string) =>
      request<Execution>(`/executions/${id}`),
    create: (input: { project_id: string; app_type_id?: string; suite_ids?: string[]; name?: string; created_by: string }) =>
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

function toQueryString(query?: Record<string, string | number | boolean | undefined>) {
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
