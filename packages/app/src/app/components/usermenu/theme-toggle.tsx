'use client';

import { useState } from 'react';
import {
	DropdownMenuPortal,
	DropdownMenuRadioItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { DropdownMenuRadioGroup } from '@radix-ui/react-dropdown-menu';
import { MoonIcon, PaletteIcon, SunIcon, SunMoonIcon } from 'lucide-react';

export function ModeToggle() {
	const [theme, setTheme] = useState('light');

	return (
		<DropdownMenuSub>
			<DropdownMenuSubTrigger>
				<PaletteIcon className="mr-2 h-4 w-4" />
				<span>Theme</span>
			</DropdownMenuSubTrigger>
			<DropdownMenuPortal>
				<DropdownMenuSubContent>
					<DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
						<DropdownMenuRadioItem
							value="light"
							className="flex justify-between"
						>
							<span>Light</span>
							<SunIcon className="h-4 w-4" />
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem
							value="dark"
							className="flex justify-between"
						>
							<span>Dark</span>
							<MoonIcon className="h-4 w-4" />
						</DropdownMenuRadioItem>
						<DropdownMenuRadioItem
							value="system"
							className="flex justify-between"
						>
							<span>System</span>
							<SunMoonIcon className="h-4 w-4" />
						</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuSubContent>
			</DropdownMenuPortal>
		</DropdownMenuSub>
	);
}
