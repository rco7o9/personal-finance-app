// Badge colors shared between the statements review screen and the expenses
// dashboard, so a category reads the same visually everywhere it appears.
export const CATEGORY_BADGE: Record<string, string> = {
  "US Equity": "bg-blue-500/20 text-blue-300 border-blue-400/30",
  "Indian Equity": "bg-cyan-500/20 text-cyan-300 border-cyan-400/30",
  "Mutual Fund": "bg-purple-500/20 text-purple-300 border-purple-400/30",
  "Liquid Fund": "bg-teal-500/20 text-teal-300 border-teal-400/30",
  ETF: "bg-teal-500/20 text-teal-300 border-teal-400/30",
  Crypto: "bg-green-500/20 text-green-300 border-green-400/30",
  "Employer RSU": "bg-orange-500/20 text-orange-300 border-orange-400/30",
  Gold: "bg-yellow-500/20 text-yellow-300 border-yellow-400/30",
  // Expense categories (agents/src/agents/statements-parser/config/categories.ts)
  "Food & Dining": "bg-orange-500/20 text-orange-300 border-orange-400/30",
  Transportation: "bg-sky-500/20 text-sky-300 border-sky-400/30",
  Shopping: "bg-pink-500/20 text-pink-300 border-pink-400/30",
  Groceries: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
  Utilities: "bg-amber-500/20 text-amber-300 border-amber-400/30",
  Healthcare: "bg-red-500/20 text-red-300 border-red-400/30",
  Entertainment: "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-400/30",
  Travel: "bg-indigo-500/20 text-indigo-300 border-indigo-400/30",
  Education: "bg-lime-500/20 text-lime-300 border-lime-400/30",
  Rent: "bg-violet-500/20 text-violet-300 border-violet-400/30",
  Maintenance: "bg-stone-500/20 text-stone-300 border-stone-400/30",
  Insurance: "bg-teal-500/20 text-teal-300 border-teal-400/30",
  Investments: "bg-blue-500/20 text-blue-300 border-blue-400/30",
  "Arjun's Parents' Expense": "bg-rose-500/20 text-rose-300 border-rose-400/30",
  "Priya's Parents' Expense": "bg-purple-500/20 text-purple-300 border-purple-400/30",
  Salary: "bg-green-500/20 text-green-300 border-green-400/30",
  Transfer: "bg-slate-500/20 text-slate-300 border-slate-400/30",
  Other: "bg-zinc-500/20 text-zinc-300 border-zinc-400/30",
};

export const DEFAULT_BADGE = "bg-secondary text-secondary-foreground";
