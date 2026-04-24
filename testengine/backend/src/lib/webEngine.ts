import { Builder, By, Key, until, type WebDriver, type WebElement } from "selenium-webdriver";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page
} from "playwright";
import type { EngineRunEnvelope, EngineRunStep, EngineWebEngineProvider } from "../contracts/qaira.js";
import {
  buildInitialContext,
  interpolateText,
  normalizeKey,
  normalizeText,
  registerContextValue,
  stringifyValue,
  toParameterValuesRecord,
  type RuntimeExecutionContext
} from "./runtimeContext.js";

type StepEvidence = {
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
};

type WebStepExecutionResult = {
  status: "passed" | "failed";
  note: string;
  captures: Record<string, string>;
  evidence?: StepEvidence | null;
  recovery_attempted: boolean;
  recovery_succeeded: boolean;
};

type StepExecutionOptions = {
  step: EngineRunStep;
  context: RuntimeExecutionContext;
  envelope: EngineRunEnvelope;
};

type PageLocatorFacade = {
  click: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  press: (key: string) => Promise<void>;
  textContent: () => Promise<string>;
  isVisible: () => Promise<boolean>;
  getAttribute: (name: string) => Promise<string | null>;
};

type PageFacade = {
  goto: (url: string) => Promise<void>;
  click: (target: string) => Promise<void>;
  fill: (target: string, value: string) => Promise<void>;
  press: (target: string, key: string) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForURL: (expected: string) => Promise<void>;
  url: () => Promise<string>;
  textContent: (target: string) => Promise<string>;
  locator: (target: string) => PageLocatorFacade;
};

type ExpectationApi = ((actual: unknown) => {
  toBe: (expected: unknown) => void;
  toContain: (expected: unknown) => void;
  toBeTruthy: () => void;
}) & {
  equal: (actual: unknown, expected: unknown, label?: string) => void;
  truthy: (actual: unknown, label?: string) => void;
  contains: (actual: unknown, expected: unknown, label?: string) => void;
};

type WebExecutionBindings = {
  page: PageFacade;
  web: Record<string, unknown>;
  expect: ExpectationApi;
  params: Record<string, string>;
  capture: (parameter: string, value: unknown) => void;
  playwrightPage?: Page;
  driver?: WebDriver;
};

type WebSession = {
  readonly provider: EngineWebEngineProvider;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  goto: (target: string) => Promise<void>;
  click: (target: string) => Promise<void>;
  fill: (target: string, value: string) => Promise<void>;
  press: (target: string | null, key: string) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  waitForUrl: (expected: string) => Promise<void>;
  expectVisible: (target: string) => Promise<void>;
  expectText: (target: string | null, expected: string) => Promise<void>;
  text: (target: string) => Promise<string>;
  value: (target: string) => Promise<string>;
  screenshot: (label: string) => Promise<StepEvidence>;
  bindings: () => Pick<WebExecutionBindings, "page" | "playwrightPage" | "driver">;
};

type ParsedAction =
  | { kind: "goto"; target: string }
  | { kind: "click"; target: string }
  | { kind: "fill"; target: string; value: string }
  | { kind: "press"; target: string | null; key: string }
  | { kind: "wait"; durationMs: number }
  | { kind: "check"; target: string }
  | { kind: "uncheck"; target: string };

type ParsedExpectation =
  | { kind: "url"; expected: string }
  | { kind: "visible"; target: string }
  | { kind: "text"; target: string | null; expected: string };

const DEFAULT_SELENIUM_GRID_URL = String(process.env.SELENIUM_GRID_URL || "http://127.0.0.1:4444/wd/hub").trim();
const SELENIUM_BROWSER_MAP: Record<string, string> = {
  chromium: "chrome",
  firefox: "firefox",
  webkit: "MicrosoftEdge"
};

