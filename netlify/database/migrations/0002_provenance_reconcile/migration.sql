-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "categorizedBy" TEXT,
ADD COLUMN     "clearedStatus" TEXT NOT NULL DEFAULT 'uncleared',
ADD COLUMN     "reconciledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Split" ADD COLUMN     "matchedRuleId" TEXT;

-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "lastMatchedAt" TIMESTAMP(3),
ADD COLUMN     "matchCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Transaction_accountId_amountCents_postedAt_idx" ON "Transaction"("accountId", "amountCents", "postedAt");

