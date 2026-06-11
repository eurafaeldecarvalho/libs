import { STATUS_CODES } from "node:http";
import * as zlib from "node:zlib";

import { HTML } from "../html/parser.js";
import { CaseInsensitiveDict } from "./case-insensitive-dict.js";
import { RequestsCookieJar } from "./cookies.js";
import { ClientException, EncodingNotFoundException } from "./errors.js";

import type { RequestOptions, TLSSession } from "./session.js";

export class ProcessResponse {
  readonly session: TLSSession;
  readonly method: string;
  readonly url: string;
  readonly options: RequestOptions;
  response!: Response;
  fullHeaders: CaseInsensitiveDict<string | string[]> | null = null;

  constructor(session: TLSSession, method: string, url: string, options: RequestOptions = {}) {
    this.session = session;
    this.method = method;
    this.url = url;
    this.options = options;
  }

  async send(): Promise<void> {
    const startedAt = Date.now();
    this.response = await this.executeRequest();
    this.response.elapsed = Date.now() - startedAt;

    const responseHook = this.options.hooks?.response;
    if (responseHook) {
      await responseHook(this.response);
    }
  }

  async executeRequest(): Promise<Response> {
    const response = await this.session.executeRequest(this.method, this.url, this.options);
    response.session = this.session.temp ? null : this.session;
    response.browser = this.session.browser;
    response.version = this.session.version;
    return response;
  }
}

export class ProcessResponsePool {
  readonly pool: ProcessResponse[];

  constructor(pool: ProcessResponse[]) {
    this.pool = pool;
  }

  async executePool(): Promise<Response[]> {
    if (this.pool.length === 0) {
      return [];
    }

    const firstProc = this.pool[0]!;

    const payloads: Array<Record<string, unknown>> = [];

    for (const proc of this.pool) {
      const [payload, headers] = proc.session.buildRequest(proc.method, proc.url, proc.options);
      proc.fullHeaders = headers;
      payloads.push(payload);
    }

    const responseObjects = await firstProc.session.bridge.multiRequest(payloads);

    return responseObjects.map((data: any, index: number) => {
      const proc = this.pool[index];
      if (!proc) {
        throw new ClientException(`Missing pooled request at index ${index}`);
      }
      const proxy = String(payloads[index]?.proxyUrl || "");
      return proc.session.buildResponse(proc.url, proc.fullHeaders ?? new CaseInsensitiveDict(), data, proxy);
    });
  }

  async execute_pool(): Promise<Response[]> {
    return this.executePool();
  }
}

export class Response {
  url: string;
  status_code: number;
  headers: CaseInsensitiveDict<string | string[]>;
  cookies: RequestsCookieJar;
  raw: string | Buffer;

  history: Response[] | null;
  session: TLSSession | null;
  browser: "firefox" | "chrome" | null;
  version: number | undefined;
  elapsed: number | undefined;
  encoding: string;
  is_utf8: boolean;
  proxy: string | null;

  private cachedHtml: HTML | null = null;

  constructor(options: {
    url: string;
    status_code: number;
    headers: CaseInsensitiveDict<string | string[]>;
    cookies: RequestsCookieJar;
    raw: string | Buffer;
    history?: Response[] | null;
    session?: TLSSession | null;
    browser?: "firefox" | "chrome" | null;
    version?: number;
    elapsed?: number;
    encoding?: string;
    is_utf8?: boolean;
    proxy?: string | null;
  }) {
    const normalizedRaw = normalizeResponseBody(options.raw);

    this.url = options.url;
    this.status_code = options.status_code;
    this.headers = options.headers;
    this.cookies = options.cookies;
    this.raw = normalizedRaw;
    this.history = options.history ?? null;
    this.session = options.session ?? null;
    this.browser = options.browser ?? null;
    this.version = options.version;
    this.elapsed = options.elapsed;
    this.encoding = options.encoding || detectResponseEncoding(normalizedRaw, this.headers);
    this.is_utf8 = options.is_utf8 ?? (typeof normalizedRaw === "string" || isUtfEncoding(this.encoding));
    this.proxy = options.proxy ?? null;
  }

  get reason(): string {
    return STATUS_CODES[this.status_code] || "";
  }

  get ok(): boolean {
    return this.status_code < 400;
  }

