export type WorkspaceSectionItem = {
  to: string;
  label: string;
  shortLabel?: string;
};

export const TEST_AUTHORING_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/requirements", label: "Requirements", shortLabel: "Reqs" },
  { to: "/test-cases", label: "Test Cases", shortLabel: "Cases" },
  { to: "/shared-steps", label: "Shared Steps", shortLabel: "Shared" },
  { to: "/design", label: "Test Suites", shortLabel: "Suites" }
];

export const TEST_ENVIRONMENT_SECTION_ITEMS: WorkspaceSectionItem[] = [
  { to: "/test-environments", label: "Environments", shortLabel: "Env" },
  { to: "/test-data", label: "Test Data", shortLabel: "Data" },
  { to: "/test-configurations", label: "Configurations", shortLabel: "Config" }
];

export const WORKSPACE_PAGE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/projects": "Projects",
  "/requirements": "Requirements",
  "/test-cases": "Test Cases",
  "/shared-steps": "Shared Step Groups",
  "/design": "Test Suites",
  "/executions": "Executions",
  "/test-environments": "Environments",
  "/test-data": "Test Data",
  "/test-configurations": "Configurations",
  "/people": "Users",
  "/integrations": "Integrations",
  "/support": "Support",
  "/notifications": "Notifications",
  "/settings": "Settings",
  "/feedback": "Reporting & Feedback"
};

export const WORKSPACE_LIBRARY_PATHS = new Set([
  ...TEST_AUTHORING_SECTION_ITEMS.map((item) => item.to),
  "/executions",
  ...TEST_ENVIRONMENT_SECTION_ITEMS.map((item) => item.to)
]);
