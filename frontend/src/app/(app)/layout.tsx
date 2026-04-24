import { Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

// This layout wraps all pages inside the (app) route group.
// It's a SERVER component — it renders the shell (sidebar + topbar) on the server,
// and slots {children} (the actual page content) into the main area.
//
// The (app) folder name with parentheses is a Next.js "route group":
// - It shares this layout across all pages inside it
// - The folder name does NOT appear in the URL (/dashboard, not /(app)/dashboard)
//
// Pages hierarchy:
//   RootLayout (app/layout.tsx)         ← html, body, fonts
//     AppLayout  (app/(app)/layout.tsx) ← sidebar shell  ← YOU ARE HERE
//       DashboardPage, InvestmentsPage, etc.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      {/* Sidebar uses useSearchParams() — must be inside Suspense for static prerender */}
      <Suspense fallback={<div className="w-56 border-r" />}>
        <Sidebar />
      </Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
