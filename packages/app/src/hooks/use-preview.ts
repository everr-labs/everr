import { useNavigate, useSearch } from "@tanstack/react-router";

// The active preview from the `?preview=` param, and a way out. "" / whitespace
// means live, so `name` is empty in that case. Both the header indicator and the
// previewable layout read the param through here so the "whitespace is live"
// rule and the exit navigation stay single-sourced.
export function usePreview(): { name: string; exit: () => void } {
  const navigate = useNavigate();
  const { preview } = useSearch({ from: "/_authenticated/_dashboard" });
  const name = (preview ?? "").trim();
  const exit = () =>
    navigate({ to: ".", search: (prev) => ({ ...prev, preview: undefined }) });
  return { name, exit };
}
