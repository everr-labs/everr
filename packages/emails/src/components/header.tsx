import { Column, Img, Link, Row, Section } from '@react-email/components';

export function Header() {
	return (
		<Section className="py-xl mx-auto">
			<Row>
				<Column className="w-full">
					<Link href="/">
						<Img
							alt="React Email logo"
							height="42"
							src="https://react.email/static/logo-without-background.png"
						/>
					</Link>
				</Column>
				<Column align="right">
					<Row align="right" className="w-0">
						<Column>
							<Link href="#">
								<Img
									alt="X"
									className="mx-[4px]"
									height="36"
									src="https://react.email/static/x-logo.png"
									width="36"
								/>
							</Link>
						</Column>
					</Row>
				</Column>
			</Row>
		</Section>
	);
}
