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

export function PrivacyPolicyDialog() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="link" size="sm" className="h-4 p-0 text-xs">
					Privacy Policy
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-fullscreen flex flex-col overflow-auto p-0">
				<DialogHeader className="p-4">
					<DialogTitle>Citric's Privacy Policy</DialogTitle>
				</DialogHeader>
				<div className="prose dark:prose-invert prose-sm grow overflow-auto px-4">
					<p>
						{/* TODO: Insert date here */}
						<strong>Effective Date:</strong> [Insert Date]
					</p>

					<p>
						At Citric, we are committed to protecting your privacy and ensuring
						the security of your personal information. This Privacy Policy
						outlines how we collect, use, store, and disclose your information
						when you use our CI/CD observability service web app.
					</p>

					<h2>1. Information We Collect</h2>
					<h3>Personal Data:</h3>
					<p>
						We collect the following personal data through third-party services
						(GitHub Auth) when you sign up or log in to Citric:
					</p>
					<ul>
						<li>Name</li>
						<li>Email address</li>
					</ul>

					<h3>Usage Data:</h3>
					<p>
						We collect data on how you use Citric to improve our services. This
						includes information about your interactions with the platform, such
						as features used and time spent on different sections of the app. We
						do not sell your personal information to advertisers or third-party
						companies.
					</p>

					<h2>2. Third-Party Services</h2>
					<p>
						We use third-party services to provide essential functions for
						Citric. These services may collect personal data as necessary to
						perform their role. The third-party services we use include:
					</p>
					<ul>
						<li>
							<strong>GitHub Auth:</strong> For user authentication.
						</li>
						<li>
							<strong>Stripe:</strong> For payment processing (please refer to{' '}
							<a href="https://stripe.com/privacy" target="_blank">
								Stripe's Privacy Policy
							</a>{' '}
							for details).
						</li>
						<li>
							<strong>Sentry:</strong> For error monitoring and logging.
						</li>
					</ul>

					<h2>3. How We Use Your Data</h2>
					<p>We use your data for the following purposes:</p>
					<ul>
						<li>To provide and improve our services.</li>
						<li>To process payments for Citric services.</li>
						<li>
							To communicate with you regarding your account and updates to
							Citric.
						</li>
						<li>To ensure the security of our platform.</li>
					</ul>
					<p>
						We do not sell your personal data to advertisers or other third
						parties. We may share data with third parties only to the extent
						necessary for payment processing (via Stripe) or to comply with
						legal obligations.
					</p>

					<h2>4. Data Retention</h2>
					<p>
						We store your data as long as your account is active or as needed to
						provide you with our services. You may request the deletion of your
						data at any time through the Citric platform’s in-app deletion
						feature.
					</p>

					<h2>5. Data Security</h2>
					<p>
						We implement standard security measures to protect your data,
						including encryption, secure servers, and access controls. However,
						no system can be 100% secure, and we cannot guarantee absolute
						protection of your data.
					</p>

					<h2>6. Your Rights</h2>
					<p>You have the following rights regarding your personal data:</p>
					<ul>
						<li>
							<strong>Access:</strong> You can access the personal data we hold
							about you at any time.
						</li>
						<li>
							<strong>Deletion:</strong> You can request deletion of your data
							through Citric's in-app deletion feature.
						</li>
						<li>
							<strong>Correction:</strong> You can update your personal
							information by contacting us.
						</li>
					</ul>
					<p>
						To exercise any of these rights, please contact us at{' '}
						<a href="mailto:info@citric.app">info@citric.app</a>.
					</p>

					<h2>7. Cookies and Tracking</h2>
					<p>
						Citric uses cookies and similar tracking technologies to enhance
						your experience and analyze how the service is used. You can manage
						cookie preferences through your browser settings.
					</p>

					<h2>8. Age Restrictions</h2>
					<p>
						Citric is not intended for use by individuals under the age of 18,
						and we do not knowingly collect personal information from children.
						If we become aware that a child has provided us with personal data,
						we will delete it immediately.
					</p>

					<h2>9. Changes to This Privacy Policy</h2>
					<p>
						We may update this privacy policy from time to time. Any changes
						will be communicated to you via email. Please review the policy
						periodically for any updates.
					</p>

					<h2>10. Contact Us</h2>
					<p>
						If you have any questions or concerns regarding this Privacy Policy,
						please contact us at{' '}
						<a href="mailto:info@citric.app">info@citric.app</a>.
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
