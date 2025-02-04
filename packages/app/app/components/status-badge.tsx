import { CheckCircle2Icon, XCircleIcon } from 'lucide-react';

import { Badge } from '@citric/ui';

interface Props {
	status: 'success' | 'cancelled' | 'failed';
}

export function StatusBadge({ status }: Props) {
	return (
		<Badge
			variant={
				status === 'success'
					? 'success'
					: status === 'cancelled'
						? 'destructive'
						: 'default'
			}
		>
			{status === 'success' && <CheckCircle2Icon className="mr-1 h-3 w-3" />}
			{status === 'cancelled' && <XCircleIcon className="mr-1 h-3 w-3" />}

			{status}
		</Badge>
	);
}
