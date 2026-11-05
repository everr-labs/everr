import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { LegalPage, legalClientLoader } from "@/components/legal-page";
import { legalPages } from "@/lib/source";

export const Route = createFileRoute("/terms")({
  validateSearch: z.object({ hash: z.string().optional() }),
  loaderDeps: ({ search }) => ({ hash: search.hash }),
  loader: async ({ deps }) => {
    const data = await serverLoader({ data: deps });
    await legalClientLoader.preload(data.path);
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "Terms of Service | Everr" },
      { name: "description", content: loaderData?.description },
      { name: "everr:terms-sha256", content: import.meta.env.VITE_TERMS_HASH },
      ...(loaderData?.draft ? [{ name: "robots", content: "noindex, nofollow" }] : []),
    ],
  }),
  component: TermsPage,
});

const serverLoader = createServerFn({ method: "GET" })
  .validator(z.object({ hash: z.string().optional() }))
  .handler(async ({ data }) => {
    if (data.hash && data.hash !== import.meta.env.VITE_TERMS_HASH) throw notFound();
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
