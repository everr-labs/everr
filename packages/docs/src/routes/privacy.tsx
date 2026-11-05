import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LegalPage, legalClientLoader } from "@/components/legal-page";
import { legalPages } from "@/lib/source";

export const Route = createFileRoute("/privacy")({
  loader: async () => {
    const data = await serverLoader();
    await legalClientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "Privacy notice | Everr" },
      { name: "description", content: loaderData?.description },
      ...(loaderData?.draft ? [{ name: "robots", content: "noindex, nofollow" }] : []),
    ],
  }),
  component: PrivacyPage,
});

const serverLoader = createServerFn({ method: "GET" }).handler(async () => {
  const page = legalPages.getPage(["privacy"]);
  if (!page) throw notFound();

  return {
    path: page.path,
    title: page.data.title,
    description: page.data.description,
    updated: page.data.updated,
    draft: page.data.draft,
  };
});

function PrivacyPage() {
  const data = Route.useLoaderData();

  return <LegalPage {...data}>{legalClientLoader.useContent(data.path)}</LegalPage>;
}
