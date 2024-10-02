import { createFileRoute } from '@tanstack/react-router';

import { signIn } from '@citric/auth';
import { Button } from '@citric/ui';

export const Route = createFileRoute('/auth/login')({
	component: () => (
		<div>
			<Button
				onClick={async () => {
					await signIn('github', { callbackUrl: '/' });
				}}
			>
				Github
			</Button>
		</div>
	),
});
