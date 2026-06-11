import { URL } from "node:url";

import setCookieParser from "set-cookie-parser";

import { CaseInsensitiveDict } from "./case-insensitive-dict.js";

export type CookieRecord = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  discard?: boolean;
  session?: boolean;
};

type CookieInput = CookieRecord | Record<string, string> | Array<CookieRecord> | RequestsCookieJar;

export class CookieConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieConflictError";
  }
}

class CookieNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieNotFoundError";
  }
}

export class RequestsCookieJar implements Iterable<CookieRecord> {
  private readonly cookies: CookieRecord[] = [];

  constructor(initial?: CookieInput) {
    if (initial instanceof RequestsCookieJar) {
      this.update(initial);
      return;
    }

    if (Array.isArray(initial)) {
      for (const cookie of initial) {
        this.setCookie(cookie);
      }
      return;
    }

    if (isCookieRecord(initial)) {
      this.setCookie(initial);
      return;
    }

    if (initial && typeof initial === "object") {
      for (const [name, value] of Object.entries(initial)) {
        this.set(name, String(value));
      }
    }
  }

  setCookie(cookie: CookieRecord): void {
    const normalized = normalizeCookie(cookie);
    const index = this.cookies.findIndex((entry) => isSameCookie(entry, normalized));

    if (index >= 0) {
      this.cookies[index] = normalized;
      return;
    }

    this.cookies.push(normalized);
  }

  set(name: string, value: string | null, options: Omit<CookieRecord, "name" | "value"> = {}): CookieRecord | void {
    if (value === null) {
      this.delete(name, options.domain, options.path);
      return;
    }

    const cookie = normalizeCookie({ name, value, ...options });
    this.setCookie(cookie);
    return cookie;
  }

  get(name: string, defaultValue?: string, domain?: string, path?: string): string | undefined {
    try {
      return this.findNoDuplicates(name, domain, path);
    } catch (error) {
      if (error instanceof CookieConflictError) {
        throw error;
      }

      return defaultValue;
    }
  }

  has(name: string): boolean {
    return this.cookies.some((cookie) => cookie.name === name);
  }

  delete(name: string, domain?: string, path?: string): void {
    const survivors = this.cookies.filter((cookie) => {
      if (cookie.name !== name) {
        return true;
      }

      if (domain !== undefined && cookie.domain !== domain) {
        return true;
      }

      if (path !== undefined && cookie.path !== path) {
        return true;
      }

      return false;
    });

    this.cookies.length = 0;
    this.cookies.push(...survivors);
  }

  clear(domain?: string, path?: string, name?: string): void {
    if (name !== undefined) {
      this.delete(name, domain, path);
      return;
    }

    if (domain === undefined && path === undefined) {
      this.cookies.length = 0;
      return;
    }

    const survivors = this.cookies.filter((cookie) => {
      if (domain !== undefined && cookie.domain !== domain) {
        return true;
      }

      if (path !== undefined && cookie.path !== path) {
        return true;
      }

      return false;
    });

    this.cookies.length = 0;
    this.cookies.push(...survivors);
  }

  update(other: CookieInput): void {
    if (other instanceof RequestsCookieJar) {
      for (const cookie of other) {
        this.setCookie(cookie);
      }
      return;
    }

    if (Array.isArray(other)) {
      for (const cookie of other) {
        this.setCookie(cookie);
      }
      return;
    }

    for (const [name, value] of Object.entries(other)) {
      this.set(name, String(value));
    }
  }

  iterkeys(): IterableIterator<string> {
    return this.keys()[Symbol.iterator]();
  }

  itervalues(): IterableIterator<string> {
    return this.values()[Symbol.iterator]();
  }

  iteritems(): IterableIterator<[string, string]> {
    return this.items()[Symbol.iterator]();
  }

  getDict(domain?: string, path?: string): Record<string, string> {
    return Object.fromEntries(
      this.cookies
        .filter((cookie) => (domain === undefined || cookie.domain === domain) && (path === undefined || cookie.path === path))
        .map((cookie) => [cookie.name, cookie.value]),
    );
  }

  get_dict(domain?: string, path?: string): Record<string, string> {
    return this.getDict(domain, path);
  }

  listDomains(): string[] {
    const domains: string[] = [];

    for (const cookie of this.cookies) {
      if (cookie.domain !== undefined && !domains.includes(cookie.domain)) {
        domains.push(cookie.domain);
      }
    }

    return domains;
  }

  list_domains(): string[] {
    return this.listDomains();
  }

  listPaths(): string[] {
    const paths: string[] = [];

    for (const cookie of this.cookies) {
      if (cookie.path !== undefined && !paths.includes(cookie.path)) {
        paths.push(cookie.path);
      }
    }

    return paths;
  }

  list_paths(): string[] {
    return this.listPaths();
  }

