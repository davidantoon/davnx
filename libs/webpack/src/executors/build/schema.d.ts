export interface WorkerEntryPoint {
  name: string;
  entryPath: string;
}

export interface AdditionalEntryPoint {
  entryName: string;
  entryPath: string;
}

export interface NodeExternalsConfig {
  allowlist?: string[];
  additionalModuleDirs?: string[];
  importType?: string;
}

export interface BuildExecutorSchema {
  entryFile: string;
  tsConfigFile: string;
  outputPath?: string;
  assets?: string[];
  workers?: WorkerEntryPoint[];
  /** @deprecated Use `workers` instead. */
  additionalEntryPoints?: AdditionalEntryPoint[];
  runtimeDependencies?: string[];
  ormConfigPath?: string;
  migrationsDir?: string;
  memoryLimit?: number;
  generatePackageJson?: boolean;
  buildLibsFromSource?: boolean;
  orgScopes?: string[];
  bundlePackages?: string[];
  nodeExternalsConfig?: NodeExternalsConfig;
  webpackConfigPath?: string;
}
