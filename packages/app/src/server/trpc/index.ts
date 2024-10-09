import { pipelinesRouter } from './routers/pipelines';
import { createTRPCRouter } from './trpc';

const appRouter = createTRPCRouter({
	pipelines: pipelinesRouter,
});

export default appRouter;

export type AppRouter = typeof appRouter;
