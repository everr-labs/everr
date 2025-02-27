// @ts-check

import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import hooksPlugin from 'eslint-plugin-react-hooks';

/** @type {Awaited<import('typescript-eslint').Config>} */
export default [
	{
		files: ['**/*.ts', '**/*.tsx'],
		plugins: {
			react: reactPlugin,
			'react-hooks': hooksPlugin,
			'jsx-a11y': jsxA11y,
		},
		rules: {
			...reactPlugin.configs['jsx-runtime'].rules,
			...hooksPlugin.configs.recommended.rules,
			...jsxA11y.flatConfigs.strict.rules,
		},
		languageOptions: {
			globals: {
				React: 'writable',
			},
		},
	},
];
