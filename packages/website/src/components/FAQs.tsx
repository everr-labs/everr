import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
	Button,
} from '@citric/ui';

interface FAQProps {
	question: string;
	answer: string;
}

const FAQList: FAQProps[] = [
	{
		question: 'What CI/CD providers does Citric support?',
		answer:
			'We currently support GitHub Actions and are working to expand to other major CI/CD providers like GitLab, CircleCI, and Jenkins in the near future.',
	},
	{
		question: 'Can I track the cost of my CI/CD pipelines?',
		answer:
			'Yes, our platform provides detailed cost tracking, breaking down the expenses of your pipelines by jobs, steps, and repositories, allowing you to optimize for cost-efficiency.',
	},
	{
		question: 'Can I monitor failure rates across branches and jobs?',
		answer:
			'Absolutely! You can monitor failure rates at multiple levels—by branch, job, or even specific steps—so you can quickly pinpoint where issues are happening.',
	},
	{
		question: 'How secure is the data collected by the Citric?',
		answer:
			'We take security very seriously. We follow industry best practices to ensure your data is safe. Additionally, we do not sell any data to third parties, and you can request data deletion at any time.',
	},
	{
		question: 'What kind of metrics does your platform track?',
		answer:
			'In addition to tracking performance and failure rates, we provide DORA metrics, step-level analysis, job-level performance, and detailed cost breakdowns, all designed to give you a holistic view of your CI/CD pipeline health.',
	},
	{
		question: 'Can I try Citric for free?',
		answer:
			'Not yet, but we are planning to offer a free tier in the future. In the meantime, you can sign up for our beta program to get early access and provide feedback to help shape the platform.',
	},
];

export function FAQs() {
	return (
		<section id="faqs" className="container py-24 sm:py-32 md:w-[900px]">
			<div className="mb-8">
				<h2 className="mb-2 text-center text-lg tracking-wider text-primary">
					FAQs
				</h2>
				<h2 className="text-center text-3xl font-bold md:text-4xl">
					Common Questions
				</h2>
			</div>
			<div className="w-full gap-4 lg:flex">
				<div className="mb-8 text-center lg:w-2/5 lg:text-left">
					<h3 className="mb-4 text-2xl">Can't find your answer? </h3>
					<Button variant="secondary" asChild size="lg">
						<a
							// TODO: Add href to contact page
							href="#contact"
						>
							Contact us
						</a>
					</Button>
				</div>
				<Accordion type="single" collapsible className="lg:w-3/5">
					{FAQList.map(({ question, answer }, i) => (
						<AccordionItem key={i} value={`${i}`}>
							<AccordionTrigger className="text-left">
								{question}
							</AccordionTrigger>

							<AccordionContent>{answer}</AccordionContent>
						</AccordionItem>
					))}
				</Accordion>
			</div>
		</section>
	);
}
