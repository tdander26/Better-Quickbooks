-- Multi-tenant migration (Milestones A/B/C), applied AFTER 0001_init,
-- 0002_provenance_reconcile, and 0003_budgets_attachments_statements.
--
-- Adds Auth.js tables (User/auth_accounts/auth_sessions/auth_verification_tokens),
-- tenancy tables (Business/Membership/Invite), and a businessId foreign key on
-- every financial table (10 of them, including Attachment/Budget/Statement). The
-- financial "Account" table keeps its physical name (Prisma model renamed to
-- FinancialAccount via @@map); the NextAuth account table is "auth_accounts".
--
-- ORDER: create new tables -> add nullable businessId -> BACKFILL existing rows
-- into one default Business (only when financial data already exists) -> set
-- NOT NULL -> swap single-column uniques for per-business composites -> indexes/FKs.
--
-- ⚠️  BACKFILL LOGIN: existing data is assigned to a default owner
--     (doc@drtoddanderson.com) with a TEMPORARY password "ChangeMe-BetterBooks-2026".
--     Sign in and change it immediately after deploying.

-- ============================================================================
-- 1) New tables
-- ============================================================================
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'trialing',
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- New-table indexes
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "auth_accounts_provider_providerAccountId_key" ON "auth_accounts"("provider", "providerAccountId");
CREATE UNIQUE INDEX "auth_sessions_sessionToken_key" ON "auth_sessions"("sessionToken");
CREATE UNIQUE INDEX "auth_verification_tokens_token_key" ON "auth_verification_tokens"("token");
CREATE UNIQUE INDEX "auth_verification_tokens_identifier_token_key" ON "auth_verification_tokens"("identifier", "token");
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");
CREATE UNIQUE INDEX "Business_stripeCustomerId_key" ON "Business"("stripeCustomerId");
CREATE UNIQUE INDEX "Business_stripeSubscriptionId_key" ON "Business"("stripeSubscriptionId");
CREATE INDEX "Membership_businessId_idx" ON "Membership"("businessId");
CREATE UNIQUE INDEX "Membership_userId_businessId_key" ON "Membership"("userId", "businessId");
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");
CREATE INDEX "Invite_businessId_idx" ON "Invite"("businessId");
CREATE INDEX "Invite_email_idx" ON "Invite"("email");

-- New-table foreign keys
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 2) Add businessId as NULLABLE to the 10 financial tables
-- ============================================================================
ALTER TABLE "Account" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Split" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Category" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Rule" ADD COLUMN "businessId" TEXT;
ALTER TABLE "FeedConnection" ADD COLUMN "businessId" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Budget" ADD COLUMN "businessId" TEXT;
ALTER TABLE "Statement" ADD COLUMN "businessId" TEXT;

-- ============================================================================
-- 3) Backfill existing (single-tenant) data into one default Business.
--    Runs ONLY if the "Account" table already has rows.
-- ============================================================================
INSERT INTO "User" ("id", "name", "email", "passwordHash", "createdAt", "updatedAt")
SELECT 'seed_user_default', 'Owner', 'doc@drtoddanderson.com',
       '$2b$10$OwKPk3nY1eLevy7iFXqQGOHJ3Pz1r4gvfOLdCgIKDXVHmfVb0XtFW',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Account")
  AND NOT EXISTS (SELECT 1 FROM "User");

INSERT INTO "Business" ("id", "name", "slug", "plan", "subscriptionStatus", "createdAt", "updatedAt")
SELECT 'seed_business_default', 'My Business', 'my-business', 'pro', 'active',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Account")
  AND NOT EXISTS (SELECT 1 FROM "Business");

INSERT INTO "Membership" ("id", "userId", "businessId", "role", "createdAt")
SELECT 'seed_membership_default', 'seed_user_default', 'seed_business_default', 'owner', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Business" WHERE "id" = 'seed_business_default')
  AND NOT EXISTS (SELECT 1 FROM "Membership");

UPDATE "Account"        SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "Transaction"    SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "Split"          SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "Category"       SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "Rule"           SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "FeedConnection" SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "ImportBatch"    SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "Attachment"     SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "Budget"         SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;
UPDATE "Statement"      SET "businessId" = 'seed_business_default' WHERE "businessId" IS NULL;

-- ============================================================================
-- 4) Enforce NOT NULL
-- ============================================================================
ALTER TABLE "Account"        ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Transaction"    ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Split"          ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Category"       ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Rule"           ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "FeedConnection" ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "ImportBatch"    ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Attachment"     ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Budget"         ALTER COLUMN "businessId" SET NOT NULL;
ALTER TABLE "Statement"      ALTER COLUMN "businessId" SET NOT NULL;

-- ============================================================================
-- 5) Swap single-column uniques for per-business composites; add indexes
-- ============================================================================
DROP INDEX "Account_simplefinAccountId_key";
DROP INDEX "Transaction_providerTxnId_key";
DROP INDEX "Category_name_parentId_key";
DROP INDEX "Budget_categoryId_month_key";

CREATE INDEX "Account_businessId_idx" ON "Account"("businessId");
CREATE UNIQUE INDEX "Account_businessId_simplefinAccountId_key" ON "Account"("businessId", "simplefinAccountId");
CREATE INDEX "Transaction_businessId_postedAt_idx" ON "Transaction"("businessId", "postedAt");
CREATE UNIQUE INDEX "Transaction_businessId_providerTxnId_key" ON "Transaction"("businessId", "providerTxnId");
CREATE INDEX "Split_businessId_idx" ON "Split"("businessId");
CREATE INDEX "Category_businessId_idx" ON "Category"("businessId");
CREATE UNIQUE INDEX "Category_businessId_name_parentId_key" ON "Category"("businessId", "name", "parentId");
CREATE INDEX "Rule_businessId_idx" ON "Rule"("businessId");
CREATE INDEX "FeedConnection_businessId_idx" ON "FeedConnection"("businessId");
CREATE INDEX "ImportBatch_businessId_idx" ON "ImportBatch"("businessId");
CREATE INDEX "Attachment_businessId_idx" ON "Attachment"("businessId");
CREATE INDEX "Budget_businessId_idx" ON "Budget"("businessId");
CREATE UNIQUE INDEX "Budget_businessId_categoryId_month_key" ON "Budget"("businessId", "categoryId", "month");
CREATE INDEX "Statement_businessId_idx" ON "Statement"("businessId");

-- ============================================================================
-- 6) Foreign keys for the businessId columns
-- ============================================================================
ALTER TABLE "Account" ADD CONSTRAINT "Account_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Split" ADD CONSTRAINT "Split_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedConnection" ADD CONSTRAINT "FeedConnection_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Statement" ADD CONSTRAINT "Statement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
