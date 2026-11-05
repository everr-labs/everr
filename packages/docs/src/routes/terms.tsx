import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LegalPage, legalClientLoader } from "@/components/legal-page";
import { legalPages } from "@/lib/source";

export const Route = createFileRoute("/terms")({
  loader: async () => {
    const data = await serverLoader();
    await legalClientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "Terms of Service | Everr" },
      { name: "description", content: loaderData?.description },
      ...(loaderData?.draft ? [{ name: "robots", content: "noindex, nofollow" }] : []),
    ],
  }),
  component: TermsPage,
});

const serverLoader = createServerFn({ method: "GET" }).handler(async () => {
  const page = legalPages.getPage(["terms"]);
  if (!page) throw notFound();

  return {
    path: page.path,
    title: page.data.title,
    description: page.data.description,
    updated: page.data.updated,
    draft: page.data.draft,
  };
});

function TermsPage() {
  const data = Route.useLoaderData();

  return <LegalPage {...data}>{legalClientLoader.useContent(data.path)}</LegalPage>;
}
