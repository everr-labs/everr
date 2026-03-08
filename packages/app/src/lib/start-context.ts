import { getGlobalStartContext } from "@tanstack/react-start";

type EverrRequestContext = {
  organizationId: string;
  userId: string;
  tenantId: number;
};

type EverrGlobalStartContext = {
  organizationId?: string;
  userId?: string;
  tenantId?: number;
};

function getStartContextOrNull() {
  try {
    return getGlobalStartContext() as EverrGlobalStartContext | null;
  } catch {
    return null;
  }
}

export function setRequestContextInStartContext(context: EverrRequestContext) {
  const startContext = getStartContextOrNull();
  if (!startContext) {
    return;
  }

  startContext.organizationId = context.organizationId;
  startContext.userId = context.userId;
  startContext.tenantId = context.tenantId;
}

export function getRequestContextFromStartContext(): EverrRequestContext | null {
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
