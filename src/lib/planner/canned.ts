/** Demo asks for the Coolness dashboard chips. Questions only; no pre-baked mock patches. */
export const CANNED_CITY_ASKS = [
  {
    id: "new-station",
    question: "Where should I open a new train station?",
  },
  {
    id: "stadium-alderwood",
    question:
      "What would happen if I close the yellow metro line and instead use that money to build a stadium in Alderwood?",
  },
  {
    id: "nuclear-siting",
    question: "Find me where to put a nuclear power plant",
  },
  {
    id: "king-tram",
    question: "Add a tram on King Street and raise parking tax 5% citywide to pay for it.",
  },
] as const;

export type CannedCityAskId = (typeof CANNED_CITY_ASKS)[number]["id"];

export function getCannedAsk(id: string) {
  return CANNED_CITY_ASKS.find((a) => a.id === id) ?? null;
}
