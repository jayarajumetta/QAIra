import {
  Navigate,
  RouterProvider,
  createBrowserRouter
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { DesignPage } from "./pages/DesignPage";
import { ExecutionsPage } from "./pages/ExecutionsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PeoplePage } from "./pages/PeoplePage";
import { ProjectsPage } from "./pages/ProjectsPage";

const queryClient = new QueryClient();

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
      { path: "executions", element: <ExecutionsPage /> }
    ]
  }
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
