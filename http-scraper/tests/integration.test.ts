import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import {
  BrowserSession,
  RequestsCookieJar,
  Response,
  Session,
  type BrowserEngine,
} from "../src/index.ts";

test("session persists cookies across requests through the bridge", async () => {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/set-cookie") {
      res.setHeader("Set-Cookie", "session_id=abc123; Path=/");
      res.end("cookie set");
      return;
    }

    if (req.url === "/echo-cookie") {
      res.end(String(req.headers.cookie || ""));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const session = new Session({ browser: "firefox", version: 132, os: "lin" });

  try {
    const first = await session.get(`${baseUrl}/set-cookie`);
    assert.equal(first.cookies.get("session_id"), "abc123");
    assert.equal(session.cookies.get("session_id"), "abc123");

    const second = await session.get(`${baseUrl}/echo-cookie`);
    assert.match(second.text, /session_id=abc123/);
  } finally {
    session.close();
    server.close();
    await once(server, "close");
  }
});

test("multipart upload sends fields and file payloads", async () => {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      method: req.method,
      contentType: req.headers["content-type"] || "",
      body: Buffer.concat(chunks).toString("utf8"),
    }));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const session = new Session({ browser: "chrome", version: 120, os: "lin" });

  try {
    const response = await session.post(`${baseUrl}/upload`, {
      data: { category: "docs", tags: ["a", "b"] },
      files: {
        file: ["hello.txt", Buffer.from("hello world"), "text/plain"],
      },
    });

    const payload = response.json<{ method: string; contentType: string; body: string }>();
    assert.equal(payload.method, "POST");
    assert.match(payload.contentType, /^multipart\/form-data; boundary=/);
    assert.match(payload.body, /name="category"/);
    assert.match(payload.body, /docs/);
    assert.match(payload.body, /name="tags"/);
    assert.match(payload.body, /filename="hello.txt"/);
    assert.match(payload.body, /hello world/);
  } finally {
    session.close();
    server.close();
    await once(server, "close");
  }
});

test("browser session works with a supplied engine and syncs cookies back on close", async () => {
  class FakePage {
    currentUrl = "about:blank";
    html = "<html><head><title>Browser Test</title></head><body><button id='go'>Go</button></body></html>";
    closed = false;
    keyboard = {
      type: async () => undefined,
      down: async () => undefined,
      up: async () => undefined,
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

    locator(_selector: string) {
      return {
        isVisible: async () => true,
        isEnabled: async () => true,
        dragTo: async () => undefined,
        screenshot: async () => Buffer.from("locator-shot"),
      };
    }

    async waitForLoadState() {
      return undefined;
    }

    async waitForFunction() {
      return undefined;
    }

    async waitForSelector() {
      return undefined;
    }

    async waitForURL() {
      return undefined;
    }

    async click() {
      return undefined;
    }

    async hover() {
      return undefined;
    }

    async evaluate() {
      return "ok";
    }

    async screenshot() {
      return Buffer.from("page-shot");
    }

    async goForward() {
      return { status: () => 204 };
    }

    async goBack() {
      return { status: () => 204 };
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

    async addCookies(cookies: Array<Record<string, unknown>>) {
      this.addedCookies.push(...cookies);
    }

    async cookies() {
      return this.browserCookies;
    }

    async newPage() {
      return this.page;
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

  browser.setHeaders({ "user-agent": "Browser Test UA" });
  await browser.goto("https://example.com/dashboard");
  const html = await browser.html;

  assert.equal(browser.resp, response);
  assert.equal(browser.headers["user-agent"], "Browser Test UA");
  assert.equal(html.find("title")?.text.trim(), "Browser Test");
  assert.equal(engine.context.addedCookies.length > 0, true);
  assert.equal(engine.lastConfig?.ignoreHTTPSErrors, false);

  await browser.shutdown();

  assert.equal(engine.stopped, false);
  assert.equal(engine.context.page.closed, true);
  assert.equal(engine.context.closed, true);
  assert.equal(session.cookies.get("browser_cookie"), "synced");
  assert.equal(response.cookies.get("browser_cookie"), "synced");
  assert.equal(response.url, "https://example.com/dashboard");
  assert.equal(response.status_code, 200);
  assert.match(response.text, /Browser Test/);
});

test("html.next(fetch=true) uses a temporary session when none is attached", async () => {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/page-2") {
      res.end("<html><head><title>Page 2</title></head><body>done</body></html>");
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine test server address");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const html = new Response({
    url: `${baseUrl}/page-1`,
    status_code: 200,
    headers: new (await import("../src/index.ts")).CaseInsensitiveDict(),
    cookies: new RequestsCookieJar(),
    raw: Buffer.from(`
      <html>
        <body>
          <a class="next" href="/page-2">Next page</a>
        </body>
      </html>
    `),
  }).html;

  try {
    const nextHtml = await html.next(true);
    assert.equal(nextHtml?.find("title")?.text.trim(), "Page 2");
  } finally {
    server.close();
    await once(server, "close");
  }
});
