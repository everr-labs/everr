import { getGlobalStartContext } from "@tanstack/react-start";

type CitricRequestContext = {
  organizationId: string;
  userId: string;
  tenantId: number;
};

type CitricGlobalStartContext = {
  organizationId?: string;
  userId?: string;
  tenantId?: number;
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
  startContext.tenantId = context.tenantId;
}

export function getRequestContextFromStartContext(): CitricRequestContext | null {
  const startContext = getStartContextOrNull();
  if (!startContext) {
    return null;
  }

  const organizationId = startContext.organizationId;
  const userId = startContext.userId;
  const tenantId = startContext.tenantId;

  if (!organizationId || !userId || !tenantId) {
    return null;
  }

  return { organizationId, userId, tenantId };
}
