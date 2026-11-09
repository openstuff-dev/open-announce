import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Shared types, and the connection string helper the web app uses.
  test: { include: ['test/**/*.test.ts'], passWithNoTests: true },
});
