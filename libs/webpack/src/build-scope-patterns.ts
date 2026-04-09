export interface NodeExternalsConfig {
  allowlist?: (string | RegExp)[];
  additionalModuleDirs?: string[];
  importType?: string;
}

export interface ScopePatterns {
  allowlistPatterns: RegExp[];
  scopePrefixes: string[];
  scopePatterns: RegExp[];
}

export function buildScopePatterns(orgScopes: string[]): ScopePatterns {
  const allowlistPatterns: RegExp[] = [];
  const scopePrefixes: string[] = [];
  const scopePatterns: RegExp[] = [];

  for (const scope of orgScopes) {
    if (!scope) continue;

    const regexMatch = scope.match(/^\/(.+)\/([gimsuy]*)$/);

    if (regexMatch) {
      // Regex: /pattern/flags — strip 'g' flag to avoid stateful lastIndex in .test()
      const flags = regexMatch[2].replace('g', '');
      const regex = new RegExp(regexMatch[1], flags);
      allowlistPatterns.push(regex);
      scopePatterns.push(regex);
    } else if (scope.includes('/')) {
      // Prefix: @frontegg/agenshield → matches @frontegg/agenshield*
      const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      allowlistPatterns.push(new RegExp(`^${escaped}`));
      scopePrefixes.push(scope);
    } else if (scope.startsWith('@')) {
      // Org scope: @myorg → matches @myorg/*
      const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      allowlistPatterns.push(new RegExp(`^${escaped}/`));
      scopePrefixes.push(scope.endsWith('/') ? scope : `${scope}/`);
    } else {
      // Exact package name: lodash → matches lodash and lodash/subpath
      const escaped = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`^${escaped}(/|$)`);
      allowlistPatterns.push(regex);
      scopePatterns.push(regex);
    }
  }

  return { allowlistPatterns, scopePrefixes, scopePatterns };
}
