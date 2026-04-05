import { useCallback, useEffect, useState } from "react";

const CURRENT_PROJECT_STORAGE_KEY = "sidebar_project_id";
const CURRENT_PROJECT_EVENT = "qaira:current-project-change";

const readCurrentProjectId = () => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY) || "";
};

const writeCurrentProjectId = (projectId: string) => {
  if (typeof window === "undefined") {
    return;
  }

  if (projectId) {
    window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, projectId);
  } else {
    window.localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  }

  window.dispatchEvent(new Event(CURRENT_PROJECT_EVENT));
};

export function useCurrentProject() {
  const [projectId, setProjectIdState] = useState(readCurrentProjectId);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncProjectId = () => {
      setProjectIdState(readCurrentProjectId());
    };

    window.addEventListener("storage", syncProjectId);
    window.addEventListener(CURRENT_PROJECT_EVENT, syncProjectId);

    return () => {
      window.removeEventListener("storage", syncProjectId);
      window.removeEventListener(CURRENT_PROJECT_EVENT, syncProjectId);
    };
  }, []);

  const setProjectId = useCallback((nextProjectId: string) => {
    setProjectIdState(nextProjectId);
    writeCurrentProjectId(nextProjectId);
  }, []);

  return [projectId, setProjectId] as const;
}
