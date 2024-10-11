import { pipelinesRouter } from './routers/pipelines';
import { reposRouter } from './routers/repos';
import { createTRPCRouter } from './trpc';

const appRouter = createTRPCRouter({
	pipelines: pipelinesRouter,
	repos: reposRouter,
});

export default appRouter;

export type AppRouter = typeof appRouter;
