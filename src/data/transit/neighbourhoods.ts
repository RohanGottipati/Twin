/**
 * Synthetic Toronto neighbourhood fixtures for TechTO geospatial planning.
 * Centroids and tags are illustrative; not official City of Toronto boundaries.
 */

export interface NeighbourhoodFixture {
  id: string;
  name: string;
  center: [number, number];
  bounds: [number, number, number, number];
  tags: string[];
  growthProxy: { populationIndex: number; employmentIndex: number };
  landUse: string;
  underservedAfter22: boolean;
}

export const NEIGHBOURHOODS: NeighbourhoodFixture[] = [
  {
    id: "liberty-village",
    name: "Liberty Village",
    center: [-79.4205, 43.6372],
    bounds: [-79.435, 43.63, -79.408, 43.645],
    tags: ["downtown", "employment", "streetcar"],
    growthProxy: { populationIndex: 1.35, employmentIndex: 1.5 },
    landUse: "Dense residential and employment, limited subway access.",
    underservedAfter22: false,
  },
  {
    id: "parkdale",
    name: "Parkdale",
    center: [-79.436, 43.6388],
    bounds: [-79.45, 43.632, -79.42, 43.648],
    tags: ["west-end", "equity-priority", "streetcar"],
    growthProxy: { populationIndex: 1.1, employmentIndex: 0.9 },
    landUse: "Mixed residential with equity-priority cohorts.",
    underservedAfter22: true,
  },
  {
    id: "regent-park",
    name: "Regent Park",
    center: [-79.3615, 43.6605],
    bounds: [-79.372, 43.654, -79.35, 43.668],
    tags: ["east-downtown", "equity-priority", "redevelopment"],
    growthProxy: { populationIndex: 1.25, employmentIndex: 1.05 },
    landUse: "Redeveloping residential with growing demand.",
    underservedAfter22: true,
  },
  {
    id: "harbourfront",
    name: "Harbourfront",
    center: [-79.3808, 43.639],
    bounds: [-79.395, 43.634, -79.368, 43.645],
    tags: ["waterfront", "events", "tourism"],
    growthProxy: { populationIndex: 1.15, employmentIndex: 1.3 },
    landUse: "Waterfront residential, tourism, and event access near Union.",
    underservedAfter22: false,
  },
  {
    id: "king-west",
    name: "King West",
    center: [-79.402, 43.6455],
    bounds: [-79.415, 43.64, -79.39, 43.652],
    tags: ["downtown", "nightlife", "streetcar"],
    growthProxy: { populationIndex: 1.2, employmentIndex: 1.4 },
    landUse: "Entertainment and office corridor with late-night demand.",
    underservedAfter22: false,
  },
];

export function listNeighbourhoods(): NeighbourhoodFixture[] {
  return NEIGHBOURHOODS;
}

export function searchNeighbourhoods(query?: string, tags?: string[], limit = 5): NeighbourhoodFixture[] {
  const q = query?.trim().toLowerCase() ?? "";
  const tagSet = new Set((tags ?? []).map((t) => t.toLowerCase()));
  return NEIGHBOURHOODS.filter((n) => {
    const nameOk = !q || n.name.toLowerCase().includes(q) || n.id.includes(q.replace(/\s+/g, "-"));
    const tagsOk = tagSet.size === 0 || n.tags.some((t) => tagSet.has(t));
    return nameOk && tagsOk;
  }).slice(0, Math.max(1, Math.min(limit, 10)));
}

export function requireNeighbourhood(id: string): NeighbourhoodFixture {
  const found = NEIGHBOURHOODS.find((n) => n.id === id);
  if (!found) throw new Error(`Unknown neighbourhood id: "${id}".`);
  return found;
}
