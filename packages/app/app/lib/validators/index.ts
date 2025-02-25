import type { InferInput, InferOutput } from 'valibot';
import { addDays, endOfDay, startOfDay } from 'date-fns';
import {
	fallback,
	isoTimestamp,
	number,
	object,
	optional,
	pipe,
	string,
} from 'valibot';

export function getDefaultRangeFrom() {
	return startOfDay(addDays(new Date(), -7)).toISOString();
}

export function getDefaultRangeTo() {
	return endOfDay(new Date()).toISOString();
}

const IsoTimestampSchema = pipe(
	string(),
	isoTimestamp('The timestamp is badly formatted.'),
);

export const RangeSchema = object({
	// TODO: From should be before to, and both should be in the past
	from: optional(
		fallback(IsoTimestampSchema, () => getDefaultRangeFrom()),
		getDefaultRangeFrom(),
	),
	to: optional(
		fallback(IsoTimestampSchema, () => getDefaultRangeTo()),
		getDefaultRangeTo(),
	),
});

export type RangeInput = InferInput<typeof RangeSchema>;
export type RangeOutput = InferOutput<typeof RangeSchema>;

export const PaginationSchema = object({
	pageSize: number(),
	pageIndex: number(),
});
