import { NextResponse } from "next/server";
import { ANALYST_SESSION_COOKIE } from "@/lib/analyst-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ANALYST_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
