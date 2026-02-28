ALTER TABLE "mcp_tokens" RENAME TO "access_tokens";
ALTER TABLE "access_tokens" RENAME CONSTRAINT "mcp_tokens_pkey" TO "access_tokens_pkey";
ALTER SEQUENCE "mcp_tokens_id_seq" RENAME TO "access_tokens_id_seq";
ALTER INDEX "mcp_tokens_token_hash_uq" RENAME TO "access_tokens_token_hash_uq";
ALTER INDEX "mcp_tokens_org_user_revoked_created_idx" RENAME TO "access_tokens_org_user_revoked_created_idx";
ALTER INDEX "mcp_tokens_token_prefix_idx" RENAME TO "access_tokens_token_prefix_idx";
