import { notFound, redirect } from "next/navigation";
import { ResultScreen } from "@/components/screens/ResultScreen";
import { getAthleteId } from "@/lib/session";
import { getJob, getJobArtifacts } from "@/lib/jobs";

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

  // A `done` job always has artifacts; if it somehow doesn't, the video is
  // unlabellable and there is nothing honest to show.
  const artifacts = await getJobArtifacts(jobId);
  if (!artifacts?.stats) notFound();

  return (
    <ResultScreen
      stats={artifacts.stats}
      videoUrl={job.videoUrl}
      downloadHref={`/api/jobs/${jobId}/video`}
      makeAnotherHref="/activities"
      backHref="/activities"
    />
  );
}
