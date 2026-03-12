
'use server';

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { revalidatePath } from "next/cache";

export async function getCases() {
  const session = await getSession();
  if (!session) return [];

  return await prisma.case.findMany({
    where: { organizationId: session.organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createCase(formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const name = formData.get("name") as string;
  const client = formData.get("client") as string;
  const type = formData.get("type") as string;
  const manager = formData.get("manager") as string;

  const newCase = await prisma.case.create({
    data: {
      name,
      client,
      type,
      manager,
      organizationId: session.organizationId,
      status: "ACTIVE",
    },
  });

  revalidatePath("/projects");
  revalidatePath("/dashboard");
  return newCase;
}

export async function getCaseDetails(id: string) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  return await prisma.case.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { createdAt: 'desc' } },
      financialData: { orderBy: { year: 'desc' } },
      industry: true,
      valuationModels: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
}

export async function saveValuation(caseId: string, data: { ebitda: number; multiplier: number; growthRate: number }) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const model = await prisma.valuationModel.create({
    data: {
      caseId,
      ebitda: data.ebitda,
      multiplier: data.multiplier,
      growthRate: data.growthRate,
      valuationType: "MARKET_APPROACH",
    },
  });

  revalidatePath(`/projects/${caseId}/valuation`);
  return model;
}

export async function searchCases(query: string) {
  const session = await getSession();
  if (!session) return [];

  return await prisma.case.findMany({
    where: {
      organizationId: session.organizationId,
      OR: [
        { name: { contains: query } },
        { client: { contains: query } },
        { type: { contains: query } },
      ],
    },
    include: {
      documents: true,
    },
    take: 10,
  });
}
