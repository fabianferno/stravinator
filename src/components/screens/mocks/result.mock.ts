import type { ActivityStats } from "@/lib/types";

/** STATIC MOCK — replace with the finished job's stats and signed video URL. */
export const resultStatsMock: ActivityStats = {
  name: "Morning Run",
  date: "2026-08-02T07:12:00Z",
  distance: 14200,
  paceSecPerKm: 292,
  elevationGain: 312,
  movingTime: 4148,
};

/** null until the encoder has uploaded the file. */
export const resultVideoUrlMock: string | null = null;
export const resultShareHrefMock = "/f/mock-share-id";
export const resultRenderSecondsMock = 112;
