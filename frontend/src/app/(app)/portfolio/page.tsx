import { apiGet } from "@/lib/api";
import { formatCurrency, formatCurrencyShort, formatDelta, formatPercent } from "@/lib/formatters";
import { PortfolioSummary } from "@/types";
import { Badge } from "@/components/ui/badge";
import { RefreshPrices } from "@/components/portfolio/RefreshPrices";

export default async function PortfolioPage() {
  const summary = await apiGet<PortfolioSummary>("/portfolio/summary");

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Portfolio</h2>
        <div className="mt-4 flex items-end gap-6">
          <div>
            <p className="text-muted-foreground text-xs tracking-wide uppercase">Total Value</p>
            <p className="mt-1 text-4xl font-bold tracking-tight">
              {formatCurrency(summary.totalValue)}
            </p>
          </div>
          <div className="mb-1">
            <p className="text-muted-foreground text-xs tracking-wide uppercase">XIRR</p>
            <p className="text-muted-foreground mt-1 text-2xl font-semibold">
              {summary.overallXirr ? formatPercent(parseFloat(summary.overallXirr)) : "—"}
            </p>
          </div>
          <div className="mb-1 ml-auto">
            <RefreshPrices />
          </div>
        </div>
      </div>

      {/* Allocation */}
      <div>
        <h3 className="mb-4 text-base font-semibold">Allocation</h3>
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
                  className="bg-primary h-full rounded-full transition-all"
                  style={{ width: `${Math.min(parseFloat(row.percentage), 100)}%` }}
                />
                {row.targetPercentage && (
                  <div
                    className="bg-destructive/70 absolute top-0 h-full w-0.5"
                    style={{ left: `${Math.min(parseFloat(row.targetPercentage), 100)}%` }}
                  />
                )}
              </div>
              <div className="text-muted-foreground mt-0.5 flex justify-between text-xs">
                <span>{formatCurrencyShort(row.value)}</span>
                {row.delta && (
                  <span className={parseFloat(row.delta) >= 0 ? "text-green-600" : "text-red-500"}>
                    {formatDelta(row.delta)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rebalancing Suggestions */}
      {summary.rebalancingSuggestions.length > 0 && (
        <div>
          <h3 className="mb-3 text-base font-semibold">Rebalancing</h3>
          <div className="space-y-2">
            {summary.rebalancingSuggestions.map((s, i) => (
              <div key={i} className="flex items-start gap-3 rounded-lg border p-3">
                <Badge variant={s.tag === "overweight" ? "destructive" : "secondary"}>
                  {s.tag}
                </Badge>
                <p className="text-sm">{s.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Platform Breakdown */}
      <div>
        <h3 className="mb-3 text-base font-semibold">By Platform</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
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
  );
}
