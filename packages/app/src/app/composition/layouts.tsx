import { UserMenu } from "#app/components/nav-user.tsx";
import { WelcomeLayout } from "#app/components/welcome/welcome-layout.tsx";
import type { ApplicationLayouts } from "#app/composition/layouts.ts";

export const layouts: ApplicationLayouts = {
  UserMenu,
  Welcome: WelcomeLayout,
};
