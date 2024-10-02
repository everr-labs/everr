import { useState } from 'react';
import { PrivacyPolicyDialog } from '@/components/PrivacyPolicyDialog';
import { TermsOfUseDialog } from '@/components/TermsOfUseDialog';
import { createFileRoute } from '@tanstack/react-router';
import { GithubIcon } from 'lucide-react';

import { signIn } from '@citric/auth';
import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@citric/ui';

export const Route = createFileRoute('/auth/login')({
	component: SignIn,
});

function SignIn() {
	const [loading, setLoading] = useState(false);

	return (
		<Card className="mx-auto max-w-sm">
			<CardHeader>
				<CardTitle className="text-3xl">Login</CardTitle>
				<CardDescription>
					Get started with Citric by logging in with your GitHub account.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4">
					<Button
						variant="outline"
						className="w-full"
						loading={loading}
						onClick={() => {
							setLoading(true);
							signIn('github', { callbackUrl: '/' }).catch(() => {
								setLoading(false);
							});
						}}
					>
						<GithubIcon className="mr-2 h-4" />
						Login with GitHub
					</Button>
				</div>
				<div className="mt-4 text-pretty text-center text-xs text-muted-foreground">
					By proceeding, you agree to Citric's <TermsOfUseDialog /> &{' '}
					<PrivacyPolicyDialog />.
				</div>
			</CardContent>
		</Card>
	);
}
