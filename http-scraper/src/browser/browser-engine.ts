import { access } from "node:fs/promises";
import { join } from "node:path";

import type { Browser as PlaywrightBrowser, BrowserContext, LaunchOptions } from "playwright-core";

import { MissingLibraryException } from "../core/errors.js";

export type EngineBrowserName = "firefox" | "chrome";
type PlaywrightModule = typeof import("playwright-core");

export type BrowserLaunchConfig = {
  browser: EngineBrowserName;
  headless?: boolean;
  executablePath?: string;
  proxy?: {
    server: string;
    username?: string;
    password?: string;
  };
};

export class BrowserEngine {
  readonly browser_type: EngineBrowserName;

  private playwright: PlaywrightModule | null = null;
  private browser: PlaywrightBrowser | null = null;
  private launchConfig: BrowserLaunchConfig | null = null;

  constructor(browser_type: EngineBrowserName = "firefox") {
    this.browser_type = browser_type;
  }

  async newContext(config: BrowserLaunchConfig & { ignoreHTTPSErrors?: boolean; extraHTTPHeaders?: Record<string, string> }): Promise<BrowserContext> {
    const browser = await this.getBrowser(config);
    return browser.newContext({
      ...(config.ignoreHTTPSErrors !== undefined ? { ignoreHTTPSErrors: config.ignoreHTTPSErrors } : {}),
      ...(config.extraHTTPHeaders ? { extraHTTPHeaders: config.extraHTTPHeaders } : {}),
    });
  }

  async stop(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
      this.browser = null;
      this.launchConfig = null;
    }
  }

  private async getBrowser(config: BrowserLaunchConfig): Promise<PlaywrightBrowser> {
    if (this.browser && sameLaunchConfig(this.launchConfig, config)) {
      return this.browser;
    }

    if (this.browser) {
      await this.stop();
    }

    const playwright = await this.getPlaywright();
    const launcher = config.browser === "chrome" ? playwright.chromium : playwright.firefox;
    const executablePath = config.executablePath || (await findBrowserExecutable(config.browser));
    if (!executablePath) {
      throw new MissingLibraryException(`No local ${config.browser} executable was found for browser automation.`);
    }

    const launchOptions: LaunchOptions = {
      headless: config.headless ?? true,
      executablePath,
      ...(config.proxy ? { proxy: config.proxy } : {}),
    };

    this.browser = await launcher.launch(launchOptions);
    this.launchConfig = {
      ...config,
      executablePath,
    };

    return this.browser!;
  }

  private async getPlaywright(): Promise<PlaywrightModule> {
    if (!this.playwright) {
      const module = await import("playwright-core");
      this.playwright = module;
    }

    return this.playwright;
  }
}

export async function findBrowserExecutable(browser: EngineBrowserName): Promise<string | null> {
  const envCandidates = browser === "chrome"
    ? [process.env.CHROME_PATH, process.env.CHROMIUM_PATH]
    : [process.env.FIREFOX_PATH];

  for (const candidate of envCandidates) {
    if (candidate && (await exists(candidate))) {
      return candidate;
    }
  }

  const platformCandidates = browser === "chrome" ? chromeCandidates() : firefoxCandidates();
  for (const candidate of platformCandidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function chromeCandidates(): string[] {
  if (process.platform === "win32") {
    return [
      join(process.env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Google/Chrome/Application/chrome.exe"),
      join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
    ];
  }

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }

  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];
}

function firefoxCandidates(): string[] {
  if (process.platform === "win32") {
    return [
      join(process.env.PROGRAMFILES || "C:/Program Files", "Mozilla Firefox/firefox.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Mozilla Firefox/firefox.exe"),
    ];
  }

  if (process.platform === "darwin") {
    return ["/Applications/Firefox.app/Contents/MacOS/firefox"];
  }

  return ["/usr/bin/firefox", "/snap/bin/firefox"];
}

function sameLaunchConfig(left: BrowserLaunchConfig | null, right: BrowserLaunchConfig): boolean {
  if (!left) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
}