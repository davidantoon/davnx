# Changelog

## 1.0.4

### Added

- **Gateway middleware** — pluggable request middleware for the dev server. Configure `gateway.middleware` in the serve executor options to point to a JS file that modifies request headers before proxying. Useful for simulating API gateways locally (e.g., decoding JWTs and injecting auth headers). The middleware receives the raw `IncomingMessage` and the parsed YAML config. See [Gateway Middleware](./README.md#gateway-middleware) in the README.

## 1.0.3

- Initial public release with `build` and `serve` executors.
