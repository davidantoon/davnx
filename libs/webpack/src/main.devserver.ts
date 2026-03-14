// Parent/Child dual-mode runner with multi-child round-robin + hot reload.
//
// Parent (default):
//  - Stable public port (env.PORT or first free >= 8100).
//  - Spawns N children (env.CHILD_COUNT, default 2), each runs this file with APP_RUNNER=1.
//  - Round-robin load balancing to healthy children.
//  - POST /webpack/reload:
//      * forwards 'reload' to all healthy children (they hot-swap in-process)
//      * respawns any unhealthy/crashed children
//  - If a child crashes, it is marked unhealthy; parent keeps serving via others.
//  - If ALL are down, parent returns 503 with last errors. Parent only dies on user interrupt.
//
// Child (APP_RUNNER=1):
//  - Loads webpack bundle (BUNDLE_PATH, default ./main.js) exporting global.createChildApp().
//  - createChildApp() bootstraps NestJS+Fastify, returns a raw http.RequestListener handler.
//  - Child wraps handler in http.createServer on a Unix socket; reports {type:'ready', socketPath} via IPC.
//  - On 'reload' IPC or POST /webpack/reload, closes old app, re-imports bundle, swaps handler in-place.

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fork, ChildProcess } from 'node:child_process';
import * as http from 'node:http';
import * as readline from 'node:readline';
import * as inspector from 'node:inspector';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const httpProxy = require('http-proxy');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prettyFactory } = require('pino-pretty');

// ----------------------------- Shared Config ----------------------------------
const BUNDLE_PATH = process.env.BUNDLE_PATH?.trim() || './main.js';
const SERVICE_NAME = process.env.SERVICE_NAME || '';
const SERVICE_PREFIX = SERVICE_NAME ? `/${SERVICE_NAME}` : '';

// ----------------------------- Socket Helpers ---------------------------------
const SOCK_DIR = path.join(os.tmpdir(), `${SERVICE_NAME || 'agencloud'}-devserver`);

function childSockPath(id: number): string {
  return path.join(SOCK_DIR, `child-${id}.sock`);
}

function cleanupSock(sockPath: string | undefined): void {
  if (!sockPath) return;
  try { fs.unlinkSync(sockPath); } catch {}
}

// ----------------------------- Child Types ------------------------------------
type BuiltChildApp = {
  handler: http.RequestListener;
  serviceConfig: { port: number | string };
  close: () => Promise<void>;
};

// delete from CJS cache + require fresh
async function importFresh<T = unknown>(spec: string): Promise<T> {
  process.env.DEVSERVER_MODE = '1';
  const resolved = path.isAbsolute(spec) ? spec : path.join(__dirname, spec);
  eval(`delete require.cache["${resolved}"]`); // delete from CJS cache
  return eval(`require("${resolved}")`) as T;
}

function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number) {
  let t: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}


