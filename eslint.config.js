import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.wrangler/**',
      '**/coverage/**',
      '**/prisma/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-empty-function': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-eval': 'error',
    },
  },
  // Relax console rule for test files
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**', '**/__tests__/**'],
    rules: {
      'no-console': 'off',
    },
  },
);
