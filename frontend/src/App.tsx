import {
  Navigate,
  RouterProvider,
  createBrowserRouter
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
import { TestCasesPage } from "./pages/TestCasesPage";

const queryClient = new QueryClient();
const THEME_KEY = "app_theme";

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

function ProtectedLayout() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="splash-screen">Loading workspace…</div>;
  }

  if (!session) {
    return <Navigate to="/auth" replace />;
  }

  return <AppShell />;
}

function AuthRoute() {
  const { session, isLoading } = useAuth();

  if (isLoading) {
    return <div className="splash-screen">Checking session…</div>;
  }

  if (session) {
    return <Navigate to="/" replace />;
  }

  return <AuthPage />;
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
