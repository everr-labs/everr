import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/_app/settings/')({
	component: () => <div>Hello /_app/settings/!</div>,
});
