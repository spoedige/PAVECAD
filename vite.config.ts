import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['testes/**/*.test.ts'], testTimeout: 60000 },
});
