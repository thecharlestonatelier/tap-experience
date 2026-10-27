// Minimal ESLint config (flat config, ESLint >= 9).
// Mixed front-end (patients/, sw.js) and Node (portal/) code in one repo,
// so browser, node, and service-worker globals are all enabled.
// Run with: npx eslint .
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'graphify-out/**',
      'portal/.data*/**',
      '.worktrees/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module', // root package.json sets "type": "module"
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    rules: {},
  },
];
