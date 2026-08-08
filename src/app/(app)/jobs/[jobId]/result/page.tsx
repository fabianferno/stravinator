import { ResultScreen } from "@/components/screens/ResultScreen";
import {
  resultRenderSecondsMock,
  resultShareHrefMock,
  resultStatsMock,
  resultVideoUrlMock,
} from "@/components/screens/mocks/result.mock";

export const metadata = { title: "That's your run — Stravinator" };

export default function ResultPage() {
  return (
    <ResultScreen
      stats={resultStatsMock}
      videoUrl={resultVideoUrlMock}
      shareHref={resultShareHrefMock}
      renderSeconds={resultRenderSecondsMock}
      makeAnotherHref="/activities"
      backHref="/activities"
    />
  );
}
