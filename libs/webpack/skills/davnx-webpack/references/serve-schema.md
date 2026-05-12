# Serve Executor Schema — `@davnx/webpack:serve`

Webpack watch mode with integrated multi-process dev server for NestJS applications.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entryFile` | `string` | `./src/main.ts` | Main entry-point file, relative to project root. **Required.** |
| `tsConfigFile` | `string` | `./tsconfig.app.json` | TypeScript config file, relative to project root. **Required.** |
| `outputPath` | `string` | `dist/{projectRoot}` | Output directory, relative to workspace root. |
| `assets` | `string[]` | `[]` | Static assets to copy. |
| `workers` | `WorkerEntryPoint[]` | `[]` | Worker entry points. Each produces a separate `[name].js` bundle compiled alongside main in watch mode. Workers are forked as child processes by the devserver. |
| `configEnv` | `string` | `"development"` | Environment name for config YAML resolution (`config/config.{env}.yaml`). |
| `memoryLimit` | `number` | `8192` | Memory limit in MB for TypeScript type checker. |
| `childCount` | `number` | `1` | Number of HTTP child processes for the devserver. |
| `buildLibsFromSource` | `boolean` | `true` | Read workspace libraries from source (faster dev builds). |
| `orgScopes` | `string[]` | `[]` | Patterns to bundle instead of externalizing. |
| `bundlePackages` | `string[]` | `[]` | Explicit package names to force-bundle. |
| `nodeExternalsConfig` | `object` | — | Override `webpack-node-externals` options. |
| `webpackConfigPath` | `string` | — | JS/TS file exporting `(config) => config` for custom webpack overrides. |
| `serviceName` | `string` | _(from config YAML or project name)_ | Service name for config resolution and socket directory naming. Does NOT affect URL prefix. |
| `servePrefix` | `string` | `""` | URL path prefix (e.g., `"myapp"` → `/myapp/`). Enforced — requests without it get 404. |
| `gateway` | `object` | — | Dev gateway middleware configuration. |

## Gateway Config

```typescript
interface GatewayConfig {
  middleware: string; // Path to JS file (relative to project root)
}
```

The middleware file exports: `(req: IncomingMessage, config: Record<string, unknown>) => void`

## Dev Server Lifecycle

1. Webpack starts in watch mode (`mode: 'development'`, `devtool: 'eval-cheap-module-source-map'`)
2. Async type checking (`async: true`) — does not block builds
3. Filesystem caching for fast incremental rebuilds
4. On first successful build: forks `main.devserver` process
5. Devserver parent spawns `childCount` HTTP children + all configured workers
6. `DevServerReloadPlugin` POSTs to `/webpack/reload` after each successful build
7. On reload: HTTP children hot-swap the bundle in-place; workers are killed and respawned

## Config YAML Resolution

The serve executor reads `config/config.{configEnv}.yaml` from the workspace root to resolve:
- `port` — devserver port (default: 3050)
- `serviceName` — overridable via the `serviceName` option

## Environment Variables

The devserver reads these from the serve executor:
- `PORT` — public server port
- `SERVICE_NAME` — service name
- `SERVE_PREFIX` — URL prefix
- `CHILD_COUNT` — number of HTTP children
- `BUNDLE_PATH` — path to compiled webpack bundle
- `GATEWAY_MIDDLEWARE` — absolute path to gateway middleware file
- `GATEWAY_CONFIG` — JSON-stringified YAML config
- `WORKERS` — JSON array of worker names
