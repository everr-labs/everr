import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import {
	Body,
	Container,
	Head,
	Html,
	Preview,
	Section,
	Tailwind,
} from '@react-email/components';

export default function () {
	return (
		<Html>
			<Head />
			<Preview>Netlify Welcome</Preview>
			<Tailwind
				config={{
					theme: {
						extend: {
							colors: {
								primary: {
									DEFAULT: '#4F46E5',
								},
								offwhite: '#f6f6f6',
								border: '#efefef',
							},
							spacing: {
								sm: '8px',
								md: '16px',
								lg: '24px',
								xl: '32px',
								'2xl': '48px',
							},
						},
					},
				}}
			>
				<Body className="bg-offwhite font-sans antialiased">
					<Container>
						<Header />
						<Section className="py-lg px-md border-px rounded border border-solid border-border bg-white">
							LOL
						</Section>
						<Footer />
					</Container>
				</Body>
			</Tailwind>
		</Html>
	);
}
