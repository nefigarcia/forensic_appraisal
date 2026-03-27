
'use server';

import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/auth-utils";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";

export async function signup(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const name = formData.get("name") as string;
  const orgName = formData.get("orgName") as string;

  const hashedPassword = await bcrypt.hash(password, 10);

  const org = await prisma.organization.create({
    data: { name: orgName },
  });

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
      organizationId: org.id,
      role: "ADMIN",
    },
  });

  const session = await encrypt({ userId: user.id, organizationId: org.id, role: user.role, email: user.email });
  (await cookies()).set("session", session, { httpOnly: true, expires: new Date(Date.now() + 2 * 60 * 60 * 1000) });

  redirect("/dashboard");
}

export async function login(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return { error: "Invalid credentials" };
  }

  const session = await encrypt({ userId: user.id, organizationId: user.organizationId, role: user.role, email: user.email });
  (await cookies()).set("session", session, { httpOnly: true, expires: new Date(Date.now() + 2 * 60 * 60 * 1000) });

  redirect("/dashboard");
}

export async function logout() {
  (await cookies()).set("session", "", { expires: new Date(0) });
  redirect("/login");
}
