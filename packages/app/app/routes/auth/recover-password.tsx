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
} from '@citric/ui';

export const Route = createFileRoute('/auth/recover-password')({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<Card className="mx-auto max-w-sm">
			<CardHeader>
				<CardTitle className="text-3xl">Password recovery</CardTitle>
				<CardDescription>
					Enter your email address and we'll send you a link to reset your
					password.
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
					<Button type="submit" className="w-full">
						Recover password
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
