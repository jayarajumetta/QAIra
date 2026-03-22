import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";

const THEME_KEY = "app_theme";
const SIDEBAR_KEY = "sidebar_collapsed";
const PROJECT_KEY = "sidebar_project_id";

const navGroups = [
  {
    label: "Workspace",
    items: [
      { to: "/", label: "Overview", icon: DashboardIcon },
      { to: "/feedback", label: "Feedback", icon: ChatIcon }
    ]
  },
  {
    label: "Administration",
    items: [
      { to: "/people", label: "People & Access", icon: UsersIcon },
      { to: "/projects", label: "Projects & Scope", icon: FolderIcon }
    ]
  },
  {
    label: "Test Design",
    items: [
      { to: "/design", label: "Test Design", icon: FlaskIcon },
      { to: "/requirements", label: "Requirements", icon: DocumentIcon },
      { to: "/test-cases", label: "Test Cases", icon: PencilIcon }
    ]
  },
  {
    label: "Execution",
    items: [
      { to: "/executions", label: "Executions", icon: PlayIcon }
    ]
  }
];

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, logout } = useAuth();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = window.localStorage.getItem(THEME_KEY);

    if (stored === "dark" || stored === "light") {
      return stored;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [isCollapsed, setIsCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_KEY) === "true");
  const [sidebarProjectId, setSidebarProjectId] = useState(() => window.localStorage.getItem(PROJECT_KEY) || "");

  const projects = projectsQuery.data || [];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.sidebar = isCollapsed ? "collapsed" : "expanded";
    window.localStorage.setItem(SIDEBAR_KEY, String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    if (!sidebarProjectId && projects[0]) {
      setSidebarProjectId(projects[0].id);
    }
  }, [projects, sidebarProjectId]);

  useEffect(() => {
    if (sidebarProjectId) {
      window.localStorage.setItem(PROJECT_KEY, sidebarProjectId);
    }
  }, [sidebarProjectId]);

  const currentSection = useMemo(() => {
    return navGroups.flatMap((group) => group.items).find((item) => item.to === location.pathname)?.label || "Workspace";
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <aside className={isCollapsed ? "sidebar is-collapsed" : "sidebar"}>
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <div className="brand-mark">QAIra</div>
            {!isCollapsed ? (
              <div className="brand-copy">
                <strong>QAIra</strong>
                <span>Workspace</span>
              </div>
            ) : null}
            <button
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="sidebar-collapse-button ghost-button"
              onClick={() => setIsCollapsed((current) => !current)}
              type="button"
            >
              {isCollapsed ? ">" : "<"}
            </button>
          </div>

          {!isCollapsed ? (
            <>
              <p className="sidebar-copy">
                Orchestrate projects, coverage design, execution runs, and results from one place.
              </p>
              <label className="sidebar-project-picker">
                <span>Project</span>
                <select
                  value={sidebarProjectId}
                  onChange={(event) => {
                    setSidebarProjectId(event.target.value);
                    navigate("/projects");
                  }}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
        </div>

        <nav className="nav-list">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              {!isCollapsed ? <p className="nav-group-label">{group.label}</p> : null}
              <div className="nav-group-items">
                {group.items.map((item) => {
                  const Icon = item.icon;

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => isActive ? "nav-link is-active" : "nav-link"}
                      title={isCollapsed ? item.label : undefined}
                    >
                      <span className="nav-link-icon"><Icon /></span>
                      {!isCollapsed ? <span className="nav-link-label">{item.label}</span> : null}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          {!isCollapsed ? (
            <div className="theme-toggle">
              <div>
                <strong>Theme</strong>
                <span>{theme === "light" ? "Light mode" : "Dark mode"}</span>
              </div>
              <button
                aria-label="Toggle theme"
                className={theme === "dark" ? "theme-switch is-dark" : "theme-switch"}
                onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
                type="button"
              >
                <span />
              </button>
            </div>
          ) : (
            <button
              aria-label="Toggle theme"
              className={theme === "dark" ? "theme-switch compact is-dark" : "theme-switch compact"}
              onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
              type="button"
            >
              <span />
            </button>
          )}

          <div className="user-chip">
            <strong>{session?.user.name || "Workspace User"}</strong>
            {!isCollapsed ? (
              <>
                <span>{session?.user.email}</span>
                <span>{session?.user.role === "admin" ? "Admin" : "Member"}</span>
              </>
            ) : null}
          </div>

          <button className="ghost-button sidebar-signout" onClick={logout} type="button">
            <LogoutIcon />
            {!isCollapsed ? <span>Sign out</span> : null}
          </button>
        </div>
      </aside>

      <main className="workspace-main" data-section={currentSection}>
        <Outlet />
      </main>
    </div>
  );
}

function IconFrame({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" fill="none" height="20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="20">{children}</svg>;
}

function DashboardIcon() {
  return <IconFrame><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></IconFrame>;
}

function UsersIcon() {
  return <IconFrame><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" /><circle cx="9.5" cy="7" r="3.5" /><path d="M20 8.5a3 3 0 0 1 0 5.8" /><path d="M23 21v-2a4 4 0 0 0-3-3.85" /></IconFrame>;
}

function FolderIcon() {
  return <IconFrame><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v9A2.5 2.5 0 0 1 18.5 21h-13A2.5 2.5 0 0 1 3 18.5z" /><path d="M9 12v5" /><path d="M13 14v3" /></IconFrame>;
}

function FlaskIcon() {
  return <IconFrame><path d="M10 3v5l-5.5 9a2 2 0 0 0 1.73 3h11.54A2 2 0 0 0 19.5 17L14 8V3" /><path d="M8 3h8" /><path d="M8.5 14h7" /></IconFrame>;
}

function DocumentIcon() {
  return <IconFrame><path d="M7 3h7l5 5v13H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M14 3v6h6" /><path d="M9 13h6" /><path d="M9 17h6" /></IconFrame>;
}

function PencilIcon() {
  return <IconFrame><path d="M4 20l4.5-1 9-9-3.5-3.5-9 9z" /><path d="M13.5 6.5l3.5 3.5" /></IconFrame>;
}

function PlayIcon() {
  return <IconFrame><path d="m7 4 12 8-12 8z" /></IconFrame>;
}

function LogoutIcon() {
  return <IconFrame><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></IconFrame>;
}

function ChatIcon() {
  return <IconFrame><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8" /><path d="M8 13h5" /></IconFrame>;
}
