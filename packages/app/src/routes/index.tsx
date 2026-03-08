import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/")({
  loader: async () => {
    const { user } = await getAuth();
    if (user) {
      throw redirect({ to: "/dashboard" });
    }
    const signInUrl = await getSignInUrl();
    return { signInUrl };
  },
  component: HomePage,
});

function HomePage() {
  const { signInUrl } = Route.useLoaderData();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Welcome to Everr</h1>
      <div className="flex flex-col items-center gap-4">
        <p className="text-lg text-muted-foreground">
          Sign in to access your dashboard
        </p>
        <a
          href={signInUrl}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Sign In
        </a>
      </div>
    </div>
  );
}
