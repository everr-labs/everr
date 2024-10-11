import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createTRPCRouter, protectedProcedure } from '../trpc';

export const reposRouter = createTRPCRouter({
	getRepo: protectedProcedure
		.input(z.string())
		.query(async ({ input: repo, ctx: { clickhouse } }) => {
			// TODO: maybe some info of the repo
			const result = await clickhouse.query({
				query: `SELECT repo FROM pipelines_mv WHERE repo = {repo:String} LIMIT 1`,
				params: {
					repo,
				},
			});

			if (result.length === 0) {
				throw new TRPCError({
					code: 'NOT_FOUND',
					message: 'Repo not found',
				});
			}

			return 'ok' as const;
		}),
});
