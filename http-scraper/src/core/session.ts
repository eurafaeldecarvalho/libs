import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import mime from "mime-types";
import { File, FormData } from "formdata-node";

import { HrequestsBridge } from "./bridge.js";
import { CaseInsensitiveDict } from "./case-insensitive-dict.js";
import {
  cookieJarFromDict,
  cookieJarToList,
  extractCookiesToJar,
  listToCookieJar,
  mergeCookies,
  RequestsCookieJar,
  type CookieRecord,
} from "./cookies.js";
import { ClientException, ProxyFormatException } from "./errors.js";
import { BrowserName, generateHeaders, getMajorVersion, OS_MAP, type SessionOs } from "./headers.js";
import { BaseProxy } from "./proxies.js";
import { ProcessResponse, Response, buildResponse } from "./response.js";

export type RequestData = string | Buffer | Uint8Array | Record<string, unknown>;

export type RequestParamValue = string | number | boolean;
export type RequestParams = Record<string, RequestParamValue | RequestParamValue[]>;
export type RequestProxies = Partial<Record<"http" | "https" | "all", string | BaseProxy>>;
export type ResponseHook = (response: Response) => void | Promise<void>;

export type RequestFiles = Record<
  string,
  | Buffer
  | Uint8Array
  | string
  | File
  | [string, Buffer | Uint8Array | string | File, string?, Record<string, string>?]
>;

export type RequestOptions = {
  params?: RequestParams;
  data?: RequestData;
  files?: RequestFiles;
  headers?: Record<string, string | string[]> | CaseInsensitiveDict<string | string[]>;
  cookies?: RequestsCookieJar | Record<string, string> | CookieRecord[];
  json?: unknown;
  hooks?: {
    response?: ResponseHook;
  };
  allow_redirects?: boolean;
  history?: boolean;
  verify?: boolean;
  timeout?: number;
  proxy?: string | BaseProxy;
  proxies?: RequestProxies;
  process?: boolean;
};

export type TLSClientOptions = {
  client_identifier?: string | null;
  random_tls_extension_order?: boolean;
  force_http1?: boolean;
  catch_panics?: boolean;
  debug?: boolean;
  proxy?: string | BaseProxy | null;
  cookies?: RequestsCookieJar;
  certificate_pinning?: Record<string, string[]>;
  disable_ipv6?: boolean;
  detect_encoding?: boolean;
  ja3_string?: string;
  h2_settings?: Record<string, number>;
  h2_settings_order?: string[];
  supported_signature_algorithms?: string[];
  supported_delegated_credentials_algorithms?: string[];
  supported_versions?: string[];
  key_share_curves?: string[];
  cert_compression_algo?: string;
  additional_decode?: string;
  pseudo_header_order?: string[];
  connection_flow?: number;
  priority_frames?: unknown[];
  header_order?: string[];
  header_priority?: string[];
  temp?: boolean;
  verify?: boolean;
  timeout?: number;
};

export type TLSSessionOptions = TLSClientOptions & {
  browser: BrowserName;
  version: number;
  os?: SessionOs;
  headers?: Record<string, string>;
};

export type SessionConstructorOptions = TLSClientOptions & {
  browser?: BrowserName;
  version?: number;
  os?: SessionOs;
  headers?: Record<string, string>;
};

const SUPPORTED_PROXIES = ["http", "https", "socks5"] as const;
const PROXY_PATTERN = new RegExp(`^(?:${SUPPORTED_PROXIES.join("|")})://(?:[^:]+:[^@]+@)?.*?(?::\\d+)?$`, "i");

export class TLSClient {
  readonly id = randomUUID();
  readonly bridge = HrequestsBridge.getInstance();

  client_identifier: string | null;
  random_tls_extension_order: boolean;
  force_http1: boolean;
  catch_panics: boolean;
  debug: boolean;
  proxy: string | BaseProxy | null;
  cookies: RequestsCookieJar;
  certificate_pinning: Record<string, string[]> | undefined;
  disable_ipv6: boolean;
  detect_encoding: boolean;
  ja3_string: string | undefined;
  h2_settings: Record<string, number> | undefined;
  h2_settings_order: string[] | undefined;
  supported_signature_algorithms: string[] | undefined;
  supported_delegated_credentials_algorithms: string[] | undefined;
  supported_versions: string[] | undefined;
  key_share_curves: string[] | undefined;
  cert_compression_algo: string | undefined;
  additional_decode: string | undefined;
  pseudo_header_order: string[] | undefined;
  connection_flow: number | undefined;
  priority_frames: unknown[] | undefined;
  header_order: string[] | undefined;
  header_priority: string[] | undefined;
  readonly temp: boolean;
  verify: boolean;
  timeout: number;

