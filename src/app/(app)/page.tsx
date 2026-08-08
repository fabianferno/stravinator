import { LandingScreen } from "@/components/screens/LandingScreen";
import { landingMock } from "@/components/screens/mocks/landing.mock";

export default function LandingPage() {
  return <LandingScreen {...landingMock} />;
}
