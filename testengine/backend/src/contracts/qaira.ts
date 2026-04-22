export type EngineStepType = "web" | "api";
export type EngineRunTrigger = "execution" | "test-run";
export type EngineSourceMode = "attached-script" | "manual-handover";
export type EngineTraceMode = "off" | "on" | "on-first-retry" | "retain-on-failure";
export type EngineVideoMode = "off" | "on" | "retain-on-failure";
export type EngineBrowser = "chromium" | "firefox" | "webkit";
export type QairaExecutionResultStatus = "passed" | "failed" | "blocked";
export type EngineStepOutcomeStatus = QairaExecutionResultStatus | "skipped";

export type EngineKeyValueEntry = {
  key: string;
  value: string;
  is_secret?: boolean;
};

export type EngineApiValidation = {
  kind: "status" | "header" | "body_contains" | "json_path";
  target?: string | null;
  expected?: string | null;
};

export type EngineApiCapture = {
  path?: string | null;
  parameter?: string | null;
};

export type EngineApiRequest = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  url?: string | null;
  headers?: Array<{ key: string; value: string }>;
  body_mode?: "none" | "json" | "text" | "xml" | "form";
  body?: string | null;
  validations?: EngineApiValidation[];
  captures?: EngineApiCapture[];
};

export type EngineRunStep = {
  id: string;
  order: number;
  step_type: EngineStepType;
  action: string | null;
  expected_result: string | null;
  automation_code?: string | null;
  api_request?: EngineApiRequest | null;
  group_name?: string | null;
  group_kind?: "local" | "reusable" | null;
};

export type EngineManualSpec = {
  title: string;
  intent: string;
  preconditions: string[];
  steps: string[];
  assertions: string[];
  test_data: Record<string, string>;
  environment_notes?: string | null;
};

export type EngineAttachedScript = {
  language: "typescript";
  framework: "playwright";
  path: string;
  locator_map_path?: string | null;
  content_hash?: string | null;
};

export type EngineRunArtifactPolicy = {
  trace_mode: EngineTraceMode;
  video_mode: EngineVideoMode;
  screenshot_on_failure: boolean;
  capture_console: boolean;
  capture_network: boolean;
  artifact_retention_days: number;
};

export type EngineInlineEvidenceImage = {
  data_url?: string | null;
  file_name?: string | null;
  mime_type?: string | null;
  artifact_path?: string | null;
};

export type QairaExecutionStepEvidence = {
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
};

export type QairaExecutionLogsPayload = {
  stepStatuses?: Record<string, QairaExecutionResultStatus>;
  stepNotes?: Record<string, string>;
  stepEvidence?: Record<string, QairaExecutionStepEvidence>;
};

export type EngineArtifactKind =
  | "trace"
  | "video"
  | "screenshot"
  | "console"
  | "network"
  | "dom"
  | "summary"
  | "script"
  | "locator-map";

export type EngineArtifactRef = {
  kind: EngineArtifactKind;
  label: string;
  path?: string | null;
  url?: string | null;
  content_type?: string | null;
};

export type EngineStepOutcome = {
  step_id: string;
  status: EngineStepOutcomeStatus;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  note?: string | null;
  evidence_image?: EngineInlineEvidenceImage | null;
  artifacts?: EngineArtifactRef[];
};

export type EngineCaseResultPayload = {
  qaira_execution_result_id?: string | null;
  status: QairaExecutionResultStatus;
  duration_ms?: number | null;
  error?: string | null;
  logs: QairaExecutionLogsPayload;
};

export type EngineRunEnvelope = {
  engine_run_id: string;
  qaira_run_id: string;
  qaira_execution_id?: string | null;
  qaira_test_case_id: string;
  qaira_test_case_title: string;
  project: {
    id: string;
    name: string;
  };
  app_type: {
    id: string;
    name: string;
    kind: string;
  };
  trigger: EngineRunTrigger;
  source_mode: EngineSourceMode;
  automated: boolean;
  browser: EngineBrowser;
  headless: boolean;
  max_repair_attempts: number;
  run_timeout_seconds: number;
  manual_spec: EngineManualSpec;
  attached_script?: EngineAttachedScript | null;
  steps: EngineRunStep[];
  suite_parameters: Record<string, string>;
  case_parameters: Record<string, string>;
  environment?: {
    name: string;
    base_url?: string | null;
    browser?: string | null;
    variables: EngineKeyValueEntry[];
  } | null;
  configuration?: {
    name: string;
    browser?: string | null;
    mobile_os?: string | null;
    platform_version?: string | null;
    variables: EngineKeyValueEntry[];
  } | null;
  data_set?: {
    name: string;
    mode: "key_value" | "table";
    columns: string[];
    rows: Array<Record<string, string>>;
  } | null;
  artifact_policy: EngineRunArtifactPolicy;
  callback: {
    url: string;
    signing_secret: string;
  };
};

export type EngineArtifactBundle = {
  trace_path?: string | null;
  video_path?: string | null;
  screenshot_paths: string[];
  console_log_path?: string | null;
  network_har_path?: string | null;
  dom_snapshot_path?: string | null;
  summary_path?: string | null;
  artifact_refs?: EngineArtifactRef[];
};

export type EnginePatchProposal = {
  kind: "locator-map" | "script";
  status: "review" | "applied";
  summary: string;
  target_path: string;
};

export type EngineRunState =
  | "queued"
  | "building-script"
  | "running"
  | "healing"
  | "completed"
  | "failed"
  | "incident";

export type EngineRunRecord = {
  id: string;
  qaira_run_id: string;
  qaira_execution_id?: string | null;
  qaira_test_case_id: string;
  test_case_title: string;
  state: EngineRunState;
  source_mode: EngineSourceMode;
  browser: EngineBrowser;
  deterministic_attempted: boolean;
  healing_attempted: boolean;
  healing_succeeded: boolean;
  summary: string;
  generated_script_path?: string | null;
  locator_map_path?: string | null;
  artifact_bundle: EngineArtifactBundle;
  patch_proposals: EnginePatchProposal[];
  created_at: string;
  updated_at: string;
};

export type EngineCallbackEventType =
  | "run.accepted"
  | "run.progress"
  | "run.step.completed"
  | "run.completed"
  | "run.failed"
  | "run.incident"
  | "run.patch.proposed";

export type EngineCallbackPayload = {
  event: EngineCallbackEventType;
  engine_run_id: string;
  qaira_run_id: string;
  qaira_execution_id?: string | null;
  qaira_test_case_id: string;
  state: EngineRunState;
  summary: string;
  deterministic_attempted: boolean;
  healing_attempted: boolean;
  healing_succeeded: boolean;
  step_outcomes?: EngineStepOutcome[];
  case_result?: EngineCaseResultPayload | null;
  artifact_bundle: EngineArtifactBundle;
  patch_proposals: EnginePatchProposal[];
  emitted_at: string;
};
