import { Avatar, AvatarFallback, AvatarImage } from '@citric/ui';

interface Props {
	name: string;
	image?: string;
}
export function UserAvatar({ name, image }: Props) {
	const parts = name.split(' ').map((n) => n[0]);
	const initials = [parts[0], parts[parts.length - 1]].filter(Boolean).join('');

	return (
		<Avatar className="h-8 w-8 rounded-lg">
			<AvatarImage src={image} alt={name} />
			<AvatarFallback className="rounded-lg">{initials}</AvatarFallback>
		</Avatar>
	);
}
