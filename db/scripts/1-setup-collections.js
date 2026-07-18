require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'backhaul_exchange';

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');

    const db = client.db(dbName);
    const existing = (await db.listCollections().toArray()).map(c => c.name);
    console.log('Existing collections:', existing.length ? existing.join(', ') : 'none');

    // --- nodes ---
    if (!existing.includes('nodes')) {
      await db.createCollection('nodes');
      console.log('Created collection: nodes');
    }

    // --- routes ---
    if (!existing.includes('routes')) {
      await db.createCollection('routes');
      console.log('Created collection: routes');
    }

    // --- events (Time Series) ---
    if (!existing.includes('events')) {
      await db.createCollection('events', {
        timeseries: {
          timeField: 'timestamp',
          metaField: 'metadata',
          granularity: 'seconds'
        }
      });
      console.log('Created collection: events (time series)');
    }

    // --- matches ---
    if (!existing.includes('matches')) {
      await db.createCollection('matches');
      console.log('Created collection: matches');
    }

    // --- Indexes: nodes ---
    const nodes = db.collection('nodes');
    await nodes.createIndex({ location: '2dsphere' });
    await nodes.createIndex({ type: 1 });
    await nodes.createIndex({ name: 'text', address: 'text' });
    console.log('Indexes created on: nodes');

    // --- Indexes: routes ---
    const routes = db.collection('routes');
    await routes.createIndex({ origin_id: 1 });
    await routes.createIndex({ destination_id: 1 });
    await routes.createIndex({ origin_location: '2dsphere' });
    await routes.createIndex({ load_fill_pct: 1 });
    await routes.createIndex({ departure_time: 1 });
    await routes.createIndex({ matched: 1, is_empty: 1 });
    console.log('Indexes created on: routes');

    // --- Indexes: matches ---
    const matches = db.collection('matches');
    await matches.createIndex({ route_a_id: 1 });
    await matches.createIndex({ route_b_id: 1 });
    await matches.createIndex({ matched_at: -1 });
    await matches.createIndex({ co2_saved_kg: -1 });
    console.log('Indexes created on: matches');

    console.log('\nSetup complete.');
    console.log('  nodes          — real Toronto business locations (2dsphere indexed)');
    console.log('  routes         — synthetic truck routes (geospatial + load data)');
    console.log('  events         — time series collection for live truck stream');
    console.log('  matches        — backhaul match results with CO2 savings');

  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
