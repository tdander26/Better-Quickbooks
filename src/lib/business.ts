// Business (tenant) creation + listing helpers.
import { prisma } from "@/lib/db";
import { seedBusinessDefaults } from "@/lib/seed";
import type { Role } from "@/lib/session";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "business"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await prisma.business.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${base}-${n}`;
  }
  return slug;
}

/**
 * Create a Business, make `userId` its member with `role`, and seed its default
 * chart of accounts + rules. Returns the created business.
 */
export async function createBusiness(userId: string, name: string, role: Role = "owner") {
  const clean = name.trim() || "My Business";
  const business = await prisma.business.create({
    data: { name: clean, slug: await uniqueSlug(slugify(clean)) },
  });
  await prisma.membership.create({ data: { userId, businessId: business.id, role } });
  await seedBusinessDefaults(business.id);
  return business;
}

/** All businesses the user belongs to, with their role, oldest first. */
export async function listUserBusinesses(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { business: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.business.id,
    name: m.business.name,
    slug: m.business.slug,
    role: m.role as Role,
  }));
}
