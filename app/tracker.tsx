"use client";

import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stop = { stopId: string | number; name?: string; lat?: string | number; lng?: string | number };
type Bus = { plate?: string; displayRouteCode?: string; lat?: string | number; lng?: string | number; latitude?: string | number; longitude?: string | number; nextTripArrivalTime?: string; timeDiff?: string | number; routeColor?: string };
type Arrival = { routeCode?: string; displayRouteCode?: string; name?: string; headSign?: string; nextTripArrivalTime?: string; stopArrivalTime?: string; routeColor?: string };
type TransitData = { ok: boolean; checkedAt: string; selectedStopId: string; stops: Stop[]; buses: Bus[]; arrivals: Arrival[]; stopInfo?: { busStopName?: string; name?: string; lat?: string | number; lng?: string | number } };

const KARACHI: [number, number] = [67.0099, 24.8615];
const mapStyle = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function BusTracker() {
  const mapNode = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [data, setData] = useState<TransitData | null>(null);
  const [selectedStop, setSelectedStop] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (stopId?: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/transit${stopId ? `?stopId=${encodeURIComponent(stopId)}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Live feed unavailable");
      const next: TransitData = await response.json();
      setData(next);
      setSelectedStop(next.selectedStopId);
      setError("");
    } catch {
      setError("Live service se connection nahi ho saka. Dobara try karein.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => load(selectedStop), 30_000);
    return () => window.clearInterval(timer);
  }, [load, selectedStop]);

  useEffect(() => {
    if (!mapNode.current || map.current) return;
    map.current = new MapLibreMap({ container: mapNode.current, style: mapStyle, center: KARACHI, zoom: 11.3, attributionControl: false });
    map.current.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.current.addControl(new AttributionControl({ compact: true }), "bottom-right");
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const currentMap = map.current;
    if (!currentMap || !data) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];

    const selected = data.stops.find((stop) => String(stop.stopId) === data.selectedStopId);
    const stopLat = number(data.stopInfo?.lat ?? selected?.lat);
    const stopLng = number(data.stopInfo?.lng ?? selected?.lng);
    if (stopLat !== null && stopLng !== null) {
      const node = document.createElement("div");
      node.className = "stop-marker";
      node.setAttribute("aria-label", "Selected bus stop");
      markers.current.push(new Marker({ element: node }).setLngLat([stopLng, stopLat]).addTo(currentMap));
      currentMap.easeTo({ center: [stopLng, stopLat], zoom: 14, duration: 700 });
    }

    data.buses.forEach((bus) => {
      const lat = number(bus.lat ?? bus.latitude);
      const lng = number(bus.lng ?? bus.longitude);
      if (lat === null || lng === null) return;
      const node = document.createElement("button");
      node.className = "bus-marker";
      node.textContent = bus.displayRouteCode || "BUS";
      node.setAttribute("aria-label", `Bus ${bus.plate ?? ""}, route ${bus.displayRouteCode ?? ""}`);
      const popup = new Popup({ offset: 20 }).setHTML(`<strong>${bus.displayRouteCode ?? "People’s Bus"}</strong><br>${bus.plate ?? "Live vehicle"}`);
      markers.current.push(new Marker({ element: node }).setLngLat([lng, lat]).setPopup(popup).addTo(currentMap));
    });
  }, [data]);

  const stopName = useMemo(() => {
    const selected = data?.stops.find((stop) => String(stop.stopId) === selectedStop);
    return data?.stopInfo?.busStopName || data?.stopInfo?.name || selected?.name || `Stop ${selectedStop}`;
  }, [data, selectedStop]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Bus Kahan Hai home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span><b>Bus Kahan Hai?</b><small>Karachi People’s Bus tracker</small></span>
        </a>
        <span className={`feed-pill ${data?.buses.length ? "is-live" : ""}`}><i />{data?.buses.length ? "Live buses" : "Feed online"}</span>
      </header>

      <section className="tracker" id="top">
        <div className="map-panel">
          <div ref={mapNode} className="map" aria-label="Karachi bus map" />
          <div className="map-status">
            <span className="pulse" />
            <div><b>{loading ? "Refreshing live feed" : `${data?.buses.length ?? 0} buses near this stop`}</b><small>Automatically refreshes every 30 seconds</small></div>
          </div>
        </div>

        <aside className="control-panel">
          <div className="eyebrow">Plan less. Move better.</div>
          <h1>Apni bus ka<br /><em>intezar nahi,</em><br />location dekho.</h1>
          <p className="intro">Stop select karein. Active buses aur expected arrivals ek simple screen par dekhein.</p>

          <label className="select-label" htmlFor="stop">Bus stop</label>
          <div className="select-wrap">
            <select id="stop" value={selectedStop} onChange={(event) => load(event.target.value)} disabled={!data?.stops.length}>
              {(data?.stops ?? []).map((stop) => <option key={String(stop.stopId)} value={String(stop.stopId)}>{stop.name || `Stop ${stop.stopId}`}</option>)}
            </select>
          </div>

          {error ? <div className="notice error" role="alert">{error}</div> : (
            <div className="stop-card">
              <div><span>Selected stop</span><strong>{stopName}</strong></div>
              <button onClick={() => load(selectedStop)} disabled={loading} aria-label="Refresh live buses">{loading ? "Checking…" : "Refresh"}</button>
            </div>
          )}

          <section className="arrivals" aria-live="polite">
            <div className="section-title"><h2>Next arrivals</h2><span>{data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
            {data?.arrivals?.length ? data.arrivals.slice(0, 4).map((arrival, index) => (
              <article className="arrival-row" key={`${arrival.routeCode}-${index}`}>
                <span className="route-badge" style={{ backgroundColor: arrival.routeColor ? `#${arrival.routeColor.replace("#", "")}` : undefined }}>{arrival.displayRouteCode || arrival.routeCode || "BUS"}</span>
                <div><b>{arrival.headSign || arrival.name || "People’s Bus"}</b><small>{arrival.nextTripArrivalTime || arrival.stopArrivalTime || "Schedule available"}</small></div>
                <span className="arrow">›</span>
              </article>
            )) : <div className="empty-state"><span className="empty-icon">B</span><div><b>Abhi active bus nazar nahi aa rahi</b><p>Service hours mein location yahan automatically show hogi.</p></div></div>}
          </section>

          <p className="disclaimer">Independent public service. Live information availability operator feed par depend karti hai.</p>
        </aside>
      </section>
    </main>
  );
}
