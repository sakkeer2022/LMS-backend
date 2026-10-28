import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@config': '/src/config',
      '@core': '/src/core',
      '@infrastructure': '/src/infrastructure',
      '@middleware': '/src/middleware',
      '@modules': '/src/modules',
      '@shared': '/src/shared',
      '@routes': '/src/routes'
    }
  },
  test: {
    globals: true,
    environment: 'node',
    // CRITICAL ORDER: env-setup.ts must be first.
    // It pre-populates required env vars (JWT_SECRET, JWT_REFRESH_SECRET, etc.)
    // before setup.ts imports src/config/index.ts, which calls validateEnv() at
    // module-import time. Reordering these files will cause tests to throw
    // "Missing required environment variables" on a fresh checkout without a .env.
    setupFiles: ['./tests/env-setup.ts', './tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/infrastructure/database/migrations/**', 'src/infrastructure/database/seeders/**'],
    },
    // We run sequentially since tests will reset the database
    fileParallelism: false,
    isolate: true,
  },
});