  private closed = false;

  constructor(options: TLSClientOptions = {}) {
    this.client_identifier = options.client_identifier ?? null;
    this.random_tls_extension_order = options.random_tls_extension_order ?? true;
    this.force_http1 = options.force_http1 ?? false;
    this.catch_panics = options.catch_panics ?? false;
    this.debug = options.debug ?? false;
    this.proxy = options.proxy ?? null;
    this.cookies = options.cookies ?? new RequestsCookieJar();
    this.certificate_pinning = options.certificate_pinning;
    this.disable_ipv6 = options.disable_ipv6 ?? false;
    this.detect_encoding = options.detect_encoding ?? true;
    this.ja3_string = options.ja3_string;
    this.h2_settings = options.h2_settings;
    this.h2_settings_order = options.h2_settings_order;
    this.supported_signature_algorithms = options.supported_signature_algorithms;
    this.supported_delegated_credentials_algorithms = options.supported_delegated_credentials_algorithms;
    this.supported_versions = options.supported_versions;
    this.key_share_curves = options.key_share_curves;
    this.cert_compression_algo = options.cert_compression_algo;
    this.additional_decode = options.additional_decode;
    this.pseudo_header_order = options.pseudo_header_order;
    this.connection_flow = options.connection_flow;
    this.priority_frames = options.priority_frames;
    this.header_order = options.header_order;
    this.header_priority = options.header_priority;
    this.temp = options.temp ?? false;
    this.verify = options.verify ?? true;
    this.timeout = options.timeout ?? 30;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.bridge.destroySession(this.id);
  }

  buildRequest(method: string, url: string, options: RequestOptions = {}): [Record<string, unknown>, CaseInsensitiveDict<string | string[]>] {
    let requestBody: string | Buffer | Uint8Array | null = null;
    let contentType: string | null = null;

    if (options.files) {
      const encoded = encodeFiles(options.files, options.data);
      requestBody = encoded.body;
      contentType = encoded.contentType;
    } else if (options.data === undefined && options.json !== undefined) {
      requestBody = typeof options.json === "string" ? options.json : JSON.stringify(options.json);
      contentType = "application/json";
    } else if (options.data !== undefined && isPlainObject(options.data)) {
      requestBody = buildSearchParams(options.data).toString();
      contentType = "application/x-www-form-urlencoded";
    } else if (options.data !== undefined) {
      requestBody = options.data as string | Buffer | Uint8Array;
    }

    const headers = this.mergeHeaders(options.headers);
    if (contentType && !headers.get("content-type")) {
      headers.set("Content-Type", contentType);
    }

    this.mergeRequestCookies(options.cookies);

    const proxy = normalizeRequestProxy(options.proxy ?? this.proxy, options.proxies, url);
    if (proxy) {
      verifyProxy(proxy);
    }

    const isByteRequest = Buffer.isBuffer(requestBody) || requestBody instanceof Uint8Array;

    const payload: Record<string, unknown> = {
      sessionId: this.id,
      followRedirects: options.allow_redirects ?? true,
      wantHistory: options.history ?? false,
      forceHttp1: this.force_http1,
      withDebug: this.debug,
      catchPanics: this.catch_panics,
      headers: headers.toJSON(),
      headerOrder: this.header_order,
      insecureSkipVerify: !(options.verify ?? this.verify),
      isByteRequest,
      detectEncoding: this.detect_encoding,
      additionalDecode: this.additional_decode,
      proxyUrl: proxy,
      requestUrl: url,
      requestMethod: method,
      requestBody: isByteRequest
        ? Buffer.from(requestBody as Buffer | Uint8Array).toString("base64")
        : (requestBody ?? null),
      requestCookies: cookieJarToList(this.cookies),
      timeoutMilliseconds: Math.round((options.timeout ?? this.timeout) * 1_000),
      withoutCookieJar: false,
      disableIPv6: this.disable_ipv6,
    };

    if (this.certificate_pinning) {
      payload.certificatePinning = this.certificate_pinning;
    }

    if (this.client_identifier) {
      payload.tlsClientIdentifier = this.client_identifier;
      payload.withRandomTLSExtensionOrder = this.random_tls_extension_order;
    } else {
      payload.customTlsClient = {
        ja3String: this.ja3_string,
        h2Settings: this.h2_settings,
        h2SettingsOrder: this.h2_settings_order,
        pseudoHeaderOrder: this.pseudo_header_order,
        connectionFlow: this.connection_flow,
        priorityFrames: this.priority_frames,
        headerPriority: this.header_priority,
        certCompressionAlgo: this.cert_compression_algo,
        supportedVersions: this.supported_versions,
        supportedSignatureAlgorithms: this.supported_signature_algorithms,
        supportedDelegatedCredentialsAlgorithms: this.supported_delegated_credentials_algorithms,
        keyShareCurves: this.key_share_curves,
      };
    }

    return [payload, headers];
  }

