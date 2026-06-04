import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const password = process.env.ANALYST_PASSWORD;

  // If no password is set, allow through (dev mode)
  if (!password) return NextResponse.next();

  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const credentials = atob(authHeader.slice(6));
    const colonIdx = credentials.indexOf(":");
    const pass = colonIdx >= 0 ? credentials.slice(colonIdx + 1) : credentials;
    if (pass === password) return NextResponse.next();
  }

  return new NextResponse("Analyst portal — authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Gito Analyst Portal"' },
  });
}

export const config = {
  matcher: ["/analyst/:path*"],
};
