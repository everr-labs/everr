import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LegalPage, legalClientLoader } from "@/components/legal-page";
import { legalPages } from "@/lib/source";

export const Route = createFileRoute("/dpa")({
  loader: async () => {
    const data = await serverLoader();
    await legalClientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "Data Processing Agreement | Everr" },
      { name: "description", content: loaderData?.description },
    ],
  }),
  component: DpaPage,
});

const serverLoader = createServerFn({ method: "GET" }).handler(async () => {
  const page = legalPages.getPage(["dpa"]);
  if (!page) throw notFound();

  return {
    path: page.path,
    title: page.data.title,
    description: page.data.description,
    updated: page.data.updated,
  };
});

function DpaPage() {
  const data = Route.useLoaderData();

  return <LegalPage {...data}>{legalClientLoader.useContent(data.path)}</LegalPage>;
}
