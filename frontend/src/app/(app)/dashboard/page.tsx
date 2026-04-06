// SERVER component — async function, fetches data directly, no "use client"
// searchParams carries ?personId=X set by PersonSelector
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>
}) {
  const { personId } = await searchParams

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Viewing as person ID: {personId ?? "none selected"}
      </p>
    </div>
  )
}
