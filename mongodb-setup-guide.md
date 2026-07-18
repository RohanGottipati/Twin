# MongoDB Atlas Setup & Data Guide
### Backhaul Exchange / City Supply Web — Hack the 6ix 2026

---

## 1. Data Sources — Simple Summary

You need 3 kinds of data. Only one is fully real; the rest is real-but-adjacent or honestly simulated.

| What you need | Where it comes from | Real or simulated? |
|---|---|---|
| **Real buildings** (nodes) | Toronto Business Licences and Permits dataset (open.toronto.ca) — 100,000+ real addressed businesses (restaurants, retail, warehouses, etc.) | Real |
| **Real roads between buildings** | OpenStreetMap (via Overpass API) + OSRM for actual road-network routing | Real |
| **A believable "% of trucks running empty" number** | Ontario Commercial Vehicle Survey / Commercial Vehicle Origin & Destination Data (data.ontario.ca) — includes a dedicated "empty trucks" category | Real, but aggregated by county/province — not city-block-level |
| **Which specific truck goes where, right now** | You simulate this | Fake, but calibrated to match the real empty-truck % above |

**One-sentence honest pitch line:** *"Buildings and roads are real, the emissions math is real (EPA/GHG Protocol factors), and the live order stream is a simulation calibrated against Ontario's actual freight survey data."*

### Key datasets, direct references
- **Toronto Business Licences and Permits** — open.toronto.ca, published by Municipal Licensing & Standards. Real addresses + business type.
- **Commercial Vehicle Origin and Destination Data** — data.ontario.ca. Trip origin/destination, commodity group, daily trips, commodity weight/value, medium/heavy trucks only, **includes empty-truck category**. Caveat: aggregated by county, ~440km average trip — not built for intra-city trips, so use it for calibration/credibility, not literal routing.
- **Commercial Vehicle Survey Data (flows assigned to road network)** — data.ontario.ca companion dataset, closer to actual road-network visualization if accessible.
- **OpenStreetMap** (Overpass API) — real building footprints/locations, any city, free.
- **OSRM** — free, self-hostable road routing engine for realistic truck paths (not straight lines).
- **EPA / GHG Protocol emissions factors** — published grams-CO2-per-ton-mile by vehicle/shipping mode. One-time lookup table, not an ongoing data source.

---

## 2. MongoDB Atlas — Practical Setup

### Cost
- **M0 (Free tier) is free forever, no credit card required.** 512 MB storage — comfortably enough for this project's entire dataset.
- Only real limitations: one free cluster per project, some enterprise features (dedicated backups, certain Search/Vector Search configs) reserved for paid tiers. Not a concern for this build.

### Organizations vs. Projects
- **Organization** = top level. Billing and broad team membership live here.
- **Project** (formerly "group") = sits inside an org. Clusters, database users, network access rules (IP allowlist) all live at this level.
- **Practical takeaway:** don't overthink it. Create one project (e.g., "hack-the-6ix") under your default org, put one cluster in it. Hierarchy only matters at company/team scale with multiple environments.

### Getting your connection string

**Atlas CLI command:**
```bash
atlas clusters connectionStrings describe <cluster-name>
```
Example:
```bash
atlas clusters connectionStrings describe HackThe6ix
```

As JSON (useful for scripting):
```bash
atlas clusters connectionStrings describe HackThe6ix --output json
```

Extract just the SRV string into a variable:
```bash
CONNECTION_STRING=$(atlas clusters connectionStrings describe HackThe6ix --output json | jq -r '.standardSrv')
```

**Prerequisites:** Atlas CLI installed + authenticated (`atlas auth login`), at least Project Read Only permission. The command returns the string with `<password>` as a placeholder — you fill in the real password yourself, which keeps it safe to run in scripts/logs.

### ⚠️ Credential safety note
Never paste a connection string with the real password into chat, docs, or commits. If one is ever exposed: **Atlas → Database Access → edit the user → regenerate password immediately**, then update it everywhere it's used (`.env` files, MCP config, etc.).

---

## 3. Administering MongoDB via an Agent (Claude Code)

Two different tools — know which does what:

