# Gateway Middleware Examples

Gateway middleware runs in the devserver parent process before requests are proxied to the NestJS app. It simulates the production API gateway locally by injecting headers.

## Basic JWT Decoder

```javascript
// gateway-middleware.js
module.exports = function gatewayMiddleware(req, config) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) return;

  const token = auth.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return;

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    );

    const set = (name, value) => {
      if (value && !req.headers[name]) req.headers[name] = String(value);
    };

    set('x-vendor-id', payload.aud);
    set('x-tenant-id', payload.tenantId);
    set('x-user-id', payload.sub);
    set('x-user-email', payload.email);
  } catch {
    // Malformed JWT — skip, let the app's auth guards handle it
  }
};
```

## With API Key Injection from Config YAML

The second argument (`config`) is the parsed contents of `config/config.{configEnv}.yaml`:

```javascript
// gateway-middleware.js
module.exports = function gatewayMiddleware(req, config) {
  // Inject API key from config YAML — overwrite any client-supplied value
  if (config.apiKey) {
    req.headers['x-api-key'] = config.apiKey;
  }

  // Decode JWT
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = JSON.parse(
        Buffer.from(auth.slice(7).split('.')[1], 'base64').toString()
      );
      if (payload.tenantId) req.headers['x-tenant-id'] = payload.tenantId;
      if (payload.sub) req.headers['x-user-id'] = payload.sub;
    } catch {}
  }
};
```

## Function Signature

```typescript
type GatewayMiddleware = (
  req: import('http').IncomingMessage,
  config: Record<string, unknown>,
) => void;
```

- **`req`** — Mutable. Set `req.headers['x-foo'] = 'bar'` to inject headers. The modified request is then proxied to the NestJS child.
- **`config`** — Read-only. Parsed YAML from `config/config.{configEnv}.yaml`. Access any field your service uses (ports, API keys, feature flags, etc).
- **Errors** in the middleware are caught and logged — they do not block the request.
- The file must be plain JavaScript (`.js`), not TypeScript. It runs in the devserver parent process, which loads it via `require()`.
