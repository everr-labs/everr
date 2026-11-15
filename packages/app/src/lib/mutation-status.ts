/** How a mutation's last run ended, for a loading Button's `status`. */
export function mutationStatus(mutation: { isSuccess: boolean; isError: boolean }) {
  if (mutation.isError) return "error";
  if (mutation.isSuccess) return "success";
  return undefined;
}

/** Only failures: for buttons whose success swaps the view or closes it. */
export function mutationErrorStatus(mutation: { isError: boolean }) {
  return mutation.isError ? "error" : undefined;
}
