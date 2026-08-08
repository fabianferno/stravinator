import { notFound, redirect } from "next/navigation";
import { RenderingScreen } from "@/components/screens/RenderingScreen";
import { ErrorScreen } from "@/components/screens/ErrorScreen";
import { JobPoller } from "@/components/JobPoller";
import { getAthleteId } from "@/lib/session";
import { getJob } from "@/lib/jobs";

export const metadata = { title: "Flying your route — Stravinator" };
export const dynamic = "force-dynamic";

export default async function RenderingPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;

  const athleteId = await getAthleteId();
  if (!athleteId) redirect("/errors/session-expired");

  const job = await getJob(jobId);
  // Missing and not-yours look identical so a job id cannot be probed.
  if (!job || job.athleteId !== athleteId) notFound();

  if (job.status === "done") redirect(`/jobs/${jobId}/result`);

  if (job.status === "failed") {
    return (
      <ErrorScreen
        kind="render-failed"
        detail={job.error ?? undefined}
        action={{ label: "Try another run", href: "/activities" }}
        backHref="/activities"
      />
    );
  }

  return (
    <>
      <JobPoller jobId={jobId} status={job.status} />
      <RenderingScreen
        job={{
          status: job.status,
          progress: job.progress,
          framesDone: job.framesDone,
          frameCount: job.frameCount,
        }}
        backHref="/activities"
      />
    </>
  );
}
