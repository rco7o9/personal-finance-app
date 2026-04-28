# SPEC: Dark Theme & Typography Refresh

**Status:** Draft  
**Scope:** Frontend only — CSS variables, fonts, root layout, portfolio page layout  
**Phase:** Visual/UX tangent (between Phase 2 and Phase 3)

---

## 1. Objective

Beautify the personal finance tracker UI by:
1. Switching to a permanent dark theme with DM Sans typography (done)
2. Restructuring the portfolio overview page layout to match the reference screenshot — a
   two-column dashboard layout with the hero metrics at the top, allocation bars and platform
   cards side by side in the middle, and rebalancing suggestions full-width at the bottom

Target users: Arjun and Priya.

---

## 2. Acceptance Criteria

- [ ] `<html>` element always carries `class="dark"` — permanent, no OS media query, no toggle
- [ ] Page background: near-black (`oklch(0.09 0 0)` ≈ `#111111`)
- [ ] Card background: one step lighter (`oklch(0.14 0 0)` ≈ `#1c1c1c`)
- [ ] Card borders: subtle white overlay (`oklch(1 0 0 / 8%)`)
- [ ] Primary text: off-white (`oklch(0.96 0 0)` ≈ `#f5f5f5`)
- [ ] Muted/secondary text: mid-gray (`oklch(0.62 0 0)` ≈ `#9ca3af`)
- [ ] XIRR / positive return values render in green (`#4ade80`)
- [ ] "Overweight" badge: amber background (`#f59e0b`), dark text
- [ ] "Underweight" badge: blue background (`#3b82f6`), white text
- [ ] Allocation bars: over-target in amber, under-target in blue
- [ ] DM Sans loaded via `next/font/google`, replacing Geist Sans
- [ ] `--font-sans` CSS variable resolves to DM Sans
- [ ] Geist Sans import removed from `layout.tsx`
- [ ] All existing pages render without broken styles (dashboard, expenses, investments,
  statements, portfolio overview, asset detail)
- [ ] `npm run build` passes — zero new TypeScript errors
- [ ] `npm run lint` passes clean

### Portfolio page layout (new)
- [ ] **Row 1:** Two equal bordered cards side by side
  - Left card: label "Total portfolio value", large bold value (₹X.XX Cr), muted subtitle "As of DD MMM YYYY"
  - Right card: label "Overall XIRR", large green value, muted subtitle "Since FY20XX · across all platforms"
- [ ] **Row 2:** Two-column layout (roughly 40/60 or equal split)
  - Left panel: section header "Actual vs target allocation (| = target)", allocation bar rows, legend at bottom ("○ Actual | Target  Amber = over  Blue = under")
  - Right panel: section header "By platform", 2-column grid of platform cards
- [ ] **Row 3:** Full-width rebalancing suggestions section
- [ ] Refresh Prices button lives in the top-right of Row 1 (inside or adjacent to the XIRR card)
- [ ] Section headers use muted small-caps / uppercase tracking style
- [ ] Layout holds at all viewport widths the app currently supports (no mobile breakpoint requirement — this is a desktop-first app)

---

## 3. Color Palette

All tokens set directly on `:root` (no `.dark {}` block needed — the app is always dark).

### Base tokens

| CSS Variable | Value | Hex equiv | Usage |
|---|---|---|---|
| `--background` | `oklch(0.09 0 0)` | `#111111` | Page background |
| `--foreground` | `oklch(0.96 0 0)` | `#f5f5f5` | Body text |
| `--card` | `oklch(0.14 0 0)` | `#1c1c1c` | Card / panel surface |
| `--card-foreground` | `oklch(0.96 0 0)` | `#f5f5f5` | Card text |
| `--popover` | `oklch(0.14 0 0)` | `#1c1c1c` | Popover surface |
| `--popover-foreground` | `oklch(0.96 0 0)` | `#f5f5f5` | Popover text |
| `--primary` | `oklch(0.96 0 0)` | `#f5f5f5` | Primary button background |
| `--primary-foreground` | `oklch(0.09 0 0)` | `#111111` | Primary button text |
| `--secondary` | `oklch(0.18 0 0)` | `#252525` | Secondary surface |
| `--secondary-foreground` | `oklch(0.96 0 0)` | `#f5f5f5` | Secondary text |
| `--muted` | `oklch(0.18 0 0)` | `#252525` | Muted surface |
| `--muted-foreground` | `oklch(0.62 0 0)` | `#9ca3af` | Muted text |
| `--accent` | `oklch(0.18 0 0)` | `#252525` | Accent surface |
| `--accent-foreground` | `oklch(0.96 0 0)` | `#f5f5f5` | Accent text |
| `--destructive` | `oklch(0.704 0.191 22.216)` | `#ef4444`-ish | Destructive action |
| `--border` | `oklch(1 0 0 / 8%)` | `rgba(255,255,255,0.08)` | Borders |
| `--input` | `oklch(1 0 0 / 12%)` | `rgba(255,255,255,0.12)` | Input borders |
| `--ring` | `oklch(0.556 0 0)` | `#737373` | Focus ring |
| `--radius` | `0.625rem` | — | Border radius (unchanged) |

