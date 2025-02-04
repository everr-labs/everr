import { ChartAreaIcon, EyeOffIcon, ReceiptIcon } from 'lucide-react';

interface Problem {
	name: string;
	description: string;
	// TODO: Fix this
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	Icon: any;
}

const problems = [
	{
		Icon: EyeOffIcon,
		name: 'CI/CD pipelines are a black box',
		description:
			"Developers often lack clear insights into what's happening inside their pipelines—what's slowing them down, why they fail, or where inefficiencies lie.",
	},
	{
		Icon: ReceiptIcon,
		name: 'Pipeline costs are invisible',
		description:
			'Organizations struggle to understand the financial impact of their CI/CD pipelines, leading to wasted resources and overspending on inefficient processes.',
	},
	{
		Icon: ChartAreaIcon,
		name: 'Improvements lack measurable impact',
		description:
			'Even after investing time and resources into improvements, teams are left guessing whether their changes had any positive effect.',
	},
] satisfies Problem[];

export function Problem() {
	return (
		<section>
			<div>
				<div className="container relative py-16">
					<div className="mx-auto max-w-3xl space-y-4 pb-6 text-center">
						<h2 className="mb-2 font-bold uppercase tracking-wider text-primary">
							Problem
						</h2>

						<h3 className="mx-auto mt-4 text-3xl font-semibold sm:max-w-none sm:text-4xl md:text-5xl">
							There's no visibility over workflows.
						</h3>
					</div>
					<div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
						{problems.map(({ name, description, Icon }) => (
							<div
								key={name}
								className="rounded-lg border border-none bg-background text-card-foreground shadow-none"
							>
								<div className="space-y-4 p-6">
									<div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
										<Icon />
									</div>
									<h3 className="text-xl font-semibold">{name}</h3>
									<p className="text-pretty text-muted-foreground">
										{description}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
