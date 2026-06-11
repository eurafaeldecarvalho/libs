import { STATUS_CODES } from "node:http";

import type { BrowserContext, Page, Response as PlaywrightResponse } from "playwright-core";

import { HTML } from "../html/parser.js";
import { CaseInsensitiveDict } from "../core/case-insensitive-dict.js";
import { mergeCookies, RequestsCookieJar } from "../core/cookies.js";
import { CacheDisabledError, JavascriptException } from "../core/errors.js";
import { Response } from "../core/response.js";
import { BaseProxy } from "../core/proxies.js";
import { Session, type RequestOptions, type SessionConstructorOptions, type TLSSession } from "../core/session.js";
import { BrowserEngine, type BrowserLaunchConfig, type EngineBrowserName } from "./browser-engine.js";

type BrowserSessionOptions = {
  session?: TLSSession | null;
  response?: Response | null;
  version?: number;
  proxy?: string | BaseProxy | null;
  mock_human?: boolean;
  os?: SessionConstructorOptions["os"];
  engine?: BrowserEngine;
  browser?: EngineBrowserName;
  verify?: boolean;
  headless?: boolean;
  executablePath?: string;
  enable_cache?: boolean;
};

type BrowserRequestOptions = {
  params?: Record<string, string | number | boolean> | URLSearchParams | string;
  data?: unknown;
  headers?: Record<string, string> | CaseInsensitiveDict<string>;
  form?: Record<string, string | number | boolean>;
  multipart?: FormData | Record<string, string | number | boolean | { name: string; mimeType: string; buffer: Buffer }>;
  timeout?: number;
  verify?: boolean;
  max_redirects?: number;
};

export class BrowserSession {
  static async create(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
    const session = new BrowserSession(options);
    await session.initialize();
    return session;
  }

  readonly session: TLSSession | null;
  readonly browser: EngineBrowserName;
  readonly verify: boolean;
  readonly mock_human: boolean;
  readonly os: SessionConstructorOptions["os"];
  readonly enable_cache: boolean;

  private readonly tempEngine: boolean;
  private readonly engine: BrowserEngine;
  private readonly proxy: string | null;
  private readonly executablePath: string | undefined;
  private readonly headless: boolean;

  private responseValue: Response | null;
  private customHeaders: Record<string, string> | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private statusCode: number | null;
  private closed = false;

  private contentValue = "";
  private cookiesValue = new RequestsCookieJar();
  private userAgentValue = "Mozilla/5.0";

  private constructor(options: BrowserSessionOptions) {
    this.session = options.session || null;
    this.responseValue = options.response || null;
    this.browser = options.browser || "firefox";
    this.verify = options.verify ?? true;
    this.mock_human = options.mock_human ?? false;
    this.os = options.os;
    this.enable_cache = options.enable_cache ?? true;
    this.engine = options.engine || new BrowserEngine(this.browser);
    this.tempEngine = !options.engine;
    this.proxy = normalizeProxy(options.proxy);
    this.executablePath = options.executablePath;
    this.headless = options.headless ?? true;
    this.statusCode = this.responseValue?.status_code ?? null;
  }

  private async initialize(): Promise<void> {
    const launchConfig: BrowserLaunchConfig = {
      browser: this.browser,
      headless: this.headless,
    };

    if (this.executablePath) {
      launchConfig.executablePath = this.executablePath;
    }

    if (this.proxy) {
      launchConfig.proxy = parseProxy(this.proxy)!;
    }

    this.context = await this.engine.newContext({
      ...launchConfig,
      ignoreHTTPSErrors: !this.verify,
      ...(this.session ? { extraHTTPHeaders: this.session.headers.toJSON() } : {}),
    });

    if (this.session) {
      const cookies = this.session.cookies.toList().map((cookie) => toPlaywrightCookie(cookie, this.responseValue?.url));
      if (cookies.length > 0) {
        await this.context.addCookies(cookies);
      }
    }

    this.page = await this.context.newPage();
    await this.refreshSnapshot();
  }

