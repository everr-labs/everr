export type AlertingPreviewScope = {
  id: string;
  repoid: string;
};

export function visibleResourcesForPreview<
  T extends { previewId: string | null; repoid: string },
>(
  resources: readonly T[],
  scopes: readonly AlertingPreviewScope[] | null,
): T[] {
  if (scopes === null) {
    return resources.filter((resource) => resource.previewId === null);
  }

  const scopeRepoidByPreviewId = new Map(
    scopes.map((scope) => [scope.id, scope.repoid]),
  );
  const coveredRepoids = new Set(scopes.map((scope) => scope.repoid));

  const previewRows = resources.filter(
    (resource) =>
      resource.previewId !== null &&
      scopeRepoidByPreviewId.get(resource.previewId) === resource.repoid,
  );
  const liveRows = resources.filter(
    (resource) =>
      resource.previewId === null && !coveredRepoids.has(resource.repoid),
  );

  return [...previewRows, ...liveRows];
}
