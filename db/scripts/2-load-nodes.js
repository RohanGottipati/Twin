require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'backhaul_exchange';

const TORONTO_API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action';

// Toronto neighbourhood centroids for synthetic fallback
const TORONTO_NEIGHBOURHOODS = [
  { name: 'Downtown Core',   lat: 43.6532, lng: -79.3832, weight: 0.20 },
  { name: 'North York',      lat: 43.7315, lng: -79.4747, weight: 0.15 },
  { name: 'Scarborough',     lat: 43.7731, lng: -79.2576, weight: 0.12 },
  { name: 'Etobicoke',       lat: 43.6205, lng: -79.5132, weight: 0.10 },
  { name: 'East York',       lat: 43.6908, lng: -79.3367, weight: 0.10 },
  { name: 'York',            lat: 43.7000, lng: -79.4500, weight: 0.08 },
  { name: 'Mississauga',     lat: 43.5890, lng: -79.6441, weight: 0.08 },
  { name: 'Port Lands',      lat: 43.6400, lng: -79.3400, weight: 0.07 },
  { name: 'Liberty Village', lat: 43.6390, lng: -79.4200, weight: 0.05 },
  { name: 'Rexdale',         lat: 43.7200, lng: -79.5700, weight: 0.05 },
];

const SYNTHETIC_TYPES = ['warehouse', 'restaurant', 'retail', 'logistics', 'manufacturing', 'food_distributor', 'commercial'];
const SYNTHETIC_TYPE_WEIGHTS = [0.20, 0.25, 0.20, 0.10, 0.10, 0.08, 0.07];

const BUSINESS_NAMES = {
  warehouse:        ['Global Storage Co', 'City Logistics Hub', 'Metro Warehouse', 'Peak Storage', 'Harbour Freight'],
  restaurant:       ['The Maple Grill', 'King Street Eats', 'Urban Kitchen', 'Harbour Bistro', 'The Junction'],
  retail:           ['Queen West Shop', 'Metro Goods', 'The Bay District', 'Urban Market', 'Yonge Retail'],
  logistics:        ['Fast Freight Co', 'Urban Dispatch', 'City Cargo', 'Express Logistics', 'Metro Haul'],
  manufacturing:    ['Ontario Parts Co', 'Lake Shore Manufacturing', 'City Fab Works', 'Metro Metals', 'GTA Components'],
  food_distributor: ['Fresh Direct TO', 'Ontario Food Hub', 'Metro Produce', 'Farm to City', 'Lakeshore Foods'],
  commercial:       ['Downtown Office', 'Metro Business Centre', 'GTA Commerce', 'Bay Street Corp', 'King Commerce'],
};