  private async refreshSnapshot(): Promise<void> {
    if (!this.page || !this.context) {
      return;
    }

    this.contentValue = await this.page.content();
    this.cookiesValue = new RequestsCookieJar((await this.context.cookies()).map(fromPlaywrightCookie));

    try {
      this.userAgentValue = String(await this.page.evaluate("navigator.userAgent"));
    } catch {
      this.userAgentValue = this.customHeaders?.["user-agent"] || this.customHeaders?.["User-Agent"] || this.userAgentValue;
    }
  }

  get response(): Response | null {
    return this.responseValue;
  }

  get resp(): Response | null {
    return this.responseValue;
  }

  get url(): string {
    return this.page?.url() || this.responseValue?.url || "about:blank";
  }

  set url(url: string) {
    void this.goto(url);
  }

  get headers(): CaseInsensitiveDict<string> {
    if (this.customHeaders) {
      return createHeaderView(this.customHeaders);
    }

    if (this.userAgentValue) {
      return createHeaderView({ "user-agent": this.userAgentValue });
    }

    const sessionHeaders = this.session?.headers.toJSON();
    if (sessionHeaders) {
      return createHeaderView(sessionHeaders as Record<string, string>);
    }

    return createHeaderView({});
  }

  set headers(headers: Record<string, string> | CaseInsensitiveDict<string>) {
    this.setHeaders(headers instanceof CaseInsensitiveDict ? headers.toJSON() : headers);
  }

  get reason(): string {
    return this.statusCode ? STATUS_CODES[this.statusCode] || "" : "";
  }

  get status_code(): number | null {
    return this.statusCode;
  }

  get content(): string {
    return this.contentValue;
  }

  get text(): string {
    return this.contentValue;
  }

  get html(): HTML {
    return new HTML({
      session: this as unknown as TLSSession,
      url: this.url,
      html: this.contentValue,
      br_session: this as any,
    });
  }

  get cookies(): RequestsCookieJar {
    return this.cookiesValue.copy();
  }

  set cookies(cookieJar: RequestsCookieJar) {
    this.setCookies(cookieJar);
  }

  get proxies(): { all: string | null } {
    return { all: this.proxy };
  }

  set proxies(_: Record<string, unknown>) {
    throw new Error("Cannot set proxies on a browser session");
  }

  find(...args: Parameters<HTML["find"]>): ReturnType<HTML["find"]> {
    return this.html.find(...args);
  }

  find_all(...args: Parameters<HTML["find_all"]>): ReturnType<HTML["find_all"]> {
    return this.html.find_all(...args);
  }

  async goto(url: string): Promise<PlaywrightResponse | null> {
    const response = await this.ensurePage().goto(url);
    this.statusCode = response?.status() ?? this.statusCode;
    await this.refreshSnapshot();
    return response;
  }

  async forward(): Promise<PlaywrightResponse | null> {
    if (this.browser === "firefox" && !this.enable_cache) {
      throw new CacheDisabledError("When enable_cache is false, you cannot go forward.");
    }

    const response = await this.ensurePage().goForward();
    this.statusCode = response?.status() ?? this.statusCode;
    await this.refreshSnapshot();
    return response;
  }

  async back(): Promise<PlaywrightResponse | null> {
    if (this.browser === "firefox" && !this.enable_cache) {
      throw new CacheDisabledError("When enable_cache is false, you cannot go back.");
    }

    const response = await this.ensurePage().goBack();
    this.statusCode = response?.status() ?? this.statusCode;
    await this.refreshSnapshot();
    return response;
  }

  async awaitNavigation(timeout = 30): Promise<void> {
    await this.ensurePage().waitForLoadState("load", { timeout: timeout * 1_000 });
  }

  async awaitScript(script: string, arg?: string, timeout = 30): Promise<void> {
    await this.ensurePage().waitForFunction(script, arg, { timeout: timeout * 1_000 });
  }

  async awaitSelector(selector: string, options: { timeout?: number } = {}): Promise<void> {
    await this.ensurePage().waitForSelector(selector, {
      state: "attached",
      timeout: (options.timeout ?? 30) * 1_000,
    });
  }

