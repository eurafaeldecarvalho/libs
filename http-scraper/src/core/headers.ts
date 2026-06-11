import { HeaderGenerator } from "header-generator";

import { CaseInsensitiveDict } from "./case-insensitive-dict.js";

export const OS_MAP = {
  win: "windows",
  mac: "macos",
  lin: "linux",
} as const;

export type BrowserName = "firefox" | "chrome";
export type SessionOs = keyof typeof OS_MAP;

const generator = new HeaderGenerator({
  strict: false,
  locales: ["en-US", "en"],
  devices: ["desktop"],
  httpVersion: "2",
});

export function generateHeaders(
  browser: BrowserName,
  options: { version: number; os: typeof OS_MAP[SessionOs] },
): Record<string, string> {
  const generated = safelyGenerateHeaders(browser, options);
  if (generated) {
    return generated;
  }

  return browser === "firefox"
    ? firefoxHeaders(options.version, options.os)
    : chromeHeaders(options.version, options.os);
}

export function getMajorVersion(headers: Record<string, string> | CaseInsensitiveDict<string>): number | undefined {
  const userAgent = headers instanceof CaseInsensitiveDict ? headers.get("user-agent") : findHeader(headers, "user-agent");
  if (!userAgent) {
    return undefined;
  }

  const chromeMatch = /Chrome\/(\d+)/i.exec(userAgent);
  if (chromeMatch) {
    return Number(chromeMatch[1]);
  }

  const firefoxMatch = /Firefox\/(\d+)/i.exec(userAgent);
  if (firefoxMatch) {
    return Number(firefoxMatch[1]);
  }

  return undefined;
}

function safelyGenerateHeaders(browser: BrowserName, options: { version: number; os: typeof OS_MAP[SessionOs] }): Record<string, string> | null {
  try {
    const headers = generator.getHeaders({
      browsers: [{ name: browser, minVersion: options.version, maxVersion: options.version, httpVersion: "2" }],
      operatingSystems: [options.os],
      devices: ["desktop"],
      locales: ["en-US", "en"],
    });

    const userAgent = headers["user-agent"] || "";
    if (!matchesBrowser(userAgent, browser) || !matchesOperatingSystem(userAgent, options.os, headers["sec-ch-ua-platform"])) {
      return null;
    }

    return normalizeHeaderKeys(headers);
  } catch {
    return null;
  }
}

function firefoxHeaders(version: number, os: typeof OS_MAP[SessionOs]): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.5",
    Connection: "keep-alive",
    DNT: "1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": firefoxUserAgent(version, os),
  };
}

function chromeHeaders(version: number, os: typeof OS_MAP[SessionOs]): Record<string, string> {
  const platformLabel = os === "windows" ? "Windows" : os === "macos" ? "macOS" : "Linux";

  return {
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Connection: "keep-alive",
    "Sec-Ch-Ua": `\"Not_A Brand\";v=\"8\", \"Chromium\";v=\"${version}\", \"Google Chrome\";v=\"${version}\"`,
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": `\"${platformLabel}\"`,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
    "User-Agent": chromeUserAgent(version, os),
  };
}

function firefoxUserAgent(version: number, os: typeof OS_MAP[SessionOs]): string {
  if (os === "windows") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
  }

  if (os === "macos") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
  }

  return `Mozilla/5.0 (X11; Linux x86_64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
}

function chromeUserAgent(version: number, os: typeof OS_MAP[SessionOs]): string {
  if (os === "windows") {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
  }

  if (os === "macos") {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
  }

  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`;
}

function normalizeHeaderKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [headerCase(key), value]),
  );
}

function headerCase(key: string): string {
  return key
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}

function matchesBrowser(userAgent: string, browser: BrowserName): boolean {
  return browser === "firefox" ? /Firefox\//i.test(userAgent) : /Chrome\//i.test(userAgent);
}

function matchesOperatingSystem(userAgent: string, os: typeof OS_MAP[SessionOs], secChPlatform?: string): boolean {
  if (os === "windows") {
    return /Windows/i.test(userAgent) || /Windows/i.test(secChPlatform || "");
  }

  if (os === "macos") {
    return /Mac OS X|Macintosh/i.test(userAgent) || /macOS/i.test(secChPlatform || "");
  }

  return /Linux|X11/i.test(userAgent) || /Linux/i.test(secChPlatform || "");
}

function findHeader(headers: Record<string, string>, key: string): string | undefined {
  const entry = Object.entries(headers).find(([currentKey]) => currentKey.toLowerCase() === key.toLowerCase());
  return entry?.[1];
}