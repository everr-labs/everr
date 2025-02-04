import {
	type LeafSpan,
	type MiddleSpan,
	type RootSpan,
	type Span,
	type Trace,
} from '@/types';

export function generateTrace(spans: Span[]): Trace {
	const rootSpan: RootSpan | undefined = spans.find(isRootSpan);
	if (!rootSpan) {
		throw new Error('Root span not found');
	}

	const jobSpans = spans.filter(
		(span) => span.ParentSpanId === rootSpan?.SpanId,
	);

	const jobs: MiddleSpan[] = jobSpans.map((job) => {
		const steps = spans.filter(isLeafSpanOf(job.SpanId));
		return {
			...job,
			spans: steps,
		};
	});

	return {
		...rootSpan,
		spans: jobs,
	};
}

function isRootSpan(span: Span): span is RootSpan {
	return span.ParentSpanId === '';
}

const isLeafSpanOf =
	(spanId: string) =>
	(span: Span): span is LeafSpan =>
		span.ParentSpanId === spanId && !span.spans;
