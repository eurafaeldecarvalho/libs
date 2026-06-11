# Releasing

## Target

- Package name: `@rafaelgdn/http-scraper`
- Initial version: `0.1.0`
- Default npm dist-tag: `latest`
- Provenance: enabled in `publishConfig`

## Checklist

1. Run `pnpm install`.
2. Run `pnpm release:check`.
3. Inspect the generated tarball in `./.pack/`.
4. Optionally run a live smoke test after `pnpm build`.
5. Publish with `npm publish --access public --tag latest --provenance`.

## Prereleases

- Use versions like `0.2.0-beta.1` for prereleases.
- Publish prereleases with `npm publish --access public --tag next --provenance`.

## Notes

- `postinstall` downloads the upstream `hrequests-cgo` bridge for the current platform.
- Browser automation depends on a local Chrome/Chromium or Firefox executable being available on the host machine.