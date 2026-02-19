import { createFileRoute, Link } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/")({
  loader: async () => {
    const { user } = await getAuth();
    const signInUrl = user ? null : await getSignInUrl();
    return { user, signInUrl };
  },
  component: HomePage,
});

function HomePage() {
  const { user, signInUrl } = Route.useLoaderData();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Welcome to Citric</h1>

      {user ? (
        <div className="flex flex-col items-center gap-4">
          <p className="text-lg text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{user.email}</span>
          </p>
          <div className="flex gap-4">
            <Link
              to="/dashboard"
              className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to Dashboard
            </Link>
            <Link
              to="/signout"
              className="rounded-md border border-input bg-background px-4 py-2 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Sign Out
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <p className="text-lg text-muted-foreground">
            Sign in to access your dashboard
          </p>
          <a
            href={signInUrl ?? "#"}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Sign In
          </a>
        </div>
      )}
    </div>
  );
}