  buildResponseObj(
    url: string,
    headers: CaseInsensitiveDict<string | string[]>,
    responseObject: Record<string, any>,
    proxy: string,
  ): Response {
    if (Number(responseObject.status || 0) === 0) {
      throw new ClientException(String(responseObject.body || "Request failed"));
    }

    const responseCookieJar = extractCookiesToJar({
      requestUrl: url,
      requestHeaders: headers,
      cookieJar: this.cookies,
      responseHeaders: normalizeResponseHeaders(responseObject.headers),
    });

    return buildResponse(responseObject, responseCookieJar, proxy || null);
  }

  buildResponse(
    url: string,
    headers: CaseInsensitiveDict<string | string[]>,
    responseObject: Record<string, any>,
    proxy: string,
  ): Response {
    const history: Response[] = [];

    if (!responseObject.isHistory) {
      return this.buildResponseObj(url, headers, responseObject.response, proxy);
    }

    const responses = responseObject.history as Array<Record<string, any>>;
    for (let index = 0; index < responses.length; index += 1) {
      const item = responses[index];
      const itemUrl = index === 0 ? url : String(getHeaderValue(responses[index - 1]?.headers, "location") || url);
      if (!item) {
        continue;
      }

      history.push(this.buildResponseObj(itemUrl, headers, item, proxy));
    }

    const finalResponse = history[history.length - 1];
    if (!finalResponse) {
      throw new ClientException("Empty redirect history returned by hrequests-cgo");
    }

    finalResponse.history = history.slice(0, -1);
    return finalResponse;
  }

  async executeRequest(method: string, url: string, options: RequestOptions = {}): Promise<Response> {
    const [payload, headers] = this.buildRequest(method, url, options);

    let responseObject: any;
    try {
      responseObject = await this.bridge.request(payload);
    } catch (error) {
      throw new ClientException(error instanceof Error ? error.message : "Request failed");
    }

    return this.buildResponse(url, headers, responseObject, String(payload.proxyUrl || ""));
  }

  protected mergeHeaders(
    headers?: Record<string, string | string[]> | CaseInsensitiveDict<string | string[]>,
  ): CaseInsensitiveDict<string | string[]> {
    if (headers instanceof CaseInsensitiveDict) {
      return headers.copy();
    }

    return new CaseInsensitiveDict(headers);
  }

  private mergeRequestCookies(cookies?: RequestsCookieJar | Record<string, string> | CookieRecord[]): void {
    if (!cookies) {
      return;
    }

    if (cookies instanceof RequestsCookieJar) {
      mergeCookies(this.cookies, cookies);
      return;
    }

    if (Array.isArray(cookies)) {
      mergeCookies(this.cookies, listToCookieJar(cookies));
      return;
    }

    mergeCookies(this.cookies, cookieJarFromDict(cookies));
  }
}

export class TLSSession extends TLSClient {
  browser: BrowserName;
  tls_version: number;
  version: number;

  private currentOs: SessionOs;
  private internalHeaders: CaseInsensitiveDict<string>;

  constructor(options: TLSSessionOptions) {
    super(options);

    this.browser = options.browser;
    this.tls_version = options.version;
    this.version = options.version;
    this.currentOs = options.os || randomOs();
    this.internalHeaders = new CaseInsensitiveDict<string>();

    if (options.headers) {
      this.headers = new CaseInsensitiveDict(options.headers);
    } else {
      this.resetHeaders(options.os);
    }

    if (!this.client_identifier && !hasCustomTlsProfile(this)) {
      this.client_identifier = `${this.browser}_${this.tls_version}`;
    }
  }

  get headers(): CaseInsensitiveDict<string> {
    return this.internalHeaders;
  }

