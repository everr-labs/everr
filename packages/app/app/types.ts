export type Conclusion = 'success' | 'skipped' | 'cancelled';

interface LeafSpanAttributes {
	'ci.github.workflow.job.step.conclusion': Conclusion;
}

export interface Span {
	TraceId: string;
	SpanId: string;
	ParentSpanId: string;
	SpanName: string;
	Timestamp: string;
	StatusCode: 'STATUS_CODE_UNSET' | 'STATUS_CODE_OK' | 'STATUS_CODE_ERROR';
	StatusMessage: Conclusion;
	Duration: number;
	ResourceAttributes: Record<string, string>;
	SpanAttributes: Record<string, string>;
	spans?: Span[];
}

export interface RootSpan extends Span {
	ParentSpanId: '';
}

export interface MiddleSpan extends Span {
	spans: LeafSpan[];
}

export interface LeafSpan extends Span {
	spans: never;
	SpanAttributes: Span['SpanAttributes'] & LeafSpanAttributes;
}

export interface Trace extends RootSpan {
	spans: MiddleSpan[];
}

export interface Log {
	Timestamp: string;
	TraceId: string;
	SpanId: string;
	TraceFlags: number;
	SeverityText: string;
	SeverityNumber: number;
	ServiceName: string;
	Body: string;
	ResourceSchemaUrl: string;
	ResourceAttributes: Record<string, string>;
	ScopeSchemaUrl: string;
	ScopeName: string;
	ScopeVersion: string;
	ScopeAttributes: Record<string, string>;
	LogAttributes: Record<string, string>;
}
