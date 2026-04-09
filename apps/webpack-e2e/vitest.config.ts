import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@davnx/webpack': path.resolve(__dirname, '../../libs/webpack/src/index.ts'),
    },
  },
  test: {
    root: path.resolve(__dirname),
    include: ['src/**/*.spec.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
