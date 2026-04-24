export type User = {
  id: string;
  email: string;
  name: string | null;
  avatar_data_url?: string | null;
  role?: "admin" | "member";
  auth_provider?: "local" | "google";
  email_verified?: boolean;
  created_at?: string;
};

export type Role = {
  id: string;
  name: string;
};

export type Project = {
  id: string;
  display_id?: string | null;
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
  display_id?: string | null;
  project_id: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  test_case_ids?: string[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
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
  type: "llm" | "jira" | "email" | "google_auth" | "google_drive" | "github" | "testengine" | "ops";
  name: string;
  base_url: string | null;
  api_key: string | null;
  model: string | null;
  project_key: string | null;
  username: string | null;
  config: Record<string, unknown> | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DomainOption = {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  defaults?: Record<string, unknown>;
};

export type DomainMetadata = {
  app_types: {
    default_type: string;
    types: DomainOption[];
  };
  integrations: {
    default_type: string;
    types: DomainOption[];
  };
  requirements: {
    default_status: string;
    priority_scale: number[];
  };
  test_cases: {
    default_status: string;
    default_automated: string;
    statuses: DomainOption[];
    automated_options: DomainOption[];
    priority_scale: number[];
  };
  test_steps: {
    group_kinds: DomainOption[];
  };
  test_data_sets: {
    default_mode: string;
    modes: DomainOption[];
  };
  test_environments: {
    browsers: DomainOption[];
    mobile_os: DomainOption[];
  };
  executions: {
    statuses: DomainOption[];
    final_statuses: DomainOption[];
    result_statuses: DomainOption[];
    impact_levels: DomainOption[];
  };
  feedback: {
    default_status: string;
    statuses: DomainOption[];
  };
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

export type AiTestCaseGenerationJob = {
  id: string;
  project_id: string;
  app_type_id: string;
  integration_id?: string | null;
  requirement_ids: string[];
  max_cases_per_requirement: number;
  parallel_requirement_limit: number;
  additional_context?: string | null;
  external_links: string[];
  images: AiDesignImageInput[];
  status: "queued" | "running" | "completed" | "failed" | string;
  total_requirements: number;
  processed_requirements: number;
  generated_cases_count: number;
  error?: string | null;
  created_by: string;
  created_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at?: string;
};

export type WorkspaceTransaction = {
  id: string;
  project_id: string | null;
  app_type_id: string | null;
  category: string;
  action: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
  related_kind: string | null;
  related_id: string | null;
  created_by: string | null;
  created_user: User | null;
  event_count?: number;
  latest_event_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type WorkspaceTransactionEvent = {
  id: string;
  transaction_id: string;
  level: "info" | "success" | "warning" | "error" | string;
  phase: string | null;
  message: string;
  details: Record<string, unknown>;
  created_at?: string;
};

export type SmartExecutionImpactCase = {
  test_case_id: string;
  title: string;
  description: string | null;
  priority: number | null;
  status: string | null;
  suite_names: string[];
  requirement_titles: string[];
  step_count: number;
  reason: string;
  impact_level: "critical" | "high" | "medium" | "low";
};

export type SmartExecutionPreviewResponse = {
  integration: {
    id: string;
    name: string;
    type: string;
    model?: string | null;
  };
  app_type: {
    id: string;
    name: string;
  };
  default_suite: {
    id: string;
    name: string;
  };
  source_case_count: number;
  matched_case_count: number;
  execution_name: string;
  summary: string;
  cases: SmartExecutionImpactCase[];
};

export type TestSuite = {
  id: string;
  display_id?: string | null;
  app_type_id: string;
  name: string;
  parent_id: string | null;
  parameter_values?: Record<string, string>;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TestCase = {
  id: string;
  display_id?: string | null;
  app_type_id?: string | null;
  suite_id: string | null;
  suite_ids?: string[];
  requirement_ids?: string[];
  title: string;
  description: string | null;
  parameter_values?: Record<string, string>;
  automated: "yes" | "no" | null;
  priority: number | null;
  status: string | null;
  requirement_id: string | null;
  ai_generation_source?: "scheduler" | null;
  ai_generation_review_status?: "pending" | "accepted" | null;
  ai_generation_job_id?: string | null;
  ai_generated_at?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TestStep = {
  id: string;
  test_case_id: string;
  step_order: number;
  action: string | null;
  expected_result: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
  group_id?: string | null;
  group_name?: string | null;
  group_kind?: "local" | "reusable" | null;
  reusable_group_id?: string | null;
};

export type TestStepType = "web" | "api" | "android" | "ios";

export type StepApiRequestHeader = {
  key: string;
  value: string;
};

export type StepApiValidationKind = "status" | "header" | "body_contains" | "json_path";

export type StepApiValidation = {
  kind: StepApiValidationKind;
  target?: string | null;
  expected?: string | null;
};

export type StepApiResponseCapture = {
  path?: string | null;
  parameter?: string | null;
};

export type StepApiRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url?: string | null;
  headers?: StepApiRequestHeader[];
  body_mode?: "none" | "json" | "text" | "xml" | "form";
  body?: string | null;
  validations?: StepApiValidation[];
  captures?: StepApiResponseCapture[];
};

export type ApiRequestPreview = {
  request: {
    method: NonNullable<StepApiRequest["method"]>;
    url: string;
  };
  response: {
    status: number;
    ok: boolean;
    headers: Record<string, string>;
    content_type?: string | null;
    body_text: string;
    body_json?: unknown;
    duration_ms: number;
  };
};

export type SharedStepGroupStep = {
  step_order: number;
  action: string | null;
  expected_result: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
};

export type SharedStepGroup = {
  id: string;
  display_id?: string;
  app_type_id: string;
  name: string;
  description: string | null;
  steps: SharedStepGroupStep[];
  step_count?: number;
  usage_count?: number;
  used_test_cases?: Array<{
    id: string;
    title: string;
    status: string | null;
    referenced_step_count: number;
  }>;
  created_by?: string | null;
  updated_by?: string | null;
  created_at?: string;
  updated_at?: string;
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
  suite_snapshots?: Array<{ id: string; name: string; parameter_values?: Record<string, string> }>;
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
  assigned_to?: string | null;
  assigned_user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  } | null;
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
  started_at: string | null;
  ended_at: string | null;
};

export type ExecutionSchedule = {
  id: string;
  project_id: string;
  app_type_id: string | null;
  name: string;
  cadence: "once" | "daily" | "weekly" | "monthly" | string;
  next_run_at: string | null;
  last_run_at?: string | null;
  suite_ids: string[];
  test_case_ids: string[];
  test_environment_id?: string | null;
  test_configuration_id?: string | null;
  test_data_set_id?: string | null;
  assigned_to?: string | null;
  assigned_user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  } | null;
  created_by: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
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
  parameter_values?: Record<string, string>;
  suite_parameter_values?: Record<string, string>;
  sort_order: number;
  assigned_to?: string | null;
  assigned_user?: {
    id: string;
    email: string;
    name: string | null;
    avatar_data_url?: string | null;
  } | null;
};

export type ExecutionStepSnapshot = {
  execution_id: string;
  test_case_id: string;
  snapshot_step_id: string;
  step_order: number;
  action: string | null;
  expected_result: string | null;
  step_type?: TestStepType | null;
  automation_code?: string | null;
  api_request?: StepApiRequest | null;
  group_id?: string | null;
  group_name?: string | null;
  group_kind?: "local" | "reusable" | null;
  reusable_group_id?: string | null;
};

export type ExecutionResult = {
  id: string;
  execution_id: string;
  test_case_id: string;
  test_case_title?: string | null;
  suite_id?: string | null;
  suite_name?: string | null;
  app_type_id: string;
  status: "running" | "passed" | "failed" | "blocked";
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

export type AuthSetupPayload = {
  google: {
    enabled: boolean;
    clientId: string | null;
  };
  emailVerification: {
    enabled: boolean;
    senderEmail: string | null;
    senderName: string | null;
  };
};

export type ApiError = {
  statusCode?: number;
  error?: string;
  message?: string;
};
