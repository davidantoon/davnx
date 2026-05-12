---
name: davnx-webpack
description: "Guide for setting up NestJS server projects with @davnx/webpack build and serve executors. Use this skill whenever a user needs to configure an Nx project with @davnx/webpack, create a main entry file with devserver support, add worker processes (queue consumers, event listeners), configure bundling with orgScopes, set up gateway middleware, or troubleshoot webpack-based NestJS builds. Also use when the user mentions davnx, webpack executors, devserver mode, createChildApp, or worker entry points."
---

# @davnx/webpack — NestJS Build & Serve Setup Guide

Custom Nx executors for building and serving NestJS applications with webpack. Provides production builds with full optimization and a multi-process dev server with hot module reload.

## Architecture Overview

```
Production (nx build):
  webpack compiles main.js + worker bundles → dist/apps/{name}/

Development (nx serve):
  webpack watch → main.devserver.ts (parent)
                    ├── Child#1 (HTTP handler via Unix socket) ──┐
                    ├── Child#2 (HTTP handler via Unix socket) ──┤ round-robin
                    ├── [worker:queue-processor] (standalone)    │
                    └── [worker:event-listener] (standalone)     │
                  public port ← reverse proxy ───────────────────┘
```

The dev server uses a parent/child architecture:
- **Parent** listens on a stable public port, proxies requests via round-robin to healthy children
- **Children** (`APP_RUNNER=1`) load the webpack bundle, call `global.createChildApp()` to bootstrap NestJS, and listen on Unix sockets
- **Workers** are standalone processes that run compiled worker bundles — they do NOT bind to any port and are restarted on each reload

## Quick Start

### 1. Configure `project.json`

```json
{
  "name": "my-service",
  "targets": {
    "build": {
      "executor": "@davnx/webpack:build",
      "dependsOn": ["^build"],
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json"
      }
    },
    "serve": {
      "executor": "@davnx/webpack:serve",
      "options": {
        "entryFile": "./src/main.ts",
        "tsConfigFile": "./tsconfig.app.json"
      }
    }
  }
}
```

### 2. Create a Dual-Mode Entry Point (`src/main.ts`)

The entry file must support two modes: **standalone** (production) and **devserver** (development). The devserver sets `DEVSERVER_MODE=1` and expects `global.createChildApp` to be a factory function.

```typescript
import * as http from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

type BuiltChildApp = {
  handler: http.RequestListener;
  serviceConfig: { port: number | string };
  close: () => Promise<void>;
};

async function createApp() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter());
  return app;
}

async function startStandalone(): Promise<void> {
  const app = await createApp();
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Listening on :${port}`);
}

async function createChildApp(): Promise<BuiltChildApp> {
  const app = await createApp();
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();
  return {
    handler: (req, res) => fastify.routing(req, res),
    serviceConfig: { port: 0 },
    close: () => app.close(),
  };
}

// Register factory — devserver calls it via global.createChildApp()
(global as Record<string, unknown>).createChildApp = createChildApp;

if (process.env.DEVSERVER_MODE !== '1') {
  startStandalone().catch((err) => {
    console.error('Startup failed', err);
    process.exit(1);
  });
}
```

The `BuiltChildApp` contract is critical — the devserver expects:
- `handler`: raw `http.RequestListener` (from Fastify or Express)
- `serviceConfig`: object with `port` (can be `0` in dev)
- `close()`: graceful shutdown — called when the devserver hot-swaps to a new bundle

### 3. Run

```bash
nx serve my-service   # development with hot reload
nx build my-service   # production build → dist/apps/my-service/
```

## Workers

Workers are **background processes** — queue consumers, event listeners, scheduled jobs. They must NOT bind to any HTTP port. They are compiled as separate webpack entry points and run as standalone child processes managed by the devserver parent.

### Configuring Workers

Add the `workers` array to **both** build and serve targets:

```json
{
  "build": {
    "executor": "@davnx/webpack:build",
    "options": {
      "entryFile": "./src/main.ts",
      "tsConfigFile": "./tsconfig.app.json",
      "workers": [
        { "name": "queue-processor", "entryPath": "./src/workers/queue-processor.ts" },
        { "name": "event-listener", "entryPath": "./src/workers/event-listener.ts" }
      ]
    }
  },
  "serve": {
    "executor": "@davnx/webpack:serve",
    "options": {
      "entryFile": "./src/main.ts",
      "tsConfigFile": "./tsconfig.app.json",
      "workers": [
        { "name": "queue-processor", "entryPath": "./src/workers/queue-processor.ts" },
        { "name": "event-listener", "entryPath": "./src/workers/event-listener.ts" }
      ]
    }
  }
}
```

- `name` — output filename without `.js` extension (e.g., `"queue-processor"` → `queue-processor.js`)
- `entryPath` — path to the worker entry file, `./` paths are relative to project root

### Worker Entry File Pattern

```typescript
// src/workers/queue-processor.ts
import { NestFactory } from '@nestjs/core';
import { QueueProcessorModule } from './queue-processor.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(QueueProcessorModule);
  console.log(`[queue-processor] started (pid=${process.pid})`);
  // The NestJS application context stays alive processing events/queues
  // Do NOT call app.listen() — workers must not bind to any port
}