  set headers(headers: CaseInsensitiveDict<string> | Record<string, string>) {
    this.internalHeaders = headers instanceof CaseInsensitiveDict ? headers.copy() : new CaseInsensitiveDict(headers);
    this.version = getMajorVersion(this.internalHeaders) ?? this.tls_version;
  }

  get os(): SessionOs {
    return this.currentOs;
  }

  set os(os: SessionOs) {
    if (!(os in OS_MAP)) {
      throw new Error(`Invalid OS: ${os}`);
    }

    this.resetHeaders(os);
  }

  resetHeaders(os?: SessionOs): void {
    const nextOs = os || this.currentOs;
    this.currentOs = nextOs;
    this.headers = generateHeaders(this.browser, {
      version: this.tls_version,
      os: OS_MAP[nextOs],
    });
  }

  reset_headers(os?: SessionOs): void {
    this.resetHeaders(os);
  }

  request(method: string, url: string, options: RequestOptions & { process?: boolean } = {}): Promise<Response | ProcessResponse> | ProcessResponse {
    const { requestUrl, requestOptions } = normalizeRequestTarget(url, options);
    const proc = new ProcessResponse(this, method, requestUrl, requestOptions);

    if (options.process === false) {
      return proc;
    }

    return (async () => {
      await proc.send();
      return proc.response;
    })();
  }

  get(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("GET", url, options) as Promise<Response>;
  }

  post(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("POST", url, options) as Promise<Response>;
  }

  options(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("OPTIONS", url, options) as Promise<Response>;
  }

  head(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("HEAD", url, options) as Promise<Response>;
  }

  put(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("PUT", url, options) as Promise<Response>;
  }

  patch(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("PATCH", url, options) as Promise<Response>;
  }

  delete(url: string, options?: RequestOptions): Promise<Response> {
    return this.request("DELETE", url, options) as Promise<Response>;
  }

  async render(url: string, options: Record<string, unknown> = {}): Promise<any> {
    const browserModule = await import("../browser/browser-session.js");
    return browserModule.render(url, {
      ...options,
      os: this.currentOs,
      session: this,
      version: this.version,
      browser: this.browser,
      proxy: (options.proxy as string | BaseProxy | null | undefined) ?? this.proxy,
    });
  }
}

export class Session extends TLSSession {
  constructor(options: SessionConstructorOptions = {}) {
    const browser = options.browser || "firefox";
    const supportedVersions = BROWSER_MAP[browser].versions;
    const requestedVersion = options.version;

    if (requestedVersion && !supportedVersions.includes(requestedVersion)) {
      throw new Error(
        `Unsupported ${browser} version ${requestedVersion}. Supported versions: ${supportedVersions.join(", ")}`,
      );
    }

    const latestVersion = supportedVersions[supportedVersions.length - 1];
    if (latestVersion === undefined) {
      throw new Error(`No supported versions configured for ${browser}`);
    }

    const version = requestedVersion !== undefined
      ? BROWSER_MAP[browser].tlsVersion(requestedVersion)
      : latestVersion;

    super({
      ...options,
      browser,
      version,
    });
  }
}

class SessionShortcut {
  readonly name: BrowserName;
  readonly versions: readonly number[];

  constructor(name: BrowserName, versions: readonly number[]) {
    this.name = name;
    this.versions = versions;
  }

  Session(options: Omit<SessionConstructorOptions, "browser"> = {}): Session {
    return new Session({
      ...options,
      browser: this.name,
    });
  }

  tlsVersion(version: number): number {
    for (let index = this.versions.length - 1; index >= 0; index -= 1) {
      const candidate = this.versions[index];
      if (candidate !== undefined && version >= candidate) {
        return candidate;
      }
    }

    throw new Error(`No supported TLS version found for ${this.name}`);
  }

  tls_version(version: number): number {
    return this.tlsVersion(version);
  }

  async BrowserSession(options: Record<string, unknown> = {}): Promise<any> {
    const browserModule = await import("../browser/browser-session.js");
    return browserModule.BrowserSession.create({
      ...options,
      browser: this.name,
    });
  }
}

export const firefox = new SessionShortcut("firefox", [102, 104, 105, 106, 108, 110, 117, 120, 123, 132]);
export const chrome = new SessionShortcut("chrome", [103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 117, 120, 124, 131]);

const BROWSER_MAP = {
  firefox,
  chrome,
} as const;

function verifyProxy(proxy: string): void {
  if (!PROXY_PATTERN.test(proxy)) {
    throw new ProxyFormatException(`Invalid proxy: ${proxy}`);
  }
}

