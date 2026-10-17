import { dirname, relative, resolve } from "node:path";
import { Generator, getConfig } from "@tanstack/router-generator";
import {
  appDirectory,
  appRoutes,
  prepareComposition,
  type AppComposition,
} from "../vite.app.ts";

/** Typechecks and tests must work before the first Vite build. */
export async function generateComposition(composition: AppComposition) {
  prepareComposition(composition);
  const fromTree = (file: string) => {
    const path = relative(
      dirname(composition.routeTree),
      resolve(appDirectory, "src", file),
    );
    return path.startsWith(".") ? path : `./${path}`;
  };
  const config = getConfig(
    {
      ...appRoutes(composition),
      routeTreeFileFooter: [
        `import type { getRouter } from '${fromTree("router.tsx")}'`,
        `import type { startInstance } from '${fromTree("start.ts")}'`,
        `declare module '@tanstack/react-start' {
  interface Register {
    ssr: true
    router: Awaited<ReturnType<typeof getRouter>>
    config: Awaited<ReturnType<typeof startInstance.getOptions>>
  }
}`,
      ],
    },
    appDirectory,
  );
  await new Generator({ config, root: appDirectory }).run();
}
