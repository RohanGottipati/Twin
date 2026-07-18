require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'backhaul_exchange';

const EVENT_TYPES = ['truck_available', 'load_posted', 'match_made', 'pickup_confirmed', 'delivery_complete'];

// Simulate a truck progressing along a route: position is interpolated
function interpolatePosition(origin, dest, progress) {
  const [lng1, lat1] = origin.coordinates;
  const [lng2, lat2] = dest.coordinates;
  return {
    type: 'Point',
    coordinates: [
      lng1 + (lng2 - lng1) * progress,
      lat1 + (lat2 - lat1) * progress
    ]
  };
}

function pastTimestamp(minutesAgo) {
  const t = new Date();
  t.setMinutes(t.getMinutes() - minutesAgo);
  return t;
}

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    const routesCol = db.collection('routes');
    const eventsCol = db.collection('events');
    const matchesCol = db.collection('matches');

    // Time series collections can't be dropped easily — just note existing count
    const existingCount = await eventsCol.countDocuments({});
    console.log(`Existing events: ${existingCount} — appending new batch`);

    const routes = await routesCol.find({}).limit(200).toArray();
    if (routes.length === 0) throw new Error('No routes found. Run 3-generate-routes.js first.');

    console.log(`Generating events from ${routes.length} routes...`);

    const events = [];
    const matchDocs = [];

    for (const route of routes) {
      const truckId = `TRUCK-${Math.floor(Math.random() * 9000 + 1000)}`;
      const numEvents = 2 + Math.floor(Math.random() * 4);

      for (let i = 0; i < numEvents; i++) {
        const minutesAgo = Math.floor(Math.random() * 1440); // last 24h
        const progress   = Math.random();
        const eventType  = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];

        events.push({
          timestamp: pastTimestamp(minutesAgo),
          metadata: {
            truck_id:     truckId,
            route_id:     route._id.toString(),
            event_type:   eventType,
            vehicle_type: route.vehicle_type,
            commodity:    route.commodity || 'general_freight'
          },
          location:     interpolatePosition(route.origin_location, route.destination_location, progress),
          load_fill_pct: route.load_fill_pct,
          distance_remaining_km: Math.round(route.distance_km * (1 - progress) * 10) / 10,
          co2_kg:       route.co2_per_trip_kg
        });
      }

      // Generate a match document for every matched/empty route pair (simulated optimizer output)
      if (route.is_empty && Math.random() < 0.5) {
        // Find a random non-empty route nearby as the match partner (simplified)
        const partner = routes.find(r => !r.is_empty && !r._id.equals(route._id));
        if (partner) {
          matchDocs.push({
            route_a_id:        route._id,
            route_b_id:        partner._id,
            a_origin:          route.origin_location,
            b_destination:     partner.destination_location,
            distance_detour_km: Math.round(Math.random() * 5 * 10) / 10,
            co2_saved_kg:      route.co2_savings_potential_kg,
            load_fill_before:  route.load_fill_pct,
            load_fill_after:   Math.min(1.0, route.load_fill_pct + partner.load_fill_pct),
            algorithm:         Math.random() < 0.5 ? 'greedy_baseline' : 'ml_optimizer',
            matched_at:        pastTimestamp(Math.floor(Math.random() * 60)),
            status:            'proposed'
          });
        }
      }
    }

    const evtResult = await eventsCol.insertMany(events);
    console.log(`Inserted ${evtResult.insertedCount} events into time series collection`);

    if (matchDocs.length > 0) {
      await matchesCol.deleteMany({});
      const matchResult = await matchesCol.insertMany(matchDocs);
      console.log(`Inserted ${matchResult.insertedCount} match proposals`);
    }

    // Summary stats via aggregation pipeline
    console.log('\nRunning aggregation summary...');
    const summary = await db.collection('routes').aggregate([
      {
        $group: {
          _id: '$vehicle_type',
          total_routes: { $sum: 1 },
          empty_routes: { $sum: { $cond: ['$is_empty', 1, 0] } },
          avg_fill_pct: { $avg: '$load_fill_pct' },
          total_co2_kg: { $sum: '$co2_per_trip_kg' },
          total_savings_potential_kg: { $sum: '$co2_savings_potential_kg' }
        }
      },
      { $sort: { _id: 1 } }
    ]).toArray();

    console.log('\nRoute stats by vehicle type:');
    for (const row of summary) {
      console.log(`  ${row._id}: ${row.total_routes} routes | ${row.empty_routes} empty (${Math.round(row.empty_routes/row.total_routes*100)}%) | avg fill ${Math.round(row.avg_fill_pct*100)}% | CO2 savings potential: ${Math.round(row.total_savings_potential_kg)} kg`);
    }

  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
