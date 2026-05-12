export interface WorkerEntryPoint {
  name: string;
  entryPath: string;
}

export interface NodeExternalsConfig {
  allowlist?: string[];
  additionalModuleDirs?: string[];
  importType?: string;
}

export interface GatewayConfig {
  middleware: string;
}

export interface ServeExecutorSchema {
  entryFile: string;
  tsConfigFile: string;
  outputPath?: string;
  assets?: string[];
  workers?: WorkerEntryPoint[];
  configEnv?: string;
  memoryLimit?: number;
  childCount?: number;
  buildLibsFromSource?: boolean;
  orgScopes?: string[];
  bundlePackages?: string[];
  nodeExternalsConfig?: NodeExternalsConfig;
  webpackConfigPath?: string;
  serviceName?: string;
  servePrefix?: string;
  gateway?: GatewayConfig;
}
