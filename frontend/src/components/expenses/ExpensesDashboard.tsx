"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api";
import { formatCurrency, formatCurrencyShort, formatDate } from "@/lib/formatters";
import { CATEGORY_BADGE, DEFAULT_BADGE } from "@/lib/categoryBadges";
import type { ExpenseCategorySummary, ExpenseDetailRow, ExpenseSummary } from "@/types";

interface Props {
  summary: ExpenseSummary;
  personId: number;
  startDate: string;
  endDate: string;
  rangeLabel: string;
}

export function ExpensesDashboard({ summary, personId, startDate, endDate, rangeLabel }: Props) {
  const [selected, setSelected] = useState<ExpenseCategorySummary | null>(null);
  const [detailCache, setDetailCache] = useState<Record<number, ExpenseDetailRow[]>>({});
  const [loading, setLoading] = useState(false);

  async function handleCardClick(category: ExpenseCategorySummary) {
    if (selected?.categoryId === category.categoryId) {
      setSelected(null);
      return;
    }
    setSelected(category);

    if (detailCache[category.categoryId]) return;
    setLoading(true);
    try {
      const rows = await apiGet<ExpenseDetailRow[]>(
        `/expenses?personId=${personId}&categoryId=${category.categoryId}` +
          `&startDate=${startDate}&endDate=${endDate}`,
      );
      setDetailCache((prev) => ({ ...prev, [category.categoryId]: rows }));
    } finally {
      setLoading(false);
    }
  }

  if (summary.categories.length === 0) {
    return (
      <div className="rounded-lg border p-10 text-center">
        <p className="text-muted-foreground text-sm">
          No confirmed expenses for {rangeLabel.toLowerCase()}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-6">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">Total spend</p>
          <p className="mt-2 text-4xl font-bold tracking-tight">
            {formatCurrency(summary.totalSpend)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">{rangeLabel}</p>
        </div>
        <div className="rounded-lg border p-6">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">Transactions</p>
          <p className="mt-2 text-4xl font-bold tracking-tight">{summary.transactionCount}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            across {summary.categories.length} categor
            {summary.categories.length === 1 ? "y" : "ies"}
          </p>
        </div>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-4 gap-4">
        {summary.categories.map((c) => (
          <button
            key={c.categoryId}
            onClick={() => void handleCardClick(c)}
            className={cn(
              "rounded-lg border p-4 text-left transition-colors",
              selected?.categoryId === c.categoryId
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/40",
            )}
          >
            <Badge
              className={cn("border text-xs", CATEGORY_BADGE[c.categoryName] ?? DEFAULT_BADGE)}
            >
              {c.categoryName}
            </Badge>
            <p className="mt-3 text-2xl font-semibold tracking-tight">
              {formatCurrencyShort(c.total)}
            </p>
            <div className="text-muted-foreground mt-1 flex justify-between text-xs">
              <span>
                {c.transactionCount} txn{c.transactionCount === 1 ? "" : "s"}
              </span>
              <span>{c.percentage}%</span>
            </div>
          </button>
        ))}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="rounded-xl border">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-2">
              <Badge
                className={cn(
                  "border text-xs",
                  CATEGORY_BADGE[selected.categoryName] ?? DEFAULT_BADGE,
                )}
              >
                {selected.categoryName}
              </Badge>
              <h3 className="text-sm font-semibold">{formatCurrencyShort(selected.total)}</h3>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground rounded-lg p-1 transition-colors"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-6 py-4">
            {loading && !detailCache[selected.categoryId] ? (
              <p className="text-muted-foreground py-6 text-center text-sm">Loading…</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-xs">
                    <th className="pb-2 text-left font-medium">Date</th>
                    <th className="pb-2 text-left font-medium">Description</th>
                    <th className="pb-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(detailCache[selected.categoryId] ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="text-muted-foreground py-2.5 pr-4 text-xs whitespace-nowrap">
                        {formatDate(row.date)}
                      </td>
                      <td className="py-2.5 pr-4">{row.description}</td>
                      <td className="py-2.5 text-right font-medium">
                        {formatCurrency(row.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
