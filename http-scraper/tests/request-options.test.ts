import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserException,
  BrowserTimeoutException,
  CacheDisabledError,
  ClientException,
  EnableMockHumanException,
  HTML,
  JavascriptException,
  MissingLibraryException,
  ProcessResponse,
  ProxyFormatException,
  RequestsCookieJar,
  Session,
  TLSRequest,
} from "../src/index.ts";

test("session.request normalizes params and upstream request defaults", () => {
  const session = new Session({ browser: "chrome", version: 120, os: "lin" });

  const proc = session.request("GET", "https://example.com/search", {
    params: { q: "needle", page: 2, tag: ["alpha", "beta"] },
    proxies: {
      https: "http://user:pass@proxy.example:8080",
    },
    process: false,
  }) as ProcessResponse;

  const [payload] = session.buildRequest(proc.method, proc.url, proc.options);

  assert.equal(payload.requestUrl, "https://example.com/search?q=needle&page=2&tag=alpha&tag=beta");
  assert.equal(payload.followRedirects, true);
  assert.equal(payload.wantHistory, false);
  assert.equal(payload.proxyUrl, "http://user:pass@proxy.example:8080");
});

test("tls request callback is normalized into a response hook", () => {
  const request = new TLSRequest("GET", "https://example.com", {
    callback: () => undefined,
  });

  assert.equal(typeof request.kwargs.hooks?.response, "function");
  request.closeSession();
});

test("session async helpers allow per-request headers timeout and verify overrides", () => {
  const session = new Session({ browser: "firefox", version: 132, os: "lin" });

  const request = session.async_get("https://example.com", {
    headers: {
      "X-Test": "1",
    },
    timeout: 5,
    verify: false,
  });

  assert.equal(request.session, session);
  assert.deepEqual(request.kwargs.headers, { "X-Test": "1" });
  assert.equal(request.kwargs.timeout, 5);
  assert.equal(request.kwargs.verify, false);
});

test("cookie jar exposes upstream snake_case helpers", () => {
  const jar = new RequestsCookieJar([
    {
      name: "session_id",
      value: "abc123",
      domain: "example.com",
      path: "/",
    },
  ]);

  assert.deepEqual(jar.get_dict(), { session_id: "abc123" });
  assert.deepEqual(jar.list_domains(), ["example.com"]);
  assert.deepEqual(jar.list_paths(), ["/"]);
  assert.equal(jar.multiple_domains(), false);

  const copy = jar.copy();
  copy.set("theme", "dark");

  assert.equal(jar.get("theme"), undefined);
  assert.equal(copy.get("theme"), "dark");
});

test("html parser resolves relative next links with the source URL", () => {
  const html = new HTML({
    url: "https://example.com/articles/index.html",
    html: `
      <html>
        <head><title>Articles</title></head>
        <body>
          <a class="next" href="/articles/page-2">Next page</a>
        </body>
      </html>
    `,
  });

  assert.equal(html.find("title")?.text.trim(), "Articles");
  assert.equal(html.next(), "https://example.com/articles/page-2");
});

test("element exposes attribute passthrough helpers like upstream", () => {
  const html = new HTML({
    url: "https://example.com",
    html: `
      <html>
        <body>
          <a href="/docs" class="primary cta" for="target">Docs</a>
        </body>
      </html>
    `,
  });

  const element = html.find("a") as any;

  assert.equal(element.href, "/docs");
  assert.deepEqual(element.class_, ["primary", "cta"]);
  assert.equal(element.for_, "target");
});

test("error hierarchy matches upstream categories", () => {
  assert.ok(new ProxyFormatException("bad proxy") instanceof ClientException);
  assert.ok(new MissingLibraryException("missing") instanceof ClientException);
  assert.ok(new JavascriptException("js") instanceof BrowserException);
  assert.ok(new CacheDisabledError("cache") instanceof BrowserException);
  assert.ok(new BrowserTimeoutException("timeout") instanceof BrowserException);
  assert.ok(new EnableMockHumanException("mock") instanceof BrowserException);
});
