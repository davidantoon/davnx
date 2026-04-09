import * as http from 'node:http';

/**
 * Minimal app used for e2e testing of @davnx/webpack executors.
 *
 * In standalone mode it starts an HTTP server.
 * In DEVSERVER_MODE it exports a createChildApp factory for the devserver.
 */

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

type BuiltChildApp = {
  handler: http.RequestListener;
  serviceConfig: { port: number | string };
  close: () => Promise<void>;
};

if (process.env.DEVSERVER_MODE === '1') {
  // Devserver mode: expose factory on global
  (global as Record<string, unknown>).createChildApp = async (): Promise<BuiltChildApp> => {
    const handler = createHandler();
    return {
      handler,
      serviceConfig: { port: 0 },
      close: async () => {},
    };
  };
} else {
  // Standalone mode
  const port = Number(process.env.PORT) || 3099;
  const server = http.createServer(createHandler());
  server.listen(port, () => {
    console.log(`test-app listening on :${port}`);
  });
}
