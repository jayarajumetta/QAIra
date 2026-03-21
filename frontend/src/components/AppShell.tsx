import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const navItems = [
  { to: "/", label: "Overview" },
  { to: "/people", label: "People & Access" },
  { to: "/projects", label: "Projects & Scope" },
  { to: "/design", label: "Test Design" },
  { to: "/executions", label: "Executions" }
];

export function AppShell() {
  const { session, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand-mark">QA</div>
          <h1>QAIra Workspace</h1>
          <p className="sidebar-copy">
            Orchestrate projects, coverage design, execution runs, and results from one place.
          </p>
        </div>

        <nav className="nav-list">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => isActive ? "nav-link is-active" : "nav-link"}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <strong>{session?.user.name || "Workspace User"}</strong>
            <span>{session?.user.email}</span>
          </div>
          <button className="ghost-button" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="workspace-main">
        <Outlet />
      </main>
    </div>
  );
}
