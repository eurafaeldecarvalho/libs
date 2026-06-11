import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserSession,
  CaseInsensitiveDict,
  RequestsCookieJar,
  Response,
  Session,
  type BrowserEngine,
} from "../src/index.ts";

class FakeApiResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  private readonly payload: Buffer;
  disposed = false;

  constructor(options: { url: string; status: number; headers?: Record<string, string>; payload: Buffer | string }) {
    this.url = options.url;
    this.status = options.status;
    this.headers = options.headers || {};
    this.payload = typeof options.payload === "string" ? Buffer.from(options.payload) : options.payload;
  }

  async body() {
    return this.payload;
  }

  async dispose() {
    this.disposed = true;
  }
}

class FakePage {
  currentUrl = "about:blank";
  html = "<html><head><title>Browser Test</title></head><body><button id='go'>Go</button></body></html>";
  closed = false;
  setContentCalls: string[] = [];
  clickCalls: Array<Record<string, unknown>> = [];
  hoverCalls: Array<Record<string, unknown>> = [];
  waitForLoadStateCalls: Array<Record<string, unknown>> = [];
  waitForFunctionCalls: Array<Record<string, unknown>> = [];
  waitForSelectorCalls: Array<Record<string, unknown>> = [];
  keyboard = {
    typed: [] as Array<Record<string, unknown>>,
    type: async (text: string, options?: Record<string, unknown>) => {
      this.keyboard.typed.push({ text, options });
    },
    down: async () => undefined,
    up: async () => undefined,
  };

  request = {
    fetch: async (_url: string, _options: Record<string, unknown>) => new FakeApiResponse({
      url: "https://example.com/api",
      status: 200,
      headers: { "content-type": "application/json" },
      payload: Buffer.from('{"ok":true}'),
    }),
  };

  async goto(url: string) {
    this.currentUrl = url;
    return { status: () => 200 };
  }

  url() {
    return this.currentUrl;
  }

  async content() {
    return this.html;
  }

  locator(selector: string) {
    return {
      isVisible: async () => true,
      isEnabled: async () => true,
      dragTo: async () => undefined,
      screenshot: async () => Buffer.from(`locator-shot:${selector}`),
    };
  }

  async waitForLoadState(state?: string, options?: Record<string, unknown>) {
    this.waitForLoadStateCalls.push({ state, options });
    return undefined;
  }

  async waitForFunction(script: string, arg?: unknown, options?: Record<string, unknown>) {
    this.waitForFunctionCalls.push({ script, arg, options });
    return undefined;
  }

  async waitForSelector(selector: string, options?: Record<string, unknown>) {
    this.waitForSelectorCalls.push({ selector, options });
    return undefined;
  }

  async waitForURL() {
    return undefined;
  }

  async click(selector: string, options?: Record<string, unknown>) {
    this.clickCalls.push({ selector, options });
    return undefined;
  }

  async hover(selector: string, options?: Record<string, unknown>) {
    this.hoverCalls.push({ selector, options });
    return undefined;
  }

  async evaluate(script: string) {
    if (script === "navigator.userAgent") {
      return "Mozilla/5.0 FakeBrowser/1.0";
    }

    return "ok";
  }

  async screenshot(options?: Record<string, unknown>) {
    return Buffer.from(`page-shot:${JSON.stringify(options || {})}`);
  }

  async goForward() {
    return { status: () => 204 };
  }

  async goBack() {
    return { status: () => 204 };
  }

  async setContent(value: string) {
    this.setContentCalls.push(value);
    this.html = value;
  }

  async close() {
    this.closed = true;
    return undefined;
  }
}

class FakeContext {
  addedCookies: Array<Record<string, unknown>> = [];
  page = new FakePage();
  closed = false;
  browserCookies = [
    {
      name: "browser_cookie",
      value: "synced",
      domain: "example.com",
      path: "/",
      expires: -1,
      secure: false,
      httpOnly: false,
      sameSite: "Lax" as const,
    },
  ];
  extraHeaders: Record<string, string> | null = null;

  request = {
    fetch: async (url: string, options: Record<string, unknown>) => {
      return new FakeApiResponse({
        url,
        status: 201,
        headers: { "content-type": "application/json", "x-mode": String(options.method || "GET") },
        payload: Buffer.from(JSON.stringify({ url, options })),
      });
    },
  };

  async addCookies(cookies: Array<Record<string, unknown>>) {
    this.addedCookies.push(...cookies);
  }

  async cookies() {
    return this.browserCookies;
  }

  async newPage() {
    this.page.request = this.request;
    return this.page;
  }

  async setExtraHTTPHeaders(headers: Record<string, string>) {
    this.extraHeaders = headers;
  }

  async close() {
    this.closed = true;
    return undefined;
  }
}

class FakeEngine {
  context = new FakeContext();
  stopped = false;
  lastConfig: Record<string, unknown> | null = null;

  async newContext(config: Record<string, unknown>) {
    this.lastConfig = config;
    return this.context;
  }

  async stop() {
    this.stopped = true;
  }
}

