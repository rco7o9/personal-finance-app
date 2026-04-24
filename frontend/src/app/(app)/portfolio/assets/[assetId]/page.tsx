import { apiGet } from "@/lib/api";
import { formatCurrency, formatCurrencyShort, formatDate, formatPercent } from "@/lib/formatters";
import { AssetDetail, PortfolioAsset } from "@/types";
import { AssetSelector } from "@/components/portfolio/AssetSelector";

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ assetId: string }>;
  searchParams: Promise<{ personId?: string }>;
}) {
  const [{ assetId }, { personId }] = await Promise.all([params, searchParams]);

  if (!personId) {
    return <p className="text-muted-foreground text-sm">Select a person to view asset details.</p>;
  }

  const [detail, assets] = await Promise.all([
    apiGet<AssetDetail>(`/portfolio/assets/${assetId}?personId=${personId}`),
    apiGet<PortfolioAsset[]>(`/portfolio/assets?personId=${personId}`),
  ]);

  return (
    <div className="space-y-8">
      {/* Header + selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-semibold tracking-tight">{detail.assetName}</h2>
        <AssetSelector assets={assets} currentAssetId={Number(assetId)} personId={personId} />
      </div>

      {/* 4-up metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Current Value"
          value={detail.currentValue ? formatCurrency(detail.currentValue) : "—"}
        />
        <MetricCard label="Units Held" value={detail.totalUnits} />
        <MetricCard label="Avg Cost" value={formatCurrency(detail.avgCost)} />
        <MetricCard label="XIRR" value="—" />
      </div>

      {/* P&L summary */}
      <div className="rounded-lg border p-4">
        <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wide uppercase">
          P&amp;L
        </h3>
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="text-muted-foreground text-xs">Unrealised Gain</p>
            <p
              className={`mt-1 text-lg font-semibold ${
                detail.unrealisedGain && parseFloat(detail.unrealisedGain) >= 0
                  ? "text-green-600"
                  : "text-red-500"
              }`}
            >
              {detail.unrealisedGain ? formatCurrency(detail.unrealisedGain) : "—"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Absolute Return</p>
            <p
              className={`mt-1 text-lg font-semibold ${
                detail.absoluteReturnPct && parseFloat(detail.absoluteReturnPct) >= 0
                  ? "text-green-600"
                  : "text-red-500"
              }`}
            >
              {detail.absoluteReturnPct ? formatPercent(parseFloat(detail.absoluteReturnPct)) : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Lot table */}
      <div>
        <h3 className="mb-3 text-base font-semibold">Lots</h3>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-muted-foreground border-b text-xs tracking-wide uppercase">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-right">Units</th>
                <th className="px-4 py-3 text-right">Buy Price</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Current Value</th>
                <th className="px-4 py-3 text-right">XIRR</th>
              </tr>
            </thead>
            <tbody>
              {detail.lots.map((lot) => (
                <tr key={lot.id} className="hover:bg-muted/30 border-b last:border-0">
                  <td className="px-4 py-3">{formatDate(lot.date)}</td>
                  <td className="px-4 py-3 capitalize">{lot.type}</td>
                  <td className="px-4 py-3 text-right">{lot.units}</td>
                  <td className="px-4 py-3 text-right">{formatCurrencyShort(lot.buyPrice)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrencyShort(lot.cost)}</td>
                  <td className="px-4 py-3 text-right">
                    {lot.currentValue ? formatCurrencyShort(lot.currentValue) : "—"}
                  </td>
                  <td className="text-muted-foreground px-4 py-3 text-right">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p className="mt-2 text-xl font-semibold">{value}</p>
    </div>
  );
}
