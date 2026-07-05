// Categorize Cockpit ("/categorize") — the app's daily job-to-be-done.
// A three-pane cockpit (nav+accounts / categorize workspace / attention+activity)
// built to the design handoff. This Server Component assembles real data and
// hands it to the interactive client cockpit.
import { getCockpitData } from "@/lib/cockpit";
import { Cockpit } from "./_cockpit";

export const dynamic = "force-dynamic";

export default async function CategorizePage() {
  const data = await getCockpitData();
  return <Cockpit data={data} />;
}
