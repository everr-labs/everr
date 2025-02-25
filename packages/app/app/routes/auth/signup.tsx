import type { InferInput } from 'valibot';
import { useState } from 'react';
import { Link } from '@/components/Link';
import { PrivacyPolicyDialog } from '@/components/PrivacyPolicyDialog';
import { TermsOfUseDialog } from '@/components/TermsOfUseDialog';
import { authClient, SignUpSchema } from '@/lib/auth-client';
import { valibotResolver } from '@hookform/resolvers/valibot';
import { createFileRoute, retainSearchParams } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { object, optional, string } from 'valibot';

import {
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

export const Route = createFileRoute('/auth/signup')({
	validateSearch: object({
		redirect: optional(string()),
	}),
	search: {
		middlewares: [retainSearchParams(['redirect'])],
	},
	component: SignUpPage,
});

function SignUpPage() {
	const [isPending, setIsPending] = useState(false);
	const form = useForm({
		resolver: valibotResolver(SignUpSchema),
		defaultValues: {
			name: '',
			email: '',
			password: '',
			passwordConfirm: '',
		},
	});
	const navigate = Route.useNavigate();
	const { redirect } = Route.useSearch();

	async function onSubmit(data: InferInput<typeof SignUpSchema>) {
		await authClient.signUp.email({
			...data,
			fetchOptions: {
				onSuccess() {
					void navigate({ to: redirect ?? '/' });
				},
				onRequest() {
					setIsPending(true);
				},
				onError(_error) {
					setIsPending(false);
					// TODO: Handle the error
				},
			},
		});
	}
	return (
		<div className="flex flex-col gap-6">
			<Card>
				<CardHeader className="text-center">
					<CardTitle className="text-xl">Sign up</CardTitle>
					<CardDescription>Create an account to get started</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-6">
					<Form {...form}>
						<form className="grid gap-6" onSubmit={form.handleSubmit(onSubmit)}>
							<div className="grid gap-6">
								<div className="grid gap-2">
									<FormField
										control={form.control}
										name="name"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Name</FormLabel>
												<FormControl>
													<Input placeholder="John Doe" {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
								<div className="grid gap-2">
									<FormField
										control={form.control}
										name="email"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Email</FormLabel>
												<FormControl>
													<Input
														placeholder="john.doe@example.com"
														type="email"
														{...field}
													/>
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
												<FormLabel>Password</FormLabel>
												<FormControl>
													<Input type="password" {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
								<div className="grid gap-2">
									<FormField
										control={form.control}
										name="passwordConfirm"
										render={({ field }) => (
											<FormItem>
												<FormLabel>Confirm password</FormLabel>
												<FormControl>
													<Input type="password" {...field} />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>

								<Button type="submit" className="w-full" loading={isPending}>
									Sign up
								</Button>
							</div>
							<div className="text-center text-sm">
								Already have an account? <Link to="/auth/login">Sign In</Link>
							</div>
						</form>
					</Form>
				</CardContent>
			</Card>

			<div className="mt-4 text-pretty text-center text-xs text-muted-foreground">
				By proceeding, you agree to our <TermsOfUseDialog /> and{' '}
				<PrivacyPolicyDialog />.
			</div>
		</div>
	);
}
