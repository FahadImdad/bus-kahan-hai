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