  multipleDomains(): boolean {
    const domains: string[] = [];

    for (const cookie of this.cookies) {
      if (cookie.domain !== undefined && domains.includes(cookie.domain)) {
        return true;
      }

      if (cookie.domain !== undefined) {
        domains.push(cookie.domain);
      }
    }

    return false;
  }

  multiple_domains(): boolean {
    return this.multipleDomains();
  }

  keys(): string[] {
    return this.cookies.map((cookie) => cookie.name);
  }

  values(): string[] {
    return this.cookies.map((cookie) => cookie.value);
  }

  items(): Array<[string, string]> {
    return this.cookies.map((cookie) => [cookie.name, cookie.value]);
  }

  toList(): CookieRecord[] {
    return this.cookies.map((cookie) => ({ ...cookie }));
  }

  clone(): RequestsCookieJar {
    return new RequestsCookieJar(this.toList());
  }

  copy(): RequestsCookieJar {
    return this.clone();
  }

  getPolicy(): undefined {
    return undefined;
  }

  get_policy(): undefined {
    return this.getPolicy();
  }

  [Symbol.iterator](): Iterator<CookieRecord> {
    return this.toList()[Symbol.iterator]();
  }

  private findNoDuplicates(name: string, domain?: string, path?: string): string {
    let found: CookieRecord | null = null;

    for (const cookie of this.cookies) {
      if (cookie.name !== name) {
        continue;
      }

      if (domain !== undefined && cookie.domain !== domain) {
        continue;
      }

      if (path !== undefined && cookie.path !== path) {
        continue;
      }

      if (found) {
        throw new CookieConflictError(`There are multiple cookies with name ${JSON.stringify(name)}`);
      }

      found = cookie;
    }

    if (!found) {
      throw new CookieNotFoundError(`Cookie not found: ${name}`);
    }

    return found.value;
  }

  private find(name: string, domain?: string, path?: string): string {
    for (const cookie of this.cookies) {
      if (cookie.name !== name) {
        continue;
      }

      if (domain !== undefined && cookie.domain !== domain) {
        continue;
      }

      if (path !== undefined && cookie.path !== path) {
        continue;
      }

      return cookie.value;
    }

    throw new CookieNotFoundError(`Cookie not found: ${name}`);
  }

  _find(name: string, domain?: string, path?: string): string {
    return this.find(name, domain, path);
  }

  _find_no_duplicates(name: string, domain?: string, path?: string): string {
    return this.findNoDuplicates(name, domain, path);
  }
}

export function cookieJarFromDict(
  cookies: Record<string, string>,
  cookieJar: RequestsCookieJar = new RequestsCookieJar(),
  overwrite = true,
): RequestsCookieJar {
  const existingNames = new Set(cookieJar.keys());

  for (const [name, value] of Object.entries(cookies || {})) {
    if (overwrite || !existingNames.has(name)) {
      cookieJar.set(name, String(value));
    }
  }

  return cookieJar;
}

export function listToCookieJar(cookies: CookieRecord[] | Array<Record<string, unknown>>): RequestsCookieJar {
  return new RequestsCookieJar(cookies as CookieRecord[]);
}

export function cookieJarToList(cookieJar: RequestsCookieJar): CookieRecord[] {
  return cookieJar.toList().map((cookie) => {
    const { discard: _discard, ...rest } = cookie;
    return rest;
  });
}

export function mergeCookies(target: RequestsCookieJar, source: RequestsCookieJar | Record<string, string>): RequestsCookieJar {
  if (source instanceof RequestsCookieJar) {
    target.update(source);
    return target;
  }

  target.update(cookieJarFromDict(source));
  return target;
}

export function getCookieHeader(
  requestUrl: string,
  requestHeaders: CaseInsensitiveDict<string | string[]> | Record<string, string | string[]>,
  cookieJar: RequestsCookieJar,
): string | undefined {
  const resolvedUrl = getRequestUrlWithHostHeader(requestUrl, requestHeaders);
  const parsedUrl = new URL(resolvedUrl);
  const matches = cookieJar
    .toList()
    .filter((cookie) => matchesRequest(cookie, parsedUrl))
    .map((cookie) => `${cookie.name}=${cookie.value}`);

  return matches.length > 0 ? matches.join("; ") : undefined;
}

export function extractCookiesToJar(options: {
  requestUrl: string;
  requestHeaders?: CaseInsensitiveDict<string | string[]> | Record<string, string | string[]>;
  cookieJar: RequestsCookieJar;
  responseHeaders?: CaseInsensitiveDict<string | string[]> | Record<string, string | string[]> | null;
}): RequestsCookieJar {
  const result = new RequestsCookieJar();
  const rawSetCookie = getHeaderValue(options.responseHeaders, "set-cookie");

  if (!rawSetCookie) {
    return result;
  }

  const parsedUrl = new URL(getRequestUrlWithHostHeader(options.requestUrl, options.requestHeaders || {}));
  const parsedCookies = setCookieParser.parse(rawSetCookie, { map: false });

  for (const cookie of parsedCookies) {
    result.setCookie(compactCookie({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain || parsedUrl.hostname,
      path: cookie.path || "/",
      expires: cookie.expires ? Math.floor(cookie.expires.getTime() / 1000) : undefined,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: normalizeSameSite(cookie.sameSite),
      discard: cookie.expires ? undefined : true,
    }));
  }

  mergeCookies(options.cookieJar, result);
  return result;
}

