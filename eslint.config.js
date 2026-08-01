import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * Deliberately narrow. `npm run typecheck` already runs `tsc --strict` over both
 * tsconfigs, so this config exists for the things the compiler can't see —
 * above all `react-hooks/exhaustive-deps`.
 *
 * That rule matters here more than in a typical app: the store mutates `texts`
 * in place and hands components long-lived refs, so a stale closure is the
 * codebase's most likely bug and its hardest to spot by eye. The repo already
 * carried ~23 `eslint-disable-next-line react-hooks/exhaustive-deps` comments
 * documenting deliberate exceptions — with no linter installed they were purely
 * decorative. Now they suppress a rule that actually runs.
 */
export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'mobile/**', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Unused code is noise; an `_`-prefixed name is the escape hatch.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ],
      // `any` defeats the strict compiler this project relies on.
      '@typescript-eslint/no-explicit-any': 'error',
      // The codebase uses `void promise` to mark deliberately un-awaited work.
      '@typescript-eslint/no-floating-promises': 'off',
      // Empty catch blocks are used throughout for genuinely best-effort cleanup,
      // and each one carries a comment saying so.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `cond ? doA() : doB()` as a statement is an established idiom here
      // (navigate-to-pane, toggle-in-set); it reads better than an if/else block.
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowTernary: true, allowShortCircuit: true }
      ]
    }
  }
)
