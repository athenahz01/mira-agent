import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export default function AuthLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-6 py-10">
      <Card className="w-full max-w-md">{children}</Card>
    </main>
  );
}
