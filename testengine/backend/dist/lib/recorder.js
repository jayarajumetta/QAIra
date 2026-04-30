import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const sessions = new Map();
const MAX_ACTIONS = Math.max(200, Number.parseInt(process.env.RECORDER_MAX_ACTIONS || "1000", 10));
const MAX_NETWORK = Math.max(200, Number.parseInt(process.env.RECORDER_MAX_NETWORK || "1000", 10));
const BODY_SAMPLE_LIMIT = Math.max(2000, Number.parseInt(process.env.RECORDER_BODY_SAMPLE_LIMIT || "12000", 10));
const REMOTE_TEXT_LIMIT = Math.max(1, Number.parseInt(process.env.RECORDER_REMOTE_TEXT_LIMIT || "500", 10));
const VIEWPORT_WIDTH = Math.max(640, Number.parseInt(process.env.RECORDER_VIEWPORT_WIDTH || "1365", 10));
const VIEWPORT_HEIGHT = Math.max(480, Number.parseInt(process.env.RECORDER_VIEWPORT_HEIGHT || "768", 10));
const recorderPageIds = new WeakMap();
const recorderAttachedPages = new WeakSet();
const LIVE_VIEW_HTML_CACHE_SECONDS = 0;
const normalizeText = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
};
const normalizeUrl = (value) => {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }
    try {
        return new URL(normalized).toString();
    }
    catch {
        return null;
    }
};
const normalizePositiveNumber = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};
const resolveHeadlessMode = () => process.env.RECORDER_HEADLESS !== "false";
const buildLiveViewPath = (session) => `/api/v1/recorder/sessions/${encodeURIComponent(session.id)}/live?token=${encodeURIComponent(session.live_token)}`;
const buildBrowserUnavailableResponse = (error) => {
    const message = error instanceof Error ? error.message : String(error || "Unable to start recorder session");
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("executable doesn't exist") || lowerMessage.includes("please run the following command")) {
        return {
            code: "RECORDER_BROWSER_UNAVAILABLE",
            message: "The Test Engine could not find its managed Chromium browser. Run the Playwright Test Engine container or install the Playwright browsers on the engine host; QAira frontend users do not need Chrome or Playwright locally.",
            detail: message
        };
    }
    if (lowerMessage.includes("headed browser") || lowerMessage.includes("xserver") || lowerMessage.includes("display")) {
        return {
            code: "RECORDER_DISPLAY_UNAVAILABLE",
            message: "The Test Engine cannot open a physical browser window on this host. Keep RECORDER_HEADLESS enabled and use the QAira live recorder view from the frontend.",
            detail: message
        };
    }
    return {
        code: "RECORDER_START_FAILED",
        message,
        detail: message
    };
};
const clip = (value, limit = BODY_SAMPLE_LIMIT) => {
    const normalized = normalizeText(typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));
    if (!normalized) {
        return null;
    }
    return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
};
const clipRawText = (value, limit) => {
    if (value === undefined || value === null) {
        return "";
    }
    const text = typeof value === "string" ? value : String(value);
    return text.length > limit ? text.slice(0, limit) : text;
};
const sanitizeHeaders = (headers) => {
    const sanitized = {};
    Object.entries(headers || {}).forEach(([key, value]) => {
        const normalizedKey = key.toLowerCase();
        sanitized[key] = ["authorization", "cookie", "set-cookie", "x-api-key"].includes(normalizedKey) ? "[redacted]" : value;
    });
    return sanitized;
};
const isUsefulNetworkRequest = (request) => {
    const resourceType = request.resourceType();
    if (resourceType === "fetch" || resourceType === "xhr") {
        return true;
    }
    try {
        const parsed = new URL(request.url());
        return /\/api(\/|$)/i.test(parsed.pathname);
    }
    catch {
        return false;
    }
};
const pushBounded = (items, item, max) => {
    items.push(item);
    if (items.length > max) {
        items.splice(0, items.length - max);
    }
};
const getRecorderPageId = (page) => {
    if (!page) {
        return null;
    }
    let pageId = recorderPageIds.get(page);
    if (!pageId) {
        pageId = `tab-${randomUUID().slice(0, 8)}`;
        recorderPageIds.set(page, pageId);
    }
    return pageId;
};
const resolvePageTitle = async (page) => {
    if (!page || page.isClosed()) {
        return null;
    }
    return normalizeText(await page.title().catch(() => ""));
};
const resolveRequestPage = (request) => {
    try {
        return request.frame().page();
    }
    catch {
        return null;
    }
};
const serializeSession = (session, options = {}) => ({
    id: session.id,
    status: session.status,
    started_at: session.started_at,
    stopped_at: session.stopped_at,
    start_url: session.start_url,
    display_mode: session.display_mode,
    live_view_path: options.includeLiveViewPath ? buildLiveViewPath(session) : null,
    action_count: session.actions.length,
    network_count: session.network.length,
    actions: session.actions,
    network: session.network,
    capture: session.capture,
    error: session.error
});
const recorderInitScript = `
(() => {
  if (window.__qairaRecorderInstalled) return;
  window.__qairaRecorderInstalled = true;

  const clean = (value) => String(value || "").replace(/\\s+/g, " ").trim();
  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value || "").replace(/[^A-Za-z0-9_-]/g, "\\\\$&");
  };
  const visibleText = (element) => clean(element.innerText || element.textContent || "").slice(0, 120);
  const attr = (element, name) => clean(element.getAttribute(name) || "");
  const cssPath = (element) => {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const id = attr(current, "id");
      if (id) {
        parts.unshift("#" + cssEscape(id));
        break;
      }
      const name = attr(current, "name");
      const testId = attr(current, "data-testid") || attr(current, "data-test") || attr(current, "data-qa");
      if (testId) {
        parts.unshift(tag + "[data-testid=\\"" + testId.replaceAll('"', "\\\\\\"") + "\\"]");
        break;
      }
      if (name) {
        parts.unshift(tag + "[name=\\"" + name.replaceAll('"', "\\\\\\"") + "\\"]");
        break;
      }
      const parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      const siblings = Array.from(parent.children).filter((sibling) => sibling.tagName === current.tagName);
      const index = siblings.indexOf(current);
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + (index + 1) + ")" : tag);
      current = parent;
    }
    return parts.join(" > ");
  };
  const locatorFor = (element) => {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return "body";
    const testId = attr(element, "data-testid") || attr(element, "data-test") || attr(element, "data-qa");
    if (testId) return "[data-testid=\\"" + testId.replaceAll('"', "\\\\\\"") + "\\"]";
    const aria = attr(element, "aria-label");
    if (aria) return "[aria-label=\\"" + aria.replaceAll('"', "\\\\\\"") + "\\"]";
    const id = attr(element, "id");
    if (id) return "#" + cssEscape(id);
    const name = attr(element, "name");
    if (name) return element.tagName.toLowerCase() + "[name=\\"" + name.replaceAll('"', "\\\\\\"") + "\\"]";
    const placeholder = attr(element, "placeholder");
    if (placeholder) return "placeholder=" + placeholder;
    const label = element.labels && element.labels[0] ? clean(element.labels[0].innerText || element.labels[0].textContent || "") : "";
    if (label) return "label=" + label;
    const role = attr(element, "role");
    const text = visibleText(element);
    if ((role || ["button", "a"].includes(element.tagName.toLowerCase())) && text) return "text=" + text;
    if (text && text.length <= 80) return "text=" + text;
    return cssPath(element);
  };
  const emit = (event) => {
    if (typeof window.__qairaRecorderEmit === "function") {
      window.__qairaRecorderEmit({
        ...event,
        url: window.location.href,
        timestamp: new Date().toISOString()
      }).catch(() => {});
    }
  };
  const inputTimers = new WeakMap();
  const lastInputValues = new WeakMap();
  const recordInput = (target, type) => {
    if (!target || !("value" in target)) return;
    const value = String(target.value || "");
    const previous = lastInputValues.get(target);
    if (previous === value) return;
    lastInputValues.set(target, value);
    emit({
      type,
      locator: locatorFor(target),
      text: attr(target, "name") || attr(target, "placeholder") || visibleText(target),
      value
    });
  };

  document.addEventListener("click", (event) => {
    const target = event.target && event.target.closest ? event.target.closest("button,a,input,select,textarea,[role=button],[role=link],[data-testid],[data-test],[data-qa]") : event.target;
    emit({
      type: "click",
      locator: locatorFor(target),
      text: visibleText(target)
    });
  }, true);

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!target || !("value" in target)) return;
    const existing = inputTimers.get(target);
    if (existing) clearTimeout(existing);
    inputTimers.set(target, setTimeout(() => recordInput(target, "fill"), 350));
  }, true);

  document.addEventListener("change", (event) => {
    recordInput(event.target, "change");
  }, true);

  document.addEventListener("submit", (event) => {
    emit({
      type: "submit",
      locator: locatorFor(event.target),
      text: visibleText(event.target)
    });
  }, true);

  window.addEventListener("popstate", () => emit({ type: "navigation", locator: "location", text: document.title }));
})();
`;
const recorderExtensionContentScript = `
(() => {
  if (document.documentElement?.dataset.qairaRecorderExtension === "loaded") return;
  if (document.documentElement) {
    document.documentElement.dataset.qairaRecorderExtension = "loaded";
  }
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-recorder.js");
  script.async = false;
  (document.documentElement || document.head || document.body).appendChild(script);
  script.remove();
})();
`;
const createRecorderExtension = async (userDataDir) => {
    const extensionDir = path.join(userDataDir, "qaira-recorder-extension");
    await mkdir(extensionDir, { recursive: true });
    await writeFile(path.join(extensionDir, "manifest.json"), JSON.stringify({
        manifest_version: 3,
        name: "QAira Recorder",
        version: "1.0.0",
        description: "Captures browser actions and API calls for QAira automation authoring sessions.",
        content_scripts: [
            {
                matches: ["<all_urls>"],
                js: ["content.js"],
                run_at: "document_start",
                all_frames: true
            }
        ],
        web_accessible_resources: [
            {
                resources: ["page-recorder.js"],
                matches: ["<all_urls>"]
            }
        ]
    }, null, 2));
    await writeFile(path.join(extensionDir, "content.js"), recorderExtensionContentScript);
    await writeFile(path.join(extensionDir, "page-recorder.js"), recorderInitScript);
    return extensionDir;
};
const attachPageCapture = (session, page, logger) => {
    if (recorderAttachedPages.has(page)) {
        return;
    }
    recorderAttachedPages.add(page);
    const pageId = getRecorderPageId(page);
    void (async () => {
        pushBounded(session.actions, {
            index: session.actions.length + 1,
            type: "tab",
            locator: "browser.tab",
            text: "Tab opened",
            value: null,
            url: page.url(),
            page_id: pageId,
            page_title: await resolvePageTitle(page),
            timestamp: new Date().toISOString()
        }, MAX_ACTIONS);
    })();
    page.on("close", () => {
        pushBounded(session.actions, {
            index: session.actions.length + 1,
            type: "tab",
            locator: "browser.tab",
            text: "Tab closed",
            value: null,
            url: page.url(),
            page_id: pageId,
            page_title: null,
            timestamp: new Date().toISOString()
        }, MAX_ACTIONS);
    });
    page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) {
            return;
        }
        void (async () => {
            pushBounded(session.actions, {
                index: session.actions.length + 1,
                type: "navigation",
                locator: "location",
                text: page.url(),
                value: null,
                url: page.url(),
                page_id: pageId,
                page_title: await resolvePageTitle(page),
                timestamp: new Date().toISOString()
            }, MAX_ACTIONS);
        })();
    });
    page.on("requestfinished", (request) => {
        if (!isUsefulNetworkRequest(request)) {
            return;
        }
        void (async () => {
            try {
                const response = await request.response();
                const requestPage = resolveRequestPage(request);
                const headers = sanitizeHeaders(await response?.allHeaders().catch(() => ({})) || {});
                const contentType = headers["content-type"] || headers["Content-Type"] || null;
                const canReadBody = typeof contentType === "string" && /(json|text|xml|html|x-www-form-urlencoded)/i.test(contentType);
                const responseText = canReadBody ? await response?.text().catch(() => null) : null;
                pushBounded(session.network, {
                    index: session.network.length + 1,
                    method: request.method(),
                    url: request.url(),
                    status: response?.status() ?? null,
                    resource_type: request.resourceType(),
                    request_body: clip(request.postData()),
                    response_body_sample: clip(responseText),
                    content_type: contentType,
                    page_id: getRecorderPageId(requestPage),
                    page_title: await resolvePageTitle(requestPage),
                    timestamp: new Date().toISOString()
                }, MAX_NETWORK);
            }
            catch (error) {
                logger.warn({ error, sessionId: session.id }, "Unable to record network request");
            }
        })();
    });
    page.on("requestfailed", (request) => {
        if (!isUsefulNetworkRequest(request)) {
            return;
        }
        void (async () => {
            const requestPage = resolveRequestPage(request);
            pushBounded(session.network, {
                index: session.network.length + 1,
                method: request.method(),
                url: request.url(),
                status: null,
                resource_type: request.resourceType(),
                request_body: clip(request.postData()),
                response_body_sample: request.failure()?.errorText || "request failed",
                content_type: null,
                page_id: getRecorderPageId(requestPage),
                page_title: await resolvePageTitle(requestPage),
                timestamp: new Date().toISOString()
            }, MAX_NETWORK);
        })();
    });
};
const resolveActivePage = async (session) => {
    const page = session.context.pages().filter((candidate) => !candidate.isClosed()).at(-1);
    return page || session.context.newPage();
};
const readRecorderToken = (request) => {
    const query = request.query;
    const header = request.headers["x-qaira-recorder-token"];
    return normalizeText(query?.token)
        || normalizeText(Array.isArray(header) ? header[0] : header)
        || null;
};
const requireRecorderToken = (request, session) => readRecorderToken(request) === session.live_token;
const renderLiveViewHtml = (session) => {
    const sessionId = JSON.stringify(session.id);
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>QAira Recorder</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f8f6;
      color: #202421;
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      background: #f7f8f6;
    }
    header,
    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid #dfe4dc;
      background: #ffffff;
    }
    header {
      justify-content: space-between;
    }
    strong {
      font-size: 14px;
      line-height: 1.2;
    }
    .meta {
      color: #667066;
      font-size: 12px;
    }
    .toolbar {
      flex-wrap: wrap;
    }
    input {
      min-width: 180px;
      border: 1px solid #c9d0c6;
      border-radius: 8px;
      padding: 9px 10px;
      font: inherit;
      background: #fff;
      color: inherit;
    }
    #address {
      flex: 1 1 320px;
    }
    #textInput {
      flex: 1 1 220px;
    }
    button {
      border: 0;
      border-radius: 999px;
      padding: 9px 13px;
      font: inherit;
      font-weight: 700;
      color: #fff;
      background: #b55233;
      cursor: pointer;
    }
    button.secondary {
      color: #8d3f27;
      background: rgba(181, 82, 51, 0.1);
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.52;
    }
    main {
      min-height: 0;
      display: grid;
      grid-template-rows: minmax(0, 1fr) auto;
      background: #1e221f;
    }
    .viewport {
      min-height: 0;
      overflow: auto;
      display: grid;
      place-items: center;
      padding: 12px;
    }
    #screen {
      display: block;
      max-width: 100%;
      height: auto;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 14px 40px rgba(0, 0, 0, 0.32);
      cursor: crosshair;
      user-select: none;
    }
    .inputbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.14);
      background: #ffffff;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: #556056;
      font-size: 12px;
      white-space: nowrap;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #3a9b68;
    }
    .error {
      color: #9a3a2f;
    }
    @media (prefers-color-scheme: dark) {
      :root,
      body {
        background: #171a18;
        color: #f1f3ef;
      }
      header,
      .toolbar,
      .inputbar {
        background: #222622;
        border-color: #343a34;
      }
      input {
        background: #171a18;
        border-color: #414840;
      }
      .meta,
      .status {
        color: #b8c1b6;
      }
      button.secondary {
        color: #f3b39f;
        background: rgba(243, 179, 159, 0.12);
      }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <strong>QAira live recorder</strong>
      <div class="meta">Session ${session.id.slice(0, 8)} · ${session.display_mode.replace(/-/g, " ")}</div>
    </div>
    <span class="status"><span class="dot"></span><span id="statusText">Connecting</span></span>
  </header>
  <div class="toolbar">
    <input id="address" autocomplete="off" placeholder="Open URL in recorder browser" />
    <button id="goButton" type="button">Go</button>
    <button class="secondary" data-key="Enter" type="button">Enter</button>
    <button class="secondary" data-key="Tab" type="button">Tab</button>
    <button class="secondary" data-key="Escape" type="button">Esc</button>
    <button class="secondary" data-key="Backspace" type="button">Backspace</button>
  </div>
  <main>
    <div class="viewport">
      <img id="screen" alt="Recorder browser viewport" draggable="false" />
    </div>
    <div class="inputbar">
      <input id="textInput" autocomplete="off" placeholder="Text to type into the focused field" />
      <button id="typeButton" type="button">Type</button>
      <span class="status" id="dimensionText"></span>
    </div>
  </main>
  <script>
    const sessionId = ${sessionId};
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const screen = document.getElementById("screen");
    const statusText = document.getElementById("statusText");
    const dimensionText = document.getElementById("dimensionText");
    const address = document.getElementById("address");
    const textInput = document.getElementById("textInput");
    let refreshTimer = null;
    let inFlight = false;

    const withToken = (path) => path + "?token=" + encodeURIComponent(token);
    const screenshotUrl = () => withToken("/api/v1/recorder/sessions/" + encodeURIComponent(sessionId) + "/screenshot") + "&t=" + Date.now();
    const inputUrl = () => withToken("/api/v1/recorder/sessions/" + encodeURIComponent(sessionId) + "/input");

    const scheduleRefresh = (delay = 350) => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(refresh, delay);
    };

    const refresh = () => {
      screen.src = screenshotUrl();
    };

    const send = async (payload) => {
      if (!token || inFlight) return;
      inFlight = true;
      statusText.textContent = "Sending";
      statusText.classList.remove("error");

      try {
        const response = await fetch(inputUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-QAira-Recorder-Token": token },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message || "Recorder input failed");
        }

        statusText.textContent = "Live";
        scheduleRefresh();
      } catch (error) {
        statusText.textContent = error instanceof Error ? error.message : "Input failed";
        statusText.classList.add("error");
      } finally {
        inFlight = false;
      }
    };

    screen.addEventListener("load", () => {
      statusText.textContent = "Live";
      statusText.classList.remove("error");
      dimensionText.textContent = screen.naturalWidth && screen.naturalHeight ? screen.naturalWidth + " x " + screen.naturalHeight : "";
    });

    screen.addEventListener("error", () => {
      statusText.textContent = "Waiting for browser";
      statusText.classList.add("error");
      scheduleRefresh(1200);
    });

    screen.addEventListener("click", (event) => {
      if (!screen.naturalWidth || !screen.naturalHeight) return;
      const rect = screen.getBoundingClientRect();
      const x = Math.round((event.clientX - rect.left) * (screen.naturalWidth / rect.width));
      const y = Math.round((event.clientY - rect.top) * (screen.naturalHeight / rect.height));
      send({ type: "click", x, y });
    });

    screen.addEventListener("wheel", (event) => {
      event.preventDefault();
      send({ type: "scroll", delta_x: event.deltaX, delta_y: event.deltaY });
    }, { passive: false });

    document.getElementById("goButton").addEventListener("click", () => {
      send({ type: "goto", url: address.value });
    });

    address.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        send({ type: "goto", url: address.value });
      }
    });

    document.getElementById("typeButton").addEventListener("click", () => {
      send({ type: "type", text: textInput.value });
      textInput.value = "";
    });

    textInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        send({ type: "type", text: textInput.value });
        textInput.value = "";
      }
    });

    document.querySelectorAll("[data-key]").forEach((button) => {
      button.addEventListener("click", () => send({ type: "press", key: button.getAttribute("data-key") }));
    });

    window.setInterval(refresh, 1000);
    refresh();
  </script>
