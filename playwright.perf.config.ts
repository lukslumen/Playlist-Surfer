import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Performance runs use a production build (unminified so profiles stay readable): React's
// development mode diffs every prop for its profiler and makes the dev server several times slower.
const PORT = 3200;

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: ['perf.spec.ts', 'profile/*.profile.ts'],
  retries: 0,
  reporter: 'list',
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx vite build --minify false --outDir dist-perf && npx vite preview --outDir dist-perf --port=${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