function normalizeCookie(cookie: CookieRecord): CookieRecord {
  const discard = normalizeDiscard(cookie);
  const normalizedValue = normalizeCookieValue(cookie.value);

  return compactCookie({
    name: cookie.name,
    value: normalizedValue,
    domain: cookie.domain ?? "",
    path: cookie.path || "/",
    expires: normalizeExpires(cookie.expires),
    secure: Boolean(cookie.secure),
    httpOnly: Boolean(cookie.httpOnly),
    sameSite: normalizeSameSite(cookie.sameSite),
    discard,
  });
}

function normalizeExpires(expires?: number): number | undefined {
  if (expires === undefined || expires === null || Number.isNaN(expires)) {
    return undefined;
  }

  return expires;
}

function normalizeSameSite(value?: string): CookieRecord["sameSite"] {
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase();
  if (normalized === "strict") {
    return "Strict";
  }

  if (normalized === "lax") {
    return "Lax";
  }

  if (normalized === "none") {
    return "None";
  }

  return undefined;
}

function compactCookie(cookie: {
  name: string;
  value: string;
  domain: string | undefined;
  path: string | undefined;
  expires: number | undefined;
  secure: boolean | undefined;
  httpOnly: boolean | undefined;
  sameSite: CookieRecord["sameSite"] | undefined;
  discard: boolean | undefined;
}): CookieRecord {
  const compact = Object.fromEntries(
    Object.entries(cookie).filter(([, value]) => value !== undefined),
  ) as CookieRecord;

  if (compact.discard !== undefined) {
    compact.session = compact.discard;
  }

  return compact;
}

function isSameCookie(left: CookieRecord, right: CookieRecord): boolean {
  return left.name === right.name && left.domain === right.domain && left.path === right.path;
}

function getHeaderValue(
  headers: CaseInsensitiveDict<string | string[]> | Record<string, string | string[]> | null | undefined,
  key: string,
): string[] {
  if (!headers) {
    return [];
  }

  if (headers instanceof CaseInsensitiveDict) {
    const value = headers.get(key);
    if (!value) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }

  const entry = Object.entries(headers).find(([currentKey]) => currentKey.toLowerCase() === key.toLowerCase());
  if (!entry) {
    return [];
  }

  const value = entry[1];
  return Array.isArray(value) ? value : [value];
}

function normalizeDiscard(cookie: CookieRecord): boolean | undefined {
  if (cookie.discard !== undefined) {
    return Boolean(cookie.discard);
  }

  if (cookie.session !== undefined) {
    return Boolean(cookie.session);
  }

  if (cookie.expires === undefined) {
    return true;
  }

  return undefined;
}

function normalizeCookieValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, "");
  }

  return value;
}

function isCookieRecord(value: CookieInput | undefined): value is CookieRecord {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && !(value instanceof RequestsCookieJar)
    && "name" in value
    && "value" in value;
}

function matchesRequest(cookie: CookieRecord, parsedUrl: URL): boolean {
  if (cookie.secure && parsedUrl.protocol !== "https:") {
    return false;
  }

  const hostname = parsedUrl.hostname;
  const domain = cookie.domain || "";
  if (domain && !domainMatches(hostname, domain)) {
    return false;
  }

  const requestPath = parsedUrl.pathname || "/";
  const cookiePath = cookie.path || "/";
  return pathMatches(requestPath, cookiePath);
}

function domainMatches(hostname: string, domain: string): boolean {
  const normalizedDomain = domain.startsWith(".") ? domain.slice(1) : domain;
  return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) {
    return true;
  }

  if (!requestPath.startsWith(cookiePath)) {
    return false;
  }

  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

function getRequestUrlWithHostHeader(
  requestUrl: string,
  requestHeaders: CaseInsensitiveDict<string | string[]> | Record<string, string | string[]>,
): string {
  const hostHeader = requestHeaders instanceof CaseInsensitiveDict
    ? requestHeaders.get("Host")
    : Object.entries(requestHeaders).find(([key]) => key.toLowerCase() === "host")?.[1];

  if (!hostHeader) {
    return requestUrl;
  }

  const parsedUrl = new URL(requestUrl);
  parsedUrl.host = Array.isArray(hostHeader) ? String(hostHeader[0]) : String(hostHeader);
  return parsedUrl.toString();
}