bootstrap().catch((err) => {
  console.error('[queue-processor] failed to start', err);
  process.exit(1);
});
```

Use `NestFactory.createApplicationContext()` (not `create()`) since workers don't need an HTTP adapter. The process stays alive as long as there are active event listeners (queue connections, timers, etc).

### Worker Lifecycle

| Phase | Build (`nx build`) | Serve (`nx serve`) |
|-------|-------------------|--------------------|
| Compile | Webpack bundles `[name].js` alongside `main.js` | Webpack watch compiles all entries together |
| Minify | Terser post-processes worker bundles | Skipped in dev |
| Run | Not started (deploy separately) | Parent devserver forks each worker as a child process |
| Reload | N/A | Workers are killed and respawned on each webpack rebuild |

## Bundling Control

By default, all `node_modules` are externalized (not bundled). Use `orgScopes` and `bundlePackages` to override this for packages that must be bundled.

### `orgScopes`

Controls which packages are bundled instead of externalized. Supports 4 modes:

| Pattern | Matches | Example |
|---------|---------|---------|
| `@myorg` | All packages under the org | `@myorg/foo`, `@myorg/bar` |
| `@myorg/prefix` | Packages with that prefix | `@myorg/prefix-a`, `@myorg/prefix-b` |
| `/^regex/` | Custom regex | `/^@internal\/.*/` |
| `lodash` | Exact package + subpaths | `lodash`, `lodash/merge` |

```json
{
  "orgScopes": ["@myorg", "@shared/common", "/^@internal\\/.*/"]
}
```

### `bundlePackages`

Force specific packages to be bundled:

```json
{
  "bundlePackages": ["lodash", "class-transformer"]
}
```

### `nodeExternalsConfig`

Fine-grained control over `webpack-node-externals`:

```json
{
  "nodeExternalsConfig": {
    "allowlist": ["some-esm-only-pkg"],
    "additionalModuleDirs": ["../../shared-modules"],
    "importType": "commonjs"
  }
}
```

## Dev Server Options

### Gateway Middleware

Simulate an API gateway locally by injecting headers before requests are proxied to the NestJS app. The middleware runs in the parent process.

```json
{
  "serve": {
    "executor": "@davnx/webpack:serve",
    "options": {
      "gateway": {
        "middleware": "./gateway-middleware.js"
      }
    }
  }
}
```

The middleware file must export a function:

```javascript
// gateway-middleware.js
module.exports = function (req, config) {
  // req  — Node.js IncomingMessage (mutate req.headers)
  // config — parsed YAML from config/config.{configEnv}.yaml

  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    // Decode JWT, inject headers that the production gateway would add
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64').toString()
    );
    req.headers['x-tenant-id'] = payload.tenantId;
    req.headers['x-user-id'] = payload.sub;
  }
};
```

### `servePrefix`

Mimics production gateway path routing. When set, the devserver enforces that all requests start with `/{prefix}/` — requests without it get a 404, matching production behavior.

```json
{ "servePrefix": "my-service" }
```
Result: `http://localhost:3050/my-service/health` works, `http://localhost:3050/health` returns 404.

### `serviceName`

Overrides the service name used for config YAML resolution and socket directory naming. Does **not** affect URL prefix — use `servePrefix` for that.

```json
{ "serviceName": "my-custom-name" }
```

### `configEnv`

Selects which config YAML to load: `config/config.{configEnv}.yaml`. Defaults to `"development"`. Useful for running different configurations locally:

```json
{
  "serve:staging": {
    "executor": "@davnx/webpack:serve",
    "options": {
      "configEnv": "staging"
    }
  }
}
```

### `childCount`

Number of HTTP child processes. Defaults to `1`. Increase to test round-robin load balancing locally.

## Hot-Reload Gotchas

### Externalized `AsyncLocalStorage` singletons

If a library you depend on creates an `AsyncLocalStorage` and calls `.enterWith(...)` **once at module top-level** (e.g. `@frontegg/context`, or many request-scoping libs), and that package is **externalized** (default for everything in `node_modules`), then:

- First boot works — `enterWith` runs, the store is set.
- After a hot reload, the bundle is re-evaluated but the externalized module is reused from `require.cache`. Its top-level code does NOT run again — no fresh `enterWith`. The new app's bootstrap runs in a different async chain where `getStore()` is `undefined`. Code paths that do `scope.get(...)` (typically logger middleware fired from `onModuleInit`) crash with:

  ```
  TypeError: Cannot read properties of undefined (reading 'get')
  ```

  …and the devserver reports *No healthy children available*.

**Fix** — in your bundle entry (or wherever runs every reload), re-enter the store before bootstrap. Only the bundled side knows which library to fix up, so this belongs in the app, not the devserver:

```ts
// src/bootstrap.ts (re-evaluated on every reload)
import { defaultScope } from '@frontegg/context'; // or your own ALS-based scope

if (process.env.DEVSERVER_MODE === '1') {
  // The scope's `ns` (AsyncLocalStorage) survives the reload, but its store
  // doesn't propagate to the new async chain. Re-enter a fresh Map here.
  (defaultScope as unknown as { ns: { enterWith: (s: Map<unknown, unknown>) => void } })
    .ns.enterWith(new Map());
}
```

See `examples/main-entry.md` → *Re-entering AsyncLocalStorage on reload* for the full pattern.

## Reference Files

For complete schema details, read:
- `references/build-schema.md` — all build executor options with types and defaults
- `references/serve-schema.md` — all serve executor options with types and defaults

For real-world code patterns, read:
- `examples/project-json.md` — project.json configurations (minimal, with workers, multiple serve targets)
- `examples/main-entry.md` — main.ts patterns (minimal HTTP, NestJS+Fastify, with bootstrap utilities)
- `examples/worker-entry.md` — worker patterns (minimal, NestJS queue consumer)
- `examples/gateway-middleware.md` — gateway middleware with JWT decoding
