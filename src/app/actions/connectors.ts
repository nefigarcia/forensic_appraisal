
'use server';

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { revalidatePath } from "next/cache";

export async function getExternalConnections() {
  const session = await getSession();
  if (!session) return [];

  return await prisma.externalConnector.findMany({
    where: { 
      organizationId: session.organizationId,
      status: "CONNECTED"
    }
  });
}

export async function saveOAuthToken(provider: string, tokenData: any) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

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
