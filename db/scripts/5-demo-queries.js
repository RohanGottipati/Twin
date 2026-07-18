/**
 * Demo script — showcases all MongoDB features used for the prize track:
 *   1. Geospatial queries  ($geoNear, $geoWithin)
 *   2. Aggregation Pipeline (baseline vs optimizer comparison)
 *   3. Time Series query    (event volume over time)
 *   4. Change Stream        (live truck event listener)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'backhaul_exchange';

// Downtown Toronto
const DEMO_POINT = { type: 'Point', coordinates: [-79.3832, 43.6532] };
const DEMO_RADIUS_KM = 5;

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    // -----------------------------------------------------------------------
    // 1. GEOSPATIAL — find nodes within 5km of Downtown Toronto
    // -----------------------------------------------------------------------
    console.log('--- 1. Geospatial: nodes within 5km of Downtown Toronto ---');
    const nearbyNodes = await db.collection('nodes').aggregate([
      {
        $geoNear: {
          near: DEMO_POINT,
          distanceField: 'dist_m',
          maxDistance: DEMO_RADIUS_KM * 1000,
          spherical: true
        }
      },
      { $limit: 5 },
      { $project: { name: 1, type: 1, address: 1, dist_m: { $round: ['$dist_m', 0] } } }
    ]).toArray();
    console.log(`Found ${nearbyNodes.length} nearby nodes (showing up to 5):`);
    nearbyNodes.forEach(n => console.log(`  ${n.name} [${n.type}] — ${n.dist_m}m away`));

    // -----------------------------------------------------------------------
    // 2. GEOSPATIAL — find routes whose origin is within a delivery zone
    // -----------------------------------------------------------------------
    console.log('\n--- 2. Geospatial: empty routes originating within 5km of Downtown ---');
    const emptyNearby = await db.collection('routes').find({
      is_empty: true,
      origin_location: {
        $geoWithin: {
          $centerSphere: [DEMO_POINT.coordinates, DEMO_RADIUS_KM / 6371]
        }
      }
    }).limit(5).project({ origin_name: 1, destination_name: 1, distance_km: 1, load_fill_pct: 1, vehicle_type: 1 }).toArray();
    console.log(`Found ${emptyNearby.length} empty routes in zone (showing up to 5):`);
    emptyNearby.forEach(r => console.log(`  ${r.origin_name} → ${r.destination_name} | ${r.distance_km}km | fill: ${Math.round(r.load_fill_pct * 100)}%`));

    // -----------------------------------------------------------------------
    // 3. AGGREGATION PIPELINE — Baseline vs optimizer CO2 comparison
    // -----------------------------------------------------------------------
    console.log('\n--- 3. Aggregation Pipeline: Greedy baseline vs ML optimizer ---');
    const matchComparison = await db.collection('matches').aggregate([
      {
        $group: {
          _id: '$algorithm',
          total_matches:   { $sum: 1 },
          total_co2_saved: { $sum: '$co2_saved_kg' },
          avg_co2_saved:   { $avg: '$co2_saved_kg' },
          avg_detour_km:   { $avg: '$distance_detour_km' },
          avg_fill_after:  { $avg: '$load_fill_after' }
        }
      },
      { $sort: { total_co2_saved: -1 } }
    ]).toArray();

    if (matchComparison.length > 0) {
      console.log('Algorithm comparison:');
      matchComparison.forEach(row => {
        console.log(`  ${row._id}: ${row.total_matches} matches | CO2 saved: ${Math.round(row.total_co2_saved)}kg total, ${Math.round(row.avg_co2_saved)}kg avg | avg fill after: ${Math.round(row.avg_fill_after * 100)}%`);
      });
    } else {
      console.log('No match data yet — run 4-generate-events.js first');
    }

    // -----------------------------------------------------------------------
    // 4. AGGREGATION — CO2 savings potential by commodity type
    // -----------------------------------------------------------------------
    console.log('\n--- 4. Aggregation Pipeline: CO2 savings potential by commodity ---');
    const byCommodity = await db.collection('routes').aggregate([
      { $match: { is_empty: true } },
      {
        $group: {
          _id: '$commodity',
          empty_trips:       { $sum: 1 },
          total_savings_kg:  { $sum: '$co2_savings_potential_kg' },
          avg_distance_km:   { $avg: '$distance_km' }
        }
      },
      { $sort: { total_savings_kg: -1 } }
    ]).toArray();
    console.log('Empty trips by commodity:');
    byCommodity.forEach(r => console.log(`  ${r._id}: ${r.empty_trips} trips | ${Math.round(r.total_savings_kg)}kg CO2 recoverable | avg ${Math.round(r.avg_distance_km)}km`));

    // -----------------------------------------------------------------------
    // 5. TIME SERIES — event volume in last 24h, bucketed by hour
    // -----------------------------------------------------------------------
    console.log('\n--- 5. Time Series: event volume by hour (last 24h) ---');
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hourlyEvents = await db.collection('events').aggregate([
      { $match: { timestamp: { $gte: since } } },
      {
        $group: {
          _id: {
            hour: { $hour: '$timestamp' },
            event_type: '$metadata.event_type'
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.hour': 1 } },
      { $limit: 10 }
    ]).toArray();
    console.log(`Events in last 24h by hour (first 10 buckets):`);
    hourlyEvents.forEach(e => console.log(`  Hour ${e._id.hour}: ${e._id.event_type} x${e.count}`));

    // -----------------------------------------------------------------------
    // 6. CHANGE STREAM — watch matches collection for new backhaul proposals
    // (Time series collections don't support change streams — use matches instead)
    // -----------------------------------------------------------------------
    console.log('\n--- 6. Change Stream: watching matches collection for new proposals ---');
    const changeStream = db.collection('matches').watch(
      [{ $match: { operationType: 'insert' } }],
      { fullDocument: 'updateLookup' }
    );

    let changeCount = 0;
    changeStream.on('change', (change) => {
      changeCount++;
      const doc = change.fullDocument;
      if (doc) {
        console.log(`  [LIVE MATCH] CO2 saved: ${doc.co2_saved_kg}kg | fill: ${Math.round(doc.load_fill_before * 100)}% → ${Math.round(doc.load_fill_after * 100)}% | algo: ${doc.algorithm}`);
      }
    });
    changeStream.on('error', (err) => {
      console.error('  Change stream error:', err.message);
    });

    // Give the stream a moment to initialize before inserting
    await new Promise(r => setTimeout(r, 1000));

    // Insert a test match to trigger the stream
    await db.collection('matches').insertOne({
      route_a_id: null,
      route_b_id: null,
      a_origin: DEMO_POINT,
      b_destination: DEMO_POINT,
      distance_detour_km: 2.1,
      co2_saved_kg: 12.4,
      load_fill_before: 0.05,
      load_fill_after: 0.82,
      algorithm: 'ml_optimizer',
      matched_at: new Date(),
      status: 'proposed'
    });

    await new Promise(r => setTimeout(r, 3000));
    await changeStream.close();
    console.log(`Change stream received ${changeCount} event(s) during watch window`);

    console.log('\nAll MongoDB feature demos complete.');

  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
