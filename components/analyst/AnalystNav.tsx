"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAnalyst } from "@/components/analyst/AnalystContext";
import { timeAgo } from "@/components/analyst/data";

function Icon({ kind }: { kind: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "raw":
      return (
        <svg {...common}>
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      );
    case "groups":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "sentiment":
      return (
        <svg {...common}>
          <polyline points="3,15 9,9 13,12 21,4" />
        </svg>
      );
    case "bubbles":
      return (
        <svg {...common}>
          <circle cx="7" cy="8" r="3" />
          <circle cx="16" cy="11" r="4" />
          <circle cx="10" cy="18" r="2.5" />
        </svg>
      );
    case "sources":
      return (
        <svg {...common}>
          <circle cx="6.5" cy="17.5" r="2.5" />
          <path d="M5 11a8 8 0 0 1 8 8" />
          <path d="M5 5a14 14 0 0 1 14 14" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}

const NAV = [
  { href: "/analyst", icon: "raw", label: "Raw data" },
  { href: "/analyst/groups", icon: "groups", label: "Groups" },
  { href: "/analyst/sentiment", icon: "sentiment", label: "Sentiment" },
  { href: "/analyst/bubbles", icon: "bubbles", label: "Bubbles" },
  { href: "/analyst/sources", icon: "sources", label: "Sources" },
];

export function AnalystNav() {
  const path = usePathname();
  const { totalItems, lastSyncAt } = useAnalyst();
  return (
    <aside className="an-sidebar">
      <div className="an-brand">
        <div className="an-brand-mark">g</div>
        <div className="an-brand-name">gito</div>
      </div>
      <nav className="an-nav">
        {NAV.map((n) => {
          const active =
            n.href === "/analyst" ? path === n.href : path.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`an-nav-item${active ? " an-nav-item-on" : ""}`}
            >
              <span className="an-nav-icon">
                <Icon kind={n.icon} />
              </span>
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="an-side-foot">
        <div className="an-side-foot-row">
          <span className="an-side-foot-label">Items · 90d</span>
          <span className="an-side-foot-value">
            {totalItems != null ? totalItems.toLocaleString() : "—"}
          </span>
        </div>
        <div className="an-live">
          <span className="an-live-dot" />
          <span>
            {lastSyncAt ? `Live · synced ${timeAgo(lastSyncAt)} ago` : "No runs yet"}
          </span>
        </div>
      </div>
    </aside>
  );
}