function normalizeProxy(proxy?: string | BaseProxy | null): string | null {
  if (!proxy) {
    return null;
  }

  return proxy instanceof BaseProxy ? proxy.toString() : proxy;
}

function normalizeRequestProxy(
  proxy: string | BaseProxy | null | undefined,
  proxies: RequestProxies | undefined,
  url: string,
): string | null {
  const directProxy = normalizeProxy(proxy);
  if (directProxy) {
    return directProxy;
  }

  if (!proxies) {
    return null;
  }

  const protocol = new URL(url).protocol.replace(":", "") as "http" | "https";
  return normalizeProxy(proxies[protocol] ?? proxies.all ?? null);
}

function normalizeResponseHeaders(headers: Record<string, string[] | string> | undefined): CaseInsensitiveDict<string | string[]> {
  return new CaseInsensitiveDict(headers || {});
}

function buildSearchParams(data: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(data)) {
    appendSearchParam(params, key, value);
  }

  return params;
}

function normalizeRequestTarget(url: string, options: RequestOptions): { requestUrl: string; requestOptions: RequestOptions } {
  if (!options.params) {
    return { requestUrl: url, requestOptions: options };
  }

  const query = buildSearchParams(options.params).toString();
  const requestUrl = query ? `${url}${url.includes("?") ? "&" : "?"}${query}` : url;
  const { params: _params, ...requestOptions } = options;
  return {
    requestUrl,
    requestOptions,
  };
}

function appendSearchParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      appendSearchParam(params, key, item);
    }
    return;
  }

  params.append(key, String(value));
}

function encodeFiles(files: RequestFiles, data?: RequestData): { body: Buffer; contentType: string } {
  const boundary = `----hrequests-${randomUUID()}`;
  const chunks: Buffer[] = [];

  if (data && isPlainObject(data)) {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          chunks.push(Buffer.from(textPart(boundary, key, String(item))));
        }
      } else {
        chunks.push(Buffer.from(textPart(boundary, key, String(value))));
      }
    }
  }

  for (const [field, input] of Object.entries(files)) {
    if (Array.isArray(input)) {
      const [fileName, fileBody, contentType] = input;
      chunks.push(filePart(boundary, field, fileName, toBuffer(fileBody), contentType || lookupMime(fileName)));
      continue;
    }

    if (input instanceof File) {
      throw new ClientException("File instances are not supported yet; pass Buffer, Uint8Array, or string instead.");
      continue;
    }

    const fileName = typeof input === "string" ? basename(input) || field : field;
    chunks.push(filePart(boundary, field, fileName, toBuffer(input), lookupMime(fileName)));
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function getHeaderValue(headers: Record<string, string[] | string> | undefined, key: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  for (const [currentKey, value] of Object.entries(headers)) {
    if (currentKey.toLowerCase() !== key.toLowerCase()) {
      continue;
    }

    return Array.isArray(value) ? value[0] : value;
  }

  return undefined;
}

function randomOs(): SessionOs {
  const options: SessionOs[] = ["win", "mac", "lin"];
  return options[Math.floor(Math.random() * options.length)]!;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  return !Buffer.isBuffer(value) && !(value instanceof Uint8Array) && !(value instanceof File);
}

function hasCustomTlsProfile(client: TLSClient): boolean {
  return Boolean(
    client.ja3_string
      || client.h2_settings
      || client.h2_settings_order
      || client.supported_signature_algorithms
      || client.supported_delegated_credentials_algorithms
      || client.supported_versions
      || client.key_share_curves
      || client.cert_compression_algo
      || client.pseudo_header_order
      || client.connection_flow
      || client.priority_frames
      || client.header_priority,
  );
}

function textPart(boundary: string, field: string, value: string): string {
  return `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuotes(field)}"\r\n\r\n${value}\r\n`;
}

function filePart(boundary: string, field: string, fileName: string, body: Buffer, contentType: string): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuotes(field)}"; filename="${escapeQuotes(fileName)}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    body,
    Buffer.from("\r\n"),
  ]);
}

function toBuffer(value: Buffer | Uint8Array | string | File): Buffer {
  if (value instanceof File) {
    throw new ClientException("File instances are not supported yet; pass Buffer, Uint8Array, or string instead.");
  }

  return typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
}

function lookupMime(fileName: string): string {
  return mime.lookup(fileName) || "application/octet-stream";
}

function escapeQuotes(value: string): string {
  return value.replace(/"/g, '\\"');
}