import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
  useLocation
} from "react-router-dom";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DesignPage } from "./pages/DesignPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PeoplePage } from "./pages/PeoplePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RequirementsPage } from "./pages/RequirementsPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { TestCasesPage } from "./pages/TestCasesPage";

const queryClient = new QueryClient();
const THEME_KEY = "app_theme";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview · QAIra",
  "/people": "People · QAIra",
  "/projects": "Projects · QAIra",
  "/design": "Test Design · QAIra",
  "/requirements": "Requirements · QAIra",
  "/feedback": "Feedback · QAIra",
  "/test-cases": "Test Cases · QAIra",
  "/executions": "Executions · QAIra",
  "/auth": "Sign In · QAIra"
};

function ThemeBootstrap() {
  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_KEY);
    const theme = stored === "dark" || stored === "light"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";

    document.documentElement.dataset.theme = theme;
  }, []);

  return null;
}

function PageTitleUpdater() {
  const location = useLocation();

  useEffect(() => {
    const title = PAGE_TITLES[location.pathname] || "QAIra";
    document.title = title;
  }, [location.pathname]);

  return null;
}

function ProtectedLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="splash-screen">Loading workspace…</div>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return (
    <>
      <PageTitleUpdater />
      <AppShell />
    </>
  );
}

function AuthRoute() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="splash-screen">Checking session…</div>;
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <PageTitleUpdater />
      <AuthPage />
    </>
  );
}

const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthRoute />
  },
  {
    path: "/",
    element: <ProtectedLayout />,
    children: [
      { index: true, element: <OverviewPage /> },
      { path: "people", element: <PeoplePage /> },
      { path: "projects", element: <ProjectsPage /> },
      { path: "design", element: <DesignPage /> },
      { path: "requirements", element: <RequirementsPage /> },
      { path: "feedback", element: <FeedbackPage /> },
      { path: "test-cases", element: <TestCasesPage /> },
      { path: "executions", element: <ExecutionsPage /> }
    ]
  }
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeBootstrap />
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
