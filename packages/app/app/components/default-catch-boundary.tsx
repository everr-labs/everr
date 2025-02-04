import type { ErrorComponentProps } from '@tanstack/react-router';
import type { MouseEvent } from 'react';
import {
	ErrorComponent,
	Link,
	rootRouteId,
	useMatch,
	useRouter,
} from '@tanstack/react-router';

import { Button } from '@citric/ui';

export function DefaultCatchBoundary({ error }: ErrorComponentProps) {
	const router = useRouter();
	const isRoot = useMatch({
		strict: false,
		select: (state) => state.id === rootRouteId,
	});

	return (
		<div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-6 p-4">
			<ErrorComponent error={error} />
			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={() => {
						void router.invalidate();
					}}
				>
					Try Again
				</Button>
				{isRoot ? (
					<Button asChild>
						<Link to="/">Home</Link>
					</Button>
				) : (
					<Button asChild variant="secondary">
						<Link
							to="/"
							onClick={(e: MouseEvent<HTMLAnchorElement>) => {
								e.preventDefault();
								window.history.back();
							}}
						>
							Go Back
						</Link>
					</Button>
				)}
			</div>
		</div>
	);
}
