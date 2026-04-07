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

export type AiDesignImageInput = {
  name?: string | null;
  url: string;
};

export type AiDesignedTestCaseCandidate = {
  client_id: string;
  title: string;
  description: string | null;
  priority: number;
  requirement_ids: string[];
  requirement_titles: string[];
  steps: Array<{
    step_order: number;
    action: string | null;
    expected_result: string | null;
  }>;
  step_count: number;
};

export type AiDesignPreviewResponse = {
  generated: number;
  cases: AiDesignedTestCaseCandidate[];
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  requirements: Array<{
    id: string;
    title: string;
  }>;
  app_type: {
    id: string;
    name: string;
  };
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

export type KeyValueEntry = {
  id?: string;
  key: string;
  value: string;
  is_secret?: boolean;
  has_stored_value?: boolean;
};

export type TestEnvironment = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  base_url: string | null;
  browser: string | null;
  notes: string | null;
  variables: KeyValueEntry[];
  created_at?: string;
};

export type TestConfiguration = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  browser: string | null;
  mobile_os: string | null;
  platform_version: string | null;
  variables: KeyValueEntry[];
  created_at?: string;
};

export type TestDataSetMode = "key_value" | "table";

export type TestDataSetRow = Record<string, string>;

export type TestDataSet = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  description: string | null;
  mode: TestDataSetMode;
  columns: string[];
  rows: TestDataSetRow[];
  created_at?: string;
};

export type ExecutionEnvironmentSnapshot = {
  id: string;
  name: string;
  description: string | null;
  base_url: string | null;
  browser: string | null;
  notes: string | null;
  variables: KeyValueEntry[];
};

export type ExecutionConfigurationSnapshot = {
  id: string;
  name: string;
  description: string | null;
  browser: string | null;
  mobile_os: string | null;
  platform_version: string | null;
  variables: KeyValueEntry[];
};

export type ExecutionDataSetSnapshot = {
  id: string;
  name: string;
  description: string | null;
  mode: TestDataSetMode;
  columns: string[];
  rows: TestDataSetRow[];
};

export type ExecutionStatus = "queued" | "running" | "completed" | "failed" | "aborted";

export type Execution = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  suite_ids: string[];
  suite_snapshots?: Array<{ id: string; name: string }>;
  case_snapshots?: ExecutionCaseSnapshot[];
  step_snapshots?: ExecutionStepSnapshot[];
  name: string | null;
  trigger: "manual" | "ci" | null;
  status: ExecutionStatus | null;
  test_environment?: {
    id: string | null;
    name: string;
    snapshot: ExecutionEnvironmentSnapshot | null;
  } | null;
  test_configuration?: {
    id: string | null;
    name: string;
    snapshot: ExecutionConfigurationSnapshot | null;
  } | null;
  test_data_set?: {
    id: string | null;
    name: string;
    snapshot: ExecutionDataSetSnapshot | null;
  } | null;
  created_by: string | null;
  started_at: string | null;
  ended_at: string | null;
};

export type ExecutionCaseSnapshot = {
  execution_id: string;
  test_case_id: string;
  test_case_title: string;
  test_case_description: string | null;
  suite_id: string | null;
  suite_name: string | null;
  priority: number | null;
  status: string | null;
  sort_order: number;
};

export type ExecutionStepSnapshot = {
  execution_id: string;
  test_case_id: string;
  snapshot_step_id: string;
  step_order: number;
  action: string | null;
  expected_result: string | null;
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