const AsyncFunction = Object.getPrototypeOf(async function () {
  return undefined;
}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

const PLAYWRIGHT_BROWSER_MAP = {
  chromium,
  firefox,
  webkit
} as const;

const normalizeProvider = (value: string | null | undefined): EngineWebEngineProvider =>
  value === "selenium" ? "selenium" : "playwright";

const normalizeBrowser = (value: string | null | undefined) => {
  const normalized = normalizeText(value)?.toLowerCase() || "chromium";

  if (normalized === "firefox") {
    return "firefox" as const;
  }

  if (normalized === "webkit" || normalized === "safari") {
    return "webkit" as const;
  }

  return "chromium" as const;
};

const stripWrappingQuotes = (value: string) => value.replace(/^["'`]+|["'`]+$/g, "").trim();

const escapeXPathLiteral = (value: string) => {
  if (!value.includes("'")) {
    return `'${value}'`;
  }

  if (!value.includes("\"")) {
    return `"${value}"`;
  }

  return `concat(${value.split("'").map((part) => `'${part}'`).join(`, "\"'\"", `)})`;
};

const extractQuotedText = (value: string) => {
  const match = value.match(/["'`](.+?)["'`]/);
  return match ? match[1].trim() : null;
};

const extractUrlCandidate = (value: string) => {
  const urlMatch = value.match(/https?:\/\/[^\s]+/i);

  if (urlMatch?.[0]) {
    return urlMatch[0];
  }

  const pathMatch = value.match(/(?:open|navigate|go|visit)\s+(?:to\s+)?(\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/i);
  return pathMatch?.[1] || null;
};

const titleCaseLabel = (value: string) => value.replace(/\s+/g, " ").trim();

const buildExpectApi = (): ExpectationApi => {
  const api = ((actual: unknown) => ({
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${stringifyValue(actual)} to equal ${stringifyValue(expected)}`);
      }
    },
    toContain(expected: unknown) {
      if (!String(actual ?? "").includes(String(expected ?? ""))) {
        throw new Error(`Expected ${stringifyValue(actual)} to contain ${stringifyValue(expected)}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected ${stringifyValue(actual)} to be truthy`);
      }
    }
  })) as ExpectationApi;

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

const resolveNavigationTarget = (target: string, envelope: EngineRunEnvelope) => {
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

const parseActionText = (step: EngineRunStep, context: RuntimeExecutionContext): ParsedAction | null => {
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

const parseExpectedResult = (step: EngineRunStep, context: RuntimeExecutionContext): ParsedExpectation | null => {
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

const candidateTokens = (target: string) => {
  const trimmed = stripWrappingQuotes(target);
  const quoted = extractQuotedText(trimmed);
  const fallback = quoted || trimmed;

  return {
    raw: trimmed,
    text: fallback
  };
};

const createPlaywrightLocatorFacade = (resolver: (target: string) => Promise<import("playwright").Locator>, target: string): PageLocatorFacade => ({
  click: async () => {
    const locator = await resolver(target);
    await locator.click();
  },
  fill: async (value: string) => {
    const locator = await resolver(target);
    await locator.fill(value);
  },
  press: async (key: string) => {
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
  getAttribute: async (name: string) => {
    const locator = await resolver(target);
    return locator.getAttribute(name);
  }
});

class PlaywrightWebSession implements WebSession {
  readonly provider: EngineWebEngineProvider = "playwright";
  private browser: Browser | null = null;
  private browserContext: BrowserContext | null = null;
  private browserPage: Page | null = null;

  constructor(private readonly envelope: EngineRunEnvelope) {}

  private get pageOrThrow() {
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
  }

  async stop() {
    await this.browserContext?.close();
    await this.browser?.close();
    this.browserContext = null;
    this.browser = null;
    this.browserPage = null;
  }

  private async resolveLocator(target: string) {
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

    let lastError: unknown = null;

    for (const candidate of fallbackCandidates) {
      try {
        const locator = candidate();
        await locator.waitFor({ state: "visible", timeout: 1500 });
        return locator;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${tokens.text}" in the browser page`);
  }

  async goto(target: string) {
    await this.pageOrThrow.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(30_000, this.envelope.run_timeout_seconds * 1000)
    });
  }

  async click(target: string) {
    const locator = await this.resolveLocator(target);
    await locator.click();
  }

  async fill(target: string, value: string) {
    const locator = await this.resolveLocator(target);
    await locator.fill(value);
  }

  async press(target: string | null, key: string) {
    if (!target) {
      await this.pageOrThrow.keyboard.press(key);
      return;
    }

    const locator = await this.resolveLocator(target);
    await locator.press(key);
  }

  async waitForTimeout(ms: number) {
    await this.pageOrThrow.waitForTimeout(Math.max(0, ms));
  }

  async waitForUrl(expected: string) {
    const resolved = stripWrappingQuotes(expected);
    await this.pageOrThrow.waitForURL((url) => url.toString().includes(resolved), {
      timeout: 10_000
    });
  }

  async expectVisible(target: string) {
    const locator = await this.resolveLocator(target);
    const isVisible = await locator.isVisible();

    if (!isVisible) {
      throw new Error(`Expected ${target} to be visible`);
    }
  }

  async expectText(target: string | null, expected: string) {
    if (!target) {
      await this.pageOrThrow.getByText(expected, { exact: false }).first().waitFor({ state: "visible", timeout: 5_000 });
      return;
    }

    const actual = await this.text(target);
    if (!actual.includes(expected)) {
      throw new Error(`Expected ${target} to contain "${expected}" but found "${actual}"`);
    }
  }

  async text(target: string) {
    const locator = await this.resolveLocator(target);
    return ((await locator.textContent()) || "").trim();
  }

  async value(target: string) {
    const locator = await this.resolveLocator(target);
    return await locator.inputValue();
  }

  async screenshot(label: string) {
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

  bindings() {
    const pageFacade: PageFacade = {
      goto: (url: string) => this.goto(url),
      click: (target: string) => this.click(target),
      fill: (target: string, value: string) => this.fill(target, value),
      press: (target: string, key: string) => this.press(target, key),
      waitForTimeout: (ms: number) => this.waitForTimeout(ms),
      waitForURL: (expected: string) => this.waitForUrl(expected),
      url: async () => this.pageOrThrow.url(),
      textContent: (target: string) => this.text(target),
      locator: (target: string) => createPlaywrightLocatorFacade((value) => this.resolveLocator(value), target)
    };

    return {
      page: pageFacade,
      playwrightPage: this.pageOrThrow
    };
  }
}

const createSeleniumLocatorFacade = (resolveElement: (target: string) => Promise<WebElement>, target: string): PageLocatorFacade => ({
  click: async () => {
    const element = await resolveElement(target);
    await element.click();
  },
  fill: async (value: string) => {
    const element = await resolveElement(target);
    await element.clear();
    await element.sendKeys(value);
  },
  press: async (key: string) => {
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
  getAttribute: async (name: string) => {
    const element = await resolveElement(target);
    return element.getAttribute(name);
  }
});

class SeleniumWebSession implements WebSession {
  readonly provider: EngineWebEngineProvider = "selenium";
  private driverInstance: WebDriver | null = null;

  constructor(private readonly envelope: EngineRunEnvelope) {}

  private get driverOrThrow() {
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

  private byStrategies(target: string) {
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

  private async resolveElement(target: string) {
    const driver = this.driverOrThrow;
    let lastError: unknown = null;

    for (const strategy of this.byStrategies(target)) {
      try {
        const matches = await driver.findElements(strategy);
        const visibleMatch = matches[0];

        if (visibleMatch) {
          return visibleMatch;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Unable to locate "${target}" in Selenium`);
  }

  async goto(target: string) {
    await this.driverOrThrow.get(target);
  }

  async click(target: string) {
    const element = await this.resolveElement(target);
    await element.click();
  }

  async fill(target: string, value: string) {
    const element = await this.resolveElement(target);
    await element.clear();
    await element.sendKeys(value);
  }

  async press(target: string | null, key: string) {
    const seleniumKey = (Key as unknown as Record<string, string>)[key.toUpperCase()] || key;

    if (!target) {
      await this.driverOrThrow.actions().sendKeys(seleniumKey).perform();
      return;
    }

    const element = await this.resolveElement(target);
    await element.sendKeys(seleniumKey);
  }

  async waitForTimeout(ms: number) {
    await this.driverOrThrow.sleep(Math.max(0, ms));
  }

  async waitForUrl(expected: string) {
    await this.driverOrThrow.wait(until.urlContains(stripWrappingQuotes(expected)), 10_000);
  }

  async expectVisible(target: string) {
    const element = await this.resolveElement(target);
    const visible = await element.isDisplayed();

    if (!visible) {
      throw new Error(`Expected ${target} to be visible`);
    }
  }

  async expectText(target: string | null, expected: string) {
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

  async text(target: string) {
    const element = await this.resolveElement(target);
    return (await element.getText()) || "";
  }

  async value(target: string) {
    const element = await this.resolveElement(target);
    return (await element.getAttribute("value")) || "";
  }

  async screenshot(label: string) {
    const base64 = await this.driverOrThrow.takeScreenshot();

    return {
      dataUrl: `data:image/png;base64,${base64}`,
      fileName: `${label}.png`,
      mimeType: "image/png"
    };
  }

  bindings() {
    const pageFacade: PageFacade = {
      goto: (url: string) => this.goto(url),
      click: (target: string) => this.click(target),
      fill: (target: string, value: string) => this.fill(target, value),
      press: (target: string, key: string) => this.press(target, key),
      waitForTimeout: (ms: number) => this.waitForTimeout(ms),
      waitForURL: (expected: string) => this.waitForUrl(expected),
      url: () => this.driverOrThrow.getCurrentUrl(),
      textContent: (target: string) => this.text(target),
      locator: (target: string) => createSeleniumLocatorFacade((value) => this.resolveElement(value), target)
    };

    return {
      page: pageFacade,
      driver: this.driverOrThrow
    };
  }
}

const createWebSession = (envelope: EngineRunEnvelope): WebSession =>
  normalizeProvider(envelope.web_engine?.active) === "selenium"
    ? new SeleniumWebSession(envelope)
    : new PlaywrightWebSession(envelope);

const applyGeneratedAction = async (
  session: WebSession,
  step: EngineRunStep,
  context: RuntimeExecutionContext,
  envelope: EngineRunEnvelope
) => {
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

const applyGeneratedExpectation = async (
  session: WebSession,
  step: EngineRunStep,
  context: RuntimeExecutionContext
) => {
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

const buildBindings = (
  session: WebSession,
  context: RuntimeExecutionContext,
  captures: Record<string, string>,
  envelope: EngineRunEnvelope
): WebExecutionBindings => {
  const capture = (parameter: string, value: unknown) => {
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
  const page: PageFacade = {
    goto: async (target: string) => providerBindings.page.goto(resolveNavigationTarget(interpolateText(target, context), envelope)),
    click: async (target: string) => providerBindings.page.click(interpolateText(target, context)),
    fill: async (target: string, value: string) => providerBindings.page.fill(interpolateText(target, context), interpolateText(value, context)),
    press: async (target: string, key: string) => providerBindings.page.press(interpolateText(target, context), interpolateText(key, context)),
    waitForTimeout: (ms: number) => providerBindings.page.waitForTimeout(ms),
    waitForURL: async (expected: string) => providerBindings.page.waitForURL(interpolateText(expected, context)),
    url: () => providerBindings.page.url(),
    textContent: async (target: string) => providerBindings.page.textContent(interpolateText(target, context)),
    locator: (target: string) => providerBindings.page.locator(interpolateText(target, context))
  };

  const web = {
    step: async (_title: string, fn: () => Promise<unknown>) => fn(),
    goto: async (target: string) => session.goto(resolveNavigationTarget(interpolateText(target, context), envelope)),
    click: async (target: string) => session.click(interpolateText(target, context)),
    fill: async (target: string, value: string) => session.fill(interpolateText(target, context), interpolateText(value, context)),
    press: async (target: string, key: string) => session.press(interpolateText(target, context), interpolateText(key, context)),
    wait: async (ms: number) => session.waitForTimeout(ms),
    waitForTimeout: async (ms: number) => session.waitForTimeout(ms),
    expectText: async (first: string, second?: string | null) => {
      if (second === undefined || second === null) {
        await session.expectText(null, interpolateText(first, context));
        return;
      }

      await session.expectText(interpolateText(first, context), interpolateText(second, context));
    },
    expectVisible: async (target: string) => session.expectVisible(interpolateText(target, context)),
    expectUrl: async (expected: string) => session.waitForUrl(interpolateText(expected, context)),
    text: async (target: string) => session.text(interpolateText(target, context)),
    value: async (target: string) => session.value(interpolateText(target, context)),
    resolve: (value: string) => interpolateText(value, context),
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

const executeAutomationCode = async (
  source: string,
  bindings: WebExecutionBindings
) => {
  const fn = new AsyncFunction(
    "page",
    "web",
    "expect",
    "params",
    "capture",
    "playwrightPage",
    "driver",
    `${source}\nreturn undefined;`
  );

  return fn(
    bindings.page,
    bindings.web,
    bindings.expect,
    bindings.params,
    bindings.capture,
    bindings.playwrightPage,
    bindings.driver
  );
};

const executeStepAttempt = async (
  session: WebSession,
  options: StepExecutionOptions,
  captures: Record<string, string>
) => {
  const bindings = buildBindings(session, options.context, captures, options.envelope);
  const source = normalizeText(options.step.automation_code || null);

  if (source) {
    await executeAutomationCode(source, bindings);
  } else {
    await applyGeneratedAction(session, options.step, options.context, options.envelope);
    await applyGeneratedExpectation(session, options.step, options.context);
  }
};

const buildStepNote = ({
  step,
  provider,
  captures,
  recoveryAttempted,
  recoverySucceeded,
  error
}: {
  step: EngineRunStep;
  provider: EngineWebEngineProvider;
  captures: Record<string, string>;
  recoveryAttempted: boolean;
  recoverySucceeded: boolean;
  error?: Error | null;
}) => {
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

export type EngineWebRunSession = {
  provider: EngineWebEngineProvider;
  context: RuntimeExecutionContext;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  runStep: (step: EngineRunStep) => Promise<WebStepExecutionResult>;
};

export const createWebRunSession = (envelope: EngineRunEnvelope, capturedValues: Record<string, string> = {}): EngineWebRunSession => {
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
    runStep: async (step: EngineRunStep) => {
      const captures: Record<string, string> = {};
      let recoveryAttempted = false;
      let recoverySucceeded = false;
      let finalError: Error | null = null;

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
          recovery_attempted: recoveryAttempted,
          recovery_succeeded: recoverySucceeded
        };
      } catch (error) {
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
            evidence: await session.screenshot(`step-${step.order}-recovered`),
            recovery_attempted: recoveryAttempted,
            recovery_succeeded: recoverySucceeded
          };
        } catch (error) {
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
        evidence: await session.screenshot(`step-${step.order}-failed`),
        recovery_attempted: recoveryAttempted,
        recovery_succeeded: recoverySucceeded
      };
    }
  };
};
