import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { getAllEntities, upsertItems } from "@/lib/collectors/ingest";
import { collectTwitter } from "@/lib/collectors/twitter";
import { sendNotification } from "@/lib/notifications/telegram";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const entities = await getAllEntities();
  let total = 0;

  for (const entity of entities) {
    try {
      const items = await collectTwitter(entity);
      const inserted = await upsertItems(items);
      total += inserted;

      if (inserted > 0) {
        if (inserted === 1) {
          const item = items[0];
          await sendNotification(
            `<b>New X post · ${entity.label}</b>\n${item.title ?? item.body?.slice(0, 140) ?? ""}${item.url ? `\n${item.url}` : ""}`
          );
        } else {
          await sendNotification(`<b>${inserted} new X posts · ${entity.label}</b>`);
        }
      }
    } catch (err) {
      console.error(`[Twitter] entity ${entity.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, inserted: total });
}
