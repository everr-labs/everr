import type { InferInput } from 'valibot';
import { valibotResolver } from '@hookform/resolvers/valibot';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/start';
import { useForm } from 'react-hook-form';
import { object, string } from 'valibot';

import {
	Combobox,
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from '@citric/ui';

interface Datasource {
	id: number;
	uid: string;
	name: string;
	type: string;
	typeLogoUrl: 'public/app/plugins/datasource/elasticsearch/img/elasticsearch.svg';
}

const getDatasources = createServerFn({ method: 'POST' }).handler(async () => {
	const res = await fetch(
		`${process.env.GRAFANA_API_BASE_URL}/api/datasources`,
		{
			headers: {
				Authorization: `Bearer ${process.env.GRAFANA_TOKEN}`,
			},
		},
	);

	const data = (await res.json()) as Datasource[];

	return data.map((ds) => ({
		label: ds.name,
		value: ds.uid,
		type: ds.type,
		imageUrl: ds.typeLogoUrl.startsWith('http')
			? ds.typeLogoUrl
			: `${process.env.GRAFANA_API_BASE_URL}/${ds.typeLogoUrl}`,
	}));
});

export const Route = createFileRoute('/_authenticated/settings/')({
	component: Settings,
});

const FormSchema = object({
	logs: string(),
	metrics: string(),
	traces: string(),
});

function Settings() {
	const { data: datasources } = useQuery({
		queryKey: ['datasources'],
		queryFn: () => getDatasources(),
	});

	const form = useForm<InferInput<typeof FormSchema>>({
		resolver: valibotResolver(FormSchema),
	});

	const onSubmit = () => {
		console.log('submit');
	};

	return (
		<div>
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
					<FormField
						control={form.control}
						name="metrics"
						render={({ field }) => (
							<FormItem className="flex flex-col">
								<FormLabel>Metrics data source</FormLabel>

								<FormControl>
									<Combobox
										value={field.value}
										onChange={(value) => {
											form.setValue('metrics', value);
										}}
										options={datasources?.filter(
											(ds) => ds.type === 'prometheus',
										)}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name="logs"
						render={({ field }) => (
							<FormItem className="flex flex-col">
								<FormLabel>Logs data source</FormLabel>

								<FormControl>
									<Combobox
										value={field.value}
										onChange={(value) => {
											form.setValue('logs', value);
										}}
										options={datasources?.filter((ds) => ds.type === 'loki')}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name="traces"
						render={({ field }) => (
							<FormItem className="flex flex-col">
								<FormLabel>Traces data source</FormLabel>

								<FormControl>
									<Combobox
										value={field.value}
										onChange={(value) => {
											form.setValue('traces', value);
										}}
										options={datasources?.filter((ds) => ds.type === 'tempo')}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</form>
			</Form>
		</div>
	);
}
