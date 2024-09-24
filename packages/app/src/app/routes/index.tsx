import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';

import { Button } from '../components/ui/button';
import { trpc } from '../utils/trpc';

export const Route = createFileRoute('/')({
	component: Index,
});

function Index() {
	const [counter, setCounter] = useState(0);
	const a = trpc.greeting.useQuery();

	return (
		<div className="p-2">
			<h3>
				{a.data?.msg}
				Welcome Home!
				<Button
					onClick={() => {
						setCounter(counter + 1);
					}}
				>
					{counter}
				</Button>
			</h3>
		</div>
	);
}
