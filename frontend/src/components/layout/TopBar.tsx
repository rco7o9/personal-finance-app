import { PersonSelector } from "./PersonSelector";
import { Suspense } from "react";

// SERVER component — no interactivity here, just layout.
// PersonSelector is a client component inside it — that's fine.
// A server component CAN render client components as children.
// The rule is: client components CANNOT render server components inside them.
export function TopBar() {
  return (
    <header className="bg-background flex h-14 items-center justify-between border-b px-6">
      <div className="text-muted-foreground text-sm">Personal Finance</div>
      {/* Suspense is required when a client component uses useSearchParams()
          during SSR — Next.js needs a boundary to stream in the interactive part */}
      <Suspense fallback={<div className="bg-muted h-9 w-36 animate-pulse rounded-md" />}>
        <PersonSelector />
      </Suspense>
    </header>
  );
}
