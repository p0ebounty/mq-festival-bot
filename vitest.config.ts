import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{apps,packages}/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    environment: 'node',
    // @live-тесты бьют в реальный kie.ai и тратят кредиты — только вручную.
    ...(process.env.LIVE_TESTS ? {} : { exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/*.live.test.ts'] }),
  },
});
