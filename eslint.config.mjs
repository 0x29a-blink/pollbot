// Flat ESLint config for the backend (TypeScript).
//
// Intentionally lightweight: this is the FIRST lint config for an existing
// ~7k-line codebase, so it deliberately does NOT pull in the full recommended
// rule sets (which would produce hundreds of pre-existing violations and make
// CI red on day one). It flags a small set of genuine-mistake patterns as
// warnings. Tighten over time as the codebase is cleaned up.
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', 'dashboard/**', 'scripts/**', '**/*.mjs'],
    },
    {
        files: ['src/**/*.ts'],
        plugins: {
            '@typescript-eslint': tseslint.plugin,
        },
        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: 'module',
        },
        rules: {
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            'no-constant-condition': 'warn',
            'no-empty': ['warn', { allowEmptyCatch: true }],
        },
    }
);