  get content(): Buffer {
    return Buffer.isBuffer(this.raw) ? this.raw : Buffer.from(this.raw);
  }

  get text(): string {
    if (typeof this.raw === "string") {
      return this.raw;
    }

    if (!this.encoding) {
      throw new EncodingNotFoundException("Response does not have a valid encoding.");
    }

    return decodeBuffer(this.raw, this.encoding);
  }

  get html(): HTML {
    if (!this.cachedHtml) {
      this.cachedHtml = new HTML({
        session: this.session,
        url: this.url,
        html: this.content,
      });
    }

    return this.cachedHtml;
  }

  json<T = unknown>(): T {
    return JSON.parse(this.text) as T;
  }

  find(...args: Parameters<HTML["find"]>): ReturnType<HTML["find"]> {
    return this.html.find(...args);
  }

  find_all(...args: Parameters<HTML["find_all"]>): ReturnType<HTML["find_all"]> {
    return this.html.find_all(...args);
  }

  get links(): Record<string, Record<string, string>> {
    const header = this.headers.get("link");
    const values = Array.isArray(header) ? header.join(",") : header;
    const resolvedLinks: Record<string, Record<string, string>> = {};

    if (!values) {
      return resolvedLinks;
    }

    for (const link of parseHeaderLinks(values)) {
      const key = link.rel || link.url || `link-${Object.keys(resolvedLinks).length}`;
      resolvedLinks[key] = link;
    }

    return resolvedLinks;
  }

  async render(options: Record<string, unknown> = {}): Promise<any> {
    const browserModule = await import("../browser/browser-session.js");

    return browserModule.render(this.url, {
      response: this,
      session: this.session,
      proxy: this.proxy,
      ...(this.version !== undefined ? { version: this.version } : {}),
      ...(this.browser ? { browser: this.browser } : {}),
      ...options,
    });
  }

  toString(): string {
    return `<Response [${this.status_code}]>`;
  }
}

export function buildResponse(
  response: Record<string, any>,
  responseCookies: RequestsCookieJar,
  proxy: string | null,
): Response {
  const responseHeaders = response.headers
    ? Object.fromEntries(
        Object.entries(response.headers).map(([key, value]) => {
          const normalized = Array.isArray(value) && value.length === 1 ? value[0] : value;
          return [key, normalized as string | string[]];
        }),
      )
    : {};

  const body = response.isBase64 ? Buffer.from(String(response.body || ""), "base64") : String(response.body || "");

  return new Response({
    url: String(response.target || ""),
    status_code: Number(response.status || 0),
    headers: new CaseInsensitiveDict(responseHeaders),
    cookies: responseCookies,
    raw: body,
    is_utf8: !response.isBase64,
    proxy,
  });
}

export function parseHeaderLinks(value: string): Array<Record<string, string>> {
  const links: Array<Record<string, string>> = [];
  const replaceChars = /[ '\"]/g;
  const trimmed = value.trim();
  if (!trimmed) {
    return links;
  }

  for (const segment of trimmed.split(/,\s*</)) {
    const normalizedSegment = segment.startsWith("<") ? segment : `<${segment}`;
    const [urlPart = "", ...params] = normalizedSegment.split(";");
    const link: Record<string, string> = {
      url: urlPart.replace(/[<> '\"]/g, ""),
    };

    for (const param of params) {
      const [key, rawValue] = param.split("=");
      if (!key || rawValue === undefined) {
        continue;
      }

      link[key.replace(replaceChars, "")] = rawValue.replace(replaceChars, "");
    }

    links.push(link);
  }

  return links;
}

export function ensureResponse<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new ClientException(message);
  }

  return value;
}

function normalizeResponseBody(raw: string | Buffer): string | Buffer {
  if (!Buffer.isBuffer(raw)) {
    return raw;
  }

  if (!isZstdCompressed(raw)) {
    return raw;
  }

  try {
    if (typeof zlib.zstdDecompressSync === "function") {
      return zlib.zstdDecompressSync(raw);
    }
  } catch {
    return raw;
  }

  return raw;
}

function detectResponseEncoding(
  raw: string | Buffer,
  headers: CaseInsensitiveDict<string | string[]>,
): string {
  if (typeof raw === "string") {
    return "utf-8";
  }

  return detectBufferEncoding(raw, headers) || "utf-8";
}

function detectBufferEncoding(
  raw: Buffer,
  headers: CaseInsensitiveDict<string | string[]>,
): string | undefined {
  const bomEncoding = detectBomEncoding(raw);
  if (bomEncoding) {
    return bomEncoding;
  }

  const headerCharset = parseCharset(getHeaderValue(headers, "content-type"));
  if (headerCharset) {
    return headerCharset;
  }

  const metaCharset = extractHtmlCharset(raw);
  if (metaCharset) {
    return metaCharset;
  }

  if (isValidUtf8(raw)) {
    return "utf-8";
  }

  return "windows-1252";
}

function detectBomEncoding(raw: Buffer): string | undefined {
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return "utf-8";
  }

  if (raw.length >= 4 && raw[0] === 0xff && raw[1] === 0xfe && raw[2] === 0x00 && raw[3] === 0x00) {
    return "utf-32le";
  }

  if (raw.length >= 4 && raw[0] === 0x00 && raw[1] === 0x00 && raw[2] === 0xfe && raw[3] === 0xff) {
    return "utf-32be";
  }

  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return "utf-16le";
  }

  if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
    return "utf-16be";
  }

  return undefined;
}

