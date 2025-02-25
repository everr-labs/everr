import { createClient } from '@clickhouse/client'; // or '@clickhouse/client-web'

if (!process.env.CLICKHOUSE_URL) {
	throw new Error('Missing CLICKHOUSE_URL');
}
if (!process.env.CLICKHOUSE_USER) {
	throw new Error('Missing CLICKHOUSE_USER');
}
if (!process.env.CLICKHOUSE_PASSWORD) {
	throw new Error('Missing CLICKHOUSE_PASSWORD');
}
if (!process.env.CLICKHOUSE_DB) {
	throw new Error('Missing CLICKHOUSE_DB');
}

export const client = createClient({
	password: process.env.CLICKHOUSE_PASSWORD,
	database: process.env.CLICKHOUSE_DB,
	username: process.env.CLICKHOUSE_USER,
	url: process.env.CLICKHOUSE_URL,
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
