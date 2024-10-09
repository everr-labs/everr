import { z } from 'zod';

export const PaginatedData = z.object({
	pageSize: z.number(),
	pageIndex: z.number().min(0).int(),
});
