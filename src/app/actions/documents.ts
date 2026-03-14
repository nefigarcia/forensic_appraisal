'use server';

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { revalidatePath } from "next/cache";
import { s3Client, BUCKET_NAME } from "@/lib/s3-client";
import { PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * addDocument - Handles the ingestion of forensic evidence.
 * 
 * 1. Primary: Uploads to the secure S3 Forensic Vault (internal custody).
 * 2. Secondary (Optional): Mirrors the file to an external firm-level provider 
 *    (SharePoint/OneDrive) if selected by the appraiser.
 */
export async function addDocument(caseId: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const file = formData.get("file") as File;
  const displayName = formData.get("name") as string;
  const type = formData.get("type") as string;
  const storageProvider = formData.get("storageProvider") as string || "s3";

  if (!file) throw new Error("No file provided");

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Create a secure, unique key for the forensic binder
  const fileKey = `cases/${caseId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;

  try {
    // 1. Primary Upload to S3 Forensic Vault (Internal Record)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileKey,
        Body: buffer,
        ContentType: file.type,
        Metadata: {
          caseId: caseId,
          organizationId: session.organizationId,
          originalName: file.name
        }
      })
    );

    // 2. Mirror to External Provider (Firm Archive) if selected
    if (storageProvider !== "s3") {
      const connector = await prisma.externalConnector.findUnique({
        where: {
          organizationId_provider: {
            organizationId: session.organizationId,
            provider: storageProvider
          }
        }
      });

      if (connector && connector.accessToken && storageProvider === 'microsoft') {
        try {
          // Mirroring to Microsoft Graph (SharePoint/OneDrive)
          const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/ValuVault_Archive/${caseId}/${file.name}:/content`;
          const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${connector.accessToken}`,
              'Content-Type': file.type
            },
            body: buffer
          });

          if (!response.ok) {
            console.error("Mirroring response failed:", await response.text());
          }
        } catch (mirrorError) {
          // We log mirroring errors but don't fail the primary upload
          console.error("External mirroring failed, continuing with S3 only:", mirrorError);
        }
      }
    }

    // 3. Persist metadata to MySQL for the Custody Binder UI
    const fileSize = (file.size / (1024 * 1024)).toFixed(2) + " MB";
    
    const doc = await prisma.document.create({
      data: {
        caseId,
        name: displayName || file.name,
        type: type || file.type,
        size: fileSize,
        s3Key: fileKey, 
        status: "VERIFIED", // Status on upload
      },
    });

    revalidatePath(`/projects/${caseId}`);
    return { success: true, docId: doc.id };
  } catch (error) {
    console.error("Upload Error:", error);
    throw new Error("Failed to upload document to secure custody binder.");
  }
}
