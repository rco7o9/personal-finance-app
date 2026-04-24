// Currency formatter — always displays in INR with Indian number formatting
export function formatCurrency(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

// Short date: "15 Jan 2025"
export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

// Month label: "Jan 2025"
export function formatMonth(date: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

// Percentage: "12.34%"
export function formatPercent(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

// Abbreviated currency: "₹1.23 Cr", "₹45.67 L", or full for small values
export function formatCurrencyShort(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (num >= 1e7) return `₹${(num / 1e7).toFixed(2)} Cr`;
  if (num >= 1e5) return `₹${(num / 1e5).toFixed(2)} L`;
  return formatCurrency(num);
}

// Delta: "+12.34%" or "-5.67%"
export function formatDelta(delta: string): string {
  const n = parseFloat(delta);
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
