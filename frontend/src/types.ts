export type User = {
  id: string;
  email: string;
  name: string | null;
  created_at?: string;
};

export type Role = {
  id: string;
  name: string;
};

export type Project = {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at?: string;
};

export type ProjectMember = {
  id: string;
  project_id: string;
  user_id: string;
  role_id: string;
  created_at?: string;
};

export type AppType = {
  id: string;
  project_id: string;
  name: string;
  type: "web" | "api" | "android" | "ios" | "unified";
  is_unified: number;
  created_at?: string;
};

export type Requirement = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  created_at?: string;
};

export type TestSuite = {
  id: string;
  app_type_id: string;
  name: string;
  parent_id: string | null;
  created_at?: string;
};

export type TestCase = {
  id: string;
  suite_id: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  requirement_id: string | null;
  created_at?: string;
};

export type TestStep = {
  id: string;
  test_case_id: string;
  step_order: number;
  action: string | null;
  expected_result: string | null;
};

export type Execution = {
  id: string;
  project_id: string;
  name: string | null;
  trigger: "manual" | "ci" | null;
  status: "queued" | "running" | "completed" | "failed" | null;
  created_by: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export type ExecutionResult = {
  id: string;
  execution_id: string;
  test_case_id: string;
  app_type_id: string;
  status: "passed" | "failed" | "blocked";
  duration_ms: number | null;
  error: string | null;
  logs: string | null;
  executed_by: string | null;
  created_at?: string;
};

export type SessionPayload = {
  token: string;
  user: User;
};

export type ApiError = {
  statusCode?: number;
  error?: string;
  message?: string;
};
