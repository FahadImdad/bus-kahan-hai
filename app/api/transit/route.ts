import { NextRequest, NextResponse } from "next/server";
import { loadSavedFleet, saveLiveFleet, supabaseFleetEnabled } from "../../lib/supabase-fleet";

export const runtime = "edge";

const BASE_URL = "https://mobile.peoplebusservice.com/rl1/";
const REFERENCE_KML_URL = "https://www.google.com/maps/d/kml?mid=15gf9WXMKT4x8Rna53Q7yEs2YEGS2-7s&forcekml=1";
type RouteResponseEntry = {
  routeCode: string;
  direction: string;
  response: { pathList?: Array<Record<string, unknown>> };
  source: "live" | "retained" | "empty";
};
let fleetCache: { expiresAt: number; entries: RouteResponseEntry[] } | null = null;
let fleetRefreshPromise: Promise<RouteResponseEntry[]> | null = null;
let directoryCache: { expiresAt: number; data: Record<string, unknown> } | null = null;
let referenceRouteCache: { expiresAt: number; paths: Array<Record<string, unknown>> } | null = null;
const vehicleMemory = new Map<string, { bus: Record<string, unknown>; lastSeenAt: number }>();

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function decodeXml(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

async function referenceRoutePaths() {
  if (referenceRouteCache && referenceRouteCache.expiresAt > Date.now()) return referenceRouteCache.paths;
  const response = await fetch(REFERENCE_KML_URL, {
    headers: { Accept: "application/vnd.google-earth.kml+xml, application/xml" },
    cf: { cacheTtl: 86_400, cacheEverything: true },
  } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
  if (!response.ok) throw new Error(`Reference route map returned ${response.status}`);
  const kml = await response.text();
  const paths = Array.from(kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)).flatMap((match) => {
    const block = match[1];
    const name = decodeXml(block.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? "");
    const routeMatch = name.match(/^(R\d+|EV-?\d+)/i);
    const coordinates = block.match(/<coordinates>([\s\S]*?)<\/coordinates>/)?.[1]?.trim() ?? "";
    if (!routeMatch || !coordinates) return [];
    const displayRouteCode = routeMatch[1].toUpperCase().replace(/^EV-?/, "EV-");
    const pointList = coordinates.split(/\s+/).flatMap((coordinate) => {
      const [lng, lat] = coordinate.split(",").map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
    });
    return pointList.length > 1 ? [
      { displayRouteCode, direction: "0", direction_name: "A to B", headSign: name, pointList },
      { displayRouteCode, direction: "1", direction_name: "B to A", headSign: name, pointList: [...pointList].reverse() },
    ] : [];
  });
  referenceRouteCache = { expiresAt: Date.now() + 86_400_000, paths };
  return paths;
}

function vehicleKey(bus: Record<string, unknown>) {
  const stableId = bus.busId ?? bus.vehicleId ?? bus.deviceId ?? bus.plateNumber ?? bus.plate;
  return stableId ? String(stableId) : "";
}

async function rememberVehicles(currentBuses: Record<string, unknown>[]) {
  const now = Date.now();
  if (supabaseFleetEnabled()) {
    try {
      const savedFleet = await loadSavedFleet();
      savedFleet.forEach((row) => {
        const lastSeenAt = Date.parse(row.last_seen_at);
        vehicleMemory.set(row.vehicle_key, {
          bus: row.bus_data,
          lastSeenAt: Number.isFinite(lastSeenAt) ? lastSeenAt : now,
        });
      });
    } catch (error) {
      console.error("Unable to load saved Supabase fleet", error);
    }
  }

  const liveFleet: Array<{ vehicleKey: string; bus: Record<string, unknown> }> = [];
  currentBuses.forEach((bus) => {
    const key = vehicleKey(bus);
    if (key) {
      vehicleMemory.set(key, { bus, lastSeenAt: now });
      liveFleet.push({ vehicleKey: key, bus });
    }
  });

  if (supabaseFleetEnabled()) {
    try {
      await saveLiveFleet(liveFleet);
    } catch (error) {
      console.error("Unable to save live fleet to Supabase", error);
    }
  }

  const fleet: Record<string, unknown>[] = [];
  vehicleMemory.forEach((entry, key) => {
    const ageMs = now - entry.lastSeenAt;
    const isLive = currentBuses.some((bus) => vehicleKey(bus) === key);
    fleet.push({
      ...entry.bus,
      vehicleKey: key,
      trackingStatus: isLive ? "live" : "recently_seen",
      lastSeenAt: new Date(entry.lastSeenAt).toISOString(),
      locationAgeSeconds: Math.round(ageMs / 1000),
    });
  });
  return fleet;
}

function passengerParams(lat = "24.860966", lng = "66.990501", language = "en") {
  return new URLSearchParams({
    region: "123",
    version: "Android_1.4.4(34)_15_web_com.kentkart.smtaapp",
    authType: "4",
    accuracy: "0",
    lat,
    lng,
    lang: language === "ur" ? "ur" : "en",
  });
}

async function passengerFetch(path: string, extra?: Record<string, string>, location?: { lat: string; lng: string; lang?: string }) {
  const params = passengerParams(location?.lat, location?.lng, location?.lang);
  Object.entries(extra ?? {}).forEach(([key, value]) => params.set(key, value));
  const response = await fetch(`${BASE_URL}${path}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 20, cacheEverything: true },
  } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
  if (!response.ok) throw new Error(`Passenger service returned ${response.status}`);
  return response.json();
}

async function routeInfoWithRetry(
  routeCode: string,
  direction: string,
  location?: { lat: string; lng: string; lang?: string },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await passengerFetch("api/v2.0/route/info", {
        displayRouteCode: routeCode,
        direction,
        resultType: "111111",
        shapeId: "",
        busStopId: "",
      }, location);
    } catch (error) {
      lastError = error;
      if (attempt < 1) await delay(200);
    }
  }
  throw lastError;
}

async function routeInfoEntries(
  routeCodes: string[],
  location?: { lat: string; lng: string; lang?: string },
  retainedEntries: RouteResponseEntry[] = [],
) {
  const tasks = routeCodes.flatMap((routeCode) => ["0", "1"].map((direction) => ({ routeCode, direction })));
  const retained = new Map(retainedEntries.map((entry) => [`${entry.routeCode}:${entry.direction}`, entry]));
  const entries: RouteResponseEntry[] = [];
  for (let index = 0; index < tasks.length; index += 8) {
    const batch = tasks.slice(index, index + 8);
    entries.push(...await Promise.all(batch.map(async ({ routeCode, direction }) => {
      try {
        return { routeCode, direction, response: await routeInfoWithRetry(routeCode, direction, location), source: "live" as const };
      } catch {
        const previous = retained.get(`${routeCode}:${direction}`);
        return previous
          ? { ...previous, source: "retained" as const }
          : { routeCode, direction, response: { pathList: [] }, source: "empty" as const };
      }
    })));
  }
  return entries;
}

async function routeDirectory(location?: { lat: string; lng: string; lang?: string }) {
  if (directoryCache && directoryCache.expiresAt > Date.now()) return directoryCache.data;
  try {
    const data = await passengerFetch("api/v2.0/route/list", undefined, location) as Record<string, unknown>;
    directoryCache = { expiresAt: Date.now() + 5 * 60_000, data };
    return data;
  } catch (error) {
    if (directoryCache) return directoryCache.data;
    throw error;
  }
}

function refreshFleet(routeCodes: string[], location?: { lat: string; lng: string; lang?: string }) {
  if (!fleetRefreshPromise) {
    fleetRefreshPromise = routeInfoEntries(routeCodes, location, fleetCache?.entries ?? [])
      .then((entries) => {
        fleetCache = { expiresAt: Date.now() + 30_000, entries };
        return entries;
      })
      .finally(() => { fleetRefreshPromise = null; });
  }
  return fleetRefreshPromise;
}

export async function GET(request: NextRequest) {
  try {
    const requestedLat = Number(request.nextUrl.searchParams.get("lat"));
    const requestedLng = Number(request.nextUrl.searchParams.get("lng"));
    const requestedLanguage = request.nextUrl.searchParams.get("lang") === "ur" ? "ur" : "en";
    const location = {
      lat: Number.isFinite(requestedLat) ? String(requestedLat) : "24.860966",
      lng: Number.isFinite(requestedLng) ? String(requestedLng) : "66.990501",
      lang: requestedLanguage,
    };
    const directory = await routeDirectory(location);
    const roadAlignedRoutePaths = await referenceRoutePaths().catch(() => []);
    const uniqueStops = Array.from(
      new Map(
        (directory.stopList ?? []).map((stop: Record<string, unknown>) => [
          String(stop.stopId),
          stop,
        ]),
      ).values(),
    );
    const stopId = request.nextUrl.searchParams.get("stopId") ?? String((uniqueStops[0] as Record<string, unknown> | undefined)?.stopId ?? "");
    const displayRouteCode = request.nextUrl.searchParams.get("route") ?? "";
    const live = stopId
      ? await passengerFetch("api/bus/closest", { busStopId: stopId }, location).catch(() => ({ busList: [], routeList: [], stopInfo: null, result: { code: -1 } }))
      : { busList: [], routeList: [], stopInfo: null };
    const routeCodes = displayRouteCode
      ? [displayRouteCode]
      : (directory.routeList ?? []).map((route: Record<string, unknown>) => String(route.displayRouteCode ?? route.routeCode ?? "")).filter(Boolean);
    let routeResponses: RouteResponseEntry[];
    if (!displayRouteCode && fleetCache) {
      routeResponses = fleetCache.expiresAt > Date.now()
        ? fleetCache.entries
        : await refreshFleet(routeCodes, location);
    } else if (!displayRouteCode) {
      routeResponses = await refreshFleet(routeCodes, location);
    } else {
      routeResponses = await routeInfoEntries(routeCodes, location, displayRouteCode ? [] : fleetCache?.entries ?? []);
    }
    const routePaths = routeResponses.flatMap(({ response }) => response.pathList ?? []);
    const routeBuses = Array.from(new Map(routeResponses.flatMap(({ routeCode, response }) =>
      (response.pathList ?? []).flatMap((path: Record<string, unknown>) =>
        (Array.isArray(path.busList) ? path.busList : []).map((bus: Record<string, unknown>) => ({
          ...bus,
          routeCode,
          displayRouteCode: routeCode,
          plate: bus.plateNumber,
        })),
      ),
    ).map((bus: Record<string, unknown>) => [vehicleKey(bus) || `${bus.routeCode}-${bus.lat}-${bus.lng}`, bus])).values());
    const closestBuses = Array.isArray(live.busList) ? live.busList as Record<string, unknown>[] : [];
    const currentBuses = Array.from(new Map(
      [...routeBuses, ...closestBuses].map((bus) => [vehicleKey(bus) || `${bus.routeCode}-${bus.lat}-${bus.lng}`, bus]),
    ).values());
    const rememberedBuses = await rememberVehicles(currentBuses);

    return NextResponse.json(
      {
        ok: live.result?.code === 0,
        checkedAt: new Date().toISOString(),
        selectedStopId: stopId,
        stops: uniqueStops,
        routes: directory.routeList ?? [],
        stopInfo: live.stopInfo ?? null,
        buses: rememberedBuses,
        fleetStatus: {
          live: rememberedBuses.filter((bus) => bus.trackingStatus === "live").length,
          recentlySeen: rememberedBuses.filter((bus) => bus.trackingStatus === "recently_seen").length,
          retentionMode: supabaseFleetEnabled() ? "supabase_until_live_again" : "server_memory_until_live_again",
        },
        arrivals: live.routeList ?? [],
        routePaths,
        referenceRoutePaths: roadAlignedRoutePaths,
        coverage: {
          requestedRouteDirections: routeResponses.length,
          freshRouteDirections: routeResponses.filter((entry) => entry.source === "live").length,
          retainedRouteDirections: routeResponses.filter((entry) => entry.source === "retained").length,
          unavailableRouteDirections: routeResponses.filter((entry) => entry.source === "empty").length,
        },
      },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: "Live service is temporarily unavailable", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 },
    );
  }
}
