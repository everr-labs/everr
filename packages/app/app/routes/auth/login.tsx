import type { ErrorContext } from 'better-auth/react';
import type { InferInput } from 'valibot';
import { useState } from 'react';
import { Link } from '@/components/Link';
import { PrivacyPolicyDialog } from '@/components/PrivacyPolicyDialog';
import { TermsOfUseDialog } from '@/components/TermsOfUseDialog';
import {
	authClient,
	SignInSchema,
	SocialSignInSchema,
} from '@/lib/auth-client';
import { valibotResolver } from '@hookform/resolvers/valibot';
import { SiGithub } from '@icons-pack/react-simple-icons';
import { createFileRoute, retainSearchParams } from '@tanstack/react-router';
import { AlertCircleIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { object, optional, string } from 'valibot';

import {
	Alert,
	AlertTitle,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
	Input,
} from '@citric/ui';

export const Route = createFileRoute('/auth/login')({
	validateSearch: object({
		redirect: optional(string()),
	}),
	search: {
		middlewares: [retainSearchParams(['redirect'])],
	},
	component: LogIn,
});

const SocialSignInOptionsMap = {
	github: {
		Icon: SiGithub,
		label: 'GitHub',
	},
} as const;

function LogIn() {
	const [error, setError] = useState<ErrorContext>();
	const [isSignInPending, setIsSignInPending] = useState(false);
	const [isSocialSignInPending, setIsSocialSignInPending] = useState(false);
	const { redirect } = Route.useSearch();

	const form = useForm({
		resolver: valibotResolver(SignInSchema),
		defaultValues: {
			email: '',
			password: '',
		},
	});

	async function onSubmit(data: InferInput<typeof SignInSchema>) {
		await authClient.signIn.email({
			callbackURL: redirect,
			rememberMe: true,
			fetchOptions: {
				onRequest() {
					setError(undefined);
					setIsSignInPending(true);
				},
				onError(error) {
					setError(error);
					setIsSignInPending(false);
				},
			},
			...data,
		});
	}

	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader className="text-center">
					<CardTitle className="text-xl">Welcome back</CardTitle>
					<CardDescription>Login with your social provider</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-6">
						{SocialSignInSchema.entries.provider.options.map((option) => {
							const { label, Icon } = SocialSignInOptionsMap[option];
							return (
								<Button
									key={option}
									variant="outline"
									className="w-full"
									loading={isSocialSignInPending}
									onClick={() => {
										void authClient.signIn.social({
											callbackURL: redirect,
											provider: option,
											fetchOptions: {
												onRequest() {
													setError(undefined);
													setIsSocialSignInPending(true);
												},
												onError(error) {
													setError(error);
													setIsSocialSignInPending(false);
												},
											},
										});
									}}
								>
									<Icon className="mr-2 h-4" />
									Login with {label}
								</Button>
							);
						})}

						<div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
							<span className="relative z-10 bg-background px-2 text-muted-foreground">
								Or continue with
							</span>
						</div>
						<Form {...form}>
							<form
								className="grid gap-6"
								onSubmit={form.handleSubmit(onSubmit)}
							>
								<div className="grid gap-6">
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="email"
											render={({ field }) => (
												<FormItem>
													<FormLabel>Email</FormLabel>
													<FormControl>
														<Input placeholder="me@example.com" {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>
									<div className="grid gap-2">
										<FormField
											control={form.control}
											name="password"
											render={({ field }) => (
												<FormItem>
													<div className="flex items-center">
														<FormLabel>Password</FormLabel>
														<Link
															to="/auth/recover-password"
															className="ml-auto text-sm hover:underline"
														>
															Forgot your password?
														</Link>
													</div>
													<FormControl>
														<Input type="password" {...field} />
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>
									</div>

									{error && <AuthErrorAlert error={error} />}
									<Button
										type="submit"
										className="w-full"
										loading={isSignInPending}
									>
										Login
									</Button>
								</div>
								<div className="text-center text-sm">
									Don&apos;t have an account yet?{' '}
									<Link to="/auth/signup">Sign up</Link>
								</div>
							</form>
						</Form>
					</div>
				</CardContent>
			</Card>

			<div className="mt-4 text-pretty text-center text-xs text-muted-foreground">
				By proceeding, you agree to our <TermsOfUseDialog /> and{' '}
				<PrivacyPolicyDialog />.
			</div>
		</div>
	);
}

function AuthErrorAlert({ error }: { error: ErrorContext }) {
	return (
		<Alert variant="destructive">
			<AlertCircleIcon className="h-4 w-4" />

			<AlertTitle>{error.error.message}</AlertTitle>
			{/* <AlertDescription>
				{error.error.message}

				{JSON.stringify(error.error)}
			</AlertDescription> */}
		</Alert>
	);
}
