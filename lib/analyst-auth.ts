// Session tokens for the analyst portal. Signed with an HMAC key derived
// from ANALYST_PASSWORD itself — changing the password invalidates all
// existing sessions. Uses Web Crypto so it runs in both middleware (edge)
// and route handlers (node).

export const ANALYST_SESSION_COOKIE = "gito_analyst_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function hmacHex(password: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`gito-analyst-v1:${password}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function signSessionToken(password: string): Promise<string> {
  const exp = Date.now() + SESSION_TTL_MS;
  const sig = await hmacHex(password, String(exp));
  return `${exp}.${sig}`;
}

export async function verifySessionToken(
  password: string,
  token: string | undefined
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = await hmacHex(password, exp);
  if (sig.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
