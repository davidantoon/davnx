# Build Executor Schema — `@davnx/webpack:build`

Production webpack build for NestJS applications. Targets Node 22.

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `entryFile` | `string` | `./src/main.ts` | Main entry-point file, relative to project root. **Required.** |
| `tsConfigFile` | `string` | `./tsconfig.app.json` | TypeScript config file, relative to project root. **Required.** |
| `outputPath` | `string` | `dist/{projectRoot}` | Output directory, relative to workspace root. |
| `assets` | `string[]` | `[]` | Static assets to copy to output. |
| `workers` | `WorkerEntryPoint[]` | `[]` | Worker entry points. Each produces a self-contained, minified `[name].js` bundle. |
| `additionalEntryPoints` | _(deprecated)_ | `[]` | Use `workers` instead. |
| `runtimeDependencies` | `string[]` | `[]` | Extra dependencies to include in generated `package.json`. |
| `ormConfigPath` | `string` | _(auto-detect)_ | Path to `ormconfig.ts`. Set to `""` to disable. Auto-detects `src/ormconfig.ts`. |
| `migrationsDir` | `string` | `./src/migrations` | Migrations directory for TypeORM bundle. |
| `memoryLimit` | `number` | `8192` | Memory limit in MB for the TypeScript type checker. |
| `generatePackageJson` | `boolean` | `true` | Generate `package.json` in output with only needed runtime dependencies. |
| `buildLibsFromSource` | `boolean` | `false` | Read buildable workspace libraries from source instead of pre-built dist. |
| `orgScopes` | `string[]` | `[]` | Patterns to bundle instead of externalizing. See SKILL.md for pattern syntax. |
| `bundlePackages` | `string[]` | `[]` | Explicit package names to force-bundle. |
| `nodeExternalsConfig` | `object` | — | Override `webpack-node-externals` options. |
| `webpackConfigPath` | `string` | — | JS/TS file exporting `(config) => config` for custom webpack overrides. |

## WorkerEntryPoint

```typescript
interface WorkerEntryPoint {
  name: string;      // Output filename without .js extension
  entryPath: string; // Path to entry file ('./' = relative to project root)
}
```

## NodeExternalsConfig

```typescript
interface NodeExternalsConfig {
  allowlist?: string[];            // Extra patterns to bundle
  additionalModuleDirs?: string[]; // Extra dirs to scan for externals
  importType?: string;             // Module type for externals (default: 'commonjs')
}
```

## Build Pipeline

1. Webpack compiles `main.js` + additional entry points (workers) with:
   - `mode: 'production'`, `devtool: 'inline-source-map'`
   - Full optimization, tree shaking, named chunks
   - Sync type checking (`async: false`)
2. If `ormconfig.ts` exists: second webpack compilation bundles `ormconfig.js` + `migrations/*.js`
3. Post-processing: worker bundles are minified via Terser (`keep_classnames: true`, inline source maps)
4. Output: `dist/{projectRoot}/main.js`, `[worker-name].js`, `package.json`
