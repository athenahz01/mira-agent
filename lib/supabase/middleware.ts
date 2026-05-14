import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/lib/db/types";
import { getSupabasePublicEnv, hasSupabasePublicEnv } from "@/lib/supabase/env";

type CookieToSet = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isAuthRoute = pathname === "/login" || pathname === "/signup";
  const isApiRoute = pathname.startsWith("/api/");
  const isOnboardingRoute = pathname === "/onboarding";

  if (!hasSupabasePublicEnv()) {
    if (!isAuthRoute && !isApiRoute) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    return NextResponse.next({
      request,
    });
  }

  let response = NextResponse.next({
    request,
  });
  const env = getSupabasePublicEnv();

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const onboardingCompletedAt = user
    ? await getOnboardingCompletedAt(
        supabase as unknown as SupabaseClient<Database>,
        user.id,
      )
    : null;
  const hasCompletedOnboarding = Boolean(onboardingCompletedAt);

  if (user && isAuthRoute) {
    return redirectWithCookies(
      request,
      response,
      hasCompletedOnboarding ? "/dashboard" : "/onboarding",
    );
  }

  if (!user && !isAuthRoute && !isApiRoute) {
    return redirectWithCookies(request, response, "/login");
  }

  if (
    user &&
    !hasCompletedOnboarding &&
    !isAuthRoute &&
    !isApiRoute &&
    !isOnboardingRoute
  ) {
    return redirectWithCookies(request, response, "/onboarding");
  }

  return response;
}

async function getOnboardingCompletedAt(
  supabase: SupabaseClient<Database>,
  userId: string,
) {
  const { data } = await supabase
    .from("users")
    .select("onboarding_completed_at")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.onboarding_completed_at ?? null;
}

function redirectWithCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = pathname;
  redirectUrl.search = "";

  const redirectResponse = NextResponse.redirect(redirectUrl);
  response.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie.name, cookie.value, cookie);
  });

  return redirectResponse;
}
