import { Suspense } from "react";
import RenderScene from "./RenderScene";

/**
 * `/render` — the page the headless capture driver screenshots frame by frame.
 *
 * Not a user-facing screen and deliberately not indexable. Everything is client
 * side because the scene needs WebGL and the frame-stepping API has to hang off
 * `window`.
 */
export const metadata = {
  title: "Stravinator — render scene",
  robots: { index: false, follow: false },
};

export default function RenderPage() {
  return (
    <Suspense fallback={null}>
      <RenderScene />
    </Suspense>
  );
}
