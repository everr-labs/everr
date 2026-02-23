import { getGlobalStartContext } from "@tanstack/react-start";

type CitricRequestContext = {
  organizationId?: string;
  userId?: string;
};

type CitricGlobalStartContext = {
  organizationId?: string;
  userId?: string;
  contextAfterGlobalMiddlewares?: CitricRequestContext;
};

function getStartContextOrNull() {
  try {
    return getGlobalStartContext() as CitricGlobalStartContext | null;
  } catch {
    return null;
  }
}

export function setRequestContextInStartContext(context: CitricRequestContext) {
  const startContext = getStartContextOrNull();
  if (!startContext) {
    return;
  }

  startContext.organizationId = context.organizationId;
  startContext.userId = context.userId;
  startContext.contextAfterGlobalMiddlewares = {
    ...(startContext.contextAfterGlobalMiddlewares ?? {}),
    ...context,
  };
}

export function getRequestContextFromStartContext(): CitricRequestContext | null {
  const startContext = getStartContextOrNull();
  if (!startContext) {
    return null;
  }

  const organizationId =
    startContext.organizationId ??
    startContext.contextAfterGlobalMiddlewares?.organizationId;
  const userId =
    startContext.userId ?? startContext.contextAfterGlobalMiddlewares?.userId;

  if (!organizationId && !userId) {
    return null;
  }

  return { organizationId, userId };
}
