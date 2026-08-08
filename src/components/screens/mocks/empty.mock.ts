import type { EmptyActivitiesScreenProps } from "../EmptyActivitiesScreen";

/** STATIC MOCK — an athlete who has never recorded anything on Strava. */
export const noActivitiesMock: EmptyActivitiesScreenProps = {
  totalActivities: 0,
  ineligibleCounts: {},
};

/**
 * STATIC MOCK — the realistic case: a full list, none of it renderable.
 * Mostly treadmill runs, with a couple of warm-up laps that were too short.
 */
export const noEligibleActivitiesMock: EmptyActivitiesScreenProps = {
  totalActivities: 14,
  ineligibleCounts: { "no-gps": 11, "no-stream": 1, "too-short": 2 },
};

/** STATIC MOCK — every single activity was indoors, so the copy has no caveats. */
export const allIndoorMock: EmptyActivitiesScreenProps = {
  totalActivities: 14,
  ineligibleCounts: { "no-gps": 14 },
};
