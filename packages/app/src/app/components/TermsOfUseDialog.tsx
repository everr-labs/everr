import {
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@citric/ui';

export function TermsOfUseDialog() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="link" size="sm" className="h-4 p-0 text-xs">
					Terms of Use
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-fullscreen flex flex-col overflow-auto p-0">
				<DialogHeader className="p-4">
					<DialogTitle>Citric's Terms of Use</DialogTitle>
				</DialogHeader>
				<div className="prose dark:prose-invert prose-sm grow overflow-auto px-4">
					<p>
						{/* TODO: add date */}
						<strong>Effective Date:</strong> [Insert Date]
					</p>

					<p>
						These Terms of Use (“Terms”) govern your use of Citric, a CI/CD
						observability service web app (the “Service”). By accessing or using
						Citric, you agree to comply with and be bound by these Terms. If you
						do not agree with any part of these Terms, you must stop using the
						Service immediately.
					</p>

					<h2>1. Use of the Service</h2>
					<p>
						Citric provides a platform for CI/CD observability, allowing you to
						monitor and manage your software pipelines. You agree to use the
						Service only for lawful purposes and in accordance with these Terms.
						You are responsible for ensuring that your use of Citric complies
						with all applicable laws, regulations, and third-party rights.
					</p>

					<h3>Eligibility</h3>
					<p>
						You must be at least 18 years old to use Citric. By using the
						Service, you represent and warrant that you meet this age
						requirement.
					</p>

					<h2>2. User Accounts</h2>
					<p>
						To use Citric, you are required to create an account using
						third-party authentication services (GitHub Auth). You must provide
						accurate and complete information during registration and ensure
						your account credentials remain secure. You are responsible for all
						activities that occur under your account, and you agree to notify us
						immediately of any unauthorized use.
					</p>
					<p>
						We reserve the right to suspend or terminate your account if you
						violate these Terms or engage in any fraudulent or illegal
						activities.
					</p>

					<h2>3. Payments</h2>
					<p>
						If you choose to purchase a subscription or any additional features,
						you agree to pay the applicable fees as described on our pricing
						page. Payments are processed through <strong>Stripe</strong>, a
						third-party payment processor. By making a purchase, you agree to
						Stripe’s{' '}
						<a href="https://stripe.com/legal" target="_blank">
							Terms of Service
						</a>{' '}
						and{' '}
						<a href="https://stripe.com/privacy" target="_blank">
							Privacy Policy
						</a>
						.
					</p>
					<p>
						All fees are non-refundable unless otherwise stated in our refund
						policy.
					</p>

					<h2>4. Prohibited Activities</h2>
					<p>
						You agree not to engage in any of the following activities while
						using Citric:
					</p>
					<ul>
						<li>
							Attempting to interfere with or compromise the integrity of the
							Service, including hacking, denial of service attacks, or
							introducing viruses or malicious code.
						</li>
						<li>
							Misusing or exploiting any part of the Service, including
							unauthorized access to the systems, accounts, or data of other
							users.
						</li>
						<li>
							Using the Service to engage in any unlawful activities or infringe
							on the rights of third parties, including but not limited to
							intellectual property violations.
						</li>
					</ul>
					<p>
						We reserve the right to investigate and take legal action against
						any user who violates these Terms, including suspending or
						terminating your access to the Service.
					</p>

					<h2>5. Intellectual Property</h2>
					<p>
						All intellectual property rights in Citric, including but not
						limited to software, logos, trademarks, and content, are owned by
						Citric or its licensors. You are granted a limited, non-exclusive,
						and non-transferable right to use the Service, subject to these
						Terms.
					</p>
					<p>
						You may not reproduce, distribute, modify, or create derivative
						works based on any part of the Service without prior written
						permission from Citric.
					</p>

					<h2>6. Data and Privacy</h2>
					<p>
						By using the Service, you agree to our collection and use of your
						data as described in our{' '}
						<a href="[link-to-privacy-policy]" target="_blank">
							Privacy Policy
						</a>
						. You retain ownership of any content or data you upload to the
						Service, but you grant Citric a license to use, store, and display
						such content to provide the Service.
					</p>

					<h2>7. Limitation of Liability</h2>
					<p>
						Citric is provided on an “as-is” and “as-available” basis. We do not
						guarantee that the Service will be uninterrupted, secure, or free
						from errors. To the fullest extent permitted by law, Citric
						disclaims all warranties, express or implied, including but not
						limited to implied warranties of merchantability, fitness for a
						particular purpose, and non-infringement.
					</p>
					<p>
						In no event will Citric, its affiliates, or its service providers be
						liable for any indirect, incidental, special, consequential, or
						punitive damages, including but not limited to loss of profits,
						data, or business, arising out of your use of or inability to use
						the Service.
					</p>

					<h2>8. Termination</h2>
					<p>
						We reserve the right to suspend or terminate your access to Citric
						at any time, with or without notice, if you violate these Terms or
						if we believe that your actions may harm the Service or its users.
					</p>
					<p>
						Upon termination, your right to use the Service will immediately
						cease, and we may delete your account and any associated data.
					</p>

					<h2>9. Changes to the Terms</h2>
					<p>
						We may update these Terms from time to time. When we make changes,
						we will notify you via email or post an announcement within the
						Service. Your continued use of the Service after such changes
						constitutes your acceptance of the new Terms.
					</p>

					<h2>10. Governing Law</h2>
					<p>
						These Terms are governed by and construed in accordance with the
						laws of [Your Country/State], without regard to its conflict of law
						principles. Any disputes arising from or relating to these Terms or
						the use of the Service will be resolved exclusively in the courts of
						[Your Jurisdiction].
					</p>

					<h2>11. Contact Information</h2>
					<p>
						If you have any questions or concerns about these Terms, please
						contact us at <a href="mailto:info@citric.app">info@citric.app</a>.
					</p>
				</div>
				<DialogFooter className="pb-4 pr-4">
					<DialogClose asChild>
						<Button type="button" variant="secondary">
							Close
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
