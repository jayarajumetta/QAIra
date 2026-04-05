import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";

const THEME_KEY = "app_theme";
const SIDEBAR_KEY = "sidebar_collapsed";

const navigation = [
  {
    label: "Main",
    items: [
      { id: "overview", to: "/", label: "Dashboard", icon: DashboardIcon },
      { id: "projects", to: "/projects", label: "Projects", icon: FolderIcon, countKey: "projects" }
    ]
  },
  {
    label: "Test Management",
    items: [
      {
        id: "authoring",
        label: "Test Authoring",
        icon: FlaskIcon,
        children: [
          { id: "requirements", to: "/requirements", label: "Requirements" },
          { id: "test-cases", to: "/test-cases", label: "Test Cases" },
          { id: "design", to: "/design", label: "Test Suites" }
        ]
      },
      {
        id: "runs",
        label: "Test Runs",
        icon: PlayIcon,
        children: [
          { id: "executions", to: "/executions", label: "Executions" },
          { id: "feedback", to: "/feedback", label: "Reporting & Feedback" }
        ]
      }
    ]
  },
  {
    label: "Administration",
    items: [
      { id: "people", to: "/people", label: "Users", icon: UsersIcon },
      { id: "integrations", to: "/integrations", label: "Integrations", icon: PlugIcon }
    ]
  },
  {
    label: "Settings",
    items: [
      { id: "support", to: "/support", label: "Support", icon: SupportIcon },
      { id: "notifications", to: "/notifications", label: "Notifications", icon: BellIcon },
      { id: "settings", to: "/settings", label: "Settings", icon: CogIcon }
    ]
  }
] as const;

