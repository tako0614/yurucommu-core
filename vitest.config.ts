import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Use node environment for backend testing
    // Frontend tests should use jsdom when needed
    environment: 'node',
    // Include test files
    include: ['src/**/*.test.ts', 'web/src/**/*.test.ts', 'web/src/**/*.test.tsx', 'test/**/*.test.ts'],
    // Exclude node_modules and generated files
    exclude: ['node_modules', 'src/generated/**'],
    // Setup files for test utilities and mocks
    setupFiles: ['./test/setup.ts'],
    // Global timeout for tests
    testTimeout: 30000,
    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      // Coverage thresholds
      thresholds: {
        statements: 50,
        branches: 40,
        functions: 50,
        lines: 50,
      },
      // Include source files
      include: ['src/backend/**/*.ts', 'web/src/**/*.ts', 'web/src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'web/src/**/*.test.ts',
        'web/src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/generated/**',
        'web/vite.config.ts',
      ],
    },
    // Pool configuration for parallel testing
    pool: 'forks',
    // Globals for describe, it, expect, etc.
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@backend': path.resolve(__dirname, './src/backend'),
      '@frontend': path.resolve(__dirname, './web/src'),
      '@test': path.resolve(__dirname, './test'),
    },
  },
});
