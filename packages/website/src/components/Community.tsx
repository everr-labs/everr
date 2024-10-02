import { CitrusIcon } from 'lucide-react';

import {
	Button,
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from '@citric/ui';

export function Community() {
	return (
		<section id="community" className="py-12">
			<hr className="border-secondary" />
			<div className="container py-20 sm:py-20">
				<div className="mx-auto lg:w-[60%]">
					<Card className="flex flex-col items-center justify-center border-none bg-background text-center shadow-none">
						<CardHeader>
							<CardTitle className="flex flex-col items-center text-4xl font-bold md:text-5xl">
								<CitrusIcon />
								<div>
									Ready to join this
									<span className="bg-gradient-to-r from-accent2 to-primary bg-clip-text pl-2 text-transparent">
										Community?
									</span>
								</div>
							</CardTitle>
						</CardHeader>
						<CardContent className="text-xl text-muted-foreground lg:w-[80%]">
							Join our vibrant Discord community! Connect, share, and grow with
							like-minded enthusiasts. Click to dive in! 🚀
						</CardContent>

						<CardFooter>
							<Button asChild>
								<a href="https://discord.com/" target="_blank">
									Join Discord
								</a>
							</Button>
						</CardFooter>
					</Card>
				</div>
			</div>
			<hr className="border-secondary" />
		</section>
	);
}
