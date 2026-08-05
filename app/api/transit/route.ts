import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const BASE_URL = "https://mobile.peoplebusservice.com/rl1/";

function passengerParams(lat = "24.860966", lng = "66.990501") {
  return new URLSearchParams({
    region: "123",
    version: "Android_1.4.4(34)_15_web_com.kentkart.smtaapp",
    authType: "4",
    accuracy: "0",
    lat,
    lng,
    lang: "en",
  });
}

async function passengerFetch(path: string, extra?: Record<string, string>, location?: { lat: string; lng: string }) {
  const params = passengerParams(location?.lat, location?.lng);
  Object.entries(extra ?? {}).forEach(([key, value]) => params.set(key, value));
  const response = await fetch(`${BASE_URL}${path}?${params.toString()}`, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 20, cacheEverything: true },
  } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } });
  if (!response.ok) throw new Error(`Passenger service returned ${response.status}`);
  return response.json();
}

export async function GET(request: NextRequest) {
  try {
    const requestedLat = Number(request.nextUrl.searchParams.get("lat"));
    const requestedLng = Number(request.nextUrl.searchParams.get("lng"));
    const location = Number.isFinite(requestedLat) && Number.isFinite(requestedLng)
      ? { lat: String(requestedLat), lng: String(requestedLng) }
      : undefined;
    const directory = await passengerFetch("api/v2.0/route/list", undefined, location);
    const uniqueStops = Array.from(
      new Map(
        (directory.stopList ?? []).map((stop: Record<string, unknown>) => [
          String(stop.stopId),
          stop,
        ]),
      ).values(),
    );
    const stopId = request.nextUrl.searchParams.get("stopId") ?? String((uniqueStops[0] as Record<string, unknown> | undefined)?.stopId ?? "");
    const live = stopId
      ? await passengerFetch("api/bus/closest", { busStopId: stopId }, location)
      : { busList: [], routeList: [], stopInfo: null };

    return NextResponse.json(
      {
        ok: live.result?.code === 0,
        checkedAt: new Date().toISOString(),
        selectedStopId: stopId,
        stops: uniqueStops,
        routes: directory.routeList ?? [],
        stopInfo: live.stopInfo ?? null,
        buses: live.busList ?? [],
        arrivals: live.routeList ?? [],
      },
      { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: "Live service is temporarily unavailable", detail: error instanceof Error ? error.message : "Unknown error" },
      { status: 502 },
    );
  }
}
