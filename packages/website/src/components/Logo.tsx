import { CitrusIcon } from 'lucide-react';

export function Logo() {
	return (
		<>
			<span className="mr-2 grid size-9 place-items-center rounded-lg border border-secondary bg-gradient-to-tr from-primary via-primary/70 to-primary text-primary-foreground">
				<CitrusIcon className="size-6" />
			</span>
			Citric
		</>
	);
}
