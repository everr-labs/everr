/** @type {import('prettier').Config & import('prettier-plugin-tailwindcss').PluginOptions} */
const config = {
	plugins: [
		'@ianvs/prettier-plugin-sort-imports',
		'prettier-plugin-tailwindcss',
	],
	singleQuote: true,
	semi: true,
	useTabs: true,

	// This plugin's options
	importOrder: [
		'<BUILT_IN_MODULES>',
		'',
		'<THIRD_PARTY_MODULES>',
		'',
		'^(@/)(.*)$',
		'^[.]',
	],
	importOrderParserPlugins: ['typescript', 'jsx', 'decorators-legacy'],
	importOrderTypeScriptVersion: '5.0.0',
};

export default config;
