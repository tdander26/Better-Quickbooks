// CLI entrypoint for local seeding: `npm run db:seed`. The actual logic lives in
// src/lib/seed.ts so it can be reused by the post-deploy /api/admin/seed route.
import { seedDemoData } from "@/lib/seed";
import { prisma } from "@/lib/db";

seedDemoData()
  .then((r) => {
    console.log(`Seeded: ${r.categories} categories, ${r.rules} rules, ${r.accounts} accounts, ${r.transactions} transactions.`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
