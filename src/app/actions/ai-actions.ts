
'use server';

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { extractFinancialData } from "@/ai/flows/ai-financial-statement-extraction-flow";
import { aiIndustryCodeSuggestion } from "@/ai/flows/ai-industry-code-suggestion-flow";
import { revalidatePath } from "next/cache";
import { s3Client, BUCKET_NAME } from "@/lib/s3-client";
import { GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * Helper to convert S3 readable stream to a Buffer
 */
async function streamToBuffer(stream: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on("data", (chunk: any) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function runFinancialExtraction(caseId: string, documentId?: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  // 1. Identify which document to process
  // Default to the most recent document if no ID is provided
  const doc = await prisma.document.findFirst({
    where: documentId ? { id: documentId } : { caseId },
    orderBy: { createdAt: 'desc' }
  });

  if (!doc || !doc.s3Key) {
    throw new Error("No document found in the custody binder to process.");
  }

  // 2. Fetch the actual file content from S3
  let documentDataUri: string;
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: doc.s3Key,
    });
    const response = await s3Client.send(command);
    const buffer = await streamToBuffer(response.Body);
    const base64 = buffer.toString('base64');
    
    // Determine mime type - Fallback to common types if metadata is missing
    const mimeType = doc.type?.toLowerCase().includes('image') ? 'image/jpeg' : 'application/pdf';
    documentDataUri = `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error("S3 Retrieval Error:", error);
    throw new Error("Failed to retrieve document from secure storage.");
  }

  // 3. Run AI Extraction with real data
  const result = await extractFinancialData({
    documentDataUri,
    documentName: doc.name,
    documentTypeHint: doc.type || "Forensic Financial Summary",
  });

  // 4. Persist extraction results to the MySQL Ledger
  if (result.extractedData && result.extractedData.length > 0) {
    await prisma.financialValue.createMany({
      data: result.extractedData.map((item) => ({
        caseId,
        year: item.year || "Unknown",
        statementType: item.statementType || "N/A",
        lineItem: item.lineItem,
        value: item.value || 0,
        currency: item.currency || "USD",
      })),
    });
  }

  revalidatePath(`/projects/${caseId}`);
  return result;
}

export async function runIndustryAnalysis(caseId: string, description: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const result = await aiIndustryCodeSuggestion({
    businessDescription: description,
  });

  const naics = result.industryCodes.find(c => c.type === 'NAICS')?.code;
  const sic = result.industryCodes.find(c => c.type === 'SIC')?.code;

  await prisma.industryClassification.upsert({
    where: { caseId },
    update: {
      suggestedIndustry: result.suggestedIndustry,
      naicsCode: naics,
      sicCode: sic,
    },
    create: {
      caseId,
      suggestedIndustry: result.suggestedIndustry,
      naicsCode: naics,
      sicCode: sic,
    },
  });

  revalidatePath(`/projects/${caseId}`);
  return result;
}
