export const TZ = "America/Los_Angeles";

export function getPacificParts(d: Date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: parseInt(parts.hour === "24" ? "0" : parts.hour),
    minute: parseInt(parts.minute),
  };
}

// "YYYY-MM-DD" for a Date in Pacific time
export function pacificDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

// Returns the UTC Date representing midnight Pacific for a given YYYY-MM-DD (Pacific) string.
// Tries UTC-7 (PDT) then UTC-8 (PST) and picks whichever lands at hour 0 in Pacific.
export function pacificMidnightFromStr(dateStr: string): Date {
  for (const utcHour of [7, 8]) {
    const candidate = new Date(`${dateStr}T${String(utcHour).padStart(2, "0")}:00:00.000Z`);
    if (
      candidate.toLocaleDateString("en-CA", { timeZone: TZ }) === dateStr &&
      getPacificParts(candidate).hour === 0
    ) {
      return candidate;
    }
  }
  return new Date(`${dateStr}T08:00:00.000Z`); // fallback: PST
}