// ===================================================================================
// CHILD MODE (APP_RUNNER=1) — loads bundle, bootstraps NestJS app, listens on socket
// ===================================================================================
if (process.env.APP_RUNNER === '1') {
  (async () => {
    let current: BuiltChildApp | null = null;
    let swapping = false;

    // Delegate starts as 503; swapped to the real handler after first boot
    let delegate: http.RequestListener = (_req, res) => {
      res.statusCode = 503;
      res.end('starting');
    };

    async function swapNow(): Promise<BuiltChildApp> {
      if (swapping) return current!;
      swapping = true;

      // ── Stale-handler cleanup ──
      // @frontegg/nestjs-common/app-builder registers process.on('uncaughtException')
      // during build() and never removes it on close. After swap, the OLD handler
      // fires during background teardown and crashes because its AsyncLocalStorage
      // context is destroyed. Fix: wipe all handlers before re-import, then add
      // a safe catch-all. The fresh bundle will register its own valid handlers.
      process.removeAllListeners('uncaughtException');
      process.removeAllListeners('unhandledRejection');
      process.on('uncaughtException', (err, origin) => {
        console.error(`[child] uncaughtException (${origin}):`, err);
      });
      process.on('unhandledRejection', (reason) => {
        // Suppress known stale-context rejections from previous app's background teardown.
        const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
        if (msg.includes('FronteggContextScope') || msg.includes('populateLoggerMetadata')) {
          return; // swallow — old app context is gone, nothing to do
        }
        console.error('[child] unhandledRejection:', reason);
      });

      await importFresh(BUNDLE_PATH);

      if (typeof (global as Record<string, unknown>).createChildApp !== 'function') {
        swapping = false;
        throw new Error(
          `Bundle '${BUNDLE_PATH}' does not export createChildApp(). ` +
          `Ensure your deployments/service/main.ts sets global.createChildApp when DEVSERVER_MODE === '1'.`
        );
      }

      const next: BuiltChildApp = await ((global as Record<string, unknown>).createChildApp as () => Promise<BuiltChildApp>)();

      const prev = current;
      current = next;
      delegate = next.handler;
      console.log(`[child] Swapped to fresh app (previous closing in background)`);

      if (prev) prev.close().catch(err => console.error('[child] background close error:', err));

      swapping = false;
      return next;
    }

    // Create ONE debounced swapper that lives across requests
    const debouncedSwap = debounce(async () => {
      try {
        console.log('[child] /webpack/reload');
        await swapNow();
      } catch (e) {
        console.error('[child] reload failed:', e);
      }
    }, 250);

    // Raw HTTP server: admin reload endpoint + delegate all else to NestJS handler
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/webpack/reload') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        debouncedSwap();
        return;
      }
      delegate(req, res);
    });

    const sockPath = process.env.CHILD_SOCK_PATH!;

    // boot once, then listen on Unix socket
    try {
      await swapNow();
      const resolvedBundle = path.isAbsolute(BUNDLE_PATH) ? BUNDLE_PATH : path.join(__dirname, BUNDLE_PATH);
      console.log(`[child] Using bundle: ${resolvedBundle}`);
      cleanupSock(sockPath); // remove stale socket from previous run
      server.listen(sockPath, () => {
        console.log(`[child] Listening on ${sockPath}`);
        if (process.send) process.send({ type: 'ready', socketPath: sockPath });
      });
    } catch (err) {
      console.error('[child] Startup error:', err);
      if (process.send) process.send({ type: 'boot-error', error: String((err as Error)?.stack || err) });
      process.exitCode = 1;
      return;
    }

    // IPC reload handler (parent-initiated reloads)
    process.on('message', async (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return;
      if ((msg as Record<string, unknown>).type === 'reload') {
        try {
          await swapNow();
          if (process.send) process.send({ type: 'reloaded', socketPath: sockPath });
        } catch (e) {
          console.error('[child] reload error:', e);
          if (process.send) process.send({ type: 'reload-error', error: String((e as Error)?.stack || e) });
        }
      }
    });

    process.on('beforeExit', () => {
      try {
        inspector?.close?.();
      } catch {
      }
    });
    const shutdown = async (sig: string) => {
      console.log(`[child ${sig}] shutting down…`);
      const closingApp = current?.close().catch(err => console.error('[child] close error:', err));
      const closingServer = new Promise<void>(resolve => server.close(() => resolve()));
      cleanupSock(sockPath);
      setTimeout(() => process.exit(0), 700).unref();
      await Promise.all([closingApp, closingServer]);
      process.exit(0);
    };
    ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGUSR2'].forEach(sig => {
      process.on(sig as NodeJS.Signals, () => {
        inspector?.close?.();
        void shutdown(sig);
      });
    });
  })();
} else {
// ===================================================================================
// PARENT MODE — multi-child mgmt, round-robin proxy, reload, resilience
// ===================================================================================
  type ChildInfo = {
    id: number;
    proc: ChildProcess;
    socketPath?: string;
    healthy: boolean;
    lastError?: string | null;
  };

  // ---------- Colored prefix helpers (no deps) ----------
  const COLORS = [
    '\x1b[36m', // cyan
    '\x1b[33m', // yellow
    '\x1b[35m', // magenta
    '\x1b[32m', // green
    '\x1b[34m', // blue
    '\x1b[31m' // red
  ];
  const RESET = '\x1b[0m';
  const CHILD_COUNT = Math.max(1, Number(process.env.CHILD_COUNT || 1));

  const colorFor = (id: number): string => {
    return COLORS[(id - 1) % COLORS.length];
  };
  const tagFor = (id: number): string => {

    if(CHILD_COUNT ===1){
      return ''
    }
    const base = `[child#${id}] `;
    return `${colorFor(id)}${base}${RESET}`;
  };

  const isJsonLog = (log:string)=>{
    return log.startsWith('{') && log.endsWith('}');
  }
  const wireChildLogging = (info: ChildInfo) => {
    const prettyLog = prettyFactory({
      sync: true,
      colorize: true,
      crlf: true,
      messageKey: 'message',
      errorLikeObjectKeys: ['err', 'error'],
      errorProps: 'type,message,stack',
      ignore: [
        'logContext', 'context', 'hostname', 'req', 'res', 'err.driverError',
        'module', 'cloudEnvironment',
        'frontegg-application-id', 'frontegg-tenant-id',
        'frontegg-trace-id', 'frontegg-vendor-id',
        'host', 'service', 'version',
        'err', 'error',
      ].join(','),
      messageFormat: '{if module}[{module}] {end}{if context}[{context}] {end}{if logContext}[{logContext}] {end}{message}',
      customPrettifiers: {
        stack: (value: unknown) => '\n' + String(value),
      },
    });

    const write = (kind: 'stdout' | 'stderr', line: string) => {
      const dest = kind === 'stdout' ? process.stdout : process.stderr;
      const log = isJsonLog(line) ? prettyLog(line) : `${line}\n`;
      dest.write(`${tagFor(info.id)}${log}`);
    };

    const attach = (stream: NodeJS.ReadableStream | null | undefined, kind: 'stdout' | 'stderr') => {
      if (!stream) return;
      const rl = readline.createInterface({ input: stream });
      rl.on('line', (line) => write(kind, line));
      rl.on('close', () => {});
    };

    attach(info.proc.stdout, 'stdout');
    attach(info.proc.stderr, 'stderr');
  };

  (async () => {
    // Ensure socket directory exists
    fs.mkdirSync(SOCK_DIR, { recursive: true });

    const proxy = httpProxy.createProxyServer({});

    let publicPort = Number(process.env.PORT) || 0;
    if (!publicPort) publicPort = 9090;

    const children: ChildInfo[] = [];
    let nextId = 1;
    let rrIndex = 0;

    function healthyChildren() {
      return children.filter(c => c.healthy && typeof c.socketPath === 'string');
    }

    function pickChild(): ChildInfo | null {
      const healthy = healthyChildren();
      if (healthy.length === 0) return null;
      const idx = rrIndex % healthy.length;
      rrIndex = (rrIndex + 1) % healthy.length;
      return healthy[idx];
    }

    async function spawnChild(): Promise<ChildInfo> {
      const id = nextId++;
      const sockPath = childSockPath(id);
      cleanupSock(sockPath); // remove stale socket

      const proc = fork(__filename, {
        env: {
          ...process.env,
          APP_RUNNER: '1',
          CHILD_SOCK_PATH: sockPath,
          CHILD_DEBUG_PORT: CHILD_COUNT == 1 ? '1' : '0',
        },
        stdio: ['inherit', 'pipe', 'pipe', 'ipc'],
        // Compiled JS — no @swc-node/register needed
        execArgv: ['--enable-source-maps']
      });
      const info: ChildInfo = { id, proc, healthy: false, lastError: null };

      proc.on('message', (msg: unknown) => {
        if (!msg || typeof msg !== 'object') return;
        const m = msg as Record<string, unknown>;

        if (m.type === 'ready') {
          info.socketPath = String(m.socketPath);
          info.healthy = true;
          console.log(`[parent] Child#${info.id} ready on socket ${info.socketPath}`);
        } else if (m.type === 'inspector-url') {
          console.log(`[parent] Child#${info.id} inspector: ${m.url}`);
        } else if (m.type === 'reloaded') {
          info.socketPath = String(m.socketPath);
          info.healthy = true;
          console.log(`[parent] Child#${info.id} hot-swapped on socket ${info.socketPath}`);
        } else if (m.type === 'reload-error') {
          info.lastError = String(m.error || 'unknown reload error');
          console.error(`[parent] Child#${info.id} reload error: ${info.lastError}`);
          info.healthy = false;
        } else if (m.type === 'boot-error') {
          info.lastError = String(m.error || 'unknown boot error');
          console.error(`[parent] Child#${info.id} boot error: ${info.lastError}`);
          info.healthy = false;
        }
      });

      proc.on('exit', (code, signal) => {
        const clean = signal === 'SIGINT' || signal === 'SIGTERM' || code === 0;
        if (clean) {
          console.log(`[parent] Child#${info.id} exited cleanly (code=${code}, signal=${signal ?? 'none'})`);
        } else {
          console.error(`[parent] Child#${info.id} crashed (code=${code}, signal=${signal ?? 'none'})`);
          if (!info.lastError) info.lastError = `Child exited abnormally (code=${code}, signal=${signal ?? 'none'})`;
        }
        info.healthy = false;
        cleanupSock(info.socketPath);
        info.socketPath = undefined;
      });

      children.push(info);
      // connect stdout/stderr now that it's piped
      wireChildLogging(info);

      return info;
    }

    async function ensurePoolSize(n: number) {
      const live = children.filter(c => c.proc.killed === false);
      const need = n - live.length;
      for (let i = 0; i < need; i++) {
        await spawnChild();
      }
    }

    async function respawnUnhealthy() {
      // Kill & replace children that are unhealthy or missing socketPaths
      const toReplace = children.filter(c => !c.healthy || typeof c.socketPath !== 'string');
      await Promise.all(toReplace.map(async (c) => {
        try {
          c.proc.kill('SIGTERM');
        } catch { /* ignore */
        }
        cleanupSock(c.socketPath);
        c.socketPath = undefined;
        // Remove from array
        const idx = children.indexOf(c);
        if (idx >= 0) children.splice(idx, 1);
        // Spawn a fresh one
        await spawnChild();
      }));
    }

    // Create ONE debounced forwarder that lives across requests
    const debouncedForwardReload = debounce(async () => {
      const healthies = healthyChildren();
      if (healthies.length > 0) {
        console.log(`[parent] Forwarding reload to ${healthies.length} child(ren)`);
        for (const c of healthies) c.proc.send?.({ type: 'reload' });
      }
      await respawnUnhealthy();
    }, 200);

    // Start parent server (stable port)
    const server = http.createServer(async (req, res) => {
      // Admin endpoint: trigger rolling hot-reload & respawn crashed
      if (req.method === 'POST' && req.url === '/webpack/reload') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        debouncedForwardReload();
        return;
      }

      // Enforce service prefix (mimics production gateway)
      if (SERVICE_PREFIX) {
        if (!req.url?.startsWith(SERVICE_PREFIX)) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(`Not found. This service is mounted at ${SERVICE_PREFIX}/`);
          return;
        }
        req.url = req.url.slice(SERVICE_PREFIX.length) || '/';
      }

      // Proxy all other traffic using round-robin among healthy children
      const targetChild = pickChild();
      if (!targetChild) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        const errs = children.map(c => `#${c.id}: ${c.lastError ?? 'no error recorded'}`).join('\n');
        res.end(`No healthy children available. POST /webpack/reload to recover.\n\nLast errors:\n${errs}`);
        return;
      }

      proxy.web(req, res, {
        target: { socketPath: targetChild.socketPath! } as unknown as string,
        autoRewrite: true,
        headers: {
          'x-proxy-child-id': String(targetChild.id)  // for logging/debugging
        }
      }, (err) => {
        console.error(`[parent] proxy error to Child#${targetChild.id}:`, err);
        // Mark this child unhealthy so next request won't pick it
        targetChild.healthy = false;
        targetChild.lastError = String((err as Error)?.stack || err);
        res.statusCode = 502;
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(`Upstream error from Child#${targetChild.id}. Try /webpack/reload.\n${targetChild.lastError}`);
      });
    });

    server.listen(publicPort, async () => {
      console.log(`[parent] Listening on :${publicPort}`);
      if (SERVICE_PREFIX) {
        console.log(`[parent] Service prefix: "${SERVICE_PREFIX}" (enforced — requests without it will get 404)`);
      }
      console.log(`POST http://localhost:${publicPort}/webpack/reload to trigger rolling swap/respawn`);
      await ensurePoolSize(CHILD_COUNT);
    });

    // Graceful shutdown of parent (children get SIGTERM)
    const shutdown = async (sig: string) => {
      console.log(`[${sig}] [parent] shutting down…`);
      for (const c of children) {
        try {
          c.proc.kill('SIGTERM');
        } catch { /* ignore */
        }
        if (c.socketPath) cleanupSock(c.socketPath);
      }
      // Clean up socket directory
      try { fs.rmdirSync(SOCK_DIR); } catch {}
      setTimeout(() => process.exit(0), 700).unref();
    };
    ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGUSR2'].forEach(sig =>
      process.on(sig as NodeJS.Signals, () => void shutdown(sig))
    );
  })();

}
