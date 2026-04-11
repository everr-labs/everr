import { Toaster } from "@everr/ui/components/sonner";
import { Outlet } from "@tanstack/react-router";

export function DesktopWindow() {
  return (
    <>
      <Toaster closeButton position="top-right" richColors visibleToasts={1} />
      <Outlet />
    </>
  );
}
