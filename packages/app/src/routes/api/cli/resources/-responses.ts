import { RESOURCE_KINDS } from "@/data/as-code/resource-admin.server";

/** 400 response for a `kind` path/query segment that is not a ResourceKind. */
export function unknownKindResponse(kind: string): Response {
  return Response.json(
    {
      error: `unknown kind "${kind}"; expected one of ${RESOURCE_KINDS.join(", ")}`,
    },
    { status: 400 },
  );
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
