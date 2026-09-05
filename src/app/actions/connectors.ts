
'use server';

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireOrganization, requireConnectorAccess } from "@/lib/authz";

export async function getExternalConnections() {
  let session;
  try { session = await requireOrganization(); } catch { return []; }

  return await prisma.externalConnector.findMany({
    where: {
      organizationId: session.organizationId,
      status: "CONNECTED"
    }
  });
}

export async function saveOAuthToken(provider: string, tokenData: any) {
  const session = await requireOrganization();

  // Calculate expiry if provided
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  await prisma.externalConnector.upsert({
    where: {
      organizationId_provider: {
        organizationId: session.organizationId,
        provider: provider
      }
    },
    update: {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: expiresAt,
      status: "CONNECTED",
      lastSync: new Date()
    },
    create: {
      organizationId: session.organizationId,
      provider: provider,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: expiresAt,
      status: "CONNECTED"
    }
  });

  revalidatePath('/connections');
}

/**
 * Explicit tenant-scoped fetch for a single connector by id. Not currently
 * used from the UI, but exposed so future connector-scoped operations
 * (delete, refresh, revoke) don't have to reimplement the check.
 */
export async function getConnector(connectorId: string) {
  const { connector } = await requireConnectorAccess(connectorId);
  return connector;
}
