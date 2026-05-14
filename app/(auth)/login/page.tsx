import Link from "next/link";

import { LoginForm } from "@/app/(auth)/login/login-form";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  return (
    <>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          Use your Mira account to continue to the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
        <p className="mt-6 text-center text-sm text-muted-foreground">
          New to Mira?{" "}
          <Link
            className="font-medium text-foreground underline"
            href="/signup"
          >
            Create an account
          </Link>
        </p>
      </CardContent>
    </>
  );
}
