import { describe, expect, it } from "vitest";

import { selectChatAgentForTask } from "@/lib/backboard/place-chat";
import {
  placeFromBuildingFeature,
  placeFromNeighbourhoodArea,
  placeFromStation,
  nearestNeighbourhood,
} from "@/lib/techto/place-context";

describe("selectChatAgentForTask", () => {
  it("routes place-scoped questions to geospatial by default", () => {
    expect(
      selectChatAgentForTask({ intent: "SIMPLE_EXPLANATION", placeScoped: true }),
    ).toBe("geospatial-twin");
  });

  it("routes schedule questions near a place to geospatial-twin", () => {
    expect(
      selectChatAgentForTask({ intent: "SCHEDULE_CHANGE", placeScoped: true }),
    ).toBe("geospatial-twin");
  });

  it("keeps citywide chat on city-copilot for simple intents", () => {
    expect(
      selectChatAgentForTask({ intent: "SIMPLE_MAP_NAVIGATION", placeScoped: false }),
    ).toBe("city-copilot");
  });
});

describe("place-context", () => {
  it("builds a station place with nearest neighbourhood", () => {
    const place = placeFromStation("union");
    expect(place).not.toBeNull();
    expect(place?.kind).toBe("station");
    expect(place?.stationId).toBe("union");
    expect(place?.neighbourhoodId).toBeTruthy();
  });

  it("builds a building place from coordinates", () => {
    const place = placeFromBuildingFeature({
      featureId: 42,
      coordinates: [-79.3808, 43.639],
      properties: { name: "Waterfront Tower" },
    });
    expect(place.kind).toBe("building");
    expect(place.label).toBe("Waterfront Tower");
    expect(place.stationId).toBeTruthy();
    expect(nearestNeighbourhood(place.coordinates)?.id).toBeTruthy();
  });

  it("builds a neighbourhood place from a map area click", () => {
    const place = placeFromNeighbourhoodArea({
      code: "085",
      name: "South Parkdale",
      coordinates: [-79.436, 43.6388],
    });
    expect(place.kind).toBe("neighbourhood");
    expect(place.label).toBe("South Parkdale");
    expect(place.id).toBe("neighbourhood:085");
  });
});