function weightedRandom(items, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function generateSyntheticNodes(count = 300) {
  const nodes = [];
  for (let i = 0; i < count; i++) {
    const hood = weightedRandom(TORONTO_NEIGHBOURHOODS, TORONTO_NEIGHBOURHOODS.map(n => n.weight));
    const type = weightedRandom(SYNTHETIC_TYPES, SYNTHETIC_TYPE_WEIGHTS);
    const names = BUSINESS_NAMES[type];
    const name = names[Math.floor(Math.random() * names.length)] + ` #${i + 1}`;

    // Spread within ~3km radius of neighbourhood centre
    const lat = hood.lat + (Math.random() - 0.5) * 0.055;
    const lng = hood.lng + (Math.random() - 0.5) * 0.075;

    nodes.push({
      name,
      type,
      address: `${100 + Math.floor(Math.random() * 9900)} ${hood.name} Ave, Toronto, ON`,
      neighbourhood: hood.name,
      location: { type: 'Point', coordinates: [lng, lat] },
      active: true,
      source: 'synthetic',
      created_at: new Date()
    });
  }
  return nodes;
}

function classifyBusinessType(record) {
  const cat = (record['Category'] || record['Business Type'] || record['Licence Type'] || '').toLowerCase();
  if (cat.includes('eat') || cat.includes('drink') || cat.includes('food') || cat.includes('restaurant')) return 'restaurant';
  if (cat.includes('warehouse') || cat.includes('storage')) return 'warehouse';
  if (cat.includes('wholesale') || cat.includes('distribut')) return 'food_distributor';
  if (cat.includes('transport') || cat.includes('logistics') || cat.includes('courier')) return 'logistics';
  if (cat.includes('manufactur') || cat.includes('industrial')) return 'manufacturing';
  if (cat.includes('retail') || cat.includes('store') || cat.includes('shop')) return 'retail';
  return 'commercial';
}

function extractCoordinates(record) {
  const latCandidates = ['Lat', 'lat', 'LATITUDE', 'latitude', 'Y', 'y'];
  const lngCandidates = ['Long', 'long', 'Lng', 'lng', 'LONGITUDE', 'longitude', 'X', 'x'];

  let lat = NaN, lng = NaN;
  for (const k of latCandidates) { if (record[k] !== undefined) { lat = parseFloat(record[k]); break; } }
  for (const k of lngCandidates) { if (record[k] !== undefined) { lng = parseFloat(record[k]); break; } }

  // Validate Toronto bounding box
  if (lat > 43.5 && lat < 43.9 && lng > -79.7 && lng < -79.0) return [lng, lat];
  return null;
}

async function fetchTorontoData() {
  console.log('Fetching Toronto Business Licences package info...');
  const pkgRes = await fetch(`${TORONTO_API}/package_show?id=business-licences`);
  const pkg = await pkgRes.json();

  if (!pkg.success) throw new Error('Toronto Open Data API returned error');

  // Prefer a datastore-active resource (tabular, not shapefile)
  const resource = pkg.result.resources.find(r => r.datastore_active && !['SHP', 'GEOJSON', 'ZIP'].includes(r.format?.toUpperCase()));
  if (!resource) throw new Error('No datastore resource found in business-licences package');

  console.log(`Using resource: ${resource.name} (${resource.id})`);

  // Fetch up to 5000 records
  const dataRes = await fetch(`${TORONTO_API}/datastore_search?resource_id=${resource.id}&limit=5000`);
  const data = await dataRes.json();
  if (!data.success) throw new Error('Failed to fetch business licence records');

  return data.result.records;
}

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const col = db.collection('nodes');

    await col.deleteMany({});
    console.log('Cleared existing nodes');

    let nodes = [];

    try {
      const records = await fetchTorontoData();
      console.log(`Fetched ${records.length} records from Toronto Open Data`);

      const withCoords = records
        .map(r => {
          const coords = extractCoordinates(r);
          if (!coords) return null;
          return {
            name: r['Business Name'] || r['Operating Name'] || r['DBA Name'] || 'Unnamed Business',
            type: classifyBusinessType(r),
            address: [r['Address'], r['City'] || 'Toronto', r['Province'] || 'ON'].filter(Boolean).join(', '),
            location: { type: 'Point', coordinates: coords },
            licence_no: r['Licence No.'] || String(r['_id']),
            active: true,
            source: 'toronto_open_data',
            created_at: new Date()
          };
        })
        .filter(Boolean);

      if (withCoords.length >= 50) {
        nodes = withCoords;
        console.log(`${withCoords.length} records have valid Toronto coordinates`);
      } else {
        console.log(`Only ${withCoords.length} geocoded records found — records may be address-only`);
        console.log('Falling back to synthetic nodes with real Toronto geography...');
        nodes = generateSyntheticNodes(300);
      }
    } catch (err) {
      console.warn(`Toronto API error: ${err.message}`);
      console.log('Falling back to synthetic nodes with real Toronto geography...');
      nodes = generateSyntheticNodes(300);
    }

    const result = await col.insertMany(nodes);
    console.log(`\nInserted ${result.insertedCount} nodes`);

    // Print type breakdown
    const counts = nodes.reduce((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc; }, {});
    console.log('Type breakdown:', JSON.stringify(counts, null, 2));

  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
