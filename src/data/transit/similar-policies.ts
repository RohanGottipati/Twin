/**
 * Synthetic past-intervention records for the find_similar_interventions
 * tool (docs/techto-implementation.md section 13.6). These are illustrative
 * precedents written for this demo, not a record of real TTC service
 * changes or a public consultation archive; see AGENTS.md section 2 on
 * never presenting simulated content as real Toronto history.
 */

export interface SimilarInterventionRecord {
  id: string;
  title: string;
  interventionType: string;
  tags: string[];
  summary: string;
  outcome: string;
  dateLabel: string;
  dataMode: "synthetic-fixture";
}

export const SIMILAR_INTERVENTIONS: SimilarInterventionRecord[] = [
  {
    id: "line-1-peak-headway-adjustment",
    title: "Line 1 peak departure retiming",
    interventionType: "shift_departure_minutes",
    tags: ["subway", "peak", "load-imbalance", "union"],
    summary:
      "Two consecutive peak-hour Line 1 departures were shifted by 2 and 3 minutes respectively to better match " +
      "an observed pre-departure arrival surge at a downtown station.",
    outcome:
      "Denied boardings on the earlier departure fell by roughly a third, and the load imbalance between the two " +
      "departures narrowed; no measurable change in missed transfers.",
    dateLabel: "2019 spring pilot",
    dataMode: "synthetic-fixture",
  },
  {
    id: "streetcar-501-retime",
    title: "501 Queen streetcar retiming near a subway interchange",
    interventionType: "retime_feeder",
    tags: ["streetcar", "transfer", "queen-street"],
    summary:
      "A 501 Queen streetcar was retimed by 2 minutes to tighten its connection window with a Line 1 southbound " +
      "departure at the same interchange.",
    outcome:
      "Estimated missed transfers dropped, but the retiming introduced a brief bunching risk with the following " +
      "streetcar; a following pilot added a short hold at the prior stop to absorb it.",
    dateLabel: "2021 corridor review",
    dataMode: "synthetic-fixture",
  },
  {
    id: "concert-event-supplemental-service",
    title: "Post-event supplemental subway trip",
    interventionType: "add_trip",
    tags: ["event", "concert", "supplemental-service", "union"],
    summary:
      "A single supplemental Line 1 trip was added immediately after a large downtown event to absorb the " +
      "post-event crowd surge before it reached the regular scheduled departure.",
    outcome:
      "Platform crowding at the event-adjacent station dropped sharply and no accessibility failures were " +
      "recorded; the added trip's operating cost was judged acceptable given the crowding it avoided.",
    dateLabel: "2018 event season",
    dataMode: "synthetic-fixture",
  },
  {
    id: "accessibility-elevator-closure-mitigation",
    title: "Entrance closure accessibility mitigation",
    interventionType: "entrance_closure",
    tags: ["accessibility", "entrance-closure", "elevator"],
    summary:
      "A planned entrance closure for maintenance was paired with temporary signage and staff assistance at the " +
      "remaining accessible entrance, rather than being deployed without mitigation.",
    outcome:
      "Accessibility failures were held near zero despite the closure; without the mitigation, an earlier " +
      "unplanned closure at the same station had produced multiple recorded accessibility barriers.",
    dateLabel: "2022 maintenance window",
    dataMode: "synthetic-fixture",
  },
  {
    id: "snow-day-service-reduction",
    title: "Snow-day capacity and headway reduction",
    interventionType: "capacity_boost",
    tags: ["weather", "snow", "reliability"],
    summary:
      "During a heavy snow event, a surface route added capacity on remaining trips rather than compensating with " +
      "shorter headways, to keep vehicles within a safe operating speed on snow-covered track.",
    outcome:
      "Mean wait time rose modestly, but the reliability and missed-transfer metrics stayed within the pre-storm " +
      "range, judged an acceptable trade-off given the weather constraint.",
    dateLabel: "2020 winter service review",
    dataMode: "synthetic-fixture",
  },
];

export function listSimilarInterventions(): SimilarInterventionRecord[] {
  return SIMILAR_INTERVENTIONS;
}

export function getSimilarIntervention(id: string): SimilarInterventionRecord | undefined {
  return SIMILAR_INTERVENTIONS.find((record) => record.id === id);
}

export function findSimilarInterventions(query: {
  interventionType?: string;
  tags?: string[];
  limit?: number;
}): SimilarInterventionRecord[] {
  const limit = query.limit ?? 3;
  const tagSet = new Set((query.tags ?? []).map((tag) => tag.toLowerCase()));

  const scored = SIMILAR_INTERVENTIONS.map((record) => {
    let score = 0;
    if (query.interventionType && record.interventionType === query.interventionType) {
      score += 2;
    }
    for (const tag of record.tags) {
      if (tagSet.has(tag.toLowerCase())) {
        score += 1;
      }
    }
    return { record, score };
  });

  const matched = scored.filter((entry) => entry.score > 0);
  const pool = matched.length > 0 ? matched : scored;

  return pool
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.record);
}
