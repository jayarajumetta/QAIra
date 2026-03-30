export type User = {
  id: string;
  email: string;
  name: string | null;
  role?: "admin" | "member";
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
  test_case_ids?: string[];
  created_at?: string;
};

export type Feedback = {
  id: string;
  user_id: string;
  user_name?: string | null;
  user_email?: string | null;
  title: string;
  message: string;
  status: string | null;
  created_at?: string;
};

export type Integration = {
  id: string;
  type: "llm" | "jira";
  name: string;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  project_key: string | null;
  username: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
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
  app_type_id?: string | null;
  suite_id: string | null;
  suite_ids?: string[];
  requirement_ids?: string[];
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
  app_type_id: string | null;
  suite_ids: string[];
  suite_snapshots?: Array<{ id: string; name: string }>;
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
  test_case_title?: string | null;
  suite_id?: string | null;
  suite_name?: string | null;
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