### Atlas CLI
Traditional command-line tool. You type exact commands (`atlas clusters create`, `atlas dbusers create`, etc.) — good for scripted, repeatable setup, but not natural-language/agentic.

### MongoDB MCP Server — the "agent" path
Connects any MongoDB deployment (Atlas, Community, Enterprise) to agentic tools like **Claude Code**, Cursor, or GitHub Copilot. Once connected, you describe what you want in plain English and the agent executes the real database/Atlas operations.

**Setup steps:**
1. **Get Atlas service account credentials** (client ID + secret) — Atlas UI → Access Manager → Applications → Service Accounts. This unlocks Atlas *admin* tools (cluster creation, user management) for the agent, separate from your regular DB connection string.
2. **Install MongoDB's official Claude Code plugin** — bundles the MCP server + pre-built "agent skills" for common MongoDB tasks. Closer to one install command than manual JSON config.
3. **Run the MCP setup utility** — pick your client (Claude Code), choose read-only mode (turn OFF temporarily while you're writing your schema/data, consider turning back ON once data is loaded), provide connection string / service account details.
4. **Talk to it directly** — e.g., "Create a database called backhaul_exchange with a nodes collection, and add a 2dsphere index on the location field."

**Safety default:** keep read-only mode ON unless you specifically need the agent to write/create — flip it off only when intentionally provisioning.

---

## 4. MongoDB Features to Use (and why)

Ranked by how directly they serve this specific project:

| Feature | Use for | Why it's the right tool here |
|---|---|---|
| **Geospatial queries** (`$geoWithin`, `$geoShape`, `$near`/`$geoNear`) | Finding nodes/loads within a delivery zone or near a truck's position | Native support for points/polygons — the obvious right tool for a map-based logistics app |
| **2dsphere index** | Required index type on any `location` field for accurate geospatial queries | Without it, geospatial queries either fail or use flat-grid math instead of accurate round-earth math |
| **Change Streams** | Powering live map updates as new orders/matches come in | Lets the frontend react instantly to new documents without polling — makes "real-time" honest, not faked |
| **Time Series collections** | Storing CO2/utilization/truck-fill history over time | Purpose-built for timestamped data at scale — a legitimate technical choice to point to in judging |
| **Aggregation Pipeline** | Computing your greedy-baseline vs. trained-model comparison (match rate, emissions saved, etc.) | Core, well-established tool for exactly this kind of group/compute/roll-up task |
| **Vector Search** (optional) | If match-quality scoring uses embeddings (e.g., "find historically similar successful matches") | Legitimate stretch feature if there's time — combines vector similarity with metadata/geospatial/lexical filters in one query; currently MongoDB's most-promoted feature |
| **Atlas Charts** | Dashboard/side-panel visualizations sitting directly on Atlas data | Saves hand-building charting logic |

**Priority for hackathon timeline:** Geospatial + Change Streams + Aggregation Pipeline first (core, load-bearing, low-risk). Vector Search only if time allows and you want to push match-scoring sophistication further.

### Schema sketch
- **`nodes`** collection — one doc per building: `name`, `type`, `address`, `location` (GeoJSON Point: `{ type: "Point", coordinates: [lng, lat] }`)
- **`routes`** collection — one doc per road path: `origin_id`, `destination_id`, `path` (GeoJSON LineString), `vehicle_type`, `load_fill_pct`, `frequency`, `distance_km`, `co2_per_trip`
- **`events`** collection — simulated live order/truck stream, watched via Change Streams

---

## 5. Quick Reference: Suggested Build Order

1. Set up Atlas M0 cluster + one project ("hack-the-6ix")
2. Connect MongoDB MCP Server to Claude Code
3. Fetch: Toronto Business Licences (real nodes) → OSM/Overpass (real roads) → Ontario Commercial Vehicle Survey (empty-truck calibration %)
4. Have the agent design + create `nodes`, `routes`, `events` collections with correct GeoJSON fields
5. Create 2dsphere index on `location`
6. Write and test sample geospatial queries (`$geoWithin`, `$geoNear`) before building the frontend on top
7. Set up Change Streams for live updates
8. Build the aggregation pipeline for baseline-vs-model comparison stats
