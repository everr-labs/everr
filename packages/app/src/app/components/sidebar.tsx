import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getRouteApi, Link } from '@tanstack/react-router';
import { CitrusIcon, HomeIcon, SettingsIcon, WorkflowIcon } from 'lucide-react';

const routeApi = getRouteApi('/_app');

export function SideBar() {
	const search = routeApi.useSearch();

	return (
		<TooltipProvider>
			<aside className="fixed inset-y-0 left-0 z-10 hidden w-14 flex-col border-r bg-background sm:flex">
				<nav className="flex flex-col items-center gap-4 px-2 sm:py-5">
					<Link
						to="/"
						className="group flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-foreground transition-all hover:scale-125 md:h-10 md:w-10 md:text-base"
					>
						<CitrusIcon className="h-6 w-6 transition-all group-hover:-rotate-90 group-hover:scale-110" />
						<span className="sr-only">Citrus - CI/CD Observability</span>
					</Link>

					<Tooltip>
						<TooltipTrigger asChild>
							<Link
								to="/"
								search={search}
								activeOptions={{ exact: true, includeSearch: false }}
								activeProps={{ className: 'bg-accent text-accent-foreground' }}
								className={cn(
									'flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8',
								)}
							>
								<HomeIcon className="h-5 w-5" />
								<span className="sr-only">Home</span>
							</Link>
						</TooltipTrigger>
						<TooltipContent side="right">Home</TooltipContent>
					</Tooltip>
				</nav>
				<nav className="mt-auto flex flex-col items-center gap-4 px-2 sm:py-5">
					<Tooltip>
						<TooltipTrigger asChild>
							<Link
								to="/settings"
								className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:h-8 md:w-8"
							>
								<SettingsIcon className="h-5 w-5" />
								<span className="sr-only">Settings</span>
							</Link>
						</TooltipTrigger>
						<TooltipContent side="right">Settings</TooltipContent>
					</Tooltip>
				</nav>
			</aside>
		</TooltipProvider>
	);
}
