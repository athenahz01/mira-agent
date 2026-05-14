"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { loginSchema, signupSchema } from "@/lib/auth/schemas";
import { defaultSenderDisplayName } from "@/lib/onboarding/defaults";
import { createClient } from "@/lib/supabase/server";

export type AuthActionResult =
  | {
      status: "error";
      message: string;
    }
  | {
      status: "check_email";
      message: string;
    };

function formatValidationError(error: z.ZodError) {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

export async function signInWithPassword(
  input: unknown,
): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "error",
      message: formatValidationError(parsed.error),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      status: "error",
      message: error.message,
    };
  }

  redirect("/dashboard");
}

export async function signUpWithPassword(
  input: unknown,
): Promise<AuthActionResult> {
  const parsed = signupSchema.safeParse(input);

  if (!parsed.success) {
    return {
      status: "error",
      message: formatValidationError(parsed.error),
    };
  }

  const supabase = await createClient();
  const { name, email, password } = parsed.data;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name,
      },
    },
  });

  if (error) {
    return {
      status: "error",
      message: error.message,
    };
  }

  if (!data.session || !data.user) {
    return {
      status: "check_email",
      message: "Check your email to confirm your account, then sign in.",
    };
  }

  const { error: profileError } = await supabase.from("users").insert({
    user_id: data.user.id,
    email: data.user.email ?? email,
    name,
    timezone: "America/New_York",
    sender_display_name: defaultSenderDisplayName,
  });

  if (profileError) {
    return {
      status: "error",
      message: profileError.message,
    };
  }

  redirect("/onboarding");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect("/login");
}
