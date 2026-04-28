import { apiGet } from "@/lib/api";
import {
  formatCurrency,
  formatCurrencyShort,
  formatDate,
  formatDelta,
  formatPercent,
} from "@/lib/formatters";
import { PortfolioSummary } from "@/types";
import { Badge } from "@/components/ui/badge";
import { RefreshPrices } from "@/components/portfolio/RefreshPrices";

export default async function PortfolioPage() {
  const summary = await apiGet<PortfolioSummary>("/portfolio/summary");

  return (
    <div className="space-y-4">
      {/* Row 1 — Hero metrics */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-6">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            Total portfolio value
          </p>
          <p className="mt-2 text-4xl font-bold tracking-tight">
            {formatCurrency(summary.totalValue)}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">As of {formatDate(new Date())}</p>
        </div>

        <div className="rounded-lg border p-6">
          <div className="flex items-start justify-between">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">Overall XIRR</p>
            <RefreshPrices />
          </div>
          <p className="mt-2 text-4xl font-bold tracking-tight text-[var(--color-positive)]">
            {summary.overallXirr ? formatPercent(parseFloat(summary.overallXirr)) : "—"}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">Across all platforms</p>
        </div>
      </div>

      {/* Row 2 — Allocation + Platform */}
      <div className="grid grid-cols-5 gap-4">
        {/* Allocation bars */}
        <div className="col-span-2 rounded-lg border p-6">
          <p className="text-muted-foreground mb-4 text-xs tracking-wide uppercase">
            Actual vs target allocation <span className="normal-case">(| = target)</span>
          </p>
          <div className="space-y-3">
            {summary.byAssetClass.map((row) => (
              <div key={row.assetClass}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{row.assetClass}</span>
                  <span className="text-muted-foreground">
                    {formatPercent(parseFloat(row.percentage), 1)}
                    {row.targetPercentage && (
                      <span className="ml-1 text-xs">
                        / {formatPercent(parseFloat(row.targetPercentage), 0)} target
                      </span>
                    )}
                  </span>
                </div>
                <div className="bg-muted relative h-5 w-full overflow-hidden rounded-full">
                  <div
                    className={`h-full rounded-full transition-all ${
                      parseFloat(row.delta ?? "0") >= 0 ? "bg-amber-500" : "bg-blue-500"
                    }`}
                    style={{ width: `${Math.min(parseFloat(row.percentage), 100)}%` }}
                  />
                  {row.targetPercentage && (
                    <div
                      className="absolute top-0 h-full w-0.5 bg-white/30"
                      style={{ left: `${Math.min(parseFloat(row.targetPercentage), 100)}%` }}
                    />
                  )}
                </div>
                <div className="text-muted-foreground mt-0.5 flex justify-between text-xs">
                  <span>{formatCurrencyShort(row.value)}</span>
                  {row.delta && (
                    <span
                      className={parseFloat(row.delta) >= 0 ? "text-green-400" : "text-red-400"}
                    >
                      {formatDelta(row.delta)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="text-muted-foreground mt-4 flex gap-4 text-xs">
            <span>○ Actual&nbsp;&nbsp;|&nbsp;&nbsp;Target</span>
            <span>
              <span className="text-amber-500">■</span> Over
            </span>
            <span>
              <span className="text-blue-500">■</span> Under
            </span>
          </div>
        </div>

        {/* By platform */}
        <div className="col-span-3 rounded-lg border p-6">
          <p className="text-muted-foreground mb-4 text-xs tracking-wide uppercase">By platform</p>
          <div className="grid grid-cols-2 gap-3">
            {summary.byPlatform.map((p, i) => (
              <div key={i} className="rounded-lg border p-4">
                <p className="text-muted-foreground text-xs">{p.assetClass}</p>
                <p className="mt-0.5 text-sm font-medium">{p.platform}</p>
                <p className="mt-2 text-lg font-semibold">{formatCurrencyShort(p.value)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Row 3 — Rebalancing suggestions */}
      {summary.rebalancingSuggestions.length > 0 && (
        <div className="rounded-lg border p-6">
          <p className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
            Rebalancing suggestions
          </p>
          <div className="space-y-2">
            {summary.rebalancingSuggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                <Badge
                  variant={s.tag === "overweight" ? "destructive" : "secondary"}
                  className={
                    s.tag === "overweight"
                      ? "border-0 bg-amber-500 text-black hover:bg-amber-500"
                      : "border-0 bg-blue-500 text-white hover:bg-blue-500"
                  }
                >
                  {s.tag}
                </Badge>
                <p className="text-sm">{s.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
