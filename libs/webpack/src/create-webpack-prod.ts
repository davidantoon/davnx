import { NxAppWebpackPlugin } from '@nx/webpack/app-plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { globSync } from 'glob';
import nodeExternals from 'webpack-node-externals';
import { buildScopePatterns, type NodeExternalsConfig } from './build-scope-patterns';

// eslint-disable-next-line @typescript-eslint/no-require-imports
// const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Configuration = Record<string, any>;

export interface ProdWebpackOptions {
  appName: string;
  appRoot: string;
  outputDir: string;
  main: string;
  tsConfig: string;
  workspaceRoot: string;
  assets?: string[];
  additionalEntryPoints?: Array<{ entryName: string; entryPath: string }>;
  runtimeDependencies?: string[];
  memoryLimit?: number;
  generatePackageJson?: boolean;
  buildLibsFromSource?: boolean;
  ormConfigPath?: string;
  migrationsDir?: string;
  orgScopes?: string[];
  bundlePackages?: string[];
  nodeExternalsConfig?: NodeExternalsConfig;
  webpackConfigPath?: string;
}

export function createProdWebpackConfig(options: ProdWebpackOptions): Configuration[] {
  const {
    appRoot,
    outputDir,
    main,
    tsConfig,
    workspaceRoot,
    assets = [],
    additionalEntryPoints = [],
    runtimeDependencies = [],
    memoryLimit = 8192,
    generatePackageJson = true,
    buildLibsFromSource = false,
    ormConfigPath,
    migrationsDir = './src/migrations',
    orgScopes = [],
    bundlePackages = [],
    nodeExternalsConfig: userNodeExternalsConfig,
    webpackConfigPath,
  } = options;

  const { allowlistPatterns, scopePrefixes, scopePatterns } = buildScopePatterns(orgScopes);

  // Build combined allowlist: orgScopes + bundlePackages + user-provided
  const bundlePatterns = bundlePackages.map(
    (pkg) => new RegExp(`^${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`),
  );
  const combinedAllowlist: (string | RegExp)[] = [
    ...allowlistPatterns,
    ...bundlePatterns,
    ...(userNodeExternalsConfig?.allowlist || []),
  ];

  // Detect ormconfig.ts for the app so we can build it for TypeORM CLI in production
  let resolvedOrmConfigPath: string | null;
  if (ormConfigPath !== undefined) {
    resolvedOrmConfigPath = ormConfigPath ? path.join(appRoot, ormConfigPath) : null;
  } else {
    const candidate = path.join(appRoot, './src/ormconfig.ts');
    resolvedOrmConfigPath = fs.existsSync(candidate) ? candidate : null;
  }
  const hasOrmconfig = resolvedOrmConfigPath && fs.existsSync(resolvedOrmConfigPath);

  const webpackConfigs: Configuration[] = [];

  const externalsConfig = [
    nodeExternals({
      allowlist: combinedAllowlist,
      additionalModuleDirs: userNodeExternalsConfig?.additionalModuleDirs || [],
      ...(userNodeExternalsConfig?.importType && { importType: userNodeExternalsConfig.importType }),
    }),
    ({ request }: { request?: string }, callback: (err?: null | Error, result?: string) => void) => {
      if (
        request &&
        (request.startsWith(path.join(workspaceRoot, 'apps')) ||
          request.startsWith(path.join(workspaceRoot, 'libs')))
      ) {
        return callback();
      }
      if (request && scopePrefixes.some((prefix) => request.startsWith(prefix))) {
        return callback();
      }
      if (request && scopePatterns.some((pattern) => pattern.test(request))) {
        return callback();
      }
      if (request && bundlePatterns.some((pattern) => pattern.test(request))) {
        return callback();
      }
      if (request && !(request.startsWith('./') || request.startsWith('..'))) {
        return callback(null, `commonjs ${request}`);
      }
      return callback();
    },
  ];

  const productionBuildConfig: Configuration = {
    externals: externalsConfig,
    output: {
      path: outputDir,
      clean: false,
    },
    devtool: 'inline-source-map',
    mode: 'production',
    plugins: [
      new NxAppWebpackPlugin({
        target: 'node22',
        compiler: 'tsc',
        main,
        additionalEntryPoints,
        externalDependencies: [],
        mergeExternals: true,
        memoryLimit,
        tsConfig,
        assets,
        namedChunks: true,
        optimization: true,
        outputHashing: 'none',
        generatePackageJson,
        runtimeDependencies,
        buildLibsFromSource,
        typeCheckOptions: {
          async: false,
        },
        sourceMap: 'inline-source-map',
        progress: false,
      }),
    ],
  };

  webpackConfigs.push(productionBuildConfig);

  if (hasOrmconfig && resolvedOrmConfigPath) {
    const migrationsEntryPoints: Array<{ entryName: string; entryPath: string }> = [];
    const migrationsGlobPath = path.join(appRoot, migrationsDir, '*.ts');
    const migrationFiles = globSync(migrationsGlobPath);
    migrationFiles.forEach((filename) => {
      const migrationName = path.basename(filename, '.ts');
      migrationsEntryPoints.push({
        entryName: `migrations/${migrationName}`,
        entryPath: filename,
      });
    });

    const ormconfigRelative = './' + path.relative(appRoot, resolvedOrmConfigPath);

    const ormconfigBuildConfig: Configuration = {
      ...productionBuildConfig,
      output: {
        ...productionBuildConfig.output,
        filename: (pathData: { runtime?: string }) => {
          if (pathData.runtime === 'main') {
            return 'ormconfig.js';
          }
          return '[name].js';
        },
        library: {
          type: 'commonjs',
        },
        clean: false,
      },
      devtool: false,
      plugins: [
        new NxAppWebpackPlugin({
          target: 'node22',
          compiler: 'tsc',
          main: ormconfigRelative,
          externalDependencies: [],
          additionalEntryPoints: migrationsEntryPoints,
          mergeExternals: true,
          tsConfig,
          assets: [],
          namedChunks: true,
          memoryLimit,
          optimization: false,
          outputHashing: 'none',
          generatePackageJson: false,
          buildLibsFromSource,
          skipTypeChecking: true,
          sourceMap: false,
          progress: !process.env.CI,
        }),
      ],
    };
    webpackConfigs.push(ormconfigBuildConfig);
  }

  // Apply user webpack overrides if configured
  if (webpackConfigPath) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const overrideModule = require(path.resolve(appRoot, webpackConfigPath));
    const overrideFn = overrideModule.default || overrideModule;
    return webpackConfigs.map((config) => overrideFn(config));
  }

  return webpackConfigs;
}
