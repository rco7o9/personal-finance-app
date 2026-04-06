export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>
}) {
  const { personId } = await searchParams

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Investments</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Viewing as person ID: {personId ?? "none selected"}
      </p>
    </div>
  )
}
