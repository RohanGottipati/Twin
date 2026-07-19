/**
 * Synthetic census-weighted demographic cohorts for the TechTO transit
 * domain layer (see AGENTS.md section 4.3 and docs/techto-implementation.md
 * section 9.1: cohorts represent statistically similar riders, never
 * individual identified residents, and weights are illustrative, not a
 * Statistics Canada extract).
 *
 * `weight` is a percentage of the modeled downtown ridership population and
 * sums to 100 across all cohorts. Sensitivity fields are 0 to 1, higher
 * means more sensitive to that dimension; they are hand-picked priors for
 * this demo, not a fitted behavioral model (AGENTS.md section 2).
 */

export interface CohortSensitivity {
  waitSensitivity: number;
  crowdingSensitivity: number;
  priceSensitivity: number;
  accessibilitySensitivity: number;
}

export interface CohortModeShare {
  transit: number;
  car: number;
  walk: number;
  cycle: number;
}

export interface TransitCohortFixture {
  id: string;
  label: string;
  weight: number;
  /** Raw count of source records this cohort was aggregated from, when known (resident-persona-aggregate only). */
  personaCount?: number;
  homeZoneId: string;
  primaryDestinationZoneId: string;
  ageBand: string;
  incomeBand: "low" | "middle" | "high";
  /** Not present in resident-persona-aggregate cohorts: occupation isn't in the ingested census fields. */
  occupationGroup?: string;
  /** Not present in resident-persona-aggregate cohorts: work schedule isn't in the ingested census fields. */
  workSchedule?: "standard" | "shift" | "night" | "flexible" | "student" | "none";
  vehicleAccessProbability: number;
  transitPassProbability: number;
  /** Not present in resident-persona-aggregate cohorts: schedule flexibility isn't in the ingested census fields. */
  scheduleFlexibility?: number;
  mobilityNeeds: string[];
  sensitivity: CohortSensitivity;
  baselineModeShare: CohortModeShare;
  dataMode: "synthetic-fixture" | "resident-persona-aggregate";
}