async function createBrowserHarness() {
  const session = new Session({ browser: "firefox", version: 132, os: "lin" });
  session.cookies.set("seed", "cookie", { domain: "example.com", path: "/" });

  const response = new Response({
    url: "https://example.com/start",
    status_code: 200,
    headers: session.headers.copy(),
    cookies: new RequestsCookieJar(),
    raw: Buffer.from("initial"),
  });

  const engine = new FakeEngine();
  const browser = await BrowserSession.create({
    engine: engine as unknown as BrowserEngine,
    browser: "firefox",
    session,
    response,
  });

  return {
    browser,
    engine,
    response,
    session,
    page: engine.context.page,
    context: engine.context,
  };
}

test("browser session exposes upstream-compatible aliases and sync accessors", async () => {
  const { browser, response } = await createBrowserHarness();

  try {
    await browser.goto("https://example.com/dashboard");

    assert.equal(browser.resp, response);
    assert.equal(browser.response, response);
    assert.equal(browser.url, "https://example.com/dashboard");
    assert.equal(browser.reason, "OK");
    assert.equal(browser.text.includes("Browser Test"), true);
    assert.equal(browser.content.includes("Browser Test"), true);
    assert.equal(browser.cookies.get("browser_cookie"), "synced");
    assert.equal(browser.proxies.all, null);
    assert.equal(browser.find("title")?.text.trim(), "Browser Test");
    assert.equal(browser.find_all("button").length, 1);
    assert.match(String(browser.headers.get("user-agent")), /FakeBrowser/);
  } finally {
    await browser.close();
  }
});

test("browser session can set headers, cookies, content, and run page tasks", async () => {
  const { browser, context, page } = await createBrowserHarness();

  try {
    browser.headers = new CaseInsensitiveDict({ "x-test": "1", "user-agent": "UA/2.0" });
    assert.deepEqual(context.extraHeaders, { "x-test": "1", "user-agent": "UA/2.0" });

    browser.cookies = new RequestsCookieJar([
      {
        name: "manual",
        value: "set",
        domain: "example.com",
        path: "/",
      },
    ]);
    assert.equal(context.addedCookies.some((cookie) => cookie.name === "manual"), true);

    browser.loadText("<html><head><title>Loaded</title></head><body><div id='loaded'>ok</div></body></html>");
    assert.equal(page.setContentCalls.length, 1);
    assert.equal(browser.find("title")?.text.trim(), "Loaded");

    let executedWith: unknown = null;
    await browser.run(async (nativePage, marker: string) => {
      executedWith = { nativePage, marker };
    }, "marker");

    assert.equal((executedWith as { marker: string }).marker, "marker");
  } finally {
    await browser.close();
  }
});

test("browser session request uses browser context request api and syncs cookies", async () => {
  const { browser, context } = await createBrowserHarness();

  try {
    const response = await browser.request("POST", "https://example.com/api/test", {
      params: { page: 2 },
      headers: { "x-extra": "1" },
      form: { hello: "world" },
      timeout: 12,
      verify: false,
      max_redirects: 3,
    });

    const payload = response.json<{ url: string; options: Record<string, unknown> }>();
    assert.equal(response.status_code, 201);
    assert.equal(response.url, "https://example.com/api/test");
    assert.equal(response.cookies.get("browser_cookie"), "synced");
    assert.equal(payload.options.method, "post");
    assert.deepEqual(payload.options.params, { page: 2 });
    assert.deepEqual(payload.options.form, { hello: "world" });
    assert.equal(payload.options.ignoreHTTPSErrors, true);
    assert.equal(payload.options.maxRedirects, 3);
    assert.equal(payload.options.timeout, 12000);
    assert.deepEqual(payload.options.headers, { "x-extra": "1" });
    assert.equal(context.page.request.fetch !== undefined, true);
  } finally {
    await browser.close();
  }
});

test("browser session url setter and interaction helpers follow upstream method contracts", async () => {
  const { browser, page } = await createBrowserHarness();

  try {
    browser.url = "https://example.com/from-setter";
    assert.equal(browser.url, "https://example.com/from-setter");

    await browser.awaitSelector("#go", { timeout: 5 });
    await browser.awaitEnabled("#go", { timeout: 6 });
    await browser.awaitScript("() => true", "arg", 7);
    await browser.awaitNavigation(8);
    await browser.type("#go", "abc", 10, { timeout: 9 });
    await browser.click("#go", "left", 2, { timeout: 4, wait_after: false });
    await browser.hover("#go", ["Shift"], { timeout: 3 });

    assert.equal(page.waitForSelectorCalls[0]?.selector, "#go");
    assert.match(String(page.waitForFunctionCalls[0]?.script || ""), /disabled/);
    assert.equal(page.waitForLoadStateCalls[0]?.state, "load");
    assert.equal(page.keyboard.typed.length, 3);
    const explicitClick = page.clickCalls.at(-1);
    assert.equal(explicitClick?.selector, "#go");
    assert.equal((explicitClick?.options as { clickCount?: number } | undefined)?.clickCount, 2);
    assert.equal(page.hoverCalls[0]?.selector, "#go");
  } finally {
    await browser.close();
  }
});
