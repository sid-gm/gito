import type { NarrativeStage } from "@/lib/db/schema";
export type { NarrativeStage };

export const NEWS_PLATFORMS = ["google_news", "google_alerts"];

export function computeNarrativeStage(opts: {
  velocity24h: number;
  prevVelocity24h: number;
  peakMomentum: number | null;
  ageInDays: number;
  platformCount?: number;
  nonNewsPlatformCount?: number;
  currentStage?: NarrativeStage;
}): NarrativeStage | null {
  const {
    velocity24h,
    prevVelocity24h,
    peakMomentum,
    ageInDays,
    platformCount = 0,
    nonNewsPlatformCount = 0,
    currentStage,
  } = opts;

  const acceleration = velocity24h - prevVelocity24h;
  const peak = peakMomentum ?? 0;
  const peakRatio = peak > 0 ? velocity24h / peak : 0;
  const spread = nonNewsPlatformCount >= 2 || platformCount >= 3;

  // Validation layer: clusters set to "developing" by the old stateless model may not
  // have earned that stage. Invalidate if they don't meet the minimum floor.
  const stage: NarrativeStage | null =
    currentStage === "developing" && !(velocity24h >= 3 && spread)
      ? null
      : (currentStage ?? null);

  // ── Terminal ──────────────────────────────────────────────────────────────
  if (stage === "declining") return "declining";

  // ── From peaked ───────────────────────────────────────────────────────────
  if (stage === "peaked") {
    if (velocity24h === 0) return "declining";
    if (peak >= 5 && peakRatio < 0.35 && acceleration < 0) return "declining";
    if (velocity24h > peak * 1.5 && acceleration > 0 && nonNewsPlatformCount >= 1) return "revival";
    return "peaked";
  }

  // ── From revival (second developing cycle) ───────────────────────────────
  if (stage === "revival") {
    if (velocity24h === 0 && ageInDays > 2) return "declining";
    if (peak >= 5 && peakRatio < 0.20 && acceleration < 0) return "declining";
    if (peak >= 5 && velocity24h > 0 && peakRatio >= 0.70 && acceleration <= 0) return "peaked";
    if (velocity24h >= 3 && spread) return "revival";
    return "declining";
  }

  // ── From developing (passed validation) ──────────────────────────────────
  if (stage === "developing") {
    if (velocity24h === 0 && ageInDays > 2) return "declining";
    if (peak >= 5 && peakRatio < 0.20 && acceleration < 0) return "declining";
    if (peak >= 5 && velocity24h > 0 && peakRatio >= 0.70 && acceleration <= 0) return "peaked";
    if (velocity24h >= 3 && spread) return "developing";
    return "developing";
  }

  // ── From emerging ────────────────────────────────────────────────────────
  if (stage === "emerging") {
    if (velocity24h >= 3 && spread) return "developing";
    if (ageInDays < 3 && velocity24h > 0) return "emerging";
    if (velocity24h === 0 && ageInDays > 2) return "declining";
    return null;
  }

  // ── From null (new cluster / invalidated state) ───────────────────────────
  if (ageInDays < 2 && (nonNewsPlatformCount >= 3 || platformCount >= 5)) return "emerging";
  if (ageInDays < 2 && velocity24h >= 3 && acceleration > 0) return "emerging";
  return null;
}
