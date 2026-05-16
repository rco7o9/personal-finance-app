import { apiGet } from "@/lib/api";
import type { PendingTransaction } from "@/types";
import { StatementUploader } from "./StatementUploader";

export default async function StatementsPage({
  searchParams,
}: {
  searchParams: Promise<{ personId?: string }>;
}) {
  const { personId } = await searchParams;
  const pid = personId ? parseInt(personId, 10) : null;

  const pendingRows: PendingTransaction[] = pid
    ? await apiGet<PendingTransaction[]>(`/statements/pending?personId=${pid}`).catch(() => [])
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Statements</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Upload a monthly statement to parse and review transactions before confirming.
        </p>
      </div>
      <StatementUploader personId={pid} initialPendingRows={pendingRows} />
    </div>
  );
}
