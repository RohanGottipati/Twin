require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'backhaul_exchange';

// EPA emissions factors (kg CO2 per km, loaded)
const EMISSIONS_KG_PER_KM = { medium: 0.23, heavy: 0.65 };

// Ontario Commercial Vehicle Survey: ~35% of truck-trips are empty
const EMPTY_TRUCK_RATE = 0.35;

// Commodity types by business type pairing
const COMMODITY_MAP = {
  restaurant:       'food_beverage',
  food_distributor: 'food_beverage',
  warehouse:        'general_freight',
  logistics:        'general_freight',
  retail:           'consumer_goods',
  manufacturing:    'industrial_parts',
  commercial:       'mixed',
};

function haversineKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Approximate road path between two points with slight jitter to simulate curves
function buildPath(origin, dest, steps = 6) {
  const [lng1, lat1] = origin;
  const [lng2, lat2] = dest;
  const coords = [[lng1, lat1]];
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const jLat = (Math.random() - 0.5) * 0.003;
    const jLng = (Math.random() - 0.5) * 0.004;
    coords.push([lng1 + (lng2 - lng1) * t + jLng, lat1 + (lat2 - lat1) * t + jLat]);
  }
  coords.push([lng2, lat2]);
  return { type: 'LineString', coordinates: coords };
}

function randomDeparture(daysAhead = 7) {
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(Math.random() * daysAhead));
  d.setHours(5 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60), 0, 0);
  return d;
}

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    const nodesCol = db.collection('nodes');
    const routesCol = db.collection('routes');

    await routesCol.deleteMany({});
    console.log('Cleared existing routes');

    // Pull node pools by type
    const allNodes = await nodesCol.find({}).toArray();
    if (allNodes.length < 10) throw new Error('Need at least 10 nodes. Run 2-load-nodes.js first.');

    const hubs = allNodes.filter(n => ['warehouse', 'logistics', 'manufacturing', 'food_distributor'].includes(n.type));
    const spoke = allNodes.filter(n => !['warehouse', 'logistics'].includes(n.type));

    console.log(`Node pool — hubs: ${hubs.length}, spokes: ${spoke.length}, total: ${allNodes.length}`);
    console.log('Generating 500 synthetic routes...\n');

    const routes = [];
    const vehicleTypes = ['medium', 'heavy'];
    const frequencies = ['daily', '3x_weekly', 'weekly'];

    for (let i = 0; i < 500; i++) {
      // 60% hub-to-spoke, 25% hub-to-hub, 15% spoke-to-spoke
      const roll = Math.random();
      let origin, dest;

      if (roll < 0.60 && hubs.length > 0 && spoke.length > 0) {
        origin = hubs[Math.floor(Math.random() * hubs.length)];
        dest   = spoke[Math.floor(Math.random() * spoke.length)];
      } else if (roll < 0.85 && hubs.length > 1) {
        origin = hubs[Math.floor(Math.random() * hubs.length)];
        do { dest = hubs[Math.floor(Math.random() * hubs.length)]; } while (dest._id.equals(origin._id));
      } else {
        origin = allNodes[Math.floor(Math.random() * allNodes.length)];
        do { dest = allNodes[Math.floor(Math.random() * allNodes.length)]; } while (dest._id.equals(origin._id));
      }

      const vehicleType = vehicleTypes[Math.floor(Math.random() * vehicleTypes.length)];
      const distKm      = haversineKm(origin.location.coordinates, dest.location.coordinates);

      // Ontario CV Survey calibration: 35% empty trips
      const isEmpty     = Math.random() < EMPTY_TRUCK_RATE;
      const loadFill    = isEmpty
        ? Math.round(Math.random() * 0.15 * 100) / 100          // 0-15% = effectively empty
        : Math.round((0.30 + Math.random() * 0.70) * 100) / 100; // 30-100%

      const co2Loaded   = distKm * EMISSIONS_KG_PER_KM[vehicleType];
      const co2Actual   = co2Loaded * (0.15 + loadFill * 0.85);   // lighter load = slightly less fuel
      // Savings if we fill this truck with a backhaul load
      const co2Savings  = isEmpty ? co2Loaded * 0.40 : Math.max(0, co2Loaded * (1 - loadFill) * 0.35);

      routes.push({
        origin_id:            origin._id,
        destination_id:       dest._id,
        origin_name:          origin.name,
        destination_name:     dest.name,
        origin_location:      origin.location,
        destination_location: dest.location,
        path:                 buildPath(origin.location.coordinates, dest.location.coordinates),
        vehicle_type:         vehicleType,
        load_fill_pct:        loadFill,
        is_empty:             isEmpty,
        commodity:            COMMODITY_MAP[origin.type] || 'general_freight',
        frequency:            frequencies[Math.floor(Math.random() * frequencies.length)],
        distance_km:          Math.round(distKm * 10) / 10,
        co2_per_trip_kg:      Math.round(co2Actual * 100) / 100,
        co2_savings_potential_kg: Math.round(co2Savings * 100) / 100,
        departure_time:       randomDeparture(7),
        status:               'scheduled',
        matched:              false,
        created_at:           new Date()
      });
    }

    const result = await routesCol.insertMany(routes);
    const emptyCount = routes.filter(r => r.is_empty).length;
    const totalSavings = routes.reduce((s, r) => s + r.co2_savings_potential_kg, 0);
    const totalCO2 = routes.reduce((s, r) => s + r.co2_per_trip_kg, 0);

    console.log(`Inserted ${result.insertedCount} routes`);
    console.log(`  Empty/underloaded trips: ${emptyCount} (${Math.round(emptyCount / routes.length * 100)}%)`);
    console.log(`  Ontario CV Survey target: ~35% — calibrated`);
    console.log(`  Total CO2 across all routes: ${Math.round(totalCO2)} kg`);
    console.log(`  Total CO2 savings potential: ${Math.round(totalSavings)} kg (${Math.round(totalSavings / totalCO2 * 100)}% reducible)`);

  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
