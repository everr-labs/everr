import { AsyncLocalStorage } from "node:async_hooks";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, getOAuthState } from "better-auth/api";
import { termsHash } from "./terms";

const acceptance = new AsyncLocalStorage<{ termsHash?: string }>();

export function withSignupTerms<T>(run: () => Promise<T>): Promise<T> {
  return acceptance.getStore() ? run() : acceptance.run({}, run);
}

export function acceptedSignupTerms(): string | undefined {
  return acceptance.getStore()?.termsHash;
}

export function signupTermsPlugin(expectedHash: string = termsHash): BetterAuthPlugin {
  return {
    id: "cloud-signup-terms",
    init() {
      return {
        options: {
          databaseHooks: {
            user: {
              create: {
                async before(_user, context) {
                  const hash =
                    context?.path === "/sign-up/email"
                      ? context.body?.termsHash
                      : (await getOAuthState())?.termsHash;
                  if (!expectedHash || hash !== expectedHash) {
                    throw new APIError("BAD_REQUEST", {
                      code: "TERMS_ACCEPTANCE_REQUIRED",
                      message: "Please return to Sign up and accept the current Terms of Service.",
                    });
                  }
                  const scope = acceptance.getStore();
                  if (!scope) throw new Error("Signup requires an identity request scope");
                  scope.termsHash = expectedHash;
                },
              },
            },
          },
        },
      };
    },
  };
}
