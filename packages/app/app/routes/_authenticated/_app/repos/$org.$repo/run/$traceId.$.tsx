import { Link } from '@/components/Link';
import { StatusIcon } from '@/components/StatusIcon';
import { shortDuration } from '@/lib/datetime';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, notFound, redirect } from '@tanstack/react-router';
import { parse } from 'ansicolor';
import parseStyleString from 'style-to-object';

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	cn,
	linkVariants,
	ResizableHandle,
	ResizablePanel,
	ResizablePanelGroup,
} from '@citric/ui';

import { DistributionChart } from './-components/distribution-chart';
import { getLogs, getPipelineOptions } from './-functions';
import { generateTrace } from './-utils/trace';

export const Route = createFileRoute(
	'/_authenticated/_app/repos/$org/$repo/run/$traceId/$',
)({
	loader: async ({
		params: { org, repo, traceId, _splat: spanId },
		context: { queryClient },
	}) => {
		const data = await queryClient.ensureQueryData(
			getPipelineOptions({ traceId, org, repo }),
		);

		if (data.length === 0) {
			return notFound();
		}

		const trace = generateTrace(data);
		const firstStep = trace.spans[0]?.spans[0];

		if (!firstStep) {
			// TODO: how to handle this case?
		}

		if (!spanId) {
			return redirect({
				to: `/repos/$org/$repo/run/$traceId/$`,
				params: { org, repo, traceId, _splat: firstStep?.SpanId },
			});
		}

		const activeSpan = data.find(
			(span) =>
				span.SpanId === spanId &&
				span.TraceId === traceId &&
				// TODO: check the following condition
				span.SpanAttributes['ci.github.workflow.job.step.conclusion'] !==
					'skipped',
		);

		if (!activeSpan) {
			return notFound();
		}
	},
	component: WorkflowPage,
});

function WorkflowPage() {
	const { org, repo, traceId, _splat: spanId } = Route.useParams();

	if (!spanId) {
		// eslint-disable-next-line @typescript-eslint/only-throw-error
		throw notFound();
	}

	const { data: logs } = useQuery({
		queryKey: ['getLogs', traceId, spanId],
		queryFn: () => getLogs({ data: { traceId, spanId: spanId } }),
		enabled: !!spanId,
	});

	const { data: pipeline } = useSuspenseQuery(
		getPipelineOptions({ traceId, org, repo }),
	);

	const trace = generateTrace(pipeline);

	const currentJob = trace.spans.find((job) =>
		job.spans.some((step) => step.SpanId === spanId),
	);

	// const currentStep = currentJob?.spans.find((step) => step.SpanId === spanId);

	return (
		<Card>
			<CardHeader>
				<CardTitle>{trace.SpanName}</CardTitle>
				<CardDescription>
					Triggered via{' '}
					{trace.ResourceAttributes['ci.github.workflow.run.event']}
				</CardDescription>
			</CardHeader>
			<CardContent className="h-full min-h-full p-0">
				<ResizablePanelGroup direction="horizontal" className="border-t">
					<ResizablePanel defaultSize={25} minSize={5} className="">
						<Accordion
							type="multiple"
							defaultValue={
								// TODO: should look into keeping state between pages
								currentJob?.SpanId ? [currentJob.SpanId] : []
							}
							className=""
						>
							{trace.spans.map((job) => {
								return (
									<AccordionItem value={job.SpanId} key={job.SpanId}>
										<AccordionTrigger className="pl-4 pr-2 text-right font-semibold hover:bg-muted/30 hover:no-underline">
											<div className="flex items-center gap-3 overflow-hidden">
												<StatusIcon
													className="h-6 w-6"
													status={
														job.ResourceAttributes[
															'ci.github.workflow.job.conclusion'
														]
													}
												/>
												<span className="text-ellipsis whitespace-nowrap">
													{job.SpanName}
												</span>
											</div>
										</AccordionTrigger>
										<AccordionContent className="pb-1">
											<ul className="flex flex-col gap-2 px-2 py-2">
												{job.spans.map((step) => {
													const isStepSkipped =
														step.SpanAttributes[
															'ci.github.workflow.job.step.conclusion'
														] === 'skipped';

													// TODO: the link component is inappropriate here
													const Component = isStepSkipped ? 'span' : Link;

													return (
														<li key={step.SpanId}>
															<Component
																variant="secondary"
																{...(!isStepSkipped
																	? {
																			to: `/repos/${org}/${repo}/run/${step.TraceId}/${step.SpanId}`,
																		}
																	: {})}
																className={cn(
																	isStepSkipped &&
																		linkVariants({
																			variant: 'disabled',
																		}),
																	'flex w-full justify-between rounded-md px-3 py-2 no-underline',
																	{
																		'hover:bg-muted/50': !isStepSkipped,
																		'bg-muted/50': step.SpanId === spanId,
																		'cursor-not-allowed': isStepSkipped,
																	},
																)}
															>
																<div className="flex w-full grow items-center gap-2 overflow-hidden">
																	<StatusIcon
																		status={
																			step.SpanAttributes[
																				'ci.github.workflow.job.step.conclusion'
																			]
																		}
																	/>
																	<span className="overflow-hidden text-ellipsis whitespace-nowrap">
																		{step.SpanName}
																	</span>
																</div>
																<span className="ml-2 text-nowrap text-muted-foreground">
																	{isStepSkipped
																		? '-'
																		: shortDuration(step.Duration)}
																</span>
															</Component>
														</li>
													);
												})}
											</ul>
										</AccordionContent>
									</AccordionItem>
								);
							})}
						</Accordion>
					</ResizablePanel>

					<ResizableHandle />

					<ResizablePanel defaultSize={75}>
						<div className="flex h-full max-h-full flex-col pt-1">
							<DistributionChart traceId={traceId} spanId={spanId} />

							<div className="h-full flex-col border-t bg-white dark:bg-black">
								<div>
									{logs?.map((log, i) => {
										return (
											<div
												key={i}
												className="flex gap-2 px-1 py-[2px] text-xs hover:bg-muted"
											>
												<div className="mr-1 w-12 shrink-0 select-none text-right tabular-nums text-muted-foreground">
													{i + 1}
												</div>
												<div className="grow font-mono">
													<LogLine text={log.Body} />
												</div>
											</div>
										);
									})}
								</div>
							</div>
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			</CardContent>
		</Card>
	);
}

interface LogLineProps {
	text: string;
}
function LogLine({ text }: LogLineProps) {
	return (
		<span
			className={cn({
				'text-teal-500': text.startsWith('[command]'),
				'text-yellow-500': text.startsWith('##[warning]'),
				'text-red-500': text.startsWith('##[error]'),
			})}
		>
			{parse(text).spans.map((span, i) => {
				return (
					<span key={i} style={toStyleObject(span.css)}>
						{span.text}
					</span>
				);
			})}
		</span>
	);
}

function toStyleObject(styleString: string) {
	const style: Record<string, string> = {};
	// TODO: this probably works poorly in dark/light mode. should be made theme-aware.
	parseStyleString(styleString, (name, value) => {
		style[camelize(name)] = value;
	});

	return style;
}

function camelize(str: string) {
	const arr = str.split('-');
	const capital = arr.map((item, index) =>
		index
			? item.charAt(0).toUpperCase() + item.slice(1).toLowerCase()
			: item.toLowerCase(),
	);
	const capitalString = capital.join('');

	return capitalString;
}
