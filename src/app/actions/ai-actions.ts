
'use server';

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { extractFinancialData } from "@/ai/flows/ai-financial-statement-extraction-flow";
import { aiIndustryCodeSuggestion } from "@/ai/flows/ai-industry-code-suggestion-flow";
import { revalidatePath } from "next/cache";

export async function runFinancialExtraction(caseId: string, documentDataUri: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const result = await extractFinancialData({
    documentDataUri,
    documentName: "Processed_Evidence.pdf",
    documentTypeHint: "Forensic Financial Summary",
  });

  // Save to DB
  await prisma.financialValue.createMany({
    data: result.extractedData.map((item) => ({
      caseId,
      year: item.year || "Unknown",
      statementType: item.statementType || "N/A",
      lineItem: item.lineItem,
      value: item.value,
      currency: item.currency || "USD",
    })),
  });

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
