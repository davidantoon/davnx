## 1.2.2 (2026-11-26)

### 🩹 Fixes

- **webpack:** publish the built package, not its sources ([7811eda](https://github.com/davidantoon/davnx/commit/7811eda))

### ❤️ Thank You

- David Antoon

## 1.2.1 (2026-11-26)

### 🩹 Fixes

- **webpack:** the dev server survives a redirect from the app ([bb4856c](https://github.com/davidantoon/davnx/commit/bb4856c))

### ❤️ Thank You

- David Antoon

# Changelog

## 1.1.0

### Added

- **Worker entry points** — new `workers` array in the build executor. Each worker produces a self-contained, minified `[name].js` bundle via terser. Replaces the deprecated `additionalEntryPoints` option. See [Workers](./README.md#workers) in the README.

- **TypeScript schema definitions** — added `schema.d.ts` files for both `build` and `serve` executors, providing type-safe option interfaces (`BuildExecutorSchema`, `ServeExecutorSchema`).

- **Source-mode development** — the serve executor auto-detects compiled JS vs TypeScript source and registers `@swc-node/register` when needed, so the dev server runs directly from source without a separate compile step.

- **JSON schema improvements** — added `$id` identifiers, `x-completion-glob` hints for IDE autocompletion, `x-deprecated` markers, and `additionalProperties: false` for stricter validation on both executor schemas.

### Changed

- **Build pipeline** — split into `compile` and `build` targets; `executors.json` paths are rewritten post-compilation (`./src/` → `./`).

- **Additional entry points** now pass through NxAppWebpackPlugin's native `additionalEntryPoints` option instead of manual `EntryPlugin` injection.

### Deprecated

- `additionalEntryPoints` build option — use `workers` instead.

## 1.0.4

### Added

- **Gateway middleware** — pluggable request middleware for the dev server. Configure `gateway.middleware` in the serve executor options to point to a JS file that modifies request headers before proxying. Useful for simulating API gateways locally (e.g., decoding JWTs and injecting auth headers). The middleware receives the raw `IncomingMessage` and the parsed YAML config. See [Gateway Middleware](./README.md#gateway-middleware) in the README.

## 1.0.3

- Initial public release with `build` and `serve` executors.
