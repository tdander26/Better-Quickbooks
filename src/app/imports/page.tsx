// Import History — an audit log of every import run (SimpleFIN refresh or CSV
// upload). A Server Component: it lists ImportBatch rows newest-first with a
// counts summary up top. Read-only.
import { formatDistanceToNow, format } from "date-fns";
import { FileUp, RefreshCw } from "lucide-react";
import { prisma } from "@/lib/db";
import { getBusinessContext } from "@/lib/session";
import { PageHeader, Card, StatTile, Badge, EmptyState } from "@/components/ui";

// Reflects live import history; never statically cache.
export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const ctx = await getBusinessContext();
  const batches = await prisma.importBatch.findMany({
    where: { businessId: ctx.businessId },
    orderBy: { startedAt: "desc" },
  });

  const totalImports = batches.length;
  const totalImported = batches.reduce((sum, b) => sum + b.imported, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Import History"
        subtitle="Every bank refresh and CSV upload, newest first."
      />

      {batches.length === 0 ? (
        <EmptyState
          title="No imports yet"
          hint="No imports yet — connect a bank in Settings to start pulling in transactions."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Total imports" value={totalImports} sub="Import runs" />
            <StatTile
              label="Transactions imported"
              value={totalImported.toLocaleString()}
              tone="green"
              sub="Across all runs"
            />
          </div>

          <div className="space-y-2">
            {batches.map((b) => {
              const isSimplefin = b.source === "simplefin";
              const Icon = isSimplefin ? RefreshCw : FileUp;
              return (
                <Card
                  key={b.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-black/5 dark:bg-white/10">
                      <Icon size={16} className="muted" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={isSimplefin ? "blue" : "neutral"}>
                          {isSimplefin ? "SimpleFIN" : "CSV"}
                        </Badge>
                        <span className="muted text-xs" title={format(b.startedAt, "PPpp")}>
                          {formatDistanceToNow(b.startedAt, { addSuffix: true })}
                        </span>
                      </div>
                      {b.note && <div className="muted mt-1 truncate text-sm">{b.note}</div>}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4 text-sm tabular-nums">
                    <div className="text-right">
                      <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                        +{b.imported.toLocaleString()}
                      </div>
                      <div className="muted text-xs">imported</div>
                    </div>
                    <div className="text-right">
                      <div className="muted font-semibold">{b.skipped.toLocaleString()}</div>
                      <div className="muted text-xs">skipped</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
