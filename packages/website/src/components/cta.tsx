import { ArrowRightIcon } from 'lucide-react';

import { Button } from '@citric/ui';

import { FlickeringGrid } from './ui/flickering-grid';
import { GradientText } from './ui/gradient-text';

export function CTA() {
	return (
		<section className="relative mb-16 flex h-[500px] items-center overflow-hidden border-b border-t border-secondary">
			<div className="absolute -z-10 h-[520px] w-full overflow-hidden">
				<FlickeringGrid
					className="relative inset-0 [mask-image:radial-gradient(650px_circle_at_center,white,transparent)]"
					squareSize={6}
					gridGap={4}
					color="#FACC15"
					maxOpacity={0.5}
					flickerChance={0.1}
				/>
			</div>
			<div className="container">
				<div className="mx-auto lg:w-[60%]">
					<div className="flex flex-col items-center justify-center gap-2 border-none text-center shadow-none">
						<span className="flex flex-col items-center text-4xl font-bold md:text-5xl">
							<div>
								Ready to{' '}
								<GradientText className="text-nowrap">
									take control
								</GradientText>{' '}
								over your pipelines?
							</div>
						</span>
						<span className="mt-4 text-xl text-secondary-foreground lg:w-[80%]">
							Take the guesswork out of pipeline optimization with actionable
							insights on performance, failures, and costs. 🚀
						</span>

						<Button className="group/arrow mt-8 font-bold" size="lg">
							Join the beta
							<ArrowRightIcon className="ml-2 size-5 transition-transform group-hover/arrow:translate-x-1" />
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}
