import * as path from 'node:path';
import { createProdWebpackConfig } from '../../create-webpack-prod';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpack = require('webpack');

export interface BuildExecutorOptions {
  entryFile: string;
  tsConfigFile: string;
  outputPath?: string;
  assets?: string[];
  additionalEntryPoints?: Array<{ entryName: string; entryPath: string }>;
  runtimeDependencies?: string[];
  ormConfigPath?: string;
  migrationsDir?: string;
  memoryLimit?: number;
  generatePackageJson?: boolean;
  buildLibsFromSource?: boolean;
  orgScopes?: string[];
  bundlePackages?: string[];
  nodeExternalsConfig?: {
    allowlist?: string[];
    additionalModuleDirs?: string[];
    importType?: string;
  };
  webpackConfigPath?: string;
}

interface ExecutorContext {
  root: string;
  projectName?: string;
  projectsConfigurations?: {
    projects: Record<string, { root: string }>;
  };
}

/**
 * Production webpack build executor for NestJS applications.
 */
async function* buildExecutor(
  options: BuildExecutorOptions,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean; outfile?: string }> {
  process.env.NODE_ENV = 'production';

  const projectConfig = context.projectsConfigurations!.projects[context.projectName!];
  const workspaceRoot = context.root;
  const projectRoot = path.join(workspaceRoot, projectConfig.root);
  const outputPath = options.outputPath
    ? path.join(workspaceRoot, options.outputPath)
    : path.join(workspaceRoot, 'dist', projectConfig.root);

  // Resolve entry/tsconfig relative to project root (absolute paths avoid
  // NxAppWebpackPlugin's normalizeRelativePaths collision with executor options)
  const entryFile = options.entryFile || './src/deployments/service/main.ts';
  const tsConfigFile = options.tsConfigFile || './tsconfig.app.json';
  const resolvedMain = path.resolve(projectRoot, entryFile);
  const resolvedTsConfig = path.resolve(projectRoot, tsConfigFile);

  const configs = createProdWebpackConfig({
    appName: context.projectName!,
    appRoot: projectRoot,
    outputDir: outputPath,
    main: resolvedMain,
    tsConfig: resolvedTsConfig,
    assets: options.assets || [],
    additionalEntryPoints: options.additionalEntryPoints || [],
    runtimeDependencies: options.runtimeDependencies || [],
    memoryLimit: options.memoryLimit || 8192,
    generatePackageJson: options.generatePackageJson !== false,
    buildLibsFromSource: options.buildLibsFromSource || false,
    ormConfigPath: options.ormConfigPath,
    migrationsDir: options.migrationsDir || './src/migrations',
    workspaceRoot,
    orgScopes: options.orgScopes || [],
    bundlePackages: options.bundlePackages || [],
    nodeExternalsConfig: options.nodeExternalsConfig,
    webpackConfigPath: options.webpackConfigPath,
  });

  const configArray = Array.isArray(configs) ? configs : [configs];

  for (const config of configArray) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { watch: _watch, ...normalizedConfig } = config;
    const compiler = webpack(normalizedConfig);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stats: any = await new Promise((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      compiler.run((err: Error | null, stats: any) => {
        if (err) return reject(err);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        compiler.close((closeErr: any) => {
          if (closeErr) console.error('[build] webpack close error:', closeErr);
        });
        resolve(stats);
      });
    });

    console.info(stats.toString(config.stats || { colors: true, chunks: false }));

    if (stats.hasErrors()) {
      yield { success: false };
      return;
    }
  }

  yield { success: true, outfile: path.join(outputPath, 'main.js') };
}

export default buildExecutor;
module.exports = buildExecutor;
module.exports.default = buildExecutor;
