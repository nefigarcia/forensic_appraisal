
'use client';

import { login } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(formData: FormData) {
    const result = await login(formData);
    if (result?.error) {
      setError(result.error);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md border-none shadow-2xl">
        <CardHeader className="space-y-4 text-center">
          <div className="flex justify-center">
            <div className="bg-primary p-2 rounded-xl">
              <ShieldCheck className="h-8 w-8 text-white" />
            </div>
          </div>
          <div>
            <CardTitle className="text-2xl font-bold font-headline tracking-tight">Welcome Back</CardTitle>
            <CardDescription>Enter your forensic credentials to access ValuVault AI</CardDescription>
          </div>
        </CardHeader>
        <form action={handleSubmit}>
          <CardContent className="space-y-4">
            {error && <p className="text-destructive text-xs font-bold text-center">{error}</p>}
            <div className="space-y-2">
              <Label htmlFor="email">Work Email</Label>
              <Input id="email" name="email" type="email" placeholder="sarah@firm.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button className="w-full bg-primary font-bold uppercase text-xs tracking-widest h-12" type="submit">
              Sign In to Workbench
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Don't have an account? <Link href="/signup" className="text-primary font-bold hover:underline">Register Firm</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
