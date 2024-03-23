import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*_test.m[jt]s']
  }
});