### Sidebar tokens

| CSS Variable | Value |
|---|---|
| `--sidebar` | `oklch(0.12 0 0)` |
| `--sidebar-foreground` | `oklch(0.96 0 0)` |
| `--sidebar-primary` | `oklch(0.488 0.243 264.376)` |
| `--sidebar-primary-foreground` | `oklch(0.96 0 0)` |
| `--sidebar-accent` | `oklch(0.18 0 0)` |
| `--sidebar-accent-foreground` | `oklch(0.96 0 0)` |
| `--sidebar-border` | `oklch(1 0 0 / 8%)` |
| `--sidebar-ring` | `oklch(0.556 0 0)` |

### Chart tokens (visible on dark background)

| Variable | Value | Color |
|---|---|---|
| `--chart-1` | `oklch(0.74 0.2 142)` | Green `#4ade80` |
| `--chart-2` | `oklch(0.67 0.19 250)` | Blue `#60a5fa` |
| `--chart-3` | `oklch(0.77 0.17 70)` | Amber `#fbbf24` |
| `--chart-4` | `oklch(0.65 0.2 25)` | Red `#f87171` |
| `--chart-5` | `oklch(0.65 0.19 295)` | Purple `#a78bfa` |

### Semantic accent tokens (custom properties added to `:root`)

| Token | Value | Usage |
|---|---|---|
| `--color-positive` | `#4ade80` | XIRR, gains, positive returns |
| `--color-overweight` | `#f59e0b` | Overweight badge background |
| `--color-underweight` | `#3b82f6` | Underweight badge background |

---

## 4. Typography

| Property | Value |
|---|---|
| Font family | DM Sans |
| Source | Google Fonts via `next/font/google` |
| Import name | `DM_Sans` |
| Weights loaded | 400, 500, 600, 700 |
| CSS variable | `--font-dm-sans` |
| Mono font | Geist Mono — keep unchanged |

`--font-sans` in `@theme inline` must resolve to `var(--font-dm-sans)`.

---

## 5. Files to Change

| File | Change |
|---|---|
| `frontend/src/app/layout.tsx` | Replace `Geist` import with `DM_Sans`; add `dark` class to `<html>`; update variable names |
| `frontend/src/app/globals.css` | Replace `:root` block with dark palette; remove `.dark {}` block; add semantic accent tokens; update `--font-sans` to `var(--font-dm-sans)` |
| `frontend/src/app/(app)/portfolio/page.tsx` | Apply semantic colors (done); restructure layout to match screenshot — hero row, allocation+platform two-column row, full-width rebalancing row |
| `frontend/src/app/(app)/portfolio/assets/[assetId]/page.tsx` | XIRR green treatment (done) |

No backend changes. No new data fetching. No feature logic changes.

---

## 6. Implementation Order

1. **`globals.css`** — rewrite palette and remove `.dark {}` block
2. **`layout.tsx`** — swap font, add `dark` class to `<html>`
3. **Portfolio page** — apply `--color-positive` to XIRR, verify badge classes
4. **Asset detail page** — same XIRR treatment
5. **Visual verification** — dev server, check all pages

---

## 7. Testing Strategy

1. Start dev server (`npm run dev` in `frontend/`)
2. Visual checks:
   - Portfolio overview: dark background, card contrast, green XIRR, amber/blue badges, allocation bars
   - Asset detail: green XIRR figure, dark card surfaces
   - Sidebar: dark background, correct border
   - Dashboard / expenses / investments / statements stubs: no broken styles
3. `npm run build` — zero new errors
4. `npm run lint` — clean

---

## 8. Boundaries

