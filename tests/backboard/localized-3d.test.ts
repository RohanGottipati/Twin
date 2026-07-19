import { describe, expect, it } from "vitest";

import {
  BUILDING_HEIGHT_EXPRESSION,
  LOCALIZED_BUILDINGS_3D_LAYER,
  deriveAgent3DFocus,
  localized3DOffset,
  localized3DZoom,
  localizedBuildingFilter,
  localizedBuildingLayer,
} from "@/lib/map/localized-3d";
import { parseMapActions, type MapAction } from "@/lib/techto/map-actions";

function actions(input: unknown[]): MapAction[] {
  const parsed = parseMapActions(input);
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  return parsed.actions;
}

const neighbourhoods: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { code: "024" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-79.44, 43.67],
            [-79.4, 43.67],
            [-79.4, 43.7],
            [-79.44, 43.7],
            [-79.44, 43.67],
          ],
        ],
      },
    },
  ],
};

describe("localized agent 3D focus", () => {
  it("moves one step closer without exceeding the map maximum", () => {
    expect(localized3DZoom(14, 18)).toBe(16.25);
    expect(localized3DZoom(17.75, 18)).toBe(18);
  });

  it("frames the focus above the bottom chat responsively", () => {
    expect(localized3DOffset(500)).toEqual([0, -110]);
    expect(localized3DOffset(800)).toEqual([0, -160]);
    expect(localized3DOffset(1400)).toEqual([0, -210]);
  });

  it("prefers explicit intervention geometry over a broad neighbourhood", () => {
    const focus = deriveAgent3DFocus(
      actions([
        { type: "highlight_neighbourhoods", neighbourhoodIds: ["024"] },
        {
          type: "draw_line",
          id: "tram-corridor",
          coordinates: [
            [-79.43, 43.68],
            [-79.41, 43.69],
          ],
          label: "Tram corridor",
        },
      ]),
      { candidateMarkers: [] },
    );

    expect(focus).toEqual({
      source: "drawings",
      targets: [
        {
          id: "tram-corridor",
          geometry: {
            type: "LineString",
            coordinates: [
              [-79.43, 43.68],
              [-79.41, 43.69],
            ],
          },
          radiusMeters: 120,
        },
      ],
    });
  });

  it("uses only the rank-one candidate when no area was drawn", () => {
    const focus = deriveAgent3DFocus(
      actions([
        {
          type: "show_candidate_markers",
          candidates: [
            {
              candidateId: "second",
              coordinates: [-79.41, 43.68],
              rank: 2,
              label: "Second",
            },
            {
              candidateId: "best",
              coordinates: [-79.42, 43.69],
              rank: 1,
              label: "Best",
            },
          ],
        },
      ]),
      { candidateMarkers: [] },
    );

    expect(focus).toEqual({
      source: "markers",
      targets: [
        {
          id: "best",
          geometry: { type: "Point", coordinates: [-79.42, 43.69] },
          radiusMeters: 180,
        },
      ],
    });
  });

  it("resolves highlighted neighbourhood geometry into the tile filter", () => {
    const filter = localizedBuildingFilter(
      { source: "highlights", neighbourhoodIds: ["024"] },
      neighbourhoods,
    );

    expect(JSON.stringify(filter)).toContain('"distance"');
    expect(JSON.stringify(filter)).toContain('"Polygon"');
    expect(JSON.stringify(filter)).toContain('"hide_3d"');
  });

  it("returns an impossible filter without a focus or matching geometry", () => {
    const hidden = [
      "==",
      ["get", "__techto_never_3d__"],
      true,
    ];
    expect(localizedBuildingFilter(null, neighbourhoods)).toEqual(hidden);
    expect(
      localizedBuildingFilter(
        { source: "highlights", neighbourhoodIds: ["missing"] },
        neighbourhoods,
      ),
    ).toEqual(hidden);
  });

  it("builds a CARTO extrusion layer driven by real building heights", () => {
    const layer = localizedBuildingLayer();
    expect(layer).toMatchObject({
      id: LOCALIZED_BUILDINGS_3D_LAYER,
      type: "fill-extrusion",
      source: "carto",
      "source-layer": "building",
    });
    if (layer.type !== "fill-extrusion") {
      throw new Error("Expected a fill-extrusion layer");
    }
    expect(layer.paint?.["fill-extrusion-height"]).toEqual(
      BUILDING_HEIGHT_EXPRESSION,
    );
  });
});
