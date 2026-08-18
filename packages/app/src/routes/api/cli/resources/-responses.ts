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
 * Runs a resource write and translates the admin layer's ReservedProjectError
 * into a 403, so every write verb inherits the reserved-project guard without
 * its own try/catch. Any other error propagates.
 */
export async function guardReservedProject<T>(
  fn: () => Promise<T>,
): Promise<T | Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ReservedProjectError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
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
