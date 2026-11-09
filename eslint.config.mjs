import globals from 'globals';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import stylistic from '@stylistic/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  {
    // The build, which is the compiler's output rather than anything anyone wrote: `dist/` would be linted as a second
    // copy of every module, and `.types/` is generated declarations. `.claude/worktrees/` is another branch's checkout,
    // which flat config lints too, a leading dot no longer being ignored.
    ignores: ['dist/**', '.types/**', '.claude/worktrees/**'],
  },

  js.configs.recommended,

  // Ahead of `prettier` so that anything formatting-related it brings is still disabled by it. The types themselves are
  // checked by `tsc`, not by this; what these rules add is the discipline around them, chiefly that a
  // `@ts-expect-error` carries a reason.
  ...tseslint.configs.strict,

  prettier,
  {
    plugins: { '@stylistic': stylistic },
    rules: {
      'curly': ['error', 'all'],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'multiline-block-like' },
        { blankLine: 'always', prev: 'multiline-block-like', next: '*' },
      ],

      // A comment binds to the code below it, so the blank line above it is what marks where its scope begins — except
      // at the top of a block, where the brace already does and Prettier strips one. The blank line after the code it
      // covers, and an interface listing its commented members last, are past what this can check.
      '@stylistic/lines-around-comment': [
        'error',
        {
          beforeBlockComment: true,
          beforeLineComment: true,
          allowBlockStart: true,
          allowClassStart: true,
          allowObjectStart: true,
          allowArrayStart: true,
          allowInterfaceStart: true,
          allowTypeStart: true,
          allowEnumStart: true,
          allowModuleStart: true,
        },
      ],
    },
  },

  {
    // A name declared again in a nested scope, as another thing, leaves a reader to work out which of the two each use
    // means. Only the battle's loop and the modules split out of it are held to it so far; the rest of the repository
    // still has names to rename first (#949).
    files: ['src/tools/battle/battle.mts', 'src/tools/battle/bench.mts', 'src/tools/battle/run.mts'],
    rules: {
      '@typescript-eslint/no-shadow': 'error',
    },
  },

  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      sourceType: 'module',
      globals: globals.browser,
    },
  },

  {
    files: ['**/*.mjs', '**/*.mts'],
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
];
