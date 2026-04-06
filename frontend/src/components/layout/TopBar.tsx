import { PersonSelector } from "./PersonSelector"
import { Suspense } from "react"

// SERVER component — no interactivity here, just layout.
// PersonSelector is a client component inside it — that's fine.
// A server component CAN render client components as children.
// The rule is: client components CANNOT render server components inside them.
export function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <div className="text-sm text-muted-foreground">Personal Finance</div>
      {/* Suspense is required when a client component uses useSearchParams()
          during SSR — Next.js needs a boundary to stream in the interactive part */}
      <Suspense fallback={<div className="w-36 h-9 rounded-md bg-muted animate-pulse" />}>
        <PersonSelector />
      </Suspense>
    </header>
  )
}
