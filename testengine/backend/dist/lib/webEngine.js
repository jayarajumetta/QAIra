import { Builder, By, Key, until } from "selenium-webdriver";
import { chromium, firefox, webkit } from "playwright";
import { buildInitialContext, interpolateText, normalizeKey, normalizeText, registerContextValue, stringifyValue, toParameterValuesRecord } from "./runtimeContext.js";
const DEFAULT_SELENIUM_GRID_URL = String(process.env.SELENIUM_GRID_URL || "http://127.0.0.1:4444/wd/hub").trim();
const SELENIUM_BROWSER_MAP = {
    chromium: "chrome",
    firefox: "firefox",
    webkit: "MicrosoftEdge"
};
const AsyncFunction = Object.getPrototypeOf(async function () {
    return undefined;
}).constructor;
const PLAYWRIGHT_BROWSER_MAP = {
    chromium,
    firefox,
    webkit
};
const normalizeProvider = (value) => value === "selenium" ? "selenium" : "playwright";
const normalizeBrowser = (value) => {
    const normalized = normalizeText(value)?.toLowerCase() || "chromium";
    if (normalized === "firefox") {
        return "firefox";
    }
    if (normalized === "webkit" || normalized === "safari") {
        return "webkit";
    }
    return "chromium";
};
const stripWrappingQuotes = (value) => value.replace(/^["'`]+|["'`]+$/g, "").trim();
const escapeXPathLiteral = (value) => {
    if (!value.includes("'")) {
        return `'${value}'`;
    }
    if (!value.includes("\"")) {
        return `"${value}"`;
    }
    return `concat(${value.split("'").map((part) => `'${part}'`).join(`, "\"'\"", `)})`;
};
const extractQuotedText = (value) => {
    const match = value.match(/["'`](.+?)["'`]/);
    return match ? match[1].trim() : null;
};
const extractUrlCandidate = (value) => {
    const urlMatch = value.match(/https?:\/\/[^\s]+/i);
    if (urlMatch?.[0]) {
        return urlMatch[0];
    }
    const pathMatch = value.match(/(?:open|navigate|go|visit)\s+(?:to\s+)?(\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/i);
    return pathMatch?.[1] || null;
};
const titleCaseLabel = (value) => value.replace(/\s+/g, " ").trim();
const buildExpectApi = () => {
    const api = ((actual) => ({
        toBe(expected) {
            if (actual !== expected) {
                throw new Error(`Expected ${stringifyValue(actual)} to equal ${stringifyValue(expected)}`);
            }
        },
        toContain(expected) {
            if (!String(actual ?? "").includes(String(expected ?? ""))) {
                throw new Error(`Expected ${stringifyValue(actual)} to contain ${stringifyValue(expected)}`);
            }
        },
        toBeTruthy() {
            if (!actual) {
                throw new Error(`Expected ${stringifyValue(actual)} to be truthy`);
            }
        }
    }));
    api.equal = (actual, expected, label) => {
        if (actual !== expected) {
            throw new Error(label || `Expected ${stringifyValue(actual)} to equal ${stringifyValue(expected)}`);
        }
    };
    api.truthy = (actual, label) => {
        if (!actual) {
            throw new Error(label || `Expected ${stringifyValue(actual)} to be truthy`);
        }
    };
    api.contains = (actual, expected, label) => {
        if (!String(actual ?? "").includes(String(expected ?? ""))) {
            throw new Error(label || `Expected ${stringifyValue(actual)} to contain ${stringifyValue(expected)}`);
        }
    };
    return api;
};
const resolveNavigationTarget = (target, envelope) => {
    const trimmed = stripWrappingQuotes(target);
    const baseUrl = normalizeText(envelope.environment?.base_url || null);
    if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
    }
    if (trimmed.startsWith("/") && baseUrl) {
        return new URL(trimmed, baseUrl).toString();
    }
    if (["home", "homepage", "application", "site", "landing page"].includes(trimmed.toLowerCase()) && baseUrl) {
        return baseUrl;
    }
    return baseUrl ? new URL(trimmed, `${baseUrl.replace(/\/+$/, "")}/`).toString() : trimmed;
};
const parseActionText = (step, context) => {
    const action = interpolateText(step.action || "", context).trim();
    if (!action) {
        return null;
    }
    const normalized = action.toLowerCase();
    const urlCandidate = extractUrlCandidate(action);
    if (/^(open|navigate|go|visit)\b/.test(normalized) || urlCandidate) {
        return {
            kind: "goto",
            target: urlCandidate || action.replace(/^(open|navigate|go|visit)\s+(to\s+)?/i, "").trim()
        };
    }
    const fillMatch = action.match(/^(?:enter|type|fill|input|write)\s+(.+?)\s+(?:into|in|to)\s+(.+)$/i);
    if (fillMatch) {
        return {
            kind: "fill",
            value: stripWrappingQuotes(fillMatch[1]),
            target: stripWrappingQuotes(fillMatch[2])
        };
    }
    const clickMatch = action.match(/^(?:click|tap|submit|choose|select)\s+(.+)$/i);
    if (clickMatch) {
        return {
            kind: "click",
            target: stripWrappingQuotes(clickMatch[1].replace(/\s+(button|link|tab|option)$/i, ""))
        };
    }
    const waitMatch = action.match(/^wait(?: for)?\s+(\d+)\s*(ms|milliseconds|s|sec|seconds)?$/i);
    if (waitMatch) {
        const amount = Number.parseInt(waitMatch[1], 10);
        const unit = (waitMatch[2] || "ms").toLowerCase();
        return {
            kind: "wait",
            durationMs: unit.startsWith("s") ? amount * 1000 : amount
        };
    }
    const pressMatch = action.match(/^press\s+([A-Za-z0-9_]+)(?:\s+(?:on|in)\s+(.+))?$/i);
    if (pressMatch) {
        return {
            kind: "press",
            key: pressMatch[1].toUpperCase(),
            target: pressMatch[2] ? stripWrappingQuotes(pressMatch[2]) : null
        };
    }
    const checkMatch = action.match(/^(check|tick)\s+(.+)$/i);
    if (checkMatch) {
        return {
            kind: "check",
            target: stripWrappingQuotes(checkMatch[2])
        };
    }
    const uncheckMatch = action.match(/^(uncheck|untick)\s+(.+)$/i);
    if (uncheckMatch) {
        return {
            kind: "uncheck",
            target: stripWrappingQuotes(uncheckMatch[2])
        };
    }
    return null;
};
const parseExpectedResult = (step, context) => {
    const expected = interpolateText(step.expected_result || "", context).trim();
    if (!expected) {
        return null;
    }
    const urlCandidate = extractUrlCandidate(expected);
    if (urlCandidate || /\burl\b|\bpage\b/.test(expected.toLowerCase())) {
        return {
            kind: "url",
            expected: stripWrappingQuotes(urlCandidate || expected)
        };
    }
    const visibleMatch = expected.match(/(.+?)\s+(?:is|should be)\s+(?:visible|displayed|shown)$/i);
    if (visibleMatch) {
        return {
            kind: "visible",
            target: stripWrappingQuotes(visibleMatch[1])
        };
    }
    const quoted = extractQuotedText(expected);
    if (quoted) {
        return {
            kind: "text",
            target: null,
            expected: quoted
        };
    }
    return null;
};
const candidateTokens = (target) => {
    const trimmed = stripWrappingQuotes(target);
    const quoted = extractQuotedText(trimmed);
    const fallback = quoted || trimmed;
    return {
        raw: trimmed,
        text: fallback
    };
};
const createPlaywrightLocatorFacade = (resolver, target) => ({
    click: async () => {
        const locator = await resolver(target);
        await locator.click();
    },
    fill: async (value) => {
        const locator = await resolver(target);
        await locator.fill(value);
    },
    press: async (key) => {
        const locator = await resolver(target);
        await locator.press(key);
    },
    textContent: async () => {
        const locator = await resolver(target);
        return (await locator.textContent()) || "";
    },
    isVisible: async () => {
        const locator = await resolver(target);
        return locator.isVisible();
    },
    getAttribute: async (name) => {
        const locator = await resolver(target);
        return locator.getAttribute(name);
    }
});
class PlaywrightWebSession {
    envelope;
    provider = "playwright";
    browser = null;
    browserContext = null;
    browserPage = null;
    consoleEntries = [];
    networkEntries = [];
    constructor(envelope) {
        this.envelope = envelope;
    }
    get pageOrThrow() {
        if (!this.browserPage) {
            throw new Error("Playwright page has not been initialized");
        }
        return this.browserPage;
    }
    async start() {
        if (this.browserPage) {
            return;
        }
        const browserType = PLAYWRIGHT_BROWSER_MAP[normalizeBrowser(this.envelope.browser)];
        this.browser = await browserType.launch({
            headless: this.envelope.headless !== false
        });
        this.browserContext = await this.browser.newContext({
            ignoreHTTPSErrors: true
        });
        this.browserPage = await this.browserContext.newPage();
        this.browserPage.on("console", (message) => {
            const location = message.location();
            this.consoleEntries.push({
                type: message.type(),
                text: message.text(),
                timestamp: new Date().toISOString(),
                location: location.url ? `${location.url}:${location.lineNumber}:${location.columnNumber}` : null
            });
        });
        this.browserPage.on("response", (response) => {
            const request = response.request();
            this.networkEntries.push({
                method: request.method(),
                url: response.url(),
                status: response.status(),
                resource_type: request.resourceType(),
                timestamp: new Date().toISOString()
            });
        });
        this.browserPage.on("requestfailed", (request) => {
            this.networkEntries.push({
                method: request.method(),
                url: request.url(),
                status: null,
                resource_type: request.resourceType(),
                error: request.failure()?.errorText || "request failed",
                timestamp: new Date().toISOString()
            });
        });
    }
    async stop() {
        await this.browserContext?.close();
        await this.browser?.close();
        this.browserContext = null;
        this.browser = null;
        this.browserPage = null;
    }
    async resolveLocator(target) {
        const page = this.pageOrThrow;
        const tokens = candidateTokens(target);
        if (tokens.raw.startsWith("css=")) {
            return page.locator(tokens.raw.slice(4)).first();
        }
        if (tokens.raw.startsWith("text=")) {
            return page.getByText(tokens.raw.slice(5), { exact: false }).first();
        }
        if (tokens.raw.startsWith("xpath=") || tokens.raw.startsWith("//")) {
            return page.locator(tokens.raw.startsWith("xpath=") ? tokens.raw : `xpath=${tokens.raw}`).first();
        }
        const fallbackCandidates = [
            () => page.getByLabel(tokens.text, { exact: false }).first(),
            () => page.getByPlaceholder(tokens.text, { exact: false }).first(),
            () => page.getByRole("button", { name: tokens.text, exact: false }).first(),
            () => page.getByRole("link", { name: tokens.text, exact: false }).first(),
            () => page.getByText(tokens.text, { exact: false }).first(),
            () => page.locator(tokens.raw).first()
        ];
        let lastError = null;
        for (const candidate of fallbackCandidates) {
            try {
                const locator = candidate();
                await locator.waitFor({ state: "visible", timeout: 1500 });
                return locator;
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${tokens.text}" in the browser page`);
    }
    async goto(target) {
        await this.pageOrThrow.goto(target, {
            waitUntil: "domcontentloaded",
            timeout: Math.max(30_000, this.envelope.run_timeout_seconds * 1000)
        });
    }
    async click(target) {
        const locator = await this.resolveLocator(target);
        await locator.click();
    }
    async fill(target, value) {
        const locator = await this.resolveLocator(target);
        await locator.fill(value);
    }
    async press(target, key) {
        if (!target) {
            await this.pageOrThrow.keyboard.press(key);
            return;
        }
        const locator = await this.resolveLocator(target);
        await locator.press(key);
    }
    async waitForTimeout(ms) {
        await this.pageOrThrow.waitForTimeout(Math.max(0, ms));
    }
    async waitForUrl(expected) {
        const resolved = stripWrappingQuotes(expected);
        await this.pageOrThrow.waitForURL((url) => url.toString().includes(resolved), {
            timeout: 10_000
        });
    }
    async expectVisible(target) {
        const locator = await this.resolveLocator(target);
        const isVisible = await locator.isVisible();
        if (!isVisible) {
            throw new Error(`Expected ${target} to be visible`);
        }
    }
    async expectText(target, expected) {
        if (!target) {
            await this.pageOrThrow.getByText(expected, { exact: false }).first().waitFor({ state: "visible", timeout: 5_000 });
            return;
        }
        const actual = await this.text(target);
        if (!actual.includes(expected)) {
            throw new Error(`Expected ${target} to contain "${expected}" but found "${actual}"`);
        }
    }
    async text(target) {
        const locator = await this.resolveLocator(target);
        return ((await locator.textContent()) || "").trim();
    }
    async value(target) {
        const locator = await this.resolveLocator(target);
        return await locator.inputValue();
    }
    async screenshot(label) {
        const buffer = await this.pageOrThrow.screenshot({
            fullPage: true,
            type: "png"
        });
        return {
            dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
            fileName: `${label}.png`,
            mimeType: "image/png"
        };
    }
    markDiagnostics() {
        return {
            started_at: new Date().toISOString(),
            console_index: this.consoleEntries.length,
            network_index: this.networkEntries.length
        };
    }
    async collectDiagnostics(marker, captures, durationMs) {
        return {
            provider: this.provider,
            started_at: marker.started_at,
            ended_at: new Date().toISOString(),
            duration_ms: durationMs,
            url: this.browserPage ? this.browserPage.url() : "",
            console: this.consoleEntries.slice(marker.console_index).slice(-80),
            network: this.networkEntries.slice(marker.network_index).slice(-120),
            captures
        };
    }
    bindings() {
        const pageFacade = {
            goto: (url) => this.goto(url),
            click: (target) => this.click(target),
            fill: (target, value) => this.fill(target, value),
            press: (target, key) => this.press(target, key),
            waitForTimeout: (ms) => this.waitForTimeout(ms),
            waitForURL: (expected) => this.waitForUrl(expected),
            url: async () => this.pageOrThrow.url(),
            textContent: (target) => this.text(target),
            locator: (target) => createPlaywrightLocatorFacade((value) => this.resolveLocator(value), target)
        };
        return {
            page: pageFacade,
            playwrightPage: this.pageOrThrow
        };
    }
}
const createSeleniumLocatorFacade = (resolveElement, target) => ({
    click: async () => {
        const element = await resolveElement(target);
        await element.click();
    },
    fill: async (value) => {
        const element = await resolveElement(target);
        await element.clear();
        await element.sendKeys(value);
    },
    press: async (key) => {
        const element = await resolveElement(target);
        await element.sendKeys(key);
    },
    textContent: async () => {
        const element = await resolveElement(target);
        return (await element.getText()) || "";
    },
    isVisible: async () => {
        const element = await resolveElement(target);
        return element.isDisplayed();
    },
    getAttribute: async (name) => {
        const element = await resolveElement(target);
        return element.getAttribute(name);
    }
});
class SeleniumWebSession {
    envelope;
    provider = "selenium";
    driverInstance = null;
    networkEntries = [];
    constructor(envelope) {
        this.envelope = envelope;
    }
    get driverOrThrow() {
        if (!this.driverInstance) {
            throw new Error("Selenium driver has not been initialized");
        }
        return this.driverInstance;
    }
    async start() {
        if (this.driverInstance) {
            return;
        }
        const seleniumBrowser = SELENIUM_BROWSER_MAP[normalizeBrowser(this.envelope.browser)] || "chrome";
        this.driverInstance = await new Builder()
            .usingServer(DEFAULT_SELENIUM_GRID_URL)
            .forBrowser(seleniumBrowser)
            .build();
        await this.driverInstance.manage().setTimeouts({
            implicit: 1_500,
            pageLoad: Math.max(30_000, this.envelope.run_timeout_seconds * 1000),
            script: 10_000
        });
    }
    async stop() {
        await this.driverInstance?.quit();
        this.driverInstance = null;
    }
    byStrategies(target) {
        const tokens = candidateTokens(target);
        if (tokens.raw.startsWith("css=")) {
            return [By.css(tokens.raw.slice(4))];
        }
        if (tokens.raw.startsWith("xpath=")) {
            return [By.xpath(tokens.raw.slice(6))];
        }
        if (tokens.raw.startsWith("//")) {
            return [By.xpath(tokens.raw)];
        }
        if (tokens.raw.startsWith("id=")) {
            return [By.id(tokens.raw.slice(3))];
        }
        if (tokens.raw.startsWith("name=")) {
            return [By.name(tokens.raw.slice(5))];
        }
        const escaped = escapeXPathLiteral(tokens.text);
        return [
            By.css(tokens.raw),
            By.xpath(`//*[@id=${escaped} or @name=${escaped} or @placeholder=${escaped} or @aria-label=${escaped}]`),
            By.xpath(`//label[contains(normalize-space(.), ${escaped})]/following::*[self::input or self::textarea or self::select][1]`),
            By.xpath(`//*[self::button or self::a or @role='button' or @role='link'][contains(normalize-space(.), ${escaped})]`),
            By.xpath(`//*[contains(normalize-space(.), ${escaped})]`)
        ];
    }
    async resolveElement(target) {
        const driver = this.driverOrThrow;
        let lastError = null;
        for (const strategy of this.byStrategies(target)) {
            try {
                const matches = await driver.findElements(strategy);
                const visibleMatch = matches[0];
                if (visibleMatch) {
                    return visibleMatch;
                }
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${target}" in Selenium`);
    }
    async goto(target) {
        await this.driverOrThrow.get(target);
        this.networkEntries.push({
            method: "GET",
            url: target,
            status: null,
            resource_type: "document",
            timestamp: new Date().toISOString()
        });
    }
    async click(target) {
        const element = await this.resolveElement(target);
        await element.click();
    }
    async fill(target, value) {
        const element = await this.resolveElement(target);
        await element.clear();
        await element.sendKeys(value);
    }
    async press(target, key) {
        const seleniumKey = Key[key.toUpperCase()] || key;
        if (!target) {
            await this.driverOrThrow.actions().sendKeys(seleniumKey).perform();
            return;
        }
        const element = await this.resolveElement(target);
        await element.sendKeys(seleniumKey);
    }
    async waitForTimeout(ms) {
        await this.driverOrThrow.sleep(Math.max(0, ms));
    }
    async waitForUrl(expected) {
        await this.driverOrThrow.wait(until.urlContains(stripWrappingQuotes(expected)), 10_000);
    }
    async expectVisible(target) {
        const element = await this.resolveElement(target);
        const visible = await element.isDisplayed();
        if (!visible) {
            throw new Error(`Expected ${target} to be visible`);
        }
    }
    async expectText(target, expected) {
        if (!target) {
            const source = await this.driverOrThrow.getPageSource();
            if (!source.includes(expected)) {
                throw new Error(`Expected the page to include "${expected}"`);
            }
            return;
        }
        const actual = await this.text(target);
        if (!actual.includes(expected)) {
            throw new Error(`Expected ${target} to contain "${expected}" but found "${actual}"`);
        }
    }
    async text(target) {
        const element = await this.resolveElement(target);
        return (await element.getText()) || "";
    }
    async value(target) {
        const element = await this.resolveElement(target);
        return (await element.getAttribute("value")) || "";
    }
    async screenshot(label) {
        const base64 = await this.driverOrThrow.takeScreenshot();
        return {
            dataUrl: `data:image/png;base64,${base64}`,
            fileName: `${label}.png`,
            mimeType: "image/png"
        };
    }
    markDiagnostics() {
        return {
            started_at: new Date().toISOString(),
            console_index: 0,
            network_index: this.networkEntries.length
        };
    }
    async collectDiagnostics(marker, captures, durationMs) {
        let consoleEntries = [];
        try {
            const manager = this.driverOrThrow.manage();
            const browserLogs = await manager.logs?.().get("browser");
            consoleEntries = (browserLogs || []).slice(-80).map((entry) => ({
                type: typeof entry.level === "string" ? entry.level : entry.level?.name || "browser",
                text: String(entry.message || ""),
                timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString()
            }));
        }
        catch {
            consoleEntries = [];
        }
        return {
            provider: this.provider,
            started_at: marker.started_at,
            ended_at: new Date().toISOString(),
            duration_ms: durationMs,
            url: await this.driverOrThrow.getCurrentUrl(),
            console: consoleEntries,
            network: this.networkEntries.slice(marker.network_index).slice(-120),
            captures
        };
    }
    bindings() {
        const pageFacade = {
            goto: (url) => this.goto(url),
            click: (target) => this.click(target),
            fill: (target, value) => this.fill(target, value),
            press: (target, key) => this.press(target, key),
            waitForTimeout: (ms) => this.waitForTimeout(ms),
            waitForURL: (expected) => this.waitForUrl(expected),
            url: () => this.driverOrThrow.getCurrentUrl(),
            textContent: (target) => this.text(target),
            locator: (target) => createSeleniumLocatorFacade((value) => this.resolveElement(value), target)
        };
        return {
            page: pageFacade,
            driver: this.driverOrThrow
        };
    }
}
const createWebSession = (envelope) => normalizeProvider(envelope.web_engine?.active) === "selenium"
    ? new SeleniumWebSession(envelope)
    : new PlaywrightWebSession(envelope);
const applyGeneratedAction = async (session, step, context, envelope) => {
    const action = parseActionText(step, context);
    if (!action) {
        throw new Error("No executable web automation code or recognizable step action was found.");
    }
    switch (action.kind) {
        case "goto":
            await session.goto(resolveNavigationTarget(action.target, envelope));
            return;
        case "click":
            await session.click(action.target);
            return;
        case "fill":
            await session.fill(action.target, action.value);
            return;
        case "press":
            await session.press(action.target, action.key);
            return;
        case "wait":
            await session.waitForTimeout(action.durationMs);
            return;
        case "check":
            await session.click(action.target);
            return;
        case "uncheck":
            await session.click(action.target);
            return;
        default:
            return;
    }
};
const applyGeneratedExpectation = async (session, step, context) => {
    const expectation = parseExpectedResult(step, context);
    if (!expectation) {
        return;
    }
    if (expectation.kind === "url") {
        await session.waitForUrl(expectation.expected);
        return;
    }
    if (expectation.kind === "visible") {
        await session.expectVisible(expectation.target);
        return;
    }
    await session.expectText(expectation.target, expectation.expected);
};
const buildBindings = (session, context, captures, envelope) => {
    const capture = (parameter, value) => {
        const normalizedKey = normalizeKey(parameter);
        if (!normalizedKey) {
            return;
        }
        const stringValue = stringifyValue(value);
        captures[normalizedKey] = stringValue;
        registerContextValue(context, normalizedKey, stringValue);
    };
    const expect = buildExpectApi();
    const providerBindings = session.bindings();
    const page = {
        goto: async (target) => providerBindings.page.goto(resolveNavigationTarget(interpolateText(target, context), envelope)),
        click: async (target) => providerBindings.page.click(interpolateText(target, context)),
        fill: async (target, value) => providerBindings.page.fill(interpolateText(target, context), interpolateText(value, context)),
        press: async (target, key) => providerBindings.page.press(interpolateText(target, context), interpolateText(key, context)),
        waitForTimeout: (ms) => providerBindings.page.waitForTimeout(ms),
        waitForURL: async (expected) => providerBindings.page.waitForURL(interpolateText(expected, context)),
        url: () => providerBindings.page.url(),
        textContent: async (target) => providerBindings.page.textContent(interpolateText(target, context)),
        locator: (target) => providerBindings.page.locator(interpolateText(target, context))
    };
    const web = {
        step: async (_title, fn) => fn(),
        goto: async (target) => session.goto(resolveNavigationTarget(interpolateText(target, context), envelope)),
        click: async (target) => session.click(interpolateText(target, context)),
        fill: async (target, value) => session.fill(interpolateText(target, context), interpolateText(value, context)),
        press: async (target, key) => session.press(interpolateText(target, context), interpolateText(key, context)),
        wait: async (ms) => session.waitForTimeout(ms),
        waitForTimeout: async (ms) => session.waitForTimeout(ms),
        expectText: async (first, second) => {
            if (second === undefined || second === null) {
                await session.expectText(null, interpolateText(first, context));
                return;
            }
            await session.expectText(interpolateText(first, context), interpolateText(second, context));
        },
        expectVisible: async (target) => session.expectVisible(interpolateText(target, context)),
        expectUrl: async (expected) => session.waitForUrl(interpolateText(expected, context)),
        text: async (target) => session.text(interpolateText(target, context)),
        value: async (target) => session.value(interpolateText(target, context)),
        resolve: (value) => interpolateText(value, context),
        capture
    };
    return {
        ...providerBindings,
        page,
        web,
        expect,
        params: toParameterValuesRecord(context),
        capture
    };
};
const executeAutomationCode = async (source, bindings) => {
    const fn = new AsyncFunction("page", "web", "expect", "params", "capture", "playwrightPage", "driver", `${source}\nreturn undefined;`);
    return fn(bindings.page, bindings.web, bindings.expect, bindings.params, bindings.capture, bindings.playwrightPage, bindings.driver);
};
const executeStepAttempt = async (session, options, captures) => {
    const bindings = buildBindings(session, options.context, captures, options.envelope);
    const source = normalizeText(options.step.automation_code || null);
    if (source) {
        await executeAutomationCode(source, bindings);
    }
    else {
        await applyGeneratedAction(session, options.step, options.context, options.envelope);
        await applyGeneratedExpectation(session, options.step, options.context);
    }
};
const buildStepNote = ({ step, provider, captures, recoveryAttempted, recoverySucceeded, error }) => {
    const lines = [
        `${titleCaseLabel(step.action || `Step ${step.order}`)} (${provider})`
    ];
    if (step.expected_result) {
        lines.push(`Expected: ${step.expected_result}`);
    }
    if (recoveryAttempted) {
        lines.push(recoverySucceeded ? "Recovery: fallback retry succeeded." : "Recovery: fallback retry did not recover the step.");
    }
    Object.entries(captures).forEach(([key, value]) => {
        lines.push(`Capture ${key} = ${value}`);
    });
    if (error) {
        lines.push(`Error: ${error.message}`);
    }
    return lines.join("\n");
};
export const createWebRunSession = (envelope, capturedValues = {}) => {
    const session = createWebSession(envelope);
    const context = buildInitialContext(envelope, capturedValues);
    return {
        provider: session.provider,
        context,
        start: async () => {
            await session.start();
            const baseUrl = normalizeText(envelope.environment?.base_url || null);
            if (baseUrl) {
                await session.goto(baseUrl);
            }
        },
        stop: async () => session.stop(),
        runStep: async (step) => {
            const captures = {};
            let recoveryAttempted = false;
            let recoverySucceeded = false;
            let finalError = null;
            const diagnosticsMarker = session.markDiagnostics();
            const startedAtMs = Date.now();
            const collectWebDetail = () => session.collectDiagnostics(diagnosticsMarker, captures, Math.max(Date.now() - startedAtMs, 0));
            try {
                await executeStepAttempt(session, { step, context, envelope }, captures);
                return {
                    status: "passed",
                    note: buildStepNote({
                        step,
                        provider: session.provider,
                        captures,
                        recoveryAttempted,
                        recoverySucceeded
                    }),
                    captures,
                    web_detail: await collectWebDetail(),
                    recovery_attempted: recoveryAttempted,
                    recovery_succeeded: recoverySucceeded
                };
            }
            catch (error) {
                finalError = error instanceof Error ? error : new Error(String(error || "Web automation step failed"));
            }
            const maxRepairAttempts = Math.max(0, envelope.max_repair_attempts || 0);
            for (let attempt = 1; attempt <= maxRepairAttempts; attempt += 1) {
                recoveryAttempted = true;
                try {
                    await session.waitForTimeout(750 * attempt);
                    await executeStepAttempt(session, { step, context, envelope }, captures);
                    recoverySucceeded = true;
                    return {
                        status: "passed",
                        note: buildStepNote({
                            step,
                            provider: session.provider,
                            captures,
                            recoveryAttempted,
                            recoverySucceeded
                        }),
                        captures,
                        web_detail: await collectWebDetail(),
                        evidence: await session.screenshot(`step-${step.order}-recovered`),
                        recovery_attempted: recoveryAttempted,
                        recovery_succeeded: recoverySucceeded
                    };
                }
                catch (error) {
                    finalError = error instanceof Error ? error : new Error(String(error || "Web automation recovery failed"));
                }
            }
            return {
                status: "failed",
                note: buildStepNote({
                    step,
                    provider: session.provider,
                    captures,
                    recoveryAttempted,
                    recoverySucceeded,
                    error: finalError
                }),
                captures,
                web_detail: await collectWebDetail(),
                evidence: await session.screenshot(`step-${step.order}-failed`),
                recovery_attempted: recoveryAttempted,
                recovery_succeeded: recoverySucceeded
            };
        }
    };
};
