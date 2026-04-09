import { ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

const workspaceRoot = path.resolve(__dirname, '../../..');

// Port must match config/config.development.yaml
const SERVE_PORT = 3099;

function waitForOutput(proc: ChildProcess, pattern: string | RegExp, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${pattern}" in output.\nCaptured so far:\n${output}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      const match = typeof pattern === 'string' ? output.includes(pattern) : pattern.test(output);
      if (match) {
        clearTimeout(timer);
        resolve(output);
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);

    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Process exited (code=${code}) before pattern "${pattern}" was found.\nOutput:\n${output}`));
    });
  });
}

describe('@davnx/webpack:serve', () => {
  let serveProc: ChildProcess | null = null;

  afterEach(() => {
    if (serveProc && !serveProc.killed) {
      serveProc.kill('SIGTERM');
      serveProc = null;
    }
    // Give the port time to release
    return new Promise((r) => setTimeout(r, 1000));
  });

  it('should start the devserver with multiple children and respond to health checks', async () => {
    serveProc = spawn('npx', ['nx', 'serve', 'test-app', '--skip-nx-cache'], {
      cwd: workspaceRoot,
      env: { ...process.env, NX_DAEMON: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    // test-app has childCount: 2 — wait for both children to report ready
    const output = await waitForOutput(serveProc, /Child#2 ready/);
    expect(output).toContain('Child#1 ready');
    expect(output).toContain('Child#2 ready');
    expect(output).toContain(`Listening on :${SERVE_PORT}`);

    // Give children a moment to fully initialize
    await new Promise((r) => setTimeout(r, 2000));

    // Hit the health endpoint
    const res = await fetch(`http://localhost:${SERVE_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });
});
