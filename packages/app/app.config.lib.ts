import { fileURLToPath } from 'node:url';
import type { NitroOptions } from 'nitropack';
import type {
	RouterSchemaInput,
	AppOptions as VinxiAppOptions,
	RouterSchemaInput as VinxiRouterSchemaInput,
} from 'vinxi';
import type * as vite from 'vite';
import {
	configSchema,
	getConfig,
	startAPIRouteSegmentsFromTSRFilePath,
} from '@tanstack/router-generator';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { createApp } from 'vinxi';
import {
	BaseFileSystemRouter as VinxiBaseFileSystemRouter,
	analyzeModule as vinxiFsRouterAnalyzeModule,
	cleanPath as vinxiFsRouterCleanPath,
} from 'vinxi/fs-router';
import { config, input } from 'vinxi/plugins/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { z } from 'zod';

/**
 * Not all the deployment presets are fully functional or tested.
 * @see https://github.com/TanStack/router/pull/2002
 */
const vinxiDeploymentPresets = [
	'alwaysdata', // untested
	'aws-amplify', // untested
	'aws-lambda', // untested
	'azure', // untested
	'azure-functions', // untested
	'base-worker', // untested
	'bun', // ✅ working
	'cleavr', // untested
	'cli', // untested
	'cloudflare', // untested
	'cloudflare-module', // untested
	'cloudflare-pages', // ✅ working
	'cloudflare-pages-static', // untested
	'deno', // untested
	'deno-deploy', // untested
	'deno-server', // untested
	'digital-ocean', // untested
	'edgio', // untested
	'firebase', // untested
	'flight-control', // untested
	'github-pages', // untested
	'heroku', // untested
	'iis', // untested
	'iis-handler', // untested
	'iis-node', // untested
	'koyeb', // untested
	'layer0', // untested
	'netlify', // ✅ working
	'netlify-builder', // untested
	'netlify-edge', // untested
	'netlify-static', // untested
	'nitro-dev', // untested
	'nitro-prerender', // untested
	'node', // partially working
	'node-cluster', // untested
	'node-server', // ✅ working
	'platform-sh', // untested
	'service-worker', // untested
	'static', // partially working
	'stormkit', // untested
	'vercel', // ✅ working
	'vercel-edge', // untested
	'vercel-static', // untested
	'winterjs', // untested
	'zeabur', // untested
	'zeabur-static', // untested
] as const;

type DeploymentPreset = (typeof vinxiDeploymentPresets)[number] | (string & {});

const testedDeploymentPresets: Array<DeploymentPreset> = [
	'bun',
	'netlify',
	'vercel',
	'cloudflare-pages',
	'node-server',
];

function checkDeploymentPresetInput(preset: string): DeploymentPreset {
	if (!vinxiDeploymentPresets.includes(preset as any)) {
		console.warn(
			`Invalid deployment preset "${preset}". Available presets are: ${vinxiDeploymentPresets
				.map((p) => `"${p}"`)
				.join(', ')}.`,
		);
	}

	if (!testedDeploymentPresets.includes(preset as any)) {
		console.warn(
			`The deployment preset '${preset}' is not fully supported yet and may not work as expected.`,
		);
	}

	return preset;
}

type HTTPSOptions = {
	cert?: string;
	key?: string;
	pfx?: string;
	passphrase?: string;
	validityDays?: number;
	domains?: Array<string>;
};
type ServerOptions_ = VinxiAppOptions['server'] & {
	https?: boolean | HTTPSOptions;
};
type ServerOptions = {
	[K in keyof ServerOptions_]: ServerOptions_[K];
};

const serverSchema = z
	.object({
		routeRules: z.custom<NitroOptions['routeRules']>().optional(),
		preset: z.custom<DeploymentPreset>().optional(),
		static: z.boolean().optional(),
		prerender: z
			.object({
				routes: z.array(z.string()),
				ignore: z
					.array(
						z.custom<
							string | RegExp | ((path: string) => undefined | null | boolean)
						>(),
					)
					.optional(),
				crawlLinks: z.boolean().optional(),
			})
			.optional(),
	})
	.and(z.custom<ServerOptions>());

const viteSchema = z.object({
	plugins: z
		.function()
		.returns(z.array(z.custom<vite.PluginOption>()))
		.optional(),
});

const babelSchema = z.object({
	plugins: z
		.array(z.union([z.tuple([z.string(), z.any()]), z.string()]))
		.optional(),
});

const reactSchema = z.object({
	babel: babelSchema.optional(),
	exclude: z.array(z.instanceof(RegExp)).optional(),
	include: z.array(z.instanceof(RegExp)).optional(),
});

const routersSchema = z.object({
	ssr: z
		.object({
			entry: z.string().optional(),
			vite: viteSchema.optional(),
		})
		.optional(),
	client: z
		.object({
			entry: z.string().optional(),
			base: z.string().optional(),
			vite: viteSchema.optional(),
		})
		.optional(),
	server: z
		.object({
			base: z.string().optional(),
			vite: viteSchema.optional(),
		})
		.optional(),
	api: z
		.object({
			entry: z.string().optional(),
			vite: viteSchema.optional(),
		})
		.optional(),
});

const tsrConfig = configSchema.partial().extend({
	appDirectory: z.string(),
});

const inlineConfigSchema = z.object({
	react: reactSchema.optional(),
	vite: viteSchema.optional(),
	tsr: tsrConfig.optional(),
	routers: routersSchema.optional(),
	server: serverSchema.optional(),
});

