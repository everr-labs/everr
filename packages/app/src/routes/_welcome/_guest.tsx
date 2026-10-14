import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAuthProviders } from "@/data/auth-providers";

export const Route = createFileRoute("/_welcome/_guest")({
  beforeLoad: async ({ context: { session } }) => {
    if (session?.user) {
      throw redirect({ to: "/" });
    }
    return getAuthProviders();
  },
  component: GuestLayout,
});

function GuestLayout() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        <Outlet />
      </div>
    </main>
  );
}
