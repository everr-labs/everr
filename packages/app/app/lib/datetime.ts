import { formatDuration } from 'date-fns';

export function shortDuration(nanoseconds: number): string {
	const minutes = Math.floor(nanoseconds / 1_000_000_000 / 60);
	const seconds = Math.floor((nanoseconds / 1_000_000_000) % 60);

	return formatDuration(
		{
			seconds,
			minutes,
		},
		{ format: ['minutes', 'seconds'], zero: true },
	)
		.replace(/ minutes?/g, 'm')
		.replace(/ seconds?/g, 's')
		.replace(/^0m/g, '');
}