export type TanStackStartDefineConfigOptions = z.infer<
	typeof inlineConfigSchema
>;

function setTsrDefaults(
	config: TanStackStartDefineConfigOptions['tsr'],
): Partial<TanStackStartDefineConfigOptions['tsr']> {
	return {
		...config,
		// Normally these are `./src/___`, but we're using `./app/___` for Start stuff
		appDirectory: config?.appDirectory ?? './src/app',
		routesDirectory: config?.routesDirectory ?? './src/app/routes',
		generatedRouteTree:
			config?.generatedRouteTree ?? './src/app/routeTree.gen.ts',
		experimental: {
			...config?.experimental,
		},
	};
}

export function defineConfig(
	inlineConfig: TanStackStartDefineConfigOptions = {},
) {
	const opts = inlineConfigSchema.parse(inlineConfig);

	const { preset: configDeploymentPreset, ...serverOptions } =
		serverSchema.parse(opts.server || {});

	const deploymentPreset = checkDeploymentPresetInput(
		configDeploymentPreset || 'node-server',
	);

	const tsrConfig = getConfig(setTsrDefaults(opts.tsr));

	const apiBase = opts.tsr?.apiBase || '/api';

	const apiEntry = opts.routers?.api?.entry || './src/server/handlers/api.ts';

	return createApp({
		server: {
			...serverOptions,
			preset: deploymentPreset,
			experimental: {
				asyncContext: true,
			},
		},
		routers: [
			{
				name: 'public',
				type: 'static',
				dir: './public',
				base: '/',
			},
			trpcRouter(),
			withPlugins([
				config('start-vite', {
					ssr: {
						noExternal: ['@tanstack/start'],
					},
				}),
				TanStackRouterVite({
					...tsrConfig,
					autoCodeSplitting: true,
					experimental: {
						...tsrConfig.experimental,
					},
				}),
			])({
				name: 'api',
				type: 'http',
				target: 'server',
				base: apiBase,
				handler: apiEntry,
				routes: tsrFileRouter({ tsrConfig, apiBase }),
				plugins: () => [
					...(opts.vite?.plugins?.() || []),
					...(opts.routers?.api?.vite?.plugins?.() || []),
				],
				link: {
					client: 'client',
				},
			}),
			{
				name: 'client',
				type: 'spa',
				plugins: () => [
					...(opts.vite?.plugins?.() || []),
					TanStackRouterVite({
						...tsrConfig,
						autoCodeSplitting: true,
					}),
					viteReact({}),
				],
				handler: './index.html',
				base: '/',
				target: 'browser',
			},
		],
	});
}

type TempRouter = Extract<
	VinxiRouterSchemaInput,
	{
		type: 'client' | 'http';
	}
> & {
	base?: string;
	link?: {
		client: string;
	};
	runtime?: string;
	build?: {
		sourcemap?: boolean;
	};
};

function withPlugins(plugins: Array<any>) {
	return (router: TempRouter) => {
		return {
			...router,
			plugins: async () => [...plugins, ...((await router.plugins?.()) ?? [])],
		};
	};
}

function tsrFileRouter(opts: {
	tsrConfig: z.infer<typeof configSchema>;
	apiBase: string;
}) {
	const apiBaseSegment = opts.apiBase.split('/').filter(Boolean).join('/');
	const isAPIPath = new RegExp(`/${apiBaseSegment}/`);

	return function (router: VinxiRouterSchemaInput, app: VinxiAppOptions) {
		// Our own custom File Router that extends the VinxiBaseFileSystemRouter
		// for splitting the API routes into its own "bundle"
		// and adding the $APIRoute metadata to the route object
		// This could be customized in future to support more complex splits
		class TanStackStartFsRouter extends VinxiBaseFileSystemRouter {
			toPath(src: string): string {
				const inputPath = vinxiFsRouterCleanPath(src, this.config);

				const segments = startAPIRouteSegmentsFromTSRFilePath(
					inputPath,
					opts.tsrConfig,
				);

				const pathname = segments
					.map((part) => {
						if (part.type === 'splat') {
							return `*splat`;
						}

						if (part.type === 'param') {
							return `:${part.value}?`;
						}

						return part.value;
					})
					.join('/');

				return pathname.length > 0 ? `/${pathname}` : '/';
			}

			toRoute(src: string) {
				const webPath = this.toPath(src);

				const [_, exports] = vinxiFsRouterAnalyzeModule(src);

				const hasRoute = exports.find((exp) => exp.n === 'Route');

				return {
					path: webPath,
					filePath: src,
					$APIRoute:
						isAPIPath.test(webPath) && hasRoute
							? {
									src,
									pick: ['Route'],
								}
							: undefined,
				};
			}
		}

		return new TanStackStartFsRouter(
			{
				dir: opts.tsrConfig.routesDirectory,
				extensions: ['js', 'jsx', 'ts', 'tsx'],
			},
			router,
			app,
		);
	};
}

function trpcRouter() {
	return {
		name: 'trpc',
		base: '/trpc',
		type: 'http',
		handler: fileURLToPath(
			new URL('./src/server/handlers/trpc.ts', import.meta.url),
		),
		target: 'server',
		plugins: () => [
			tsconfigPaths(),
			input(
				'$vinxi/trpc/router',
				fileURLToPath(new URL('./src/server/trpc/index.ts', import.meta.url)),
			),
		],
	} satisfies RouterSchemaInput;
}
