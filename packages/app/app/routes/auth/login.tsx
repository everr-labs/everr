import { Link } from '@/components/Link';
import { PrivacyPolicyDialog } from '@/components/PrivacyPolicyDialog';
import { TermsOfUseDialog } from '@/components/TermsOfUseDialog';
import { useSignInMutation, useSocialSignInMutation } from '@/lib/auth-client';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { createFileRoute } from '@tanstack/react-router';

import {
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Input,
	Label,
	Separator,
} from '@citric/ui';

export const Route = createFileRoute('/auth/login')({
	component: LogIn,
});

function LogIn() {
	const {
		mutate: socialSignIn,
		isPending,
		isSuccess,
	} = useSocialSignInMutation();
	const { mutate: signIn } = useSignInMutation();

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
					<div className="grid gap-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							type="email"
							placeholder="me@example.com"
							required
						/>
					</div>
					<div className="grid gap-2">
						<div className="flex items-center">
							<Label htmlFor="password">Password</Label>
							<Link
								to="/auth/recover-password"
								className="ml-auto inline-block text-xs underline"
							>
								Forgot your password?
							</Link>
						</div>
						<Input id="password" type="password" required />
					</div>
					<Button
						type="submit"
						className="w-full"
						onClick={() => {
							signIn({ data: {} });
						}}
					>
						Login
					</Button>

					<Separator />

					<Button
						variant="outline"
						className="w-full"
						loading={isPending || isSuccess}
						onClick={() => {
							socialSignIn({ data: { provider: 'github' } });
						}}
					>
						<SiGithub className="mr-2 h-4" />
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
