import { Logo } from './Logo';

export const Footer = () => {
	return (
		<footer id="footer" className="container py-24 sm:py-32">
			<div className="rounded-2xl border border-secondary bg-card p-10">
				<div className="grid grid-cols-2 gap-x-12 gap-y-8 md:grid-cols-4 xl:grid-cols-6">
					<div className="col-span-full xl:col-span-2">
						<a href="/" className="flex items-center text-xl font-bold">
							<Logo />
						</a>
					</div>

					<div className="flex flex-col gap-2">
						<h3 className="text-lg font-bold">Contact</h3>
						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Github
							</a>
						</div>

						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Twitter
							</a>
						</div>

						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Instagram
							</a>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<h3 className="text-lg font-bold">Platforms</h3>
						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								iOS
							</a>
						</div>

						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Android
							</a>
						</div>

						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Web
							</a>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<h3 className="text-lg font-bold">Help</h3>
						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Contact Us
							</a>
						</div>

						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								FAQ
							</a>
						</div>

						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Feedback
							</a>
						</div>
					</div>

					<div className="flex flex-col gap-2">
						<h3 className="text-lg font-bold">Socials</h3>
						<div>
							<a href="#" className="opacity-60 hover:opacity-100">
								Twitter / X
							</a>
						</div>
					</div>
				</div>
			</div>
		</footer>
	);
};
