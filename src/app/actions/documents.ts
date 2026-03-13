'use server';

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { revalidatePath } from "next/cache";
import { s3Client, BUCKET_NAME } from "@/lib/s3-client";
import { PutObjectCommand } from "@aws-sdk/client-s3";

export async function addDocument(caseId: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const file = formData.get("file") as File;
  const displayName = formData.get("name") as string;
  const type = formData.get("type") as string;

  if (!file) throw new Error("No file provided");

  // Convert File to Buffer for S3
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  
  // Generate a unique S3 key
  const fileKey = `cases/${caseId}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;

  try {
    // 1. Upload to S3
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

    // 2. Persist metadata to MySQL via Prisma
    const fileSize = (file.size / (1024 * 1024)).toFixed(2) + " MB";
    
    const doc = await prisma.document.create({
      data: {
        caseId,
        name: displayName || file.name,
        type: type || file.type,
        size: fileSize,
        s3Key: fileKey, 
        status: "EXTRACTED",
      },
    });

    revalidatePath(`/projects/${caseId}`);
    return { success: true, docId: doc.id };
  } catch (error) {
    console.error("S3 Upload Error:", error);
    throw new Error("Failed to upload document to secure custody binder.");
  }
}
