import { UserMenu } from '@/components/UserMenu';
import { Link } from '@tanstack/react-router';
import {
	CitrusIcon,
	PanelLeftIcon,
	SearchIcon,
	SettingsIcon,
} from 'lucide-react';

import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
	Button,
	Input,
	Sheet,
	SheetContent,
	SheetTrigger,
} from '@citric/ui';

export function TopNav() {
	return (
		<header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background px-4 sm:static sm:h-auto sm:border-0 sm:bg-transparent sm:px-6">
			<Sheet>
				<SheetTrigger asChild>
					<Button size="icon" variant="outline" className="sm:hidden">
						<PanelLeftIcon className="h-5 w-5" />
						<span className="sr-only">Toggle Menu</span>
					</Button>
				</SheetTrigger>
				<SheetContent side="left" className="sm:max-w-xs">
					<nav className="grid gap-6 text-lg font-medium">
						<Link
							to="/"
							className="group flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-full bg-primary text-lg font-semibold text-primary-foreground md:text-base"
						>
							<CitrusIcon className="h-5 w-5 transition-all group-hover:scale-110" />
							<span className="sr-only">Acme Inc</span>
						</Link>

						<Link
							to="/settings"
							className="flex items-center gap-4 px-2.5 text-muted-foreground hover:text-foreground"
						>
							<SettingsIcon className="h-5 w-5" />
							Settings
						</Link>
					</nav>
				</SheetContent>
			</Sheet>
			<Breadcrumb className="hidden md:flex">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink asChild>
							<Link to="/">Home</Link>
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />

					<BreadcrumbItem>
						<BreadcrumbPage>Workflow Runs</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<div className="relative ml-auto flex-1 md:grow-0">
				<SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
				<Input
					type="search"
					placeholder="Search..."
					className="w-full rounded-lg bg-background pl-8 md:w-[200px] lg:w-[336px]"
				/>
			</div>
			<UserMenu user={{}} />
		</header>
	);
}