export function AppShell() {
  const location = useLocation();
  const { session, logout, error, clearError } = useAuth();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    retry: 1,
    staleTime: 60 * 1000
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = window.localStorage.getItem(THEME_KEY);

    if (stored === "dark" || stored === "light") {
      return stored;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [isCollapsed, setIsCollapsed] = useState(() => window.localStorage.getItem(SIDEBAR_KEY) === "true");
  const [sidebarProjectId, setSidebarProjectId] = useCurrentProject();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    authoring: true,
    runs: true
  });

  const projects = projectsQuery.data || [];
  const hasNoProjects = !projectsQuery.isPending && projects.length === 0;
  const navCounts = {
    projects: projects.length
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.sidebar = isCollapsed ? "collapsed" : "expanded";
    window.localStorage.setItem(SIDEBAR_KEY, String(isCollapsed));
  }, [isCollapsed]);

  useEffect(() => {
    if (projectsQuery.isPending) {
      return;
    }

    if (!projects.length) {
      if (sidebarProjectId) {
        setSidebarProjectId("");
      }
      return;
    }

    if (!sidebarProjectId || !projects.some((project) => project.id === sidebarProjectId)) {
      setSidebarProjectId(projects[0].id);
    }
  }, [projects, projectsQuery.isPending, setSidebarProjectId, sidebarProjectId]);

  useEffect(() => {
    navigation.forEach((group) => {
      group.items.forEach((item) => {
        if ("children" in item && item.children.some((child) => child.to === location.pathname)) {
          setExpandedGroups((current) => ({ ...current, [item.id]: true }));
        }
      });
    });
  }, [location.pathname]);

  const isWorkspaceWideLibrary = location.pathname === "/requirements" || location.pathname === "/test-cases";

  const currentSection = useMemo(() => {
    for (const group of navigation) {
      for (const item of group.items) {
        if ("to" in item && item.to === location.pathname) {
          return item.label;
        }

        if ("children" in item) {
          const match = item.children.find((child) => child.to === location.pathname);
          if (match) {
            return match.label;
          }
        }
      }
    }

    return "Workspace";
  }, [location.pathname]);

  return (
    <div className={`app-shell app-layout${isWorkspaceWideLibrary ? " app-layout--workspace-wide" : ""}`}>
      {error && (
        <div className="global-alert" role="alert">
          <p>{error}</p>
          <button 
            className="ghost-button" 
            onClick={clearError}
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
      
      <aside className={isCollapsed ? "sidebar is-collapsed" : "sidebar"} role="navigation">
        <div className="sidebar-top">
          <div className="sidebar-brand-row">
            <div className="sidebar-brand-lockup">
              <div
                aria-label="QAIra Home"
                className="brand-mark"
                title={isCollapsed ? "QAIra Home" : undefined}
              >
                {isCollapsed ? "Q" : "QAIra"}
              </div>
              {!isCollapsed ? (
                <div className="brand-copy">
                  <strong>QAIra</strong>
                  <span>Workspace</span>
                </div>
              ) : null}
            </div>
            {!isCollapsed ? (
              <button
                aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="sidebar-collapse-button ghost-button"
                onClick={() => setIsCollapsed((current) => !current)}
                type="button"
              >
                <MenuIcon />
              </button>
            ) : null}
          </div>

          {isCollapsed ? (
            <button
              aria-label="Expand sidebar"
              className="sidebar-collapse-button sidebar-collapse-button-compact ghost-button"
              onClick={() => setIsCollapsed((current) => !current)}
              title="Expand sidebar"
              type="button"
            >
              <MenuIcon />
            </button>
          ) : null}

          {!isCollapsed ? (
            hasNoProjects ? (
              <div className="sidebar-notice">
                <p>No projects assigned yet.</p>
                <p className="text-muted">Ask an admin to add you to a project.</p>
              </div>
            ) : (
              <label className="sidebar-project-picker">
                <span>Current Project</span>
                <select
                  value={sidebarProjectId}
                  onChange={(event) => setSidebarProjectId(event.target.value)}
                  aria-label="Select a project"
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </label>
            )
          ) : null}
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              {!isCollapsed ? <p className="nav-group-label">{group.label}</p> : null}
              <div className="nav-group-items">
                {group.items.map((item) => {
                  const Icon = item.icon;

                  if ("children" in item) {
                    const isOpen = expandedGroups[item.id] ?? true;
                    const hasActiveChild = item.children.some((child) => child.to === location.pathname);
                    const isDisabled = hasNoProjects;
                    const firstChild = item.children[0];

                    return (
                      <div className="nav-branch" key={item.id}>
                        <div className="nav-branch-control">
                          <NavLink
                            aria-label={item.label}
                            className={hasActiveChild ? "nav-link nav-branch-link is-active" : "nav-link nav-branch-link"}
                            onClick={(event) => {
                              if (isDisabled || !firstChild) {
                                event.preventDefault();
                                return;
                              }

                              if (isCollapsed) {
                                setIsCollapsed(false);
                              }

                              setExpandedGroups((current) => ({ ...current, [item.id]: true }));
                            }}
                            style={{ opacity: isDisabled ? 0.5 : 1, cursor: isDisabled ? "not-allowed" : "pointer" }}
                            title={isCollapsed ? item.label : undefined}
                            to={firstChild?.to || "/"}
                          >
                            <span className="nav-link-icon" aria-hidden="true"><Icon /></span>
                            {!isCollapsed ? <span className="nav-link-label">{item.label}</span> : null}
                          </NavLink>

                          {!isCollapsed ? (
                            <button
                              aria-expanded={isOpen}
                              aria-label={isOpen ? `Collapse ${item.label}` : `Expand ${item.label}`}
                              className={hasActiveChild ? "nav-branch-caret-button is-active" : "nav-branch-caret-button"}
                              disabled={isDisabled}
                              onClick={() => {
                                if (isDisabled) {
                                  return;
                                }

                                setExpandedGroups((current) => ({ ...current, [item.id]: !isOpen }));
                              }}
                              type="button"
                            >
                              <span className={isOpen ? "nav-link-caret is-open" : "nav-link-caret"}><ChevronIcon /></span>
                            </button>
                          ) : null}
                        </div>

                        {!isCollapsed && isOpen ? (
                          <div className="nav-subgroup">
                            {item.children.map((child) => {
                              const childDisabled = hasNoProjects;

                              return (
                                <NavLink
                                  key={child.to}
                                  to={child.to}
                                  className={({ isActive }) => isActive ? "nav-sublink is-active" : "nav-sublink"}
                                  onClick={(event) => {
                                    if (childDisabled) {
                                      event.preventDefault();
                                    }
                                  }}
                                  style={{ opacity: childDisabled ? 0.5 : 1, cursor: childDisabled ? "not-allowed" : "pointer" }}
                                >
                                  <span>{child.label}</span>
                                </NavLink>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  const isDisabled = false;
                  const badgeCount = "countKey" in item ? navCounts[item.countKey as keyof typeof navCounts] : undefined;

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={({ isActive }) => isActive ? "nav-link is-active" : "nav-link"}
                      title={isCollapsed ? item.label : undefined}
                      aria-label={item.label}
                      onClick={(e) => {
                        if (isDisabled) {
                          e.preventDefault();
                        }
                      }}
                      style={{ opacity: isDisabled ? 0.5 : 1, cursor: isDisabled ? "not-allowed" : "pointer" }}
                    >
                      <span className="nav-link-icon" aria-hidden="true"><Icon /></span>
                      {!isCollapsed ? <span className="nav-link-label">{item.label}</span> : null}
                      {!isCollapsed && typeof badgeCount === "number" ? <span className="nav-link-badge">{badgeCount}</span> : null}
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
              className={theme === "dark" ? "sidebar-icon-button is-dark" : "sidebar-icon-button"}
              onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              type="button"
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
          )}

          <div className="user-chip" role="status">
            <strong>{session?.user.name || "Workspace User"}</strong>
            {!isCollapsed ? (
              <>
                <span>{session?.user.email}</span>
                <span>{session?.user.role === "admin" ? "Admin" : "Member"}</span>
              </>
            ) : null}
          </div>

          <button 
            className="ghost-button sidebar-signout" 
            onClick={logout} 
            type="button"
            aria-label="Sign out"
            title={isCollapsed ? "Sign out" : undefined}
          >
            <LogoutIcon />
            {!isCollapsed ? <span>Sign out</span> : null}
          </button>
        </div>
      </aside>

      <main
        className={`workspace-main main${isWorkspaceWideLibrary ? " main--library-fill" : ""}`}
        data-section={currentSection}
      >
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

function ChevronIcon() {
  return <IconFrame><path d="m8 10 4 4 4-4" /></IconFrame>;
}

function PlugIcon() {
  return <IconFrame><path d="M8 7v5" /><path d="M16 7v5" /><path d="M7 12h10" /><path d="M12 12v5a3 3 0 0 1-3 3H8" /><path d="M16 20h-1" /></IconFrame>;
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

function BellIcon() {
  return <IconFrame><path d="M15 17H5l1.4-1.4A2 2 0 0 0 7 14.2V11a5 5 0 0 1 10 0v3.2a2 2 0 0 0 .6 1.4L19 17h-4" /><path d="M10 20a2 2 0 0 0 4 0" /></IconFrame>;
}

function CogIcon() {
  return <IconFrame><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 0 1-4 0v-.2a1 1 0 0 0-.6-.9 1 1 0 0 0-1.1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 0 1 0-4h.2a1 1 0 0 0 .9-.6 1 1 0 0 0-.2-1.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 0 1 4 0v.2a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6h.2a2 2 0 0 1 0 4h-.2a1 1 0 0 0-.9.6" /></IconFrame>;
}

function SupportIcon() {
  return <IconFrame><path d="M9.1 9a3 3 0 1 1 5.8 1c-.5 1.2-1.6 1.7-2.4 2.3-.6.5-1 1-1 1.7" /><circle cx="12" cy="18" r="1" /><path d="M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" /></IconFrame>;
}

function MenuIcon() {
  return <IconFrame><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></IconFrame>;
}

function SunIcon() {
  return <IconFrame><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5" /><path d="M12 19v2.5" /><path d="m4.93 4.93 1.77 1.77" /><path d="m17.3 17.3 1.77 1.77" /><path d="M2.5 12H5" /><path d="M19 12h2.5" /><path d="m4.93 19.07 1.77-1.77" /><path d="m17.3 6.7 1.77-1.77" /></IconFrame>;
}

function MoonIcon() {
  return <IconFrame><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4 6.8 6.8 0 0 0 20 14.5z" /></IconFrame>;
}
