export type OrganizationCreationResult =
  | { kind: "created"; organization: { id: string; name: string } }
  | { kind: "checkout"; url: string };