export const TRANSIT_COHORTS: TransitCohortFixture[] = [
  {
    id: "downtown-commuters",
    label: "Downtown 9-to-5 commuters",
    weight: 28,
    homeZoneId: "zone-liberty-village",
    primaryDestinationZoneId: "zone-financial-district",
    ageBand: "25-44",
    incomeBand: "middle",
    occupationGroup: "professional-services",
    workSchedule: "standard",
    vehicleAccessProbability: 0.55,
    transitPassProbability: 0.82,
    scheduleFlexibility: 0.2,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.5,
      crowdingSensitivity: 0.45,
      priceSensitivity: 0.3,
      accessibilitySensitivity: 0.15,
    },
    baselineModeShare: { transit: 0.62, car: 0.26, walk: 0.08, cycle: 0.04 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "university-students",
    label: "University and college students",
    weight: 16,
    homeZoneId: "zone-annex",
    primaryDestinationZoneId: "zone-st-george-campus",
    ageBand: "18-24",
    incomeBand: "low",
    occupationGroup: "student",
    workSchedule: "student",
    vehicleAccessProbability: 0.2,
    transitPassProbability: 0.88,
    scheduleFlexibility: 0.35,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.6,
      crowdingSensitivity: 0.4,
      priceSensitivity: 0.7,
      accessibilitySensitivity: 0.15,
    },
    baselineModeShare: { transit: 0.71, car: 0.06, walk: 0.15, cycle: 0.08 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "shift-workers",
    label: "Retail and hospitality shift workers",
    weight: 10,
    homeZoneId: "zone-parkdale",
    primaryDestinationZoneId: "zone-entertainment-district",
    ageBand: "25-54",
    incomeBand: "low",
    occupationGroup: "retail-hospitality",
    workSchedule: "shift",
    vehicleAccessProbability: 0.3,
    transitPassProbability: 0.75,
    scheduleFlexibility: 0.1,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.55,
      crowdingSensitivity: 0.35,
      priceSensitivity: 0.6,
      accessibilitySensitivity: 0.2,
    },
    baselineModeShare: { transit: 0.68, car: 0.18, walk: 0.1, cycle: 0.04 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "seniors",
    label: "Seniors traveling off-peak and peak",
    weight: 8,
    homeZoneId: "zone-st-lawrence",
    primaryDestinationZoneId: "zone-financial-district",
    ageBand: "65+",
    incomeBand: "middle",
    occupationGroup: "retired",
    workSchedule: "none",
    vehicleAccessProbability: 0.35,
    transitPassProbability: 0.9,
    scheduleFlexibility: 0.6,
    mobilityNeeds: ["reduced-mobility"],
    sensitivity: {
      waitSensitivity: 0.5,
      crowdingSensitivity: 0.65,
      priceSensitivity: 0.25,
      accessibilitySensitivity: 0.8,
    },
    baselineModeShare: { transit: 0.55, car: 0.3, walk: 0.14, cycle: 0.01 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "accessibility-users",
    label: "Wheelchair and mobility-device users",
    weight: 4,
    homeZoneId: "zone-regent-park",
    primaryDestinationZoneId: "zone-financial-district",
    ageBand: "25-64",
    incomeBand: "low",
    occupationGroup: "mixed",
    workSchedule: "flexible",
    vehicleAccessProbability: 0.25,
    transitPassProbability: 0.85,
    scheduleFlexibility: 0.3,
    mobilityNeeds: ["wheelchair", "step-free-access"],
    sensitivity: {
      waitSensitivity: 0.45,
      crowdingSensitivity: 0.75,
      priceSensitivity: 0.4,
      accessibilitySensitivity: 0.95,
    },
    baselineModeShare: { transit: 0.5, car: 0.35, walk: 0.15, cycle: 0.0 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "tourists",
    label: "Visitors and tourists",
    weight: 6,
    homeZoneId: "zone-external",
    primaryDestinationZoneId: "zone-entertainment-district",
    ageBand: "25-64",
    incomeBand: "middle",
    occupationGroup: "visitor",
    workSchedule: "none",
    vehicleAccessProbability: 0.1,
    transitPassProbability: 0.3,
    scheduleFlexibility: 0.85,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.3,
      crowdingSensitivity: 0.55,
      priceSensitivity: 0.45,
      accessibilitySensitivity: 0.25,
    },
    baselineModeShare: { transit: 0.45, car: 0.2, walk: 0.3, cycle: 0.05 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "parents-with-strollers",
    label: "Parents traveling with strollers",
    weight: 5,
    homeZoneId: "zone-riverdale",
    primaryDestinationZoneId: "zone-financial-district",
    ageBand: "25-44",
    incomeBand: "middle",
    occupationGroup: "mixed",
    workSchedule: "flexible",
    vehicleAccessProbability: 0.5,
    transitPassProbability: 0.6,
    scheduleFlexibility: 0.5,
    mobilityNeeds: ["stroller-access"],
    sensitivity: {
      waitSensitivity: 0.55,
      crowdingSensitivity: 0.7,
      priceSensitivity: 0.35,
      accessibilitySensitivity: 0.75,
    },
    baselineModeShare: { transit: 0.48, car: 0.4, walk: 0.1, cycle: 0.02 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "night-workers",
    label: "Overnight and late-shift workers",
    weight: 5,
    homeZoneId: "zone-scarborough-junction",
    primaryDestinationZoneId: "zone-hospital-district",
    ageBand: "25-54",
    incomeBand: "low",
    occupationGroup: "healthcare-support",
    workSchedule: "night",
    vehicleAccessProbability: 0.4,
    transitPassProbability: 0.7,
    scheduleFlexibility: 0.05,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.65,
      crowdingSensitivity: 0.25,
      priceSensitivity: 0.4,
      accessibilitySensitivity: 0.2,
    },
    baselineModeShare: { transit: 0.58, car: 0.35, walk: 0.05, cycle: 0.02 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "gig-delivery-workers",
    label: "Gig and delivery workers",
    weight: 6,
    homeZoneId: "zone-thorncliffe",
    primaryDestinationZoneId: "zone-entertainment-district",
    ageBand: "18-44",
    incomeBand: "low",
    occupationGroup: "gig-economy",
    workSchedule: "flexible",
    vehicleAccessProbability: 0.45,
    transitPassProbability: 0.55,
    scheduleFlexibility: 0.7,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.3,
      crowdingSensitivity: 0.3,
      priceSensitivity: 0.75,
      accessibilitySensitivity: 0.15,
    },
    baselineModeShare: { transit: 0.4, car: 0.3, walk: 0.15, cycle: 0.15 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "event-attendees",
    label: "Concert and event attendees",
    weight: 4,
    homeZoneId: "zone-mixed-gta",
    primaryDestinationZoneId: "zone-entertainment-district",
    ageBand: "18-44",
    incomeBand: "middle",
    occupationGroup: "mixed",
    workSchedule: "none",
    vehicleAccessProbability: 0.5,
    transitPassProbability: 0.4,
    scheduleFlexibility: 0.9,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.4,
      crowdingSensitivity: 0.75,
      priceSensitivity: 0.3,
      accessibilitySensitivity: 0.2,
    },
    baselineModeShare: { transit: 0.5, car: 0.35, walk: 0.1, cycle: 0.05 },
    dataMode: "synthetic-fixture",
  },
  {
    id: "low-income-transit-dependent",
    label: "Low-income transit-dependent riders",
    weight: 8,
    homeZoneId: "zone-weston-mount-dennis",
    primaryDestinationZoneId: "zone-financial-district",
    ageBand: "18-64",
    incomeBand: "low",
    occupationGroup: "mixed",
    workSchedule: "standard",
    vehicleAccessProbability: 0.08,
    transitPassProbability: 0.95,
    scheduleFlexibility: 0.1,
    mobilityNeeds: [],
    sensitivity: {
      waitSensitivity: 0.7,
      crowdingSensitivity: 0.5,
      priceSensitivity: 0.85,
      accessibilitySensitivity: 0.3,
    },
    baselineModeShare: { transit: 0.8, car: 0.03, walk: 0.15, cycle: 0.02 },
    dataMode: "synthetic-fixture",
  },
];

export function listCohorts(): TransitCohortFixture[] {
  return TRANSIT_COHORTS;
}

export function getCohort(cohortId: string): TransitCohortFixture | undefined {
  return TRANSIT_COHORTS.find((cohort) => cohort.id === cohortId);
}

export function requireCohort(cohortId: string): TransitCohortFixture {
  const cohort = getCohort(cohortId);
  if (!cohort) {
    throw new Error(`Unknown transit cohort id: "${cohortId}"`);
  }
  return cohort;
}

export function totalCohortWeight(): number {
  return TRANSIT_COHORTS.reduce((sum, cohort) => sum + cohort.weight, 0);
}

/**
 * Cohorts most exposed to service degradation: mobility-device users,
 * low-income transit-dependent riders with no car alternative, and seniors.
 * Used by the equity-gap metric (lib/transit/metrics.ts) as the vulnerable
 * comparison group against the full population. Pure over any cohort list
 * so repository-fed (Mongo/resident-persona-aggregate) cohorts can reuse the
 * same filter as the static fixture.
 */
export function deriveVulnerableCohorts(cohorts: TransitCohortFixture[]): TransitCohortFixture[] {
  return cohorts.filter(
    (cohort) =>
      cohort.mobilityNeeds.length > 0 ||
      cohort.sensitivity.accessibilitySensitivity >= 0.7 ||
      cohort.incomeBand === "low",
  );
}

export function vulnerableCohorts(): TransitCohortFixture[] {
  return deriveVulnerableCohorts(TRANSIT_COHORTS);
}

export function accessibilitySensitiveCohorts(): TransitCohortFixture[] {
  return TRANSIT_COHORTS.filter(
    (cohort) => cohort.mobilityNeeds.length > 0 || cohort.sensitivity.accessibilitySensitivity >= 0.7,
  );
}
