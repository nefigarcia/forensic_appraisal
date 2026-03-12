
'use client';

import { signup } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function SignupPage() {
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
            <CardTitle className="text-2xl font-bold font-headline tracking-tight">Create Workspace</CardTitle>
            <CardDescription>Initialize your firm's forensic environment</CardDescription>
          </div>
        </CardHeader>
        <form action={signup}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="orgName">Firm / Organization Name</Label>
              <Input id="orgName" name="orgName" placeholder="Preston & Reed LLP" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" name="name" placeholder="Sarah Jenkins" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Work Email</Label>
              <Input id="email" name="email" type="email" placeholder="sarah@firm.com" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Security Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button className="w-full bg-primary font-bold uppercase text-xs tracking-widest h-12" type="submit">
              Initialize Environment
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Already a member? <Link href="/login" className="text-primary font-bold hover:underline">Sign In</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
