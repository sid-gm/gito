"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { Company, Topic } from "@/components/analyst/data";

interface AnalystState {
  companies: Company[];
  companyId: string | null;
  setCompanyId: (id: string) => void;
  topics: Topic[];
  days: number;
  setDays: (d: number) => void;
  totalItems: number | null;
  lastSyncAt: string | null;
  ready: boolean;
}

const AnalystContext = createContext<AnalystState>({
  companies: [],
  companyId: null,
  setCompanyId: () => {},
  topics: [],
  days: 7,
  setDays: () => {},
  totalItems: null,
  lastSyncAt: null,
  ready: false,
});

export function useAnalyst(): AnalystState {
  return useContext(AnalystContext);
}

const COMPANY_STORAGE_KEY = "gito-analyst-company";

export function AnalystProvider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyIdState] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [days, setDays] = useState(7);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const setCompanyId = useCallback((id: string) => {
    setCompanyIdState(id);
    try {
      localStorage.setItem(COMPANY_STORAGE_KEY, id);
    } catch {
      /* private mode */
    }
  }, []);

  // Companies once on mount; restore the last-used company
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/companies");
        if (!res.ok) return;
        const rows = (await res.json()) as Company[];
        setCompanies(rows);
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(COMPANY_STORAGE_KEY);
        } catch {
          /* private mode */
        }
        const initial = rows.find((c) => c.id === stored)?.id ?? rows[0]?.id ?? null;
        setCompanyIdState(initial);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Topics + sidebar stats whenever the company changes
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      const [topicsRes, itemsRes, sourcesRes] = await Promise.all([
        fetch(`/api/topics?companyId=${companyId}`),
        fetch(`/api/analyst/items?companyId=${companyId}&days=90&limit=1`),
        fetch(`/api/analyst/sources?companyId=${companyId}&runs=1`),
      ]);
      if (cancelled) return;
      if (topicsRes.ok) setTopics((await topicsRes.json()) as Topic[]);
      if (itemsRes.ok) {
        const data = await itemsRes.json();
        setTotalItems(typeof data.total === "number" ? data.total : null);
      }
      if (sourcesRes.ok) {
        const data = await sourcesRes.json();
        setLastSyncAt(data.runs?.[0]?.startedAt ?? null);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return (
    <AnalystContext.Provider
      value={{
        companies,
        companyId,
        setCompanyId,
        topics,
        days,
        setDays,
        totalItems,
        lastSyncAt,
        ready,
      }}
    >
      {children}
    </AnalystContext.Provider>
  );
}
