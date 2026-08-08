import { RenderingScreen } from "@/components/screens/RenderingScreen";
import {
  jobActivityNameMock,
  jobMock,
  jobPointCountMock,
  jobStageSecondsMock,
} from "@/components/screens/mocks/job.mock";

export const metadata = { title: "Flying your route — Stravinator" };

export default async function RenderingPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;

  return (
    <RenderingScreen
      job={jobMock}
      activityName={jobActivityNameMock}
      stageSeconds={jobStageSecondsMock}
      pointCount={jobPointCountMock}
      cancelHref={`/api/jobs/${jobId}/cancel`}
      backHref="/activities"
    />
  );
}
