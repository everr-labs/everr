import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/_authenticated/_app/repos/$org/$repo')({
	loader: async ({ context: { trpcQueryUtils }, params: { org, repo } }) => {
		try {
			await trpcQueryUtils.repos.getRepo.ensureData(`${org}/${repo}`);
		} catch (_) {
			return notFound();
		}
	},
	component: RepositoryPage,
	notFoundComponent: () => <h1>Not found</h1>,
});

function RepositoryPage() {
	const { org, repo } = Route.useParams();

	return (
		<div>
			<h1>
				Repository Page {org}/{repo}
			</h1>
		</div>
	);
}
