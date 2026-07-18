# MongoDB Atlas Features — Use Cases for TwinTO

## Atlas Search (Full-text + Autocomplete)

**Use case: AI agent command bar / natural language input**

User types "King" into a search box → instantly returns "504 King streetcar", "King Station", "King St W / Bathurst" as autocomplete suggestions. The fuzzy matching means "boor" still finds "Bloor". The agent can also use this to resolve vague user references — if a user asks "what's the situation on the Yonge line?", the agent searches `transit_toronto.routes` to resolve that to route_id `1` before querying anything else.

---

## Atlas Vector Search (Semantic Similarity)

**Use case 1: Neighbourhood equity comparison**

"Find me neighbourhoods similar to Moss Park" → returns areas with similar income, age distribution, and transit dependency. Lets the agent say "if this infrastructure change works in Moss Park, these 4 comparable neighbourhoods would also benefit."

**Use case 2: Natural language demographic query**

`?q=low+income+high+transit+dependency+aging+population` → returns the actual neighbourhoods that match that description without any explicit field filtering. The agent can translate a policy question directly into a demographic search.

---

## $geoNear + $facet + Cross-DB Catchment Pipeline

**Use case: Station impact analysis**

Click any point on the map → API returns in one shot:
- Every TTC stop within 500m, broken down by type (subway/bus/streetcar)
- Which routes serve that catchment
- The census demographic profile of that neighbourhood (population, median income, transit usage, low-income rate)

This is the core KPI tool — "who does this station actually serve, and what do we know about them?"

---

## The Combination: Full AI Agent Query Chain

The real power is chaining all three features together:

1. User asks: *"Which underserved neighbourhoods near the Eglinton Crosstown have high transit dependency?"*
2. Agent uses **Atlas Search** to resolve "Eglinton Crosstown" to a route
3. Agent calls the **catchment pipeline** along the route corridor → gets all nearby neighbourhoods
4. Agent filters by `commuting_transit_pct > 60%` and `income_low_income_pct > 20%`
5. Agent uses **Vector Search** to find other similar neighbourhoods elsewhere in Toronto for comparison
6. Every stat in the response carries a provenance citation → agent cites the source

That's the demo arc that will impress judges — a single conversational question that touches all three MongoDB features in sequence.
