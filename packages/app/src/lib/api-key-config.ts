/** Native key configurations are the authority for key type and storage. */
export const API_KEY_CONFIG = {
  public: { configId: "public", prefix: "pk_" },
  secret: { configId: "secret", prefix: "sk_" },
} as const;

export type ApiKeyKind = keyof typeof API_KEY_CONFIG;
