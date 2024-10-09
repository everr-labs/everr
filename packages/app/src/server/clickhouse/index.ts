import { createClient } from '@clickhouse/client'; // or '@clickhouse/client-web'

import { env } from '../../env';

export const client = createClient({
	// TODO: env vars
	password: env.CLICKHOUSE_PASSWORD,
	database: env.CLICKHOUSE_DB,
	username: env.CLICKHOUSE_USER,
	url: env.CLICKHOUSE_URL,
});

interface QueryOptions {
	query: string;
	params?: Record<string, unknown>;
}
export const clickhouse = {
	query: async <T>({ query, params: query_params }: QueryOptions) => {
		return (
			await client.query({
				format: 'JSONEachRow',
				query,
				query_params,
			})
		).json<T>();
	},
};
