import assert from "node:assert/strict";
import test from "node:test";

import * as httpScraper from "../src/index.ts";

test("exports hrequests-style top-level symbols", () => {
  const expectedExports = [
    "HTML",
    "Session",
    "TLSSession",
    "Response",
    "ProcessResponse",
    "BrowserEngine",
    "BrowserSession",
    "send",
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "async_get",
    "async_post",
    "async_put",
    "async_patch",
    "async_delete",
    "map",
    "imap",
    "imap_enum",
    "firefox",
    "chrome",
    "BROWSER_SUPPORT",
    "__author__",
    "__version__",
    "__upstream__",
  ];

  for (const exportName of expectedExports) {
    assert.ok(exportName in httpScraper, `missing export ${exportName}`);
  }

  assert.match(httpScraper.BROWSER_SUPPORT, /^[01]$/);
  assert.equal(httpScraper.__author__, "Rafael");
  assert.equal(httpScraper.__upstream__, "hrequests@0.9.2");
});

test("session exposes async helpers and browser version aliases", () => {
  const session = new httpScraper.Session({ browser: "firefox" });

  assert.equal(typeof session.async_get, "function");
  assert.equal(typeof session.async_post, "function");
  assert.equal(typeof httpScraper.firefox.tls_version, "function");
  assert.equal(typeof httpScraper.chrome.tls_version, "function");

  const pending = session.async_get("https://example.com");
  assert.ok(pending instanceof httpScraper.TLSRequest);
  assert.equal(pending.session, session);

  assert.equal(httpScraper.firefox.tls_version(132), 132);
  assert.equal(httpScraper.chrome.tls_version(120), 120);

  session.reset_headers("mac");
  assert.match(String(session.headers.get("user-agent")), /Macintosh/);
  pending.close_session();
});

test("lazy and pool helpers expose upstream-style aliases", async () => {
  const lazy = new httpScraper.LazyTLSRequest(Promise.resolve(new httpScraper.Response({
    url: "https://example.com",
    status_code: 200,
    headers: new httpScraper.CaseInsensitiveDict(),
    cookies: new httpScraper.RequestsCookieJar(),
    raw: Buffer.from("ok"),
  })));

  const joined = await lazy.join();
  assert.equal(joined.status_code, 200);

  const pool = new httpScraper.ProcessResponsePool([]);
  assert.deepEqual(await pool.execute_pool(), []);
});
