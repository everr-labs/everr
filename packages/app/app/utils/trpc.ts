import type { inferRouterOutputs } from '@trpc/server';
import { createTRPCReact } from '@trpc/react-query';

import type { AppRouter } from '~server/trpc';

export const api = createTRPCReact<AppRouter>();

export type RouterOutputs = inferRouterOutputs<AppRouter>;
