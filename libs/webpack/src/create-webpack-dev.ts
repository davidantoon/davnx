import { NxAppWebpackPlugin } from '@nx/webpack/app-plugin';
import * as path from 'node:path';
import * as nodeExternals from 'webpack-node-externals';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpack = require('webpack');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

export interface NodeExternalsConfig {
  allowlist?: (string | RegExp)[];
  additionalModuleDirs?: string[];
  importType?: string;
}

export interface DevWebpackOptions {
  appName: string;
  appRoot: string;
  outputDir: string;
  main: string;
  tsConfig: string;
  workspaceRoot: string;
  assets?: string[];
  port: number;
  serviceName: string;
  memoryLimit?: number;
  buildLibsFromSource?: boolean;
  orgScopes?: string[];
  bundlePackages?: string[];
  nodeExternalsConfig?: NodeExternalsConfig;
  webpackConfigPath?: string;
}

class DevServerReloadPlugin {
  private url: string;

  constructor(port: number) {
    this.url = `http://localhost:${port}/webpack/reload`;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply(compiler: any): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiler.hooks.done.tap('DevServerReloadPlugin', async (stats: any) => {
      try {
        if (stats.hasErrors()) return;
        await fetch(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        console.log('[DevServerReloadPlugin] notified devserver to reload');
      } catch {
        console.log('[DevServerReloadPlugin] devserver not running yet');
      }
    });
  }
}

function buildScopePatterns(orgScopes: string[]): { allowlistPatterns: RegExp[]; scopePrefixes: string[] } {
  const allowlistPatterns = orgScopes.map((scope) => new RegExp(`^${scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
  const scopePrefixes = orgScopes.map((scope) => (scope.endsWith('/') ? scope : `${scope}/`));
  return { allowlistPatterns, scopePrefixes };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createDevWebpackConfig(options: DevWebpackOptions): Record<string, any> {
  const {
    appRoot,
    outputDir,
    main,
    tsConfig,
    workspaceRoot,
    assets = [],
    port,
    memoryLimit = 8192,
    buildLibsFromSource = true,
    orgScopes = [],
    bundlePackages = [],
    nodeExternalsConfig: userNodeExternalsConfig,
    webpackConfigPath,
  } = options;

  const { allowlistPatterns, scopePrefixes } = buildScopePatterns(orgScopes);

  // Build combined allowlist: orgScopes + bundlePackages + user-provided
  const bundlePatterns = bundlePackages.map(
    (pkg) => new RegExp(`^${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/|$)`),
  );
  const combinedAllowlist: (string | RegExp)[] = [
    /webpack\/hot\/poll\?100/,
    ...allowlistPatterns,
    ...bundlePatterns,
    ...(userNodeExternalsConfig?.allowlist || []),
  ];

  const config: Record<string, any> = {
    output: {
      path: outputDir,
      ...(process.env.NODE_ENV !== 'production' && {
        devtoolModuleFilenameTemplate: '[absolute-resource-path]',
      }),
      clean: true,
    },
    externals: [
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
        if (request && !(request.startsWith('./') || request.startsWith('..'))) {
          return callback(null, `commonjs ${request}`);
        }
        return callback();
      },
    ],
    mode: 'development',
    devtool: 'eval-cheap-module-source-map',
    plugins: [
      new webpack.HotModuleReplacementPlugin(),
      new NxAppWebpackPlugin({
        target: 'node22',
        compiler: 'tsc',
        main,
        additionalEntryPoints: [],
        verbose: true,
        sourceMap: 'eval-cheap-module-source-map',
        mergeExternals: true,
        externalDependencies: [],
        memoryLimit,
        tsConfig,
        assets,
        optimization: false,
        progress: false,
        outputHashing: 'none',
        generatePackageJson: false,
        watchDependencies: true,
        typeCheckOptions:{
          async: true,
        },
        buildLibsFromSource,
      }),
      new DevServerReloadPlugin(port),
    ],
    snapshot: { managedPaths: [/^(.+?[\\/])?node_modules[\\/]/] },
    watch: true,
    watchOptions: {
      ignored: ['**/*.env.template', '**/config.template.json', '**/*.md', '**/dist/**', '**/migrations/**'],
    },
    cache: { type: 'filesystem' },
  };

  // Apply user webpack overrides if configured
  if (webpackConfigPath) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const overrideModule = require(path.resolve(appRoot, webpackConfigPath));
    const overrideFn = overrideModule.default || overrideModule;
    return overrideFn(config);
  }

  return config;
}
