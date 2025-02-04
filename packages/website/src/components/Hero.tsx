import { ArrowRight } from 'lucide-react';

import { Badge, Button } from '@citric/ui';

import heroImage from '../img/screenshot.png';
import { GradientText } from './ui/gradient-text';

export function Hero() {
	return (
		<section className="container w-full">
			<div className="mx-auto grid place-items-center gap-8 py-20 md:py-32 lg:max-w-screen-xl">
				<div className="space-y-8 text-center">
					<Badge variant="outline" className="py-2 text-sm">
						<span className="mr-2 text-primary">
							<Badge>New</Badge>
						</span>
						<span>GitHub Actions integration</span>
					</Badge>

					<div className="mx-auto max-w-screen-md text-center text-4xl font-bold md:text-6xl">
						<h1>
							Pipelines visibility,{' '}
							<GradientText className="text-nowrap">made simple</GradientText>.
						</h1>
					</div>

					<p className="mx-auto max-w-screen-sm text-xl text-muted-foreground">
						Take control of your CI/CD health — detailed performance tracking,
						failure analysis, and cost monitoring all in one platform.
					</p>

					<div className="space-y-4 md:space-x-4 md:space-y-0">
						<Button className="group/arrow w-5/6 font-bold md:w-1/4" size="lg">
							Join the beta
							<ArrowRight className="ml-2 size-5 transition-transform group-hover/arrow:translate-x-1" />
						</Button>

						<Button
							variant="secondary"
							className="w-5/6 font-bold md:w-1/4"
							disabled
							size="lg"
							asChild
						>
							<a href={import.meta.env.VITE_DOCS_URL}>Documentation</a>
						</Button>
					</div>
				</div>

				<div className="group relative mt-14">
					<div className="absolute left-1/2 top-2 mx-auto h-24 w-[90%] -translate-x-1/2 transform rounded-full bg-primary/50 blur-3xl lg:-top-8 lg:h-80"></div>
					<img
						width={1200}
						height={600}
						className="rouded-lg relative mx-auto flex w-full items-center rounded-lg border border-t-2 border-secondary border-t-primary/30 leading-none md:w-[1200px]"
						src={heroImage.src}
						alt="dashboard"
					/>

					<div className="absolute bottom-0 left-0 h-20 w-full rounded-lg bg-gradient-to-b from-background/0 via-background/50 to-background md:h-28"></div>
				</div>
			</div>
		</section>
	);
}
