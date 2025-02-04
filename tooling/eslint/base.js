/// <reference types="./types.d.ts" />

import * as path from 'node:path';
import { includeIgnoreFile } from '@eslint/compat';
import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import turboPlugin from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

/**
 * All packages that leverage t3-env should use this rule
 */
export const restrictEnvAccess = tseslint.config(
	{ ignores: ['**/env.ts'] },
	{
		files: ['**/*.js', '**/*.ts', '**/*.tsx'],
		rules: {},
	},
);

export default tseslint.config(
	// Ignore files not tracked by VCS and any config files
	includeIgnoreFile(path.join(import.meta.dirname, '../../.gitignore')),
	{ ignores: ['**/*.config.*'] },
	{
		files: ['**/*.js', '**/*.ts', '**/*.tsx'],
		plugins: {
			import: importPlugin,
			turbo: turboPlugin,
		},
		extends: [
			eslint.configs.recommended,
			...tseslint.configs.recommendedTypeChecked,
			...tseslint.configs.strictTypeChecked,
			...tseslint.configs.stylisticTypeChecked,
		],
		rules: {
			...turboPlugin.configs.recommended.rules,
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					reportUsedIgnorePattern: true,
				},
			],
			'@typescript-eslint/consistent-type-imports': [
				'warn',
				{ prefer: 'type-imports', fixStyle: 'separate-type-imports' },
			],
			'@typescript-eslint/no-misused-promises': [
				2,
				{ checksVoidReturn: { attributes: false } },
			],
			'@typescript-eslint/no-unnecessary-condition': [
				'error',
				{
					allowConstantLoopConditions: true,
				},
			],
			'@typescript-eslint/restrict-template-expressions': [
				'error',
				{
					allowNumber: true,
				},
			],
			'@typescript-eslint/no-non-null-assertion': 'error',
			'import/consistent-type-specifier-style': ['error', 'prefer-top-level'],
			// TODO: Check how to do this so we can throw notFound & others from @tanstack/react-router
			// '@typescript-eslint/only-throw-error': [
			// 	'error',
			// 	{
			// 		allow: [
			// 			{
			// 				from: 'package',
			// 				name: ['notFound'],
			// 				package: '@tanstack/react-router',
			// 			},
			// 		],
			// 	},
			// ],
		},
	},
	{
		linterOptions: { reportUnusedDisableDirectives: true },
		languageOptions: { parserOptions: { projectService: true } },
	},
);
