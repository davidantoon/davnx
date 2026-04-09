import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';

const workspaceRoot = path.resolve(__dirname, '../../..');
const distDir = path.join(workspaceRoot, 'dist/apps/test-app');

describe('@davnx/webpack:build', () => {
  beforeAll(() => {
    // Clean previous output
    fs.rmSync(distDir, { recursive: true, force: true });

    // Run the build
    execSync('npx nx build test-app', {
      cwd: workspaceRoot,
      stdio: 'pipe',
      env: { ...process.env, NX_DAEMON: 'false' },
      timeout: 90_000,
    });
  });

  it('should produce main.js bundle', () => {
    const mainJs = path.join(distDir, 'main.js');
    expect(fs.existsSync(mainJs)).toBe(true);

    const content = fs.readFileSync(mainJs, 'utf-8');
    // Should contain our handler code
    expect(content).toContain('health');
    expect(content).toContain('hello');
  });

  it('should produce worker.js bundle', () => {
    const workerJs = path.join(distDir, 'worker.js');
    expect(fs.existsSync(workerJs)).toBe(true);

    const content = fs.readFileSync(workerJs, 'utf-8');
    expect(content).toContain('worker');
  });

  it('should generate package.json', () => {
    const pkgPath = path.join(distDir, 'package.json');
    expect(fs.existsSync(pkgPath)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.name).toBeDefined();
    expect(pkg.dependencies).toBeDefined();
  });

  it('should produce valid JavaScript (main.js is require-able)', () => {
    const mainJs = path.join(distDir, 'main.js');
    // Run the bundle in a child process with DEVSERVER_MODE to avoid starting a server
    const result = execSync(
      `node -e "process.env.DEVSERVER_MODE='1'; require('${mainJs.replace(/\\/g, '\\\\')}'); console.log('OK');"`,
      { cwd: distDir, stdio: 'pipe', timeout: 10_000 },
    );
    expect(result.toString().trim()).toContain('OK');
  });

  it('should include source maps', () => {
    const mainJs = path.join(distDir, 'main.js');
    const content = fs.readFileSync(mainJs, 'utf-8');
    // Inline source maps (sourceMappingURL=data:...)
    expect(content).toContain('sourceMappingURL');
  });
});