</body>
</html>`;
};
const stopSession = async (session) => {
    if (session.status === "running") {
        session.status = "stopped";
    }
    session.stopped_at = session.stopped_at || new Date().toISOString();
    await session.context.close().catch(() => undefined);
    await rm(session.user_data_dir, { recursive: true, force: true }).catch(() => undefined);
};
export const registerRecorderRoutes = async (app) => {
    app.get("/api/v1/recorder/sessions", async () => ({
        items: [...sessions.values()].map((session) => serializeSession(session))
    }));
    app.get("/api/v1/recorder/sessions/:id", async (request, reply) => {
        const params = request.params;
        const session = sessions.get(params.id);
        if (!session) {
            reply.code(404);
            return { message: "Recorder session not found" };
        }
        return serializeSession(session);
    });
    app.get("/api/v1/recorder/sessions/:id/live", async (request, reply) => {
        const params = request.params;
        const session = sessions.get(params.id);
        if (!session) {
            reply.code(404);
            return { message: "Recorder session not found" };
        }
        if (!requireRecorderToken(request, session)) {
            reply.code(403);
            return { message: "Recorder live view token is invalid or expired" };
        }
        reply
            .header("Cache-Control", `private, max-age=${LIVE_VIEW_HTML_CACHE_SECONDS}`)
            .type("text/html; charset=utf-8");
        return renderLiveViewHtml(session);
    });
    app.get("/api/v1/recorder/sessions/:id/screenshot", async (request, reply) => {
        const params = request.params;
        const session = sessions.get(params.id);
        if (!session) {
            reply.code(404);
            return { message: "Recorder session not found" };
        }
        if (!requireRecorderToken(request, session)) {
            reply.code(403);
            return { message: "Recorder live view token is invalid or expired" };
        }
        try {
            const page = await resolveActivePage(session);
            const screenshot = await page.screenshot({
                type: "png",
                fullPage: false,
                timeout: 5_000
            });
            reply
                .header("Cache-Control", "no-store")
                .type("image/png");
            return screenshot;
        }
        catch (error) {
            reply.code(409);
            return {
                message: error instanceof Error ? error.message : "Unable to capture recorder screenshot"
            };
        }
    });
    app.post("/api/v1/recorder/sessions/:id/input", async (request, reply) => {
        const params = request.params;
        const session = sessions.get(params.id);
        if (!session) {
            reply.code(404);
            return { message: "Recorder session not found" };
        }
        if (!requireRecorderToken(request, session)) {
            reply.code(403);
            return { message: "Recorder live view token is invalid or expired" };
        }
        if (session.status !== "running") {
            reply.code(409);
            return { message: "Recorder session is not running" };
        }
        const body = request.body;
        const type = normalizeText(body?.type);
        try {
            const page = await resolveActivePage(session);
            if (type === "click") {
                const x = normalizePositiveNumber(body?.x);
                const y = normalizePositiveNumber(body?.y);
                if (x === null || y === null) {
                    reply.code(400);
                    return { message: "click input requires non-negative x and y coordinates" };
                }
                await page.mouse.click(x, y);
            }
            else if (type === "type") {
                const text = clipRawText(body?.text, REMOTE_TEXT_LIMIT);
                if (text) {
                    await page.keyboard.type(text, { delay: 12 });
                }
            }
            else if (type === "press") {
                const key = normalizeText(body?.key);
                if (!key) {
                    reply.code(400);
                    return { message: "press input requires a key" };
                }
                await page.keyboard.press(key);
                pushBounded(session.actions, {
                    index: session.actions.length + 1,
                    type: "press",
                    locator: "keyboard",
                    text: key,
                    value: null,
                    url: page.url(),
                    page_id: getRecorderPageId(page),
                    page_title: await resolvePageTitle(page),
                    timestamp: new Date().toISOString()
                }, MAX_ACTIONS);
            }
            else if (type === "scroll") {
                await page.mouse.wheel(Number(body?.delta_x) || 0, Number(body?.delta_y) || 0);
            }
            else if (type === "goto") {
                const url = normalizeUrl(body?.url);
                if (!url) {
                    reply.code(400);
                    return { message: "goto input requires a valid absolute URL" };
                }
                await page.goto(url, {
                    waitUntil: "domcontentloaded",
                    timeout: 60_000
                });
            }
            else {
                reply.code(400);
                return { message: "Unsupported recorder input type" };
            }
            return {
                ok: true,
                action_count: session.actions.length,
                network_count: session.network.length
            };
        }
        catch (error) {
            reply.code(409);
            return {
                message: error instanceof Error ? error.message : "Recorder input failed"
            };
        }
    });
    app.post("/api/v1/recorder/sessions", async (request, reply) => {
        const body = request.body;
        const id = randomUUID();
        const userDataDir = await mkdtemp(path.join(os.tmpdir(), `qaira-recorder-${id}-`));
        const startUrl = normalizeUrl(body?.start_url);
        const headless = resolveHeadlessMode();
        let context = null;
        let recorderExtensionDir = null;
        try {
            if (!headless && process.env.RECORDER_DISABLE_EXTENSION !== "true") {
                recorderExtensionDir = await createRecorderExtension(userDataDir).catch((error) => {
                    app.log.warn({ error, sessionId: id }, "Unable to prepare recorder extension; falling back to init script");
                    return null;
                });
            }
            const launchArgs = [
                "--start-maximized",
                "--disable-background-networking",
                "--disable-default-apps"
            ];
            if (recorderExtensionDir) {
                launchArgs.push(`--disable-extensions-except=${recorderExtensionDir}`);
                launchArgs.push(`--load-extension=${recorderExtensionDir}`);
            }
            context = await chromium.launchPersistentContext(userDataDir, {
                headless,
                ignoreHTTPSErrors: true,
                viewport: headless ? { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT } : null,
                args: launchArgs
            });
            const capture = {
                actions: true,
                network: true,
                duplicate_typing_suppression: true,
                injection: recorderExtensionDir ? "chrome-extension + playwright-init-script" : "playwright-init-script",
                extension_ready: Boolean(recorderExtensionDir),
                remote_control: true,
                screenshot_stream: true
            };
            const session = {
                id,
                status: "running",
                started_at: new Date().toISOString(),
                stopped_at: null,
                start_url: startUrl,
                user_data_dir: userDataDir,
                live_token: randomUUID(),
                display_mode: headless ? "browser-live-view" : "local-browser-with-live-view",
                context,
                actions: [],
                network: [],
                error: null,
                capture
            };
            await context.exposeBinding("__qairaRecorderEmit", async (source, event) => {
                if (!event || typeof event !== "object" || Array.isArray(event)) {
                    return;
                }
                const payload = event;
                const type = normalizeText(payload.type) || "click";
                const normalizedType = type === "fill" || type === "change" || type === "submit" || type === "navigation" || type === "press" || type === "tab" ? type : "click";
                const sourcePage = source.page || null;
                pushBounded(session.actions, {
                    index: session.actions.length + 1,
                    type: normalizedType,
                    locator: normalizeText(payload.locator),
                    text: normalizeText(payload.text),
                    value: normalizedType === "fill" || normalizedType === "change" ? normalizeText(payload.value) : null,
                    url: normalizeText(payload.url) || sourcePage?.url() || null,
                    page_id: getRecorderPageId(sourcePage),
                    page_title: await resolvePageTitle(sourcePage),
                    timestamp: normalizeText(payload.timestamp) || new Date().toISOString()
                }, MAX_ACTIONS);
            });
            await context.addInitScript(recorderInitScript);
            context.on("page", (page) => attachPageCapture(session, page, app.log));
            const page = context.pages()[0] || await context.newPage();
            attachPageCapture(session, page, app.log);
            sessions.set(id, session);
            if (startUrl) {
                await page.goto(startUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 60_000
                }).catch((error) => {
                    app.log.warn({ error, sessionId: id, startUrl }, "Recorder start URL navigation failed");
                });
            }
            reply.code(202);
            return {
                id,
                status: session.status,
                started_at: session.started_at,
                start_url: startUrl,
                display_mode: session.display_mode,
                live_view_path: buildLiveViewPath(session),
                action_count: session.actions.length,
                network_count: session.network.length,
                capture
            };
        }
        catch (error) {
            await context?.close().catch(() => undefined);
            await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
            const failure = buildBrowserUnavailableResponse(error);
            reply.code(failure.code === "RECORDER_START_FAILED" ? 500 : 503);
            return {
                ...failure,
                recoverable: true
            };
        }
    });
    app.post("/api/v1/recorder/sessions/:id/stop", async (request, reply) => {
        const params = request.params;
        const session = sessions.get(params.id);
        if (!session) {
            reply.code(404);
            return { message: "Recorder session not found" };
        }
        await stopSession(session);
        return serializeSession(session);
    });
};
