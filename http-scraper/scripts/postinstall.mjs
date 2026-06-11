import { createWriteStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const RELEASE_TAG = "v0.9.2";
const BRIDGE_VERSION = "3.1";

function getCacheRoot() {
    if (process.platform === "win32") {
        return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    }

    if (process.platform === "darwin") {
        return join(homedir(), "Library", "Caches");
    }

    return process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
}

function getAssetName() {
    const archMap = {
        x64: "amd64",
        ia32: "386",
        arm64: "arm64",
        arm: "arm-7",
        ppc64: "ppc64le",
        riscv64: "riscv64",
        s390x: "s390x"
    };

    const arch = archMap[process.arch];
    if (!arch) {
        throw new Error(`Unsupported architecture: ${process.arch}`);
    }

    if (process.platform === "darwin") {
        return `hrequests-cgo-${BRIDGE_VERSION}-darwin-${arch}.dylib`;
    }

    if (process.platform === "win32") {
        return `hrequests-cgo-${BRIDGE_VERSION}-windows-4.0-${arch}.dll`;
    }

    return `hrequests-cgo-${BRIDGE_VERSION}-linux-${arch}.so`;
}

async function ensureBridge() {
    const assetName = getAssetName();
    const cacheDir = join(getCacheRoot(), "rafaelgdn-http-scraper", "bin");
    const targetPath = join(cacheDir, assetName);

    await mkdir(dirname(targetPath), { recursive: true });

    try {
        await access(targetPath);
        return;
    } catch {
    }

    const url = `https://github.com/daijro/hrequests/releases/download/${RELEASE_TAG}/${assetName}`;
    const response = await fetch(url);

    if (!response.ok || !response.body) {
        throw new Error(`Failed to download ${assetName}: ${response.status} ${response.statusText}`);
    }

    await pipeline(response.body, createWriteStream(targetPath));
}

ensureBridge().catch((error) => {
    console.warn(`[http-scraper] postinstall bridge download skipped: ${error.message}`);
});