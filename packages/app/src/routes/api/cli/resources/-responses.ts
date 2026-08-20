import {
  RESOURCE_KINDS,
  ReservedProjectError,
} from "@/data/as-code/resource-admin.server";

/** 400 response for a `kind` path/query segment that is not a ResourceKind. */
export function unknownKindResponse(kind: string): Response {
  return Response.json(
    {
      error: `unknown kind "${kind}"; expected one of ${RESOURCE_KINDS.join(", ")}`,
    },
    { status: 400 },
  );
}

/**
 * 403 for the admin layer's ReservedProjectError, or null for any other
 * error (which the caller should rethrow).
 */
export function reservedProjectResponse(error: unknown): Response | null {
  if (!(error instanceof ReservedProjectError)) return null;
  return Response.json({ error: error.message }, { status: 403 });
}

/** 404 response for a resource that does not exist. */
export function notFoundResponse(
  kind: string,
  project: string,
  slug: string,
): Response {
  return Response.json(
    { error: `resource not found: ${kind}/${project}/${slug}` },
    { status: 404 },
  );
}
