
'use server';

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { requireOrganization, requireConnectorAccess } from "@/lib/authz";
import {
  encryptConnectorSecrets,
  decryptConnectorSecret,
  CONNECTOR_METADATA_SELECT,
} from "@/lib/crypto/connector-secrets";

/**
 * List connectors visible to the caller's org. Returns metadata ONLY —
 * `accessToken`, `refreshToken`, `encryptedSecrets`, and
 * `encryptionKeyVersion` are never included in the projection, so no
 * plaintext or ciphertext ever crosses into a client component.
 */
export async function getExternalConnections() {
  let session;
  try { session = await requireOrganization(); } catch { return []; }

  return await prisma.externalConnector.findMany({
    where: {
      organizationId: session.organizationId,
      status: "CONNECTED",
    },
    select: CONNECTOR_METADATA_SELECT,
  });
}

/**
 * Persist an OAuth token payload. The plaintext strings coming from the
 * provider are encrypted with the envelope helper before write, and the
 * legacy plaintext columns are set to NULL on the same row so a stale
 * plaintext copy cannot survive the upsert.
 */
export async function saveOAuthToken(provider: string, tokenData: {
  access_token?:  string
  refresh_token?: string
  expires_in?:    number
}) {
  const session = await requireOrganization();

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : null;

  const enc = await encryptConnectorSecrets({
    accessToken:  tokenData.access_token,
    refreshToken: tokenData.refresh_token,
  });

  await prisma.externalConnector.upsert({
    where: {
      organizationId_provider: {
        organizationId: session.organizationId,
        provider,
      },
    },
    update: {
      accessToken:          enc.accessToken,          // always null (envelope stored below)
      refreshToken:         enc.refreshToken,         // always null
      encryptedSecrets:     enc.encryptedSecrets as any,
      encryptionKeyVersion: enc.encryptionKeyVersion,
      expiresAt,
      status: "CONNECTED",
      lastSync: new Date(),
    },
    create: {
      organizationId: session.organizationId,
      provider,
      accessToken:          enc.accessToken,
      refreshToken:         enc.refreshToken,
      encryptedSecrets:     enc.encryptedSecrets as any,
      encryptionKeyVersion: enc.encryptionKeyVersion,
      expiresAt,
      status: "CONNECTED",
    },
  });

  revalidatePath('/connections');
}

/**
 * Server-side accessor. Returns the connector row with the token fields
 * only — used by other server actions (e.g. document mirroring) that
 * need a valid access token. Never expose this shape to a client
 * component. Callers that only need metadata should use
 * `getExternalConnections()`.
 */
export async function getConnector(connectorId: string) {
  const { connector } = await requireConnectorAccess(connectorId);
  return connector;
}

/**
 * Server-side helper: return the plaintext access token for a connector
 * scoped to the caller's org. Used at the moment of the outbound HTTP
 * call — never at page render, never in a client component. Callers must
 * not persist the returned value.
 */
export async function getDecryptedAccessTokenForProvider(
  provider: string,
): Promise<string | null> {
  let session;
  try { session = await requireOrganization(); } catch { return null; }

  const row = await prisma.externalConnector.findUnique({
    where: {
      organizationId_provider: {
        organizationId: session.organizationId,
        provider,
      },
    },
  });
  if (!row) return null;
  return decryptConnectorSecret(row, 'accessToken');
}
