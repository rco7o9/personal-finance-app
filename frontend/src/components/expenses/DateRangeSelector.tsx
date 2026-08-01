"use client";

// CLIENT component — a Popover containing a full calendar (day / whole month /
// arbitrary range) plus quick presets, syncing the choice into the URL as
// ?startDate=X&endDate=Y so the server component (page.tsx) re-fetches with the
// new date bounds. No local/persisted state needed here — the URL is the single
// source of truth, same pattern as PersonSelector's ?personId sync.

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  RANGE_PRESETS,
  computeDateRange,
  describeDateRange,
  dateToYmd,
  parseYmd,
  isSameDay,
  startOfMonth,
  endOfMonthDate,
  monthLabel,
} from "@/lib/dateRanges";

interface Props {
  startDate: string;
  endDate: string;
}

type Tab = "range" | "day" | "month";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function monthCells(viewMonth: Date): (Date | null)[] {
  const first = startOfMonth(viewMonth);
  const last = endOfMonthDate(viewMonth);
  const cells: (Date | null)[] = new Array(first.getDay()).fill(null);
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function DateRangeSelector({ startDate, endDate }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("range");
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(parseYmd(startDate)));
  const [monthTabYear, setMonthTabYear] = useState(() => parseYmd(startDate).getFullYear());
  const [selectedDay, setSelectedDay] = useState<Date | null>(() =>
    startDate === endDate ? parseYmd(startDate) : null,
  );
  const [rangeFrom, setRangeFrom] = useState<Date | null>(() => parseYmd(startDate));
  const [rangeTo, setRangeTo] = useState<Date | null>(() => parseYmd(endDate));
  const [hoverDay, setHoverDay] = useState<Date | null>(null);

  function handleOpenChange(next: boolean) {
    if (next) {
      const s = parseYmd(startDate);
      const e = parseYmd(endDate);
      setViewMonth(startOfMonth(s));
      setMonthTabYear(s.getFullYear());
      setSelectedDay(startDate === endDate ? s : null);
      setRangeFrom(s);
      setRangeTo(e);
      setHoverDay(null);
      setTab("range");
    }
    setOpen(next);
  }

  function applyDates(nextStart: string, nextEnd: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("startDate", nextStart);
    params.set("endDate", nextEnd);
    router.push(`${pathname}?${params.toString()}`);
    setOpen(false);
  }

  function handlePreset(presetValue: string) {
    const preset = computeDateRange(presetValue);
    applyDates(preset.startDate, preset.endDate);
  }

  function handleDayApply(day: Date) {
    const ymdStr = dateToYmd(day);
    setSelectedDay(day);
    applyDates(ymdStr, ymdStr);
  }

  function handleMonthApply(monthIndex: number) {
    const first = new Date(monthTabYear, monthIndex, 1);
    const last = endOfMonthDate(first);
    applyDates(dateToYmd(first), dateToYmd(last));
  }

  function handleRangeDayClick(day: Date) {
    if (!rangeFrom || rangeTo) {
      setRangeFrom(day);
      setRangeTo(null);
      return;
    }
    if (day < rangeFrom) {
      setRangeTo(rangeFrom);
      setRangeFrom(day);
    } else {
      setRangeTo(day);
    }
  }

  function handleRangeApply() {
    if (!rangeFrom) return;
    const end = rangeTo ?? rangeFrom;
    applyDates(dateToYmd(rangeFrom), dateToYmd(end));
  }

  const rangePreviewEnd = rangeTo ?? hoverDay;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="outline" className="w-64 justify-start gap-2 text-sm font-normal" />
        }
      >
        <CalendarDays className="h-4 w-4 shrink-0" />
        {describeDateRange(startDate, endDate)}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] space-y-3">
        {/* Quick presets */}
        <div className="grid grid-cols-2 gap-1.5">
          {RANGE_PRESETS.map((p) => (
            <Button
              key={p.value}
              variant="secondary"
              size="sm"
              className="text-xs font-normal"
              onClick={() => handlePreset(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="border-t" />

        {/* Tabs */}
        <div className="bg-muted grid grid-cols-3 gap-0.5 rounded-lg p-0.5 text-xs">
          {(
            [
              ["day", "Day"],
              ["month", "Month"],
              ["range", "Range"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={cn(
                "rounded-md py-1 font-medium transition-colors",
                tab === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "month" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <button
                className="hover:bg-muted rounded-md p-1"
                onClick={() => setMonthTabYear((y) => y - 1)}
                aria-label="Previous year"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">{monthTabYear}</span>
              <button
                className="hover:bg-muted rounded-md p-1"
                onClick={() => setMonthTabYear((y) => y + 1)}
                aria-label="Next year"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {MONTH_ABBR.map((label, idx) => {
                const isCurrentSelection =
                  startDate === dateToYmd(new Date(monthTabYear, idx, 1)) &&
                  endDate === dateToYmd(endOfMonthDate(new Date(monthTabYear, idx, 1)));
                return (
                  <button
                    key={label}
                    onClick={() => handleMonthApply(idx)}
                    className={cn(
                      "rounded-md py-1.5 text-sm transition-colors",
                      isCurrentSelection ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <button
                className="hover:bg-muted rounded-md p-1"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">{monthLabel(viewMonth)}</span>
              <button
                className="hover:bg-muted rounded-md p-1"
                onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="text-muted-foreground grid grid-cols-7 text-center text-xs">
              {WEEKDAY_LABELS.map((d, i) => (
                <div key={i} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-y-1" onMouseLeave={() => setHoverDay(null)}>
              {monthCells(viewMonth).map((day, idx) => {
                if (!day) return <div key={idx} />;

                if (tab === "day") {
                  const isSelected = selectedDay && isSameDay(day, selectedDay);
                  return (
                    <button
                      key={idx}
                      onClick={() => handleDayApply(day)}
                      className={cn(
                        "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors",
                        isSelected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                      )}
                    >
                      {day.getDate()}
                    </button>
                  );
                }

                // range tab
                const from = rangeFrom;
                const to = rangePreviewEnd;
                const lo = from && to && to < from ? to : from;
                const hi = from && to && to < from ? from : to;
                const isEdge = (from && isSameDay(day, from)) || (to && isSameDay(day, to));
                const isBetween = lo && hi && day > lo && day < hi;

                return (
                  <button
                    key={idx}
                    onClick={() => handleRangeDayClick(day)}
                    onMouseEnter={() => setHoverDay(day)}
                    className={cn(
                      "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors",
                      isEdge && "bg-primary text-primary-foreground",
                      !isEdge && isBetween && "bg-primary/15 rounded-none",
                      !isEdge && !isBetween && "hover:bg-muted",
                    )}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>

            {tab === "range" && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-muted-foreground text-xs">
                  {rangeFrom
                    ? `${dateToYmd(rangeFrom)} → ${rangeTo ? dateToYmd(rangeTo) : "?"}`
                    : "Pick a start date"}
                </span>
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleRangeApply}
                  disabled={!rangeFrom}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
