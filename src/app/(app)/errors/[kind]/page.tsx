import { notFound } from "next/navigation";
import { ErrorScreen, FAILURE_COPY, type FailureKind } from "@/components/screens/ErrorScreen";

function isFailureKind(value: string): value is FailureKind {
  return value in FAILURE_COPY;
}

export default async function FailurePage({ params }: PageProps<"/errors/[kind]">) {
  const { kind } = await params;
  if (!isFailureKind(kind)) notFound();
  return <ErrorScreen kind={kind} activityName="Morning Run" />;
}
