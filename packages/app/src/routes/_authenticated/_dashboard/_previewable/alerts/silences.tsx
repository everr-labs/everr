import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import * as A from "@/components/alerts/prototype-silences/variant-a";
import * as B from "@/components/alerts/prototype-silences/variant-b";
import * as C from "@/components/alerts/prototype-silences/variant-c";
import { PrototypeSwitcher } from "@/components/prototype-switcher";

// PROTOTYPE: three variants of the silences page on fixture data, switchable
// via `?variant=A|B|C`. Fold the winner in and drop the rest.
const VARIANTS = [
  { key: "A", name: A.nameA, Component: A.VariantA },
  { key: "B", name: B.nameB, Component: B.VariantB },
  { key: "C", name: C.nameC, Component: C.VariantC },
];

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/silences",
)({
  // Silences are live operational state, not an as-code resource a preview
  // branch overlays, so the preview banner would be misleading here.
  staticData: { breadcrumb: "Silences", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert silences" }] }),
  validateSearch: z.object({
    variant: z.enum(["A", "B", "C"]).optional().catch(undefined),
  }),
  component: AlertingSilencesPage,
});

function AlertingSilencesPage() {
  const { variant = "A" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const current = VARIANTS.find((v) => v.key === variant) ?? VARIANTS[0];
  return (
    <>
      <current.Component />
      <PrototypeSwitcher
        variants={VARIANTS}
        current={current.key}
        onChange={(key) =>
          navigate({
            search: (prev) => ({ ...prev, variant: key as "A" | "B" | "C" }),
            replace: true,
          })
        }
      />
    </>
  );
}
