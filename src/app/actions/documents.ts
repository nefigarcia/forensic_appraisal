
'use server';

import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-utils";
import { revalidatePath } from "next/cache";

export async function addDocument(caseId: string, formData: FormData) {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");

  const name = formData.get("name") as string;
  const type = formData.get("type") as string;
  const size = "1.2 MB"; // Mock size

  const doc = await prisma.document.create({
    data: {
      caseId,
      name,
      type,
      size,
      status: "VERIFIED",
    },
  });

  revalidatePath(`/projects/${caseId}`);
  return doc;
}
