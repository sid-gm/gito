import { NextRequest, NextResponse } from "next/server";
import { ANALYST_SESSION_COOKIE, verifySessionToken } from "@/lib/analyst-auth";

export async function middleware(request: NextRequest) {
  const password = process.env.ANALYST_PASSWORD;

  // If no password is set, allow through (dev mode)
  if (!password) return NextResponse.next();

  // Session cookie set by /api/auth/login
  const token = request.cookies.get(ANALYST_SESSION_COOKIE)?.value;
  if (await verifySessionToken(password, token)) return NextResponse.next();

  // Basic auth fallback for scripts / curl
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const credentials = atob(authHeader.slice(6));
    const colonIdx = credentials.indexOf(":");
    const pass = colonIdx >= 0 ? credentials.slice(colonIdx + 1) : credentials;
    if (pass === password) return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/analyst/:path*"],
};
