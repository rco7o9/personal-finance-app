import { apiGet } from "@/lib/api";
import { computeDateRange, describeDateRange, isValidYmd } from "@/lib/dateRanges";
import { ExpenseSummary } from "@/types";
import { DateRangeSelector } from "@/components/expenses/DateRangeSelector";
import { ExpensesDashboard } from "@/components/expenses/ExpensesDashboard";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string; startDate?: string; endDate?: string }>;
}) {
  const { personId, startDate: rawStart, endDate: rawEnd } = await searchParams;
  const pid = personId ? parseInt(personId, 10) : null;

  // Default to "This Month" when no explicit range is in the URL (first visit,
  // or a link that only set ?personId). Once the calendar picks a range, the
  // exact dates round-trip through the URL — no preset is stored.
  const defaultRange = computeDateRange("month");
  const startDate = isValidYmd(rawStart) ? rawStart : defaultRange.startDate;
  const endDate = isValidYmd(rawEnd) ? rawEnd : defaultRange.endDate;
  const label = describeDateRange(startDate, endDate);

  const summary: ExpenseSummary | null = pid
    ? await apiGet<ExpenseSummary>(
        `/expenses/summary?personId=${pid}&startDate=${startDate}&endDate=${endDate}`,
      ).catch(() => null)
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Expenses</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Category-wise breakdown of confirmed spend.
          </p>
        </div>
        <DateRangeSelector startDate={startDate} endDate={endDate} />
      </div>

      {!pid ? (
        <div className="rounded-lg border p-10 text-center">
          <p className="text-muted-foreground text-sm">Select a person to view expenses.</p>
        </div>
      ) : !summary ? (
        <div className="rounded-lg border p-10 text-center">
          <p className="text-muted-foreground text-sm">Could not load expenses.</p>
        </div>
      ) : (
        <ExpensesDashboard
          summary={summary}
          personId={pid}
          startDate={startDate}
          endDate={endDate}
          rangeLabel={label}
        />
      )}
    </div>
  );
}