function parseCharset(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const match = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(value);
  return match?.[1] ? normalizeEncodingLabel(match[1]) : undefined;
}

function extractHtmlCharset(raw: Buffer): string | undefined {
  const snippet = raw.subarray(0, Math.min(raw.length, 2048)).toString("latin1");
  const directMatch = /<meta[^>]+charset\s*=\s*["']?([^\s"'>/]+)/i.exec(snippet);
  if (directMatch?.[1]) {
    return normalizeEncodingLabel(directMatch[1]);
  }

  const contentMatch = /<meta[^>]+content\s*=\s*["'][^"']*charset=([^\s"';]+)/i.exec(snippet);
  if (contentMatch?.[1]) {
    return normalizeEncodingLabel(contentMatch[1]);
  }

  return undefined;
}

function normalizeEncodingLabel(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (["utf8", "utf-8"].includes(normalized)) {
    return "utf-8";
  }

  if (["utf16", "utf-16", "utf16le", "utf-16le"].includes(normalized)) {
    return "utf-16le";
  }

  if (["utf16be", "utf-16be"].includes(normalized)) {
    return "utf-16be";
  }

  if (["utf32", "utf-32", "utf32le", "utf-32le"].includes(normalized)) {
    return "utf-32le";
  }

  if (["utf32be", "utf-32be"].includes(normalized)) {
    return "utf-32be";
  }

  if (["latin1", "latin-1", "iso-8859-1", "iso8859-1"].includes(normalized)) {
    return "iso-8859-1";
  }

  if (["cp1252", "windows1252", "windows-1252"].includes(normalized)) {
    return "windows-1252";
  }

  if (["ascii", "us-ascii"].includes(normalized)) {
    return "ascii";
  }

  return normalized;
}

function decodeBuffer(raw: Buffer, encoding: string): string {
  const normalized = normalizeEncodingLabel(encoding);

  try {
    return new TextDecoder(normalized).decode(raw);
  } catch {
    return raw.toString(toBufferEncoding(normalized));
  }
}

function getHeaderValue(headers: CaseInsensitiveDict<string | string[]>, key: string): string | undefined {
  const value = headers.get(key);
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function isZstdCompressed(raw: Buffer): boolean {
  return raw.length >= 4 && raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd;
}

function isUtfEncoding(encoding: string): boolean {
  return /^utf-/i.test(encoding);
}

function isValidUtf8(raw: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return true;
  } catch {
    return false;
  }
}

function toBufferEncoding(encoding: string): BufferEncoding {
  const normalized = encoding.toLowerCase();
  if (normalized === "windows-1252" || normalized === "iso-8859-1") {
    return "latin1";
  }

  if (normalized === "utf-16be" || normalized === "utf-32le" || normalized === "utf-32be") {
    return "utf8";
  }

  const supported: Set<string> = new Set([
    "ascii",
    "utf8",
    "utf-8",
    "utf16le",
    "ucs2",
    "ucs-2",
    "base64",
    "base64url",
    "latin1",
    "binary",
    "hex",
  ]);

  return supported.has(normalized) ? (normalized as BufferEncoding) : "utf8";
}
