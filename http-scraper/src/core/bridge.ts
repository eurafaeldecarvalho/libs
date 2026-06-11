import { createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import koffi from "koffi";

import { ClientException } from "./errors.js";

const RELEASE_TAG = "v0.9.2";
const BRIDGE_VERSION = "3.1";

const GoString = koffi.struct("_GoString_", {
  p: koffi.pointer("char"),
  n: "intptr_t",
});

type BridgeRequest = Record<string, unknown>;

type BridgeFunctions = {
  getOpenPort: () => number;
  startServer: (port: { p: Buffer; n: number }) => void;
  stopServer: () => void;
  destroyAll: () => void;
  destroySession: (sessionId: { p: Buffer; n: number }) => void;
};

export class HrequestsBridge {
  private static instance: HrequestsBridge | null = null;

  static getInstance(): HrequestsBridge {
    if (!HrequestsBridge.instance) {
      HrequestsBridge.instance = new HrequestsBridge();
    }

    return HrequestsBridge.instance;
  }

  private ffi: BridgeFunctions | null = null;
  private port: number | null = null;
  private started = false;
  private startPromise: Promise<void> | null = null;
  private exitHookRegistered = false;

  async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }

    if (!this.startPromise) {
      this.startPromise = this.start();
    }

    await this.startPromise;
  }

  async request(payload: BridgeRequest): Promise<any> {
    await this.ensureStarted();
    return this.postJson("/request", payload);
  }

  async multiRequest(payload: BridgeRequest[]): Promise<any> {
    await this.ensureStarted();
    return this.postJson("/multirequest", payload);
  }

  destroySession(sessionId: string): void {
    if (!this.ffi) {
      return;
    }

    this.ffi.destroySession(this.makeGoString(sessionId));
  }

  stop(): void {
    if (!this.ffi || !this.started) {
      return;
    }

    try {
      this.ffi.stopServer();
    } catch {
    }

    this.started = false;
    this.port = null;
    this.startPromise = null;
  }

  private async start(): Promise<void> {
    const ffi = this.loadFunctions(await ensureBridgeBinary());
    const port = ffi.getOpenPort();
    if (!port) {
      throw new ClientException("Could not find an open port for hrequests-cgo");
    }

    ffi.startServer(this.makeGoString(String(port)));
    await waitForBridge(port);

    this.ffi = ffi;
    this.port = port;
    this.started = true;
    this.registerExitHook();
  }

  private async postJson(path: string, payload: unknown): Promise<any> {
    const response = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new ClientException(`hrequests-cgo request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private url(path: string): string {
    if (!this.port) {
      throw new ClientException("hrequests-cgo bridge is not started");
    }

    return `http://127.0.0.1:${this.port}${path}`;
  }

  private makeGoString(value: string): { p: Buffer; n: number } {
    const buffer = Buffer.from(`${value}\0`, "utf-8");
    return { p: buffer, n: Buffer.byteLength(value) };
  }

  private loadFunctions(libraryPath: string): BridgeFunctions {
    const library = koffi.load(libraryPath);

    return {
      getOpenPort: library.func("GetOpenPort", "int", []) as BridgeFunctions["getOpenPort"],
      startServer: library.func("StartServer", "void", [GoString]) as BridgeFunctions["startServer"],
      stopServer: library.func("StopServer", "void", []) as BridgeFunctions["stopServer"],
      destroyAll: library.func("DestroyAll", "void", []) as BridgeFunctions["destroyAll"],
      destroySession: library.func("DestroySession", "void", [GoString]) as BridgeFunctions["destroySession"],
    };
  }

  private registerExitHook(): void {
    if (this.exitHookRegistered) {
      return;
    }

    this.exitHookRegistered = true;

    const stop = () => {
      this.stop();
    };

    process.once("exit", stop);
    process.once("SIGINT", () => {
      stop();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      stop();
      process.exit(143);
    });
  }
}

export async function ensureBridgeBinary(): Promise<string> {
  const assetName = resolveAssetName();
  const cacheDir = join(getCacheRoot(), "rafaelgdn-http-scraper", "bin");
  const targetPath = join(cacheDir, assetName);

  await mkdir(dirname(targetPath), { recursive: true });

  try {
    await access(targetPath);
    return targetPath;
  } catch {
  }

  const response = await fetch(
    `https://github.com/daijro/hrequests/releases/download/${RELEASE_TAG}/${assetName}`,
  );

  if (!response.ok || !response.body) {
    throw new ClientException(
      `Failed to download hrequests-cgo binary: ${response.status} ${response.statusText}`,
    );
  }

  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(targetPath));
  return targetPath;
}

function getCacheRoot(): string {
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches");
  }

  return process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
}

function resolveAssetName(): string {
  const archMap: Record<string, string> = {
    x64: "amd64",
    ia32: "386",
    arm64: "arm64",
    arm: "arm-7",
    ppc64: "ppc64le",
    riscv64: "riscv64",
    s390x: "s390x",
  };

  const arch = archMap[process.arch];
  if (!arch) {
    throw new ClientException(`Unsupported machine architecture: ${process.arch}`);
  }

  if (process.platform === "darwin") {
    return `hrequests-cgo-${BRIDGE_VERSION}-darwin-${arch}.dylib`;
  }

  if (process.platform === "win32") {
    return `hrequests-cgo-${BRIDGE_VERSION}-windows-4.0-${arch}.dll`;
  }

  if (process.platform === "linux") {
    return `hrequests-cgo-${BRIDGE_VERSION}-linux-${arch}.so`;
  }

  throw new ClientException(`Unsupported platform: ${process.platform}`);
}

async function waitForBridge(port: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 10_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ping`);
      const body = await response.text();
      if (response.ok && body === "pong") {
        return;
      }
    } catch {
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new ClientException("Timed out waiting for hrequests-cgo to start");
}