# HTTP Scraper

`@rafaelgdn/http-scraper` is a Node.js port of `hrequests`, built to preserve the same API direction in a package that can be published to npm.

## Scope

- Requests-like HTTP API
- TLS-fingerprinted requests through the official `hrequests-cgo` bridge
- Sessions, cookies, lazy/background requests, and concurrent mapping
- HTML parsing helpers inspired by `hrequests`
- Optional browser automation support through a local browser

## Status

This package is being ported from `hrequests` 0.9.2.

## Install

```bash
pnpm install
```

The package will try to download the official `hrequests-cgo` binary for the current platform during `postinstall`. If that step is skipped or fails, the binary is downloaded lazily on first use.

## Usage

```ts
import { Session, get } from "@rafaelgdn/http-scraper";

const response = await get("https://example.com");
console.log(response.status_code);
console.log(response.html.find("title")?.text);

const session = new Session({ browser: "firefox" });
const page = await session.get("https://example.com");
console.log(page.cookies.getDict());
```

### Query Params, Proxies, And Hooks

```ts
import { Session } from "@rafaelgdn/http-scraper";

const session = new Session({ browser: "chrome" });

const response = await session.get("https://httpbin.org/get", {
	params: { page: 2, tag: ["alpha", "beta"] },
	proxies: {
		https: "http://user:pass@proxy.example:8080"
	},
	hooks: {
		response: (result) => {
			console.log(result.status_code);
		}
	}
});

console.log(response.url);
```

### Concurrent Requests

```ts
import { Session, async_get, map } from "@rafaelgdn/http-scraper";

const session = new Session();
const jobs = [
	session.async_get("https://example.com"),
	async_get("https://example.org")
];

const responses = await map(jobs, 2);
console.log(responses.map((item) => item.toString()));
```

## Browser Mode

Browser automation is implemented inside this package with `playwright-core`. To use `response.render()` or `session.render()`, the host machine needs a local Chrome/Chromium or Firefox executable available in a standard path or in one of these environment variables:

- `CHROME_PATH`
- `CHROMIUM_PATH`
- `FIREFOX_PATH`

## Current Notes

- HTTP requests, sessions, cookies, concurrency helpers, and HTML parsing are wired through the official upstream `hrequests-cgo` bridge.
- Browser automation is isolated to this package and does not depend on `@rafaelgdn/browser-scraper`.
- Multipart uploads currently support `Buffer`, `Uint8Array`, and `string` inputs directly.

## Release

- Run `pnpm release:check` before publishing.
- The current first npm release target is `0.1.0` on the `latest` tag.
- A full release checklist is available in `RELEASING.md`.

## License

This package is an independent Node port that follows the public `hrequests` project and reuses the official `hrequests-cgo` bridge binary published by the upstream project.