### Always do
- Keep DM Sans loaded with all four weights (400/500/600/700) to avoid FOUT on bold headings
- Keep Geist Mono for `--font-mono` (code/numeric displays)
- Use CSS custom properties for semantic colors — never hardcode hex in component classNames

### Ask before doing
- Adding a light/dark toggle
- Changing any font size or spacing scale (separate concern)
- Modifying component-level Tailwind classes beyond color/font tokens

### Never do
- Backend changes of any kind
- Changes to business logic or data fetching
- New ADRs (this is purely cosmetic — no architectural decision is recorded)
- Layout changes to any page other than `portfolio/page.tsx`

---

## 9. Out of Scope

- Light mode support
- Per-user theme preference
- Custom font for numerics / monospace financial figures (can be explored separately)
- Animation / transition polish
- Layout changes to any page other than portfolio overview

---

## 10. Portfolio Page Layout Design

### Reference layout (from screenshot)

```
┌─────────────────────────────┬─────────────────────────────────────┐
│  Total portfolio value      │  Overall XIRR          [Refresh]    │
│  ₹1.25 Cr                   │  14.2%                              │
│  As of 01 Apr 2026          │  Since FY2024 · across all platforms│
└─────────────────────────────┴─────────────────────────────────────┘

┌──────────────────────────────┬──────────────────────────────────────┐
│  Actual vs target allocation │  By platform                         │
│  (| = target)                │                                      │
│                              │  ┌──────────┐  ┌──────────┐         │
│  US Equity   ████████  42%   │  │INDMoney  │  │Employer stock  │         │
│  Indian Eq   ████|     18%   │  │₹68.4L    │  │₹16.3L    │         │
│  Mut Funds   ████|     16%   │  │14.8% XIRR│  │Mkt-to-mkt│         │
│  RSUs        ██|       10%   │  ├──────────┤  ├──────────┤         │
│  Liquid      ██|        8%   │  │Zerodha   │  │PayTM Money│        │
│  Crypto       █         4%   │  │₹29.4L    │  │₹26.1L    │         │
│  Gold          ·        2%   │  │11.2% XIRR│  │12.9% XIRR│         │
│                              │  ├──────────┤  ├──────────┤         │
│  ○ Actual | Target           │  │CoinSwitch│  │HDFC Bank │         │
│  Amber = over  Blue = under  │  │₹6.5L     │  │₹13.0L    │         │
│                              │  │38.4% XIRR│  │3.5% svgs │         │
└──────────────────────────────┴──────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│  Rebalancing suggestions                                             │
│  [Overweight] US Equity at 42% vs 40% target — consider pausing…    │
│  [Underweight] Indian Equity at 18% vs 20% target — Zerodha has…    │
└──────────────────────────────────────────────────────────────────────┘
```

### Layout implementation notes

**Row 1 — Hero metrics:**
- `grid grid-cols-2 gap-4` at the top level
- Each cell is a `rounded-lg border p-6` card
- Left card: label in `text-xs uppercase tracking-wide text-muted-foreground`, value in `text-4xl font-bold`, subtitle in `text-sm text-muted-foreground mt-1`
- Right card: same structure; XIRR value uses `text-[var(--color-positive)]`; RefreshPrices button pinned to top-right corner of the card via `flex justify-between items-start`

**Row 2 — Allocation + Platform:**
- `grid grid-cols-2 gap-4` (or a `40/60` split via `grid-cols-5` with `col-span-2` / `col-span-3`)
- Left panel: no card border — or a subtle bordered card; section header as muted uppercase label
- Right panel: section header + 2-column grid of platform mini-cards
- Legend below allocation bars: `○ Actual | Target  Amber = over  Blue = under` in `text-xs text-muted-foreground`

**Row 3 — Rebalancing:**
- Full-width, section header + list of suggestion rows (no change to existing markup, just placement)

**Platform card details (from screenshot):**
- Each card: asset class label (small muted), platform name (medium bold), value (large), secondary line (XIRR % or "Mark-to-market" or "X% savings") in muted green or muted gray
- XIRR on platform cards: `text-[var(--color-positive)]` if present

### Current layout (to replace)

The current `portfolio/page.tsx` renders a single-column `space-y-8` stack:
1. Hero div (title + total value + XIRR inline + RefreshPrices)
2. Allocation section
3. Rebalancing suggestions
4. By Platform grid

This entire layout structure will be replaced with the three-row grid described above.
Only `portfolio/page.tsx` changes — no backend, no new API calls.
