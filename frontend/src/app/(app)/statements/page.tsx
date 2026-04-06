export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>;
}) {
  const { personId } = await searchParams;

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-tight">Statements</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Viewing as person ID: {personId ?? "none selected"}
      </p>
    </div>
  );
}
