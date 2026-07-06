// Business chooser. Shown when a signed-in user has no active business (or lands
// here from the switcher). Authenticates directly — must NOT call
// getBusinessContext (that would redirect back here and loop).
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Wallet } from "lucide-react";
import { auth } from "@/auth";
import { listUserBusinesses } from "@/lib/business";
import { BusinessPicker } from "./_client";

export const dynamic = "force-dynamic";

export default async function SelectBusinessPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const businesses = await listUserBusinesses(session.user.id);

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-b from-brand-400 to-brand-600 text-white">
            <Wallet size={26} />
          </div>
          <div>
            <h1 className="text-lg font-semibold">
              {businesses.length ? "Choose a business" : "Create your first business"}
            </h1>
            <p className="muted text-sm">
              {businesses.length
                ? "Pick which set of books to open."
                : "Each business keeps its own accounts, transactions, and reports."}
            </p>
          </div>
        </div>

        {businesses.length > 0 && <BusinessPicker businesses={businesses} />}

        <Link
          href="/business/new"
          className="btn-primary mt-4 w-full justify-center"
        >
          <Plus size={16} />
          New business
        </Link>
      </div>
    </div>
  );
}
