type FleetRow = {
  vehicle_key: string;
  bus_data: Record<string, unknown>;
  last_seen_at: string;
};

function configuration() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceKey ? { url, serviceKey } : null;
}

function headers(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

export function supabaseFleetEnabled() {
  return configuration() !== null;
}

export async function loadSavedFleet(): Promise<FleetRow[]> {
  const config = configuration();
  if (!config) return [];

  const response = await fetch(
    `${config.url}/rest/v1/bus_last_locations?select=vehicle_key,bus_data,last_seen_at&order=last_seen_at.desc&limit=500`,
    { headers: headers(config.serviceKey), cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Supabase fleet load returned ${response.status}`);
  return response.json() as Promise<FleetRow[]>;
}

// ---- Full-response snapshot (scalability) ----------------------------------
// Instead of every visitor triggering a 44-request live sweep, one refresh
// writes the entire ready-to-serve /api/transit payload into a single row.
// All visitors then read that one row (fast + cheap), so upstream load and
// Vercel function time stay flat no matter how many people use the site.
const SNAPSHOT_KEY = "transit-snapshot-v1";

export async function loadSnapshot(): Promise<{ payload: Record<string, unknown>; savedAt: number } | null> {
  const config = configuration();
  if (!config) return null;
  const response = await fetch(
    `${config.url}/rest/v1/bus_last_locations?select=bus_data,last_seen_at&vehicle_key=eq.${SNAPSHOT_KEY}&limit=1`,
    { headers: headers(config.serviceKey), cache: "no-store" },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as FleetRow[];
  if (!rows.length) return null;
  const savedAt = Date.parse(rows[0].last_seen_at);
  return { payload: rows[0].bus_data, savedAt: Number.isFinite(savedAt) ? savedAt : 0 };
}

export async function saveSnapshot(payload: Record<string, unknown>) {
  const config = configuration();
  if (!config) return;
  const now = new Date().toISOString();
  await fetch(`${config.url}/rest/v1/bus_last_locations?on_conflict=vehicle_key`, {
    method: "POST",
    headers: { ...headers(config.serviceKey), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ vehicle_key: SNAPSHOT_KEY, bus_data: payload, last_seen_at: now, updated_at: now }]),
  }).catch(() => {});
}

export async function saveLiveFleet(buses: Array<{ vehicleKey: string; bus: Record<string, unknown> }>) {
  const config = configuration();
  if (!config || buses.length === 0) return;

  const now = new Date().toISOString();
  const response = await fetch(`${config.url}/rest/v1/bus_last_locations?on_conflict=vehicle_key`, {
    method: "POST",
    headers: {
      ...headers(config.serviceKey),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(buses.map(({ vehicleKey, bus }) => ({
      vehicle_key: vehicleKey,
      bus_data: bus,
      last_seen_at: now,
      updated_at: now,
    }))),
  });
  if (!response.ok) throw new Error(`Supabase fleet save returned ${response.status}`);
}
