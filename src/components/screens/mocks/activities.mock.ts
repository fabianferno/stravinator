import type { ActivitySummary } from "@/lib/types";

/** STATIC MOCK — replace with the Strava activity list. */
export const activitiesMock: ActivitySummary[] = [
  {
    id: "10000001",
    name: "Morning Run",
    startDate: "2026-08-02T07:12:00Z",
    distance: 14200,
    movingTime: 4148,
    elevationGain: 312,
    sportType: "Run",
    ineligible: null,
  },
  {
    id: "10000002",
    name: "Sunday Long Run",
    startDate: "2026-07-27T08:04:00Z",
    distance: 26800,
    movingTime: 8442,
    elevationGain: 684,
    sportType: "Run",
    ineligible: null,
  },
  {
    id: "10000003",
    name: "Evening Shakeout",
    startDate: "2026-07-24T18:40:00Z",
    distance: 6100,
    movingTime: 1952,
    elevationGain: 48,
    sportType: "Run",
    ineligible: null,
  },
  {
    id: "10000004",
    name: "Trail Recce",
    startDate: "2026-07-22T06:30:00Z",
    distance: 11400,
    movingTime: 4104,
    elevationGain: 505,
    sportType: "TrailRun",
    ineligible: null,
  },
  {
    id: "10000005",
    name: "Treadmill Intervals",
    startDate: "2026-07-23T19:05:00Z",
    distance: 8000,
    movingTime: 2400,
    elevationGain: 0,
    sportType: "Run",
    ineligible: "no-stream",
  },
  {
    id: "10000006",
    name: "Warm-up Loop",
    startDate: "2026-07-21T17:15:00Z",
    distance: 700,
    movingTime: 240,
    elevationGain: 4,
    sportType: "Run",
    ineligible: "too-short",
  },
  {
    id: "10000007",
    name: "Gym Session",
    startDate: "2026-07-20T12:00:00Z",
    distance: 0,
    movingTime: 3600,
    elevationGain: 0,
    sportType: "Workout",
    ineligible: "no-gps",
  },
];

export function findMockActivity(id: string): ActivitySummary | undefined {
  return activitiesMock.find((a) => a.id === id);
}
