# @davnx/webpack

[![npm](https://img.shields.io/npm/v/@davnx/webpack)](https://www.npmjs.com/package/@davnx/webpack)
[![license](https://img.shields.io/npm/l/@davnx/webpack)](./LICENSE)

Custom Nx executors for building and serving NestJS applications with webpack. Includes a multi-process development server with hot module reload and round-robin load balancing.

## Installation

```bash
npm install -D @davnx/webpack
# or
yarn add -D @davnx/webpack
```

**Peer dependencies** (must be installed in your workspace):

- `webpack` ^5.0.0
- `@nx/webpack` >=20.0.0
- `@nx/devkit` >=20.0.0

## Quick Start

Add the executors to your NestJS app's `project.json`:

```json
{
  "targets": {
    "build": {
      "executor": "@davnx/webpack:build",
      "dependsOn": ["^build"],
      "options": {
        "entryFile": "./src/deployments/service/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "orgScopes": ["@myorg"]
      }
    },
    "serve": {
      "executor": "@davnx/webpack:serve",
      "options": {
        "entryFile": "./src/deployments/service/main.ts",
        "tsConfigFile": "./tsconfig.app.json",
        "orgScopes": ["@myorg"]
      }
    }
  }
}
```

Then run:

```bash
nx serve my-app    # Development with hot reload
nx build my-app    # Production build
```

## Executors

### `@davnx/webpack:build`

Production webpack build for NestJS applications. Compiles your application with full type checking, tree shaking, and generates a deployable `package.json`.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entryFile` | `string` | `./src/deployments/service/main.ts` | Entry point file (relative to project root) |
| `tsConfigFile` | `string` | `./tsconfig.app.json` | TypeScript config file |
| `outputPath` | `string` | `dist/{projectRoot}` | Output directory (relative to workspace root) |
| `assets` | `string[]` | `[]` | Static assets to copy to the output |
| `additionalEntryPoints` | `object[]` | `[]` | Extra webpack entry points (`{ entryName, entryPath }`) |
| `runtimeDependencies` | `string[]` | `[]` | Extra dependencies for the generated `package.json` |
| `ormConfigPath` | `string` | auto-detect | Path to `ormconfig.ts` (empty string to disable) |
| `migrationsDir` | `string` | `./src/migrations` | TypeORM migrations directory |
| `memoryLimit` | `number` | `8192` | Memory limit (MB) for the TypeScript type checker |
| `generatePackageJson` | `boolean` | `true` | Generate a `package.json` in the output directory |
| `buildLibsFromSource` | `boolean` | `false` | Read workspace libraries from source instead of pre-built dist |
| `orgScopes` | `string[]` | `[]` | Org scopes to bundle into the output (e.g. `["@myorg"]`) |
| `bundlePackages` | `string[]` | `[]` | Explicit package names to force-bundle (e.g. `["lodash"]`) |
| `nodeExternalsConfig` | `object` | `{}` | Override options for `webpack-node-externals` (see [Externals Configuration](#externals-configuration)) |
| `webpackConfigPath` | `string` | — | Path to a JS/TS file exporting a `(config) => config` override function (see [Webpack Overrides](#webpack-overrides)) |

#### TypeORM Support

If an `ormconfig.ts` file is detected in `src/ormconfig.ts` (or at the path specified by `ormConfigPath`), the build executor automatically creates a second webpack compilation that bundles:

- `ormconfig.js` — the TypeORM CLI configuration
- `migrations/*.js` — all migration files from `migrationsDir`

This allows running TypeORM CLI commands (`typeorm migration:run`) directly against the production build output.

#### Example: Full Configuration

```json
{
  "build": {
    "executor": "@davnx/webpack:build",
    "dependsOn": ["^build"],
    "options": {
      "entryFile": "./src/deployments/service/main.ts",
      "tsConfigFile": "./tsconfig.app.json",
      "outputPath": "dist/apps/my-api",
      "orgScopes": ["@myorg"],
      "additionalEntryPoints": [
        { "entryName": "worker", "entryPath": "./src/deployments/worker/main.ts" }
      ],
      "runtimeDependencies": ["pg", "redis"],
      "assets": ["apps/my-api/src/assets"]
    }
  }
}
```

### `@davnx/webpack:serve`

Development server with webpack watch mode, async type checking, and an integrated multi-process HTTP server with hot module reload.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entryFile` | `string` | `./src/deployments/service/main.ts` | Entry point file |
| `tsConfigFile` | `string` | `./tsconfig.app.json` | TypeScript config file |
| `outputPath` | `string` | `dist/{projectRoot}` | Output directory |
| `assets` | `string[]` | `[]` | Static assets to copy |
| `configEnv` | `string` | `development` | Config YAML environment (`config/config.{env}.yaml`) |
| `memoryLimit` | `number` | `8192` | Memory limit (MB) for the TypeScript type checker |
| `childCount` | `number` | `1` | Number of child worker processes |
| `buildLibsFromSource` | `boolean` | `true` | Read workspace libraries from source for faster dev builds |
| `orgScopes` | `string[]` | `[]` | Org scopes to bundle (e.g. `["@myorg"]`) |
| `bundlePackages` | `string[]` | `[]` | Explicit package names to force-bundle (e.g. `["lodash"]`) |
| `nodeExternalsConfig` | `object` | `{}` | Override options for `webpack-node-externals` (see [Externals Configuration](#externals-configuration)) |
| `webpackConfigPath` | `string` | — | Path to a JS/TS file exporting a `(config) => config` override function (see [Webpack Overrides](#webpack-overrides)) |
| `serviceName` | `string` | — | Service name for config resolution and socket directory naming. Overrides the value from config YAML. |
| `servePrefix` | `string` | `""` | URL path prefix for the devserver (e.g. `"agenshield"` → `/agenshield/`). Empty string means no prefix. Independent of `serviceName`. |

#### How the Dev Server Works

The serve executor runs a multi-process architecture:

```
┌─────────────────────────────────────────────┐
│  Webpack (watch mode)                       │
│  Compiles on file change → triggers reload  │
└──────────────┬──────────────────────────────┘
               │ POST /webpack/reload
               ▼
┌─────────────────────────────────────────────┐
│  Parent Process (port from config YAML)     │
│  Round-robin load balancer                  │
│  Service prefix enforcement                 │
├────────────┬────────────────────────────────┤
│ Child #1   │ Child #2   │ ... Child #N      │
│ NestJS app │ NestJS app │ NestJS app        │
│ Unix sock  │ Unix sock  │ Unix sock         │
└────────────┴────────────┴───────────────────┘
```

1. **Webpack watches** for file changes and recompiles
2. On successful build, a **reload signal** is sent to the parent process
3. The parent forwards the reload to all **child processes** via IPC
4. Each child **hot-swaps** the NestJS application in-process (no restart needed)
5. Incoming HTTP requests are **round-robin proxied** to healthy children
6. If a child crashes, the parent **respawns** it automatically

#### Config Resolution

The serve executor reads `config/config.{configEnv}.yaml` from the workspace root to resolve:

- `port` — the port the dev server listens on (default: `3050`)
- `serviceName` — used for socket directory naming and config resolution (does **not** affect URL prefix)

```yaml
# config/config.development.yaml
port: 3050
serviceName: my-api
```

#### URL Prefix

By default, the devserver has **no URL prefix** — requests go directly to `/`. To simulate production gateway behavior where services are mounted at a path prefix, set `servePrefix` in your `project.json`:

```json
{
  "serve": {
    "executor": "@davnx/webpack:serve",
    "options": {
      "servePrefix": "my-api"
    }
  }
}
```

With `servePrefix: "my-api"`, the devserver enforces that all requests start with `/my-api/` and strips the prefix before forwarding to the application. Requests without the prefix return 404.

## NestJS Bootstrap Contract

Your application's entry point must implement a dual-mode bootstrap pattern to support both standalone production and devserver development modes.

### How It Works

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Production** | `node dist/.../main.js` | Starts normally via `startStandalone()` — binds to a port |
| **Development** | `nx serve` | Devserver sets `DEVSERVER_MODE=1`, loads the bundle, and calls `global.createChildApp()` — the app bootstraps without binding to a port |

### Required Type

```typescript
export type BuiltChildApp = {
  handler: http.RequestListener;             // Raw HTTP request handler (Fastify/Express)
  serviceConfig: { port: number | string };  // Service configuration
  close: () => Promise<void>;                // Cleanup function for graceful shutdown
};
```

### Entry Point Template

```typescript
// src/deployments/service/main.ts
import '../tracing/service'; // must be first for APM instrumentation
import { createAppModule } from './app.module';
import {
  createStandaloneFunction,
  createChildAppFunction,
  bootstrapDevServerIfNeeded,
} from '../bootstrap';

const appModule = createAppModule();
const startStandalone = createStandaloneFunction(appModule);
const createChildApp = createChildAppFunction(appModule);
bootstrapDevServerIfNeeded(startStandalone, createChildApp);
```

### Bootstrap Implementation

```typescript
// src/deployments/bootstrap.ts
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import * as http from 'node:http';

export function createStandaloneFunction(appModule: any) {
  return async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      appModule,
      new FastifyAdapter(),
    );
    await app.listen(process.env.PORT || 3000, '0.0.0.0');
  };
}

export function createChildAppFunction(appModule: any) {
  return async (): Promise<BuiltChildApp> => {
    const app = await NestFactory.create<NestFastifyApplication>(
      appModule,
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    return {
      handler: app.getHttpServer() as http.RequestListener,
      serviceConfig: { port: process.env.PORT || 3000 },
      close: () => app.close(),
    };
  };
}

export function bootstrapDevServerIfNeeded(
  startStandalone: () => Promise<void>,
  createChildApp: () => Promise<BuiltChildApp>,
) {
  if (process.env.DEVSERVER_MODE === '1') {
    // Devserver mode: export factory for the devserver to call
    (global as any).createChildApp = createChildApp;
  } else {
    // Standalone mode: start the app normally
    startStandalone();
  }
}
```

## Externals Configuration

By default, all `node_modules` are externalized (not bundled) except:
- Packages matching `orgScopes` (monorepo org scopes)
- Workspace paths (`apps/`, `libs/`)

Use `bundlePackages` and `nodeExternalsConfig` for fine-grained control over what gets bundled vs. externalized.

### `bundlePackages`

Force-bundle specific npm packages into the output:

```json
{
  "options": {
    "orgScopes": ["@myorg"],
    "bundlePackages": ["lodash", "date-fns"]
  }
}
```

### `nodeExternalsConfig`

Override [webpack-node-externals](https://github.com/liady/webpack-node-externals) options:

```json
{
  "options": {
    "nodeExternalsConfig": {
      "allowlist": ["some-esm-only-pkg"],
      "additionalModuleDirs": ["../../shared-modules"],
      "importType": "module"
    }
  }
}
```

The `allowlist` entries are **appended** to the auto-generated patterns from `orgScopes` and `bundlePackages`.

## Webpack Overrides

For advanced customization (custom plugins, loaders, output tweaks), point `webpackConfigPath` to a JS file that exports a transform function:

```json
{
  "options": {
    "webpackConfigPath": "./webpack.overrides.js"
  }
}
```

```js
// webpack.overrides.js
const { BannerPlugin } = require('webpack');

module.exports = (config) => {
  // Add a custom plugin
  config.plugins.push(new BannerPlugin({ banner: '/* custom banner */' }));

  // Modify output settings
  config.output.library = { type: 'commonjs2' };

  return config;
};
```

The override function receives the fully-built webpack config and must return the modified config. For the build executor, it is called on each config in the array (main build + ORM config if present).

## Programmatic API

The webpack config generators can be used directly for custom build setups:

```typescript
import { createProdWebpackConfig, createDevWebpackConfig } from '@davnx/webpack';

// Production config
const prodConfigs = createProdWebpackConfig({
  appName: 'my-app',
  appRoot: '/path/to/app',
  outputDir: '/path/to/dist',
  main: './src/main.ts',
  tsConfig: './tsconfig.app.json',
  workspaceRoot: '/path/to/workspace',
  orgScopes: ['@myorg'],
});

// Development config
const devConfig = createDevWebpackConfig({
  appName: 'my-app',
  appRoot: '/path/to/app',
  outputDir: '/path/to/dist',
  main: './src/main.ts',
  tsConfig: './tsconfig.app.json',
  workspaceRoot: '/path/to/workspace',
  port: 3050,
  serviceName: 'my-app',
  orgScopes: ['@myorg'],
});
```

### `createProdWebpackConfig(options)`

Returns an array of webpack configurations. The first config is always the main application build. If an `ormconfig.ts` is detected, a second config for TypeORM migrations is included.

### `createDevWebpackConfig(options)`

Returns a single webpack configuration with watch mode enabled, HMR, async type checking, filesystem caching, and the `DevServerReloadPlugin` that notifies the devserver after each successful build.

## Key Features

- **Node 22 target** — compiled with `target: node22` for modern JavaScript
- **Org scope bundling** — packages matching `orgScopes` are bundled into the output instead of being externalized, useful for monorepo packages
- **Async type checking** — `fork-ts-checker-webpack-plugin` runs type checking in a separate process so builds aren't blocked
- **Filesystem caching** — webpack cache persists across dev rebuilds for fast incremental compilation
- **Auto package.json** — production builds generate a `package.json` with only the runtime dependencies needed
- **Source maps** — inline source maps in production, eval source maps in development
- **Multi-child devserver** — scale development with multiple child processes for parallel request handling

## License

MIT
