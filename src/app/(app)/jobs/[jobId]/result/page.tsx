import { notFound, redirect } from "next/navigation";
import { ResultScreen } from "@/components/screens/ResultScreen";
import { getAthleteId } from "@/lib/session";
import { getJob } from "@/lib/jobs";
import type { ActivityStats } from "@/lib/types";

export const metadata = { title: "That's your run — Stravinator" };
export const dynamic = "force-dynamic";

export default async function ResultPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;

  const athleteId = await getAthleteId();
  if (!athleteId) redirect("/errors/session-expired");

  const job = await getJob(jobId);
  if (!job || job.athleteId !== athleteId) notFound();

  // Still working — send them back to watch it finish rather than showing an
  // empty player.
  if (job.status !== "done") redirect(`/jobs/${jobId}`);

  const stats = (job as unknown as { stats: ActivityStats }).stats;

  return (
    <ResultScreen
      stats={stats}
      videoUrl={job.videoUrl}
      downloadHref={`/api/jobs/${jobId}/video`}
      makeAnotherHref="/activities"
      backHref="/activities"
    />
  );
}
