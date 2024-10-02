import { db } from '~server/db';

import { t } from './trpc';

const appRouter = t.router({
	greeting: t.procedure.query(async () => {
		const users = await db.query.users.findMany();
		return { msg: 'hello tRPC v10!', users };
	}),
});

export default appRouter;

export type AppRouter = typeof appRouter;
