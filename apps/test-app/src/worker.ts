/**
 * Minimal worker entry point for testing the workers feature of @davnx/webpack:build.
 */
console.log(`[worker] started (pid=${process.pid})`);

setInterval(() => {
  // keep-alive
}, 60_000);