  async awaitEnabled(selector: string, options: { timeout?: number } = {}): Promise<void> {
    await this.ensurePage().waitForFunction(
      "(currentSelector) => { const element = document.querySelector(currentSelector); return !!element && !element.disabled; }",
      selector,
      { timeout: (options.timeout ?? 30) * 1_000 },
    );
  }

  async isVisible(selector: string): Promise<boolean> {
    try {
      return await this.ensurePage().locator(selector).isVisible();
    } catch {
      return false;
    }
  }

  async isEnabled(selector: string): Promise<boolean> {
    try {
      return await this.ensurePage().locator(selector).isEnabled();
    } catch {
      return false;
    }
  }

  async awaitUrl(url: string | RegExp | ((currentUrl: string) => boolean), timeout = 30): Promise<void> {
    if (typeof url === "function") {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeout * 1_000) {
        if (url(this.url)) {
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      throw new Error(`Timeout waiting for URL match after ${timeout}s`);
    }

    await this.ensurePage().waitForURL(url, { timeout: timeout * 1_000 });
  }

  async dragTo(source: string, target: string, options: { timeout?: number } = {}): Promise<void> {
    await this.ensurePage().locator(source).dragTo(this.ensurePage().locator(target), {
      timeout: (options.timeout ?? 30) * 1_000,
    });
  }

  async type(selector: string, text: string, delay = 50, options: { timeout?: number } = {}): Promise<void> {
    await this.ensurePage().click(selector, { timeout: (options.timeout ?? 30) * 1_000 });

    for (const character of text) {
      await this.ensurePage().keyboard.type(character, {
        delay: this.mock_human ? randomBetween(delay * 0.5, delay * 1.5) : delay,
      });
    }
  }

  async click(
    selector: string,
    button: "left" | "right" | "middle" = "left",
    count = 1,
    options: { timeout?: number; wait_after?: boolean } = {},
  ): Promise<void> {
    await this.ensurePage().click(selector, {
      button,
      clickCount: count,
      timeout: (options.timeout ?? 30) * 1_000,
      noWaitAfter: !(options.wait_after ?? true),
    });
  }

  async hover(
    selector: string,
    modifiers?: Array<"Alt" | "Control" | "Meta" | "Shift">,
    options: { timeout?: number } = {},
  ): Promise<void> {
    if (modifiers) {
      for (const modifier of modifiers) {
        await this.ensurePage().keyboard.down(modifier);
      }
    }

    try {
      await this.ensurePage().hover(selector, {
        timeout: (options.timeout ?? 90) * 1_000,
      });
    } finally {
      if (modifiers) {
        for (const modifier of modifiers.reverse()) {
          await this.ensurePage().keyboard.up(modifier);
        }
      }
    }
  }

  async evaluate(script: string, arg?: string): Promise<unknown> {
    try {
      return await this.ensurePage().evaluate(script, arg);
    } catch (error) {
      throw new JavascriptException(error instanceof Error ? error.message : String(error));
    }
  }

  async screenshot(selectorOrPath?: string, path?: string, full_page = false): Promise<Buffer> {
    if (selectorOrPath && path) {
      return this.ensurePage().locator(selectorOrPath).screenshot({ path });
    }

    const resolvedPath = selectorOrPath && !looksLikeSelector(selectorOrPath) ? selectorOrPath : path;
    return this.ensurePage().screenshot({
      ...(resolvedPath ? { path: resolvedPath } : {}),
      fullPage: full_page,
    });
  }

  async request(
    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD",
    url: string,
    options: BrowserRequestOptions = {},
  ): Promise<Response> {
    const fetchResponse = await this.ensureContext().request.fetch(url, {
      ...(options.params !== undefined ? { params: options.params } : {}),
      ...(options.data !== undefined ? { data: options.data } : {}),
      ...(options.headers ? { headers: normalizeStringHeaders(options.headers) } : {}),
      ...(options.form ? { form: options.form } : {}),
      ...(options.multipart ? { multipart: options.multipart } : {}),
      ...(options.timeout !== undefined ? { timeout: options.timeout * 1_000 } : {}),
      ...(options.verify !== undefined ? { ignoreHTTPSErrors: !options.verify } : {}),
      ...(options.max_redirects !== undefined ? { maxRedirects: options.max_redirects } : {}),
      method: method.toLowerCase(),
      failOnStatusCode: false,
    });

    const body = await fetchResponse.body();
    await this.refreshSnapshot();
    const response = new Response({
      url: getApiResponseUrl(fetchResponse),
      status_code: getApiResponseStatus(fetchResponse),
      headers: new CaseInsensitiveDict(getApiResponseHeaders(fetchResponse)),
      cookies: this.cookies,
      raw: body,
      session: this.session,
    });
    await fetchResponse.dispose();
    return response;
  }

  async get(url: string, options: RequestOptions = {}): Promise<Response> {
    return this.browserRequest("GET", url, options);
  }

  async post(url: string, options: RequestOptions = {}): Promise<Response> {
    return this.browserRequest("POST", url, options);
  }

  async put(url: string, options: RequestOptions = {}): Promise<Response> {
    return this.browserRequest("PUT", url, options);
  }

  async patch(url: string, options: RequestOptions = {}): Promise<Response> {
    return this.browserRequest("PATCH", url, options);
  }

  async delete(url: string, options: RequestOptions = {}): Promise<Response> {
    return this.browserRequest("DELETE", url, options);
  }

  async head(url: string, options: RequestOptions = {}): Promise<Response> {
    return this.browserRequest("HEAD", url, options);
  }

  setHeaders(headers: Record<string, string>): void {
    this.customHeaders = { ...headers };
    const context = this.ensureContext() as BrowserContext & {
      setExtraHTTPHeaders?: (headers: Record<string, string>) => Promise<void> | void;
    };
    const maybePromise = context.setExtraHTTPHeaders?.(this.customHeaders);
    void Promise.resolve(maybePromise);
  }

  setCookies(cookieJar: RequestsCookieJar): void {
    this.cookiesValue = cookieJar.copy();
    const currentUrl = this.url;
    const entries = cookieJar.toList().map((cookie) => toPlaywrightCookie(cookie, currentUrl));
    const maybePromise = this.ensureContext().addCookies(entries);
    void Promise.resolve(maybePromise);
  }

  loadText(text: string): void {
    this.contentValue = text;
    void Promise.resolve(this.ensurePage().setContent(text)).then(() => this.refreshSnapshot());
  }

  async run<T>(fn: (page: Page, ...args: unknown[]) => Promise<T> | T, ...args: unknown[]): Promise<T> {
    return fn(this.ensurePage(), ...args);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.refreshSnapshot();

    if (this.session) {
      mergeCookies(this.session.cookies, this.cookiesValue);
    }

    if (this.responseValue) {
      mergeCookies(this.responseValue.cookies, this.cookiesValue);
      this.responseValue.url = this.url;
      this.responseValue.raw = Buffer.from(this.contentValue);
      this.responseValue.status_code = this.statusCode ?? this.responseValue.status_code;
    }

    await this.page?.close().catch(() => undefined);
    await this.context?.close().catch(() => undefined);

    if (this.tempEngine) {
      await this.engine.stop();
    }
  }

  async shutdown(): Promise<void> {
    await this.close();
  }

  private async browserRequest(method: string, url: string, options: RequestOptions): Promise<Response> {
    const headers = this.headers;
    const session = this.session || new Session({
      browser: this.browser,
      ...(this.os ? { os: this.os } : {}),
      headers: headers.toJSON() as Record<string, string>,
      temp: true,
    });

    session.headers = headers;
    mergeCookies(session.cookies, this.cookiesValue);
    const optionHeaders = normalizeHeaders(options.headers);
    const response = await session.executeRequest(method, url, {
      ...options,
      headers: {
        ...headers.toJSON(),
        ...optionHeaders,
      },
      cookies: session.cookies,
    });

    await this.syncCookiesFromSession(session.cookies);
    return response;
  }

  private async syncCookiesFromSession(cookies: RequestsCookieJar): Promise<void> {
    this.cookiesValue = cookies.copy();
    const currentUrl = this.url;
    const entries = cookies.toList().map((cookie) => toPlaywrightCookie(cookie, currentUrl));
    if (entries.length > 0) {
      await this.ensureContext().addCookies(entries);
    }
  }

  private ensurePage(): Page {
    if (!this.page) {
      throw new Error("BrowserSession page is not initialized");
    }

    return this.page;
  }

  private ensureContext(): BrowserContext {
    if (!this.context) {
      throw new Error("BrowserSession context is not initialized");
    }

    return this.context;
  }
}

export async function render(url: string, options: BrowserSessionOptions = {}): Promise<BrowserSession> {
  const session = await BrowserSession.create(options);
  await session.goto(options.response?.url || url);
  return session;
}

function normalizeProxy(proxy?: string | BaseProxy | null): string | null {
  if (!proxy) {
    return null;
  }

  return proxy instanceof BaseProxy ? proxy.toString() : proxy;
}

function parseProxy(proxy: string): BrowserLaunchConfig["proxy"] {
  const parsed = new URL(proxy);
  return compactObject({
    server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
  }) as BrowserLaunchConfig["proxy"];
}

function toPlaywrightCookie(
  cookie: ReturnType<RequestsCookieJar["toList"]>[number],
  currentUrl?: string,
): Parameters<BrowserContext["addCookies"]>[0][number] {
  const fallback = currentUrl ? new URL(currentUrl) : null;
  return compactObject({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain || fallback?.hostname || "localhost",
    path: cookie.path || "/",
    expires: cookie.expires ?? -1,
    httpOnly: cookie.httpOnly ?? false,
    secure: cookie.secure ?? false,
    sameSite: cookie.sameSite,
  }) as Parameters<BrowserContext["addCookies"]>[0][number];
}

function fromPlaywrightCookie(
  cookie: Awaited<ReturnType<BrowserContext["cookies"]>>[number],
): ReturnType<RequestsCookieJar["toList"]>[number] {
  return compactObject({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires && cookie.expires > 0 ? cookie.expires : undefined,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
  }) as ReturnType<RequestsCookieJar["toList"]>[number];
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function looksLikeSelector(value: string): boolean {
  return /^[.#\[]|^[a-z]+[.#\[]?/i.test(value);
}

function normalizeHeaders(headers: RequestOptions["headers"]): Record<string, string | string[]> {
  if (!headers) {
    return {};
  }

  if (headers instanceof CaseInsensitiveDict) {
    return headers.toJSON() as Record<string, string | string[]>;
  }

  return headers;
}

function normalizeStringHeaders(
  headers: Record<string, string> | CaseInsensitiveDict<string>,
): Record<string, string> {
  const normalized = headers instanceof CaseInsensitiveDict ? headers.toJSON() : headers;
  return Object.fromEntries(Object.entries(normalized).map(([key, value]) => [key, String(value)]));
}

function getApiResponseUrl(response: { url: string } | { url(): string }): string {
  return typeof response.url === "function" ? response.url() : response.url;
}

function getApiResponseStatus(response: { status: number } | { status(): number }): number {
  return typeof response.status === "function" ? response.status() : response.status;
}

function getApiResponseHeaders(
  response: { headers: Record<string, string> } | { headers(): Record<string, string> },
): Record<string, string> {
  return typeof response.headers === "function" ? response.headers() : response.headers;
}

function createHeaderView(headers: Record<string, string>): CaseInsensitiveDict<string> {
  const dict = new CaseInsensitiveDict(headers) as CaseInsensitiveDict<string> & Record<string, string>;
  for (const [key, value] of Object.entries(headers)) {
    dict[key] = value;
    dict[key.toLowerCase()] = value;
  }

  return dict;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
