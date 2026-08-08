import { redirect } from "next/navigation";
import { LandingScreen } from "@/components/screens/LandingScreen";
import { getAthleteId } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  // An athlete who is already connected has no use for the invite gate.
  if (await getAthleteId()) redirect("/activities");

  return (
    <LandingScreen
      lastFlyover={null}
      runsFlown={0}
      elevationClimbed={0}
      connectHref="/api/auth/strava/start"
    />
  );
}
