import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
const sessions = new Map();
const MAX_ACTIONS = Math.max(200, Number.parseInt(process.env.RECORDER_MAX_ACTIONS || "1000", 10));
const MAX_NETWORK = Math.max(200, Number.parseInt(process.env.RECORDER_MAX_NETWORK || "1000", 10));
const BODY_SAMPLE_LIMIT = Math.max(2000, Number.parseInt(process.env.RECORDER_BODY_SAMPLE_LIMIT || "12000", 10));
const recorderPageIds = new WeakMap();
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
const clip = (value, limit = BODY_SAMPLE_LIMIT) => {
    const normalized = normalizeText(typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));
    if (!normalized) {
        return null;
    }
    return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
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
const serializeSession = (session) => ({
    id: session.id,
    status: session.status,
    started_at: session.started_at,
    stopped_at: session.stopped_at,
    start_url: session.start_url,
    action_count: session.actions.length,
    network_count: session.network.length,
    actions: session.actions,
    network: session.network,
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
        items: [...sessions.values()].map(serializeSession)
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
    app.post("/api/v1/recorder/sessions", async (request, reply) => {
        const body = request.body;
        const id = randomUUID();
        const userDataDir = await mkdtemp(path.join(os.tmpdir(), `qaira-recorder-${id}-`));
        const startUrl = normalizeUrl(body?.start_url);
        const headless = process.env.RECORDER_HEADLESS === "true";
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
                viewport: null,
                args: launchArgs
            });
            const session = {
                id,
                status: "running",
                started_at: new Date().toISOString(),
                stopped_at: null,
                start_url: startUrl,
                user_data_dir: userDataDir,
                context,
                actions: [],
                network: [],
                error: null
            };
            await context.exposeBinding("__qairaRecorderEmit", async (source, event) => {
                if (!event || typeof event !== "object" || Array.isArray(event)) {
                    return;
                }
                const payload = event;
                const type = normalizeText(payload.type) || "click";
                const normalizedType = type === "fill" || type === "change" || type === "submit" || type === "navigation" || type === "tab" ? type : "click";
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
                capture: {
                    actions: true,
                    network: true,
                    duplicate_typing_suppression: true,
                    injection: recorderExtensionDir ? "chrome-extension + playwright-init-script" : "playwright-init-script",
                    extension_ready: Boolean(recorderExtensionDir)
                }
            };
        }
        catch (error) {
            await context?.close().catch(() => undefined);
            await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
            reply.code(500);
            return {
                message: error instanceof Error ? error.message : "Unable to start recorder session"
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
