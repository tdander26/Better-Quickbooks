// Security tests for the password-free demo provider. The property that matters:
// the demo login can NEVER resolve to a real (SEED_USER_EMAIL) account, and is
// off entirely unless explicitly enabled. Runs against the local SQLite dev DB.
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createBusiness } from "@/lib/business";
import { authorizeDemo, DEMO_EMAIL } from "@/lib/demo-auth";

const OWNER_EMAIL = `owner-${Math.random().toString(36).slice(2, 8)}@real.example`;
let ownerId = "";

// Snapshot + restore the env vars the provider reads.
const savedDemo = process.env.NEXT_PUBLIC_DEMO_LOGIN;
const savedSeed = process.env.SEED_USER_EMAIL;

async function destroyUserAndBusinesses(userId: string) {
  const memberships = await prisma.membership.findMany({ where: { userId } });
  for (const m of memberships) {
    const businessId = m.businessId;
    await prisma.rule.deleteMany({ where: { businessId } });
    await prisma.category.deleteMany({ where: { businessId } });
    await prisma.membership.deleteMany({ where: { businessId } });
    await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
  }
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
}

beforeAll(async () => {
  // Stand in for the real owner: point SEED_USER_EMAIL at a genuine account that
  // owns a business — exactly the setup the old bug leaked into.
  const owner = await prisma.user.create({
    data: { email: OWNER_EMAIL, name: "Real Owner", passwordHash: await hashPassword("owner-pw-123") },
  });
  ownerId = owner.id;
  await createBusiness(owner.id, "Owner Books", "owner");
  process.env.SEED_USER_EMAIL = OWNER_EMAIL;
});

afterEach(async () => {
  // Remove any demo user the test created, so each case starts clean.
  const demo = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (demo) await destroyUserAndBusinesses(demo.id);
});

afterAll(async () => {
  await destroyUserAndBusinesses(ownerId);
  if (savedDemo === undefined) delete process.env.NEXT_PUBLIC_DEMO_LOGIN;
  else process.env.NEXT_PUBLIC_DEMO_LOGIN = savedDemo;
  if (savedSeed === undefined) delete process.env.SEED_USER_EMAIL;
  else process.env.SEED_USER_EMAIL = savedSeed;
  await prisma.$disconnect();
});

describe("demo login security", () => {
  it("returns null when demo login is disabled", async () => {
    delete process.env.NEXT_PUBLIC_DEMO_LOGIN;
    expect(await authorizeDemo()).toBeNull();

    process.env.NEXT_PUBLIC_DEMO_LOGIN = "0";
    expect(await authorizeDemo()).toBeNull();
  });

  it("never resolves to the real (SEED_USER_EMAIL) account, even when enabled", async () => {
    process.env.NEXT_PUBLIC_DEMO_LOGIN = "1";
    const session = await authorizeDemo();

    expect(session).not.toBeNull();
    expect(session!.email).toBe(DEMO_EMAIL);
    // The bug this guards against: returning the owner's account.
    expect(session!.email).not.toBe(OWNER_EMAIL);
    expect(session!.id).not.toBe(ownerId);
  });

  it("signs into an isolated Demo Business, not the owner's books", async () => {
    process.env.NEXT_PUBLIC_DEMO_LOGIN = "1";
    const session = await authorizeDemo();

    const memberships = await prisma.membership.findMany({
      where: { userId: session!.id },
      include: { business: true },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].business.name).toBe("Demo Business");

    // Owner's business is untouched and unshared.
    const ownerMemberships = await prisma.membership.findMany({ where: { userId: ownerId } });
    expect(ownerMemberships).toHaveLength(1);
    expect(ownerMemberships[0].businessId).not.toBe(memberships[0].businessId);
  });
});
