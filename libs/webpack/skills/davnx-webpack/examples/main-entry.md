# Main Entry Point Examples

## Minimal (Plain HTTP)

For simple services without a framework:

```typescript
// src/main.ts
import * as http from 'node:http';

type BuiltChildApp = {
  handler: http.RequestListener;
  serviceConfig: { port: number | string };
  close: () => Promise<void>;
};

function createHandler(): http.RequestListener {
  return (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hello: 'world', pid: process.pid }));
  };
}

// Register devserver factory on global
(global as Record<string, unknown>).createChildApp =
  async (): Promise<BuiltChildApp> => ({
    handler: createHandler(),
    serviceConfig: { port: 0 },
    close: async () => {},
  });

// Standalone mode — only runs when NOT in devserver
if (process.env.DEVSERVER_MODE !== '1') {
  const port = Number(process.env.PORT) || 3000;
  http.createServer(createHandler()).listen(port, () => {
    console.log(`Listening on :${port}`);
  });
}
```

## NestJS + Fastify

The recommended pattern for NestJS applications:

```typescript
// src/main.ts
import * as http from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

type BuiltChildApp = {
  handler: http.RequestListener;
  serviceConfig: { port: number | string };
  close: () => Promise<void>;
};

async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  return app;
}

async function startStandalone(): Promise<void> {
  const app = await createApp();
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Listening on :${port}`);
}

async function createChildApp(): Promise<BuiltChildApp> {
  const app = await createApp();
  await app.init();
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();

  return {
    handler: (req, res) => fastify.routing(req, res),
    serviceConfig: { port: 0 },
    close: () => app.close(),
  };
}

// Always register the factory — devserver uses it via global.createChildApp()
(global as Record<string, unknown>).createChildApp = createChildApp;

if (process.env.DEVSERVER_MODE !== '1') {
  startStandalone().catch((err) => {
    console.error('Startup failed', err);
    process.exit(1);
  });
}
```

## NestJS + Fastify with Bootstrap Utilities

For larger projects, extract bootstrap logic into a shared utility:

```typescript
// src/bootstrap.ts
import * as http from 'node:http';
import { DynamicModule, Type, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

export type BuiltChildApp = {
  handler: http.RequestListener;
  serviceConfig: { port: number | string };
  close: () => Promise<void>;
};

async function buildApp(nestModule: DynamicModule | Type<unknown>) {
  const app = await NestFactory.create<NestFastifyApplication>(
    nestModule,
    new FastifyAdapter(),
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  return app;
}

/** For workers — bootstrap without HTTP listening */
export async function bootstrap(nestModule: DynamicModule | Type<unknown>): Promise<void> {
  const app = await NestFactory.createApplicationContext(nestModule);
  // Application context stays alive via active listeners (queues, timers)
}

export function createStandaloneFunction(nestModule: DynamicModule | Type<unknown>) {
  return async function startStandalone(): Promise<void> {
    const app = await buildApp(nestModule);
    const port = Number(process.env.PORT) || 3000;
    await app.listen(port, '0.0.0.0');
  };
}

export function createChildAppFunction(nestModule: DynamicModule | Type<unknown>) {
  return async function createChildApp(): Promise<BuiltChildApp> {
    const app = await buildApp(nestModule);
    await app.init();
    const fastify = app.getHttpAdapter().getInstance();
    await fastify.ready();
    return {
      handler: (req, res) => fastify.routing(req, res),
      serviceConfig: { port: 0 },
      close: () => app.close(),
    };
  };
}

export function bootstrapDevServerIfNeeded(
  startStandalone: () => Promise<void>,
  createChildApp: () => Promise<BuiltChildApp>,
): void {
  (global as Record<string, unknown>).createChildApp = createChildApp;

  if (process.env.DEVSERVER_MODE !== '1') {
    startStandalone().catch((err) => {
      console.error('Startup failed', err);
      process.exit(1);
    });
  }
}
```

```typescript
// src/main.ts
import { AppModule } from './app.module';
import {
  createStandaloneFunction,
  createChildAppFunction,
  bootstrapDevServerIfNeeded,
} from './bootstrap';

const appModule = AppModule;
bootstrapDevServerIfNeeded(
  createStandaloneFunction(appModule),
  createChildAppFunction(appModule),
);
```

## Re-entering AsyncLocalStorage on reload

If your app depends on an externalized package that constructs an `AsyncLocalStorage` and calls `.enterWith(...)` at module top-level (e.g. request-scoping libs like `@frontegg/context`, OpenTelemetry context, custom org libs), the store will go missing after a hot reload — `require.cache` keeps the singleton alive, so its constructor (and the `enterWith` inside it) never runs again, and the new bootstrap's async chain has no store.

Symptom: bootstrap crashes inside a logger or request-context lookup during `onModuleInit`:

```
TypeError: Cannot read properties of undefined (reading 'get')
    at FronteggContextScope.get
    at FronteggWinstonLogger.populateLoggerMetadata
    ...
```

The fix lives in your **bundle entry** (which re-evaluates on each reload), NOT in the devserver — the devserver is project-agnostic and shouldn't know about your context libs.

```ts
// src/bootstrap.ts (or wherever runs at bundle top-level)
import { defaultScope } from '@frontegg/context';

// Devserver re-evaluates this file on every webpack rebuild. The externalized
// `@frontegg/context` module isn't re-evaluated, so its one-shot
// `ns.enterWith(new Map())` from the constructor doesn't run again. Re-enter
// here so the new async chain (bootstrap → onModuleInit → logger.info → ctx.get)
// has a live store.
if (process.env.DEVSERVER_MODE === '1') {
  (defaultScope as unknown as { ns: { enterWith: (s: Map<unknown, unknown>) => void } })
    .ns.enterWith(new Map());
}
```

Place this **before** any top-level `createLogger(...)` / scope consumer so the first call after the reload sees a valid store. Generalize to any other ALS-based singleton your stack uses.

## Key Contract

The devserver expects `global.createChildApp` to be an async factory that returns:

```typescript
{
  handler: http.RequestListener;  // Raw HTTP handler (Fastify routing or Express)
  serviceConfig: { port: number | string };  // Can be 0 in dev
  close: () => Promise<void>;     // Graceful shutdown (called on hot-swap)
}
```

`close()` is called every time the devserver hot-swaps to a new bundle. It must clean up the old NestJS app (close DB connections, stop timers, etc.) without crashing — the new app is already serving traffic when this runs.
