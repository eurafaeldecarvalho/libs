import assert from "node:assert/strict";
import test from "node:test";
import * as zlib from "node:zlib";

import { CaseInsensitiveDict, RequestsCookieJar, Response } from "../src/index.ts";
import { buildResponse } from "../src/core/response.ts";

test("response transparently decompresses zstd payloads before exposing content", { skip: typeof zlib.zstdCompressSync !== "function" }, () => {
  const payload = Buffer.from(JSON.stringify({ message: "caf\u00e9" }), "utf8");
  const compressed = zlib.zstdCompressSync(payload);

  const response = new Response({
    url: "https://example.com/data",
    status_code: 200,
    headers: new CaseInsensitiveDict({ "content-type": "application/json" }),
    cookies: new RequestsCookieJar(),
    raw: compressed,
  });

  assert.equal(response.content.equals(payload), true);
  assert.equal(response.text, payload.toString("utf8"));
  assert.deepEqual(response.json(), { message: "caf\u00e9" });
  assert.match(response.encoding.toLowerCase(), /utf-?8/);
});

test("buildResponse detects non-utf8 byte payloads instead of forcing utf8", () => {
  const payload = Buffer.from([0x63, 0x61, 0x66, 0xe9]);

  const response = buildResponse(
    {
      target: "https://example.com/text",
      status: 200,
      headers: {
        "content-type": ["text/plain"],
      },
      body: payload.toString("base64"),
      isBase64: true,
    },
    new RequestsCookieJar(),
    null,
  );

  assert.equal(response.content.equals(payload), true);
  assert.equal(response.text, "caf\u00e9");
  assert.match(response.encoding.toLowerCase(), /1252|8859-1/);
});

test("response uses charset hints and BOMs when available", () => {
  const latin1Payload = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
  const latin1Response = new Response({
    url: "https://example.com/latin1",
    status_code: 200,
    headers: new CaseInsensitiveDict({ "content-type": "text/plain; charset=iso-8859-1" }),
    cookies: new RequestsCookieJar(),
    raw: latin1Payload,
  });

  assert.equal(latin1Response.text, "caf\u00e9");

  const utf16Payload = Buffer.from(`\ufeffOl\u00e1`, "utf16le");
  const utf16Response = new Response({
    url: "https://example.com/utf16",
    status_code: 200,
    headers: new CaseInsensitiveDict({ "content-type": "text/plain" }),
    cookies: new RequestsCookieJar(),
    raw: utf16Payload,
  });

  assert.match(utf16Response.encoding.toLowerCase(), /utf-16/);
  assert.equal(utf16Response.text.replace(/^\ufeff/, ""), "Ol\u00e1");
});
