import assert from "node:assert/strict";
import test from "node:test";

import {
  CaseInsensitiveDict,
  CookieConflictError,
  RequestsCookieJar,
  cookieJarFromDict,
  cookieJarToList,
  getCookieHeader,
  listToCookieJar,
  mergeCookies,
} from "../src/index.ts";

test("cookie jar get raises on conflicts but not on missing cookies", () => {
  const jar = new RequestsCookieJar([
    {
      name: "session_id",
      value: "one",
      domain: "example.com",
      path: "/",
    },
    {
      name: "session_id",
      value: "two",
      domain: "api.example.com",
      path: "/",
    },
  ]);

  assert.throws(() => jar.get("session_id"), CookieConflictError);
  assert.equal(jar.get("session_id", undefined, "example.com", "/"), "one");
  assert.equal(jar.get("missing", "fallback"), "fallback");
});

test("cookie helpers preserve existing values on dict merge like requests", () => {
  const base = new RequestsCookieJar([
    {
      name: "session_id",
      value: "base",
      domain: "example.com",
      path: "/",
    },
  ]);

  const kept = cookieJarFromDict(
    {
      session_id: "override",
      theme: "dark",
    },
    base.copy(),
    false,
  );

  assert.equal(kept.get("session_id", undefined, "example.com", "/"), "base");
  assert.equal(kept.get("theme"), "dark");

  const overwritten = cookieJarFromDict(
    {
      session_id: "override",
    },
    base.copy(),
    true,
  );

  assert.equal(overwritten.get("session_id", undefined, "example.com", "/"), "base");
  assert.equal(overwritten.get("session_id", undefined, "", "/"), "override");
  assert.throws(() => overwritten.get("session_id"), CookieConflictError);

  const merged = base.copy();
  mergeCookies(merged, {
    session_id: "request",
    locale: "en-US",
  });

  assert.equal(merged.get("session_id", undefined, "example.com", "/"), "base");
  assert.equal(merged.get("session_id", undefined, "", "/"), "request");
  assert.throws(() => merged.get("session_id"), CookieConflictError);
  assert.equal(merged.get("locale", undefined, undefined, "/"), "en-US");
});

test("cookie jar exposes iterator helpers and browser cookie session aliases", () => {
  const jar = listToCookieJar([
    {
      name: "browser_cookie",
      value: "synced",
      domain: "example.com",
      path: "/",
      session: true,
      secure: false,
    },
  ] as Array<Record<string, unknown>>);

  assert.deepEqual(Array.from(jar.iterkeys()), ["browser_cookie"]);
  assert.deepEqual(Array.from(jar.itervalues()), ["synced"]);
  assert.deepEqual(Array.from(jar.iteritems()), [["browser_cookie", "synced"]]);

  const serialized = cookieJarToList(jar) as Array<Record<string, unknown>>;
  assert.equal(serialized[0]?.session, true);
  assert.equal("discard" in (serialized[0] || {}), false);
});

test("getCookieHeader filters cookies by URL, path, security, and host header", () => {
  const jar = new RequestsCookieJar([
    {
      name: "root",
      value: "1",
      domain: "example.com",
      path: "/",
    },
    {
      name: "api",
      value: "2",
      domain: "example.com",
      path: "/api",
    },
    {
      name: "secure_only",
      value: "3",
      domain: "example.com",
      path: "/",
      secure: true,
    },
    {
      name: "other",
      value: "4",
      domain: "other.com",
      path: "/",
    },
  ]);

  const httpsHeader = getCookieHeader("https://example.com/api/users", new CaseInsensitiveDict(), jar);
  assert.match(httpsHeader || "", /root=1/);
  assert.match(httpsHeader || "", /api=2/);
  assert.match(httpsHeader || "", /secure_only=3/);
  assert.doesNotMatch(httpsHeader || "", /other=4/);

  const httpHeader = getCookieHeader("http://example.com/api/users", new CaseInsensitiveDict(), jar);
  assert.match(httpHeader || "", /root=1/);
  assert.match(httpHeader || "", /api=2/);
  assert.doesNotMatch(httpHeader || "", /secure_only=3/);

  const hostHeader = getCookieHeader(
    "https://127.0.0.1/api/users",
    new CaseInsensitiveDict({ Host: "example.com" }),
    jar,
  );
  assert.match(hostHeader || "", /root=1/);
  assert.match(hostHeader || "", /api=2/);
});

test("multipleDomains follows upstream requests compatibility semantics", () => {
  const duplicateDomain = new RequestsCookieJar([
    {
      name: "one",
      value: "1",
      domain: "example.com",
      path: "/",
    },
    {
      name: "two",
      value: "2",
      domain: "example.com",
      path: "/nested",
    },
  ]);

  const distinctDomains = new RequestsCookieJar([
    {
      name: "one",
      value: "1",
      domain: "example.com",
      path: "/",
    },
    {
      name: "two",
      value: "2",
      domain: "api.example.com",
      path: "/",
    },
  ]);

  assert.equal(duplicateDomain.multiple_domains(), true);
  assert.equal(distinctDomains.multiple_domains(), false);
});

test("cookie jar supports single-record init, clear, and quoted cookie normalization", () => {
  const jar = new RequestsCookieJar({
    name: "quoted",
    value: '"value\\"quoted"',
    domain: "example.com",
    path: "/",
  });

  assert.equal(jar.get("quoted", undefined, "example.com", "/"), "valuequoted");

  jar.set("temp", "1", { domain: "example.com", path: "/tmp" });
  jar.clear("example.com", "/tmp", "temp");
  assert.equal(jar.get("temp"), undefined);
});

test("extractCookiesToJar respects Host header when deriving cookie domain", async () => {
  const { extractCookiesToJar } = await import("../src/index.ts");

  const jar = new RequestsCookieJar();
  const extracted = extractCookiesToJar({
    requestUrl: "https://127.0.0.1/welcome",
    requestHeaders: new CaseInsensitiveDict({ Host: "example.com" }),
    cookieJar: jar,
    responseHeaders: {
      "set-cookie": ["session_id=abc123; Path=/; HttpOnly"],
    },
  });

  assert.equal(extracted.get("session_id", undefined, "example.com", "/"), "abc123");
  assert.equal(jar.get("session_id", undefined, "example.com", "/"), "abc123");
});
