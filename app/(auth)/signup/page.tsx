import Link from "next/link";

import { SignupForm } from "@/app/(auth)/signup/signup-form";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SignupPage() {
  return (
    <>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Set up the account Mira will use for your outreach workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SignupForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link className="font-medium text-foreground underline" href="/login">
            Sign in
          </Link>
        </p>
      </CardContent>
    </>
  );
}
