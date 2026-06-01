import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hackernews: true,
    reddit: true,
    twitter: !!process.env.TWITTER_BEARER_TOKEN,
    threads: !!process.env.THREADS_ACCESS_TOKEN,
  });
}
