# Database — MongoDB Atlas Setup Summary
### HackThe6ix 2026 · TechTO + Backhaul Exchange

---

## Overview

Two logical database workstreams were built and wired into the project, both running on the same MongoDB Atlas M0 cluster.

| Database | Purpose |
|---|---|
| `backhaul_exchange` | Freight/logistics layer — nodes, truck routes, live events, match proposals |
| `techto` (transit + census) | City simulation layer — TTC stops/routes, Toronto census neighbourhoods |

---

## Part 1 — Backhaul Exchange

### Collections

| Collection | Type | Description |
|---|---|---|
| `nodes` | Standard | Real Toronto business locations (restaurants, warehouses, retail, etc.) sourced from Toronto Business Licences dataset |
| `routes` | Standard | 500 synthetic truck routes calibrated to Ontario Commercial Vehicle Survey (~35% empty trips) |
| `events` | **Time Series** (`timeField: timestamp`) | Live truck telemetry stream — truck position, load fill %, event type |
| `matches` | Standard | Backhaul match proposals comparing `greedy_baseline` vs `ml_optimizer` algorithms |

### Indexes

**`nodes`**
- `location`: `2dsphere` — geospatial point queries
- `type`: `1` — filter by business category
- `name`, `address`: `text` — full-text search

**`routes`**
- `origin_id`, `destination_id`: `1` — join lookups
- `origin_location`: `2dsphere` — proximity queries
- `load_fill_pct`: `1` — filter underloaded trips
- `departure_time`: `1` — time-window queries
- `matched`, `is_empty`: `1` — compound filter for unmatched empty trips

**`matches`**
- `route_a_id`, `route_b_id`: `1`
- `matched_at`: `-1` — recency sort
- `co2_saved_kg`: `-1` — sort by impact

### Data generation scripts (`db/scripts/`)

| Script | What it does |
|---|---|
| `0-test-connection.js` | Verify Atlas connection |
| `1-setup-collections.js` | Create all 4 collections + indexes |
| `2-load-nodes.js` | Load Toronto business locations as GeoJSON Points |
| `3-generate-routes.js` | Generate 500 synthetic routes with EPA CO2 factors; 35% empty calibrated against Ontario CV Survey |
| `4-generate-events.js` | Populate time series `events` collection + seed `matches` with greedy/ML proposals |
| `5-demo-queries.js` | Sample aggregation pipeline queries |

### Emissions model

- EPA factors: medium truck = 0.23 kg CO2/km, heavy = 0.65 kg CO2/km
- Load-adjusted actual CO2: `co2_loaded * (0.15 + load_fill * 0.85)`
- Savings potential: empty trips save ~40% if backfilled; partial loads save proportionally

---

## Part 2 — TechTO (Transit + Census)

### Collections

| Collection | Description |
|---|---|
| `transit.stops` | TTC stop locations from official GTFS feed (GeoJSON Points) |
| `transit.routes` | TTC route definitions — subway lines 1/2/4, LRT 5/6, streetcars |
| `census.neighbourhoods` | 158 Toronto neighbourhoods with 2021 Census data (population, median income, etc.) |

### Atlas Search Indexes

| Index | Collection | Fields | Type |
|---|---|---|---|
| `transit_search` | `transit.stops`, `transit.routes` | `stop_name`, `route_name` | Autocomplete + fuzzy full-text |
| `census_search` | `census.neighbourhoods` | `neighbourhood_name` | Autocomplete |

### Atlas Vector Search Index

| Index | Collection | Field | Similarity |
|---|---|---|---|
| `census_vector` | `census.neighbourhoods` | `embedding` | Cosine |

Embeddings are 1536-dimensional vectors generated via OpenAI `text-embedding-3-small` from a text representation of each neighbourhood's census profile. Generated once via `npm run generate-embeddings` and stored directly in each document.

### Setup scripts (`db/scripts/`)

| Script | npm command | What it does |
|---|---|---|
| `1-setup-transit-collections.js` | `npm run setup-transit` | Create transit collections + geospatial indexes |
| `2-load-ttc-gtfs.js` | `npm run load-ttc` | Download and parse TTC GTFS feed into MongoDB |
| `1-setup-census-collections.js` | `npm run setup-census` | Create census collections + text indexes |
| `2-load-census-data.js` | `npm run load-census` | Load 158 neighbourhood profiles |
| `3-validate-census-data.js` | `npm run validate-census` | Sanity-check loaded records |
| `4-setup-search-indexes.js` | `npm run setup-search-indexes` | Create Atlas Search + Vector Search index definitions |
| `5-generate-embeddings.js` | `npm run generate-embeddings` | Call OpenAI API once to embed all neighbourhoods (requires `OPENAI_API_KEY` in `.env`) |

---

## API Routes (live with `next dev`)

| Route | MongoDB Feature Used |
|---|---|
| `GET /api/transit/search?q=bloor` | Atlas Search — autocomplete + fuzzy on stop/route names |
| `GET /api/census/search?q=rosedale` | Atlas Search — autocomplete on neighbourhood names |
| `GET /api/census/similar?id=067` | Atlas Vector Search — cosine similarity on stored embeddings |
| `GET /api/census/similar?q=high+income+low+transit` | Vector Search + OpenAI — embed query on the fly, then cosine similarity |
| `GET /api/transit/catchment?lat=43.67&lng=-79.38` | `$geoNear` + `$facet` + `$lookup` + cross-collection join |

---

## Setup Order

```bash
# 1. Backhaul Exchange (run once)
cd db
npm run run-all

# 2. TechTO — Transit
npm run run-transit

# 3. TechTO — Census
npm run run-census

# 4. Atlas Search + Vector Search indexes (create in Atlas UI or via script)
npm run setup-search-indexes

# 5. Generate embeddings (requires OPENAI_API_KEY in .env — one-time cost, pennies)
npm run generate-embeddings
```

---

## Environment Variables

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
MONGODB_DB=backhaul_exchange
OPENAI_API_KEY=sk-...
```

> Never commit a connection string with a real password. If one is exposed, regenerate the Atlas database user password immediately.
