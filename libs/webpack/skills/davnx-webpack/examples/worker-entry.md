# Worker Entry Point Examples

Workers are background processes that must NOT bind to any HTTP port. They use queues, event listeners, timers, or other non-HTTP mechanisms.

## Minimal Worker

```typescript
// src/workers/my-worker.ts
console.log(`[my-worker] started (pid=${process.pid})`);

// Keep the process alive — replace with your actual work
setInterval(() => {
  // poll queue, process events, etc.
}, 60_000);
```

## NestJS Queue Consumer

```typescript
// src/workers/queue-processor.ts
import { NestFactory } from '@nestjs/core';
import { QueueProcessorModule } from './queue-processor.module';

async function bootstrap() {
  // createApplicationContext — no HTTP adapter, no port binding
  const app = await NestFactory.createApplicationContext(QueueProcessorModule);
  console.log(`[queue-processor] started (pid=${process.pid})`);

  // Process stays alive via active queue connections (e.g., BullMQ, SQS, RabbitMQ)
  // The NestJS module should register queue consumers that keep the event loop active
}

bootstrap().catch((err) => {
  console.error('[queue-processor] failed to start', err);
  process.exit(1);
});
```

```typescript
// src/workers/queue-processor.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { JobProcessor } from './job.processor';

@Module({
  imports: [
    BullModule.forRoot({ redis: { host: 'localhost', port: 6379 } }),
    BullModule.registerQueue({ name: 'jobs' }),
  ],
  providers: [JobProcessor],
})
export class QueueProcessorModule {}
```

## NestJS Event Listener

```typescript
// src/workers/event-listener.ts
import { NestFactory } from '@nestjs/core';
import { EventListenerModule } from './event-listener.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(EventListenerModule);
  console.log(`[event-listener] started (pid=${process.pid})`);
  // Stays alive via Kafka/Redis/NATS subscriptions registered in the module
}

bootstrap().catch((err) => {
  console.error('[event-listener] failed to start', err);
  process.exit(1);
});
```

## Worker with Shared Bootstrap Utility

If your project has a shared `bootstrap()` function (see `main-entry.md`):

```typescript
// src/workers/main.ts
import { bootstrap } from '../bootstrap';
import { WorkerModule } from './worker.module';

bootstrap(WorkerModule).catch((err) => {
  console.error('[worker] failed to start', err);
  process.exit(1);
});
```

## Important Rules

1. **Never call `app.listen()`** — workers must not bind to any port
2. **Use `createApplicationContext()`** instead of `create()` — no HTTP adapter needed
3. **Keep the event loop active** — the process exits when there are no pending listeners. Queue connections, timers, and event subscriptions keep it alive.
4. **In dev mode**, workers are automatically killed and respawned on each webpack rebuild. Design workers to handle SIGTERM gracefully for clean restarts.
