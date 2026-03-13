import { createFileRoute } from "@tanstack/react-router";
import { Resend } from "resend";
import { env } from "@/env";

export const Route = createFileRoute("/api/waitlist")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json();
        const email = body?.email;

        if (!email || typeof email !== "string") {
          return Response.json({ error: "Email is required" }, { status: 400 });
        }

        try {
          const resend = new Resend(env.RESEND_API_KEY);
          const environment = env.NODE_ENV === "production" ? "prod" : "dev";
          await resend.contacts.create({
            email,
            unsubscribed: false,
            properties: { env: environment, source: "waitlist" },
          });
          return Response.json({ ok: true });
        } catch (err) {
          console.error("Failed to add contact to Resend:", err);
          return Response.json(
            { error: "Failed to join waitlist" },
            { status: 500 },
          );
        }
      },
    },
  },
});
