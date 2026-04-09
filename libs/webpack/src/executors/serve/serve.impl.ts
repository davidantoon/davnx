import * as path from 'node:path';
import * as fs from 'node:fs';
import { fork, ChildProcess } from 'node:child_process';
import * as yaml from 'js-yaml';
import { createDevWebpackConfig } from '../../create-webpack-dev';
import type { ServeExecutorSchema } from './schema';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpack = require('webpack');

interface ExecutorContext {
  root: string;
  projectName?: string;
  projectsConfigurations?: {
    projects: Record<string, { root: string }>;
  };
}

/**
 * Dev serve executor — webpack watch mode with integrated devserver.
 *
 * Owns the full devserver lifecycle:
 * 1. Starts webpack in watch mode
 * 2. On first successful build, forks main.devserver.js with proper env vars
 * 3. On subsequent builds, POSTs /webpack/reload to devserver
 * 4. On shutdown, cleans up devserver and webpack watcher
 */
async function* serveExecutor(
  options: ServeExecutorSchema,
  context: ExecutorContext,
): AsyncGenerator<{ success: boolean; baseUrl?: string }> {
  process.env.NODE_ENV = 'development';

  const projectConfig = context.projectsConfigurations!.projects[context.projectName!];
  const workspaceRoot = context.root;
  const projectRoot = path.join(workspaceRoot, projectConfig.root);
  const outputPath = options.outputPath
    ? path.join(workspaceRoot, options.outputPath)
    : path.join(workspaceRoot, 'dist', projectConfig.root);

  // Resolve port and serviceName from config YAML
  const configEnv = options.configEnv || 'development';
  const configFilePath = path.join(workspaceRoot, 'config', `config.${configEnv}.yaml`);
  let port = 3050;
  let serviceName = context.projectName!;
  let yamlConfig: Record<string, unknown> = {};
  if (fs.existsSync(configFilePath)) {
    yamlConfig = yaml.load(fs.readFileSync(configFilePath, 'utf8')) as Record<string, unknown>;
    port = Number(yamlConfig.port) || port;
    serviceName = (yamlConfig.serviceName as string) || serviceName;
  }
  if (options.serviceName) {
    serviceName = options.serviceName;
  }
  const servePrefix = options.servePrefix ?? '';

  // Resolve gateway middleware
  let gatewayMiddlewarePath: string | undefined;
  let gatewayConfigJson: string | undefined;
  if (options.gateway?.middleware) {
    gatewayMiddlewarePath = path.resolve(projectRoot, options.gateway.middleware);
    gatewayConfigJson = JSON.stringify(yamlConfig);
  }

  // Resolve entry/tsconfig relative to project root (absolute paths avoid
  // NxAppWebpackPlugin's normalizeRelativePaths collision with executor options)
  const entryFile = options.entryFile || './src/deployments/service/main.ts';
  const tsConfigFile = options.tsConfigFile || './tsconfig.app.json';
  const resolvedMain = path.resolve(projectRoot, entryFile);
  const resolvedTsConfig = path.resolve(projectRoot, tsConfigFile);

  // Build dev webpack config
  const config = createDevWebpackConfig({
    appName: context.projectName!,
    appRoot: projectRoot,
    outputDir: outputPath,
    main: resolvedMain,
    tsConfig: resolvedTsConfig,
    assets: options.assets || [],
    port,
    serviceName,
    memoryLimit: options.memoryLimit || 8192,
    buildLibsFromSource: options.buildLibsFromSource !== false,
    workspaceRoot,
    orgScopes: options.orgScopes || [],
    bundlePackages: options.bundlePackages || [],
    nodeExternalsConfig: options.nodeExternalsConfig,
    webpackConfigPath: options.webpackConfigPath,
  });

  // State
  let devserverProcess: ChildProcess | null = null;
  let firstBuildComplete = false;

  // Path to the devserver script (compiled JS in the same package)
  const devserverScript = path.join(__dirname, '../../main.devserver.js');
  // Absolute path to the webpack bundle the devserver should load
  const bundlePath = path.join(outputPath, 'main.js');

  function cleanup() {
    if (devserverProcess && !devserverProcess.killed) {
      devserverProcess.kill('SIGTERM');
      devserverProcess = null;
    }
  }

  // Register cleanup on process signals
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;
  const signalHandlers = signals.map((sig) => {
    const handler = () => cleanup();
    process.on(sig, handler);
    return { sig, handler };
  });
  process.on('exit', cleanup);

  function startDevServer() {
    if (!fs.existsSync(devserverScript)) {
      console.error(`[serve] devserver script not found at ${devserverScript}`);
      return;
    }

    devserverProcess = fork(devserverScript, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PORT: String(port),
        SERVICE_NAME: serviceName,
        SERVE_PREFIX: servePrefix,
        CHILD_COUNT: String(options.childCount || process.env.CHILD_COUNT || 1),
        BUNDLE_PATH: bundlePath,
        ...(gatewayMiddlewarePath && { GATEWAY_MIDDLEWARE: gatewayMiddlewarePath }),
        ...(gatewayConfigJson && { GATEWAY_CONFIG: gatewayConfigJson }),
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      // Compiled JS — no @swc-node/register needed
      execArgv: ['--enable-source-maps'],
    });

    devserverProcess.on('exit', (code, signal) => {
      if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
        console.error(`[serve] devserver exited unexpectedly (code=${code}, signal=${signal})`);
      }
      devserverProcess = null;
    });

    console.log(`[serve] Devserver started on port ${port} (service: ${serviceName}${servePrefix ? `, prefix: /${servePrefix}` : ''})`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function _notifyDevServerReload() {
    if (!devserverProcess || devserverProcess.killed) {
      console.log('[serve] Devserver not running, restarting...');
      startDevServer();
      return;
    }

    fetch(`http://localhost:${port}/webpack/reload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then(() => console.log('[serve] Notified devserver to reload'))
      .catch((err: Error) => {
        console.warn('[serve] Failed to notify devserver, restarting...', err.message);
        cleanup();
        startDevServer();
      });
  }

  // Start webpack in watch mode
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { watch: _watch, ...normalizedConfig } = config;
  const compiler = webpack(normalizedConfig);

  // Event queue for the async generator
  let resolveNext: ((result: { success: boolean; baseUrl?: string }) => void) | null = null;
  const pendingResults: Array<{ success: boolean; baseUrl?: string }> = [];

  function pushResult(result: { success: boolean; baseUrl?: string }) {
    if (resolveNext) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve(result);
    } else {
      pendingResults.push(result);
    }
  }

  function waitForNext(): Promise<{ success: boolean; baseUrl?: string }> {
    if (pendingResults.length > 0) {
      return Promise.resolve(pendingResults.shift()!);
    }
    return new Promise((resolve) => { resolveNext = resolve; });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const watching = compiler.watch(config.watchOptions || {}, (err: any, stats: any) => {
    if (err) {
      console.error('[serve] Webpack error:', err);
      pushResult({ success: false });
      return;
    }

    const hasErrors = stats.hasErrors();
    console.info(stats.toString({ colors: true, chunks: false, assets: true }));

    if (hasErrors) {
      // Don't kill the devserver — keep the last good build running
      pushResult({ success: false });
      return;
    }

    if (!firstBuildComplete) {
      firstBuildComplete = true;
      startDevServer();
    }
    // Note: subsequent reloads are handled by DevServerReloadPlugin in webpack config
    // which POSTs to /webpack/reload. We don't need to do it here since the plugin fires
    // after each successful build.

    pushResult({
      success: true,
      baseUrl: `http://localhost:${port}`,
    });
  });

  // Main generator loop: yield each build result
  try {
    while (true) {
      const result = await waitForNext();
      yield result;
    }
  } finally {
    // Generator was returned/thrown (Nx killed the executor)
    watching.close(() => {});
    cleanup();
    // Remove signal handlers
    signalHandlers.forEach(({ sig, handler }) => process.removeListener(sig, handler));
  }
}

export default serveExecutor;
module.exports = serveExecutor;
module.exports.default = serveExecutor;
