import tseslint from 'typescript-eslint';
import { baseConfig } from '../eslint.base.mjs';

export default tseslint.config(
  ...baseConfig,
  {
    ignores: [
      '**/.wrangler/**',
      '**/coverage/**',
    ],
  },
);
