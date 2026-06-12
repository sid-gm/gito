import { NextRequest, NextResponse } from "next/server";
import {
  ANALYST_SESSION_COOKIE,
  SESSION_TTL_MS,
  signSessionToken,
} from "@/lib/analyst-auth";

export async function POST(request: NextRequest) {
  const configured = process.env.ANALYST_PASSWORD;
  if (!configured) {
    // Dev mode — middleware lets everything through anyway
    return NextResponse.json({ ok: true });
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // constant-time compare
  const a = new TextEncoder().encode(password);
  const b = new TextEncoder().encode(configured);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i % a.length] ?? 0) ^ (b[i % b.length] ?? 0);
  }
  if (diff !== 0) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await signSessionToken(configured);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ANALYST_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return res;
}
