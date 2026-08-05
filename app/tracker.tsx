"use client";

import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stop = { stopId: string | number; name?: string; lat?: string | number; lng?: string | number };
type Route = { routeCode: string; displayRouteCode?: string; name?: string; routeColor?: string };
type Bus = { plate?: string; displayRouteCode?: string; routeCode?: string; lat?: string | number; lng?: string | number; latitude?: string | number; longitude?: string | number };
type Arrival = { routeCode?: string; displayRouteCode?: string; name?: string; headSign?: string; nextTripArrivalTime?: string; stopArrivalTime?: string; routeColor?: string };
type Location = { lat: number; lng: number };
type TransitData = { ok: boolean; checkedAt: string; selectedStopId: string; stops: Stop[]; routes: Route[]; buses: Bus[]; arrivals: Arrival[]; stopInfo?: { busStopName?: string; name?: string; lat?: string | number; lng?: string | number } };

const KARACHI: [number, number] = [67.0099, 24.8615];
const mapStyle = { version: 8 as const, sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster" as const, source: "osm" }] };

function numeric(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function distanceKm(point: Location, stop: Stop) {
  const lat = numeric(stop.lat); const lng = numeric(stop.lng);
  if (lat === null || lng === null) return Number.POSITIVE_INFINITY;
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(lat - point.lat); const dLng = rad(lng - point.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(point.lat)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function etaLabel(value?: string) {
  if (!value) return "ETA pending";
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber >= 0) return `${Math.max(1, Math.round(asNumber))} min`;
  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (!match) return value;
  const now = new Date(); const arrival = new Date(now);
  arrival.setHours(Number(match[1]), Number(match[2]), 0, 0);
  if (arrival.getTime() < now.getTime() - 60_000) arrival.setDate(arrival.getDate() + 1);
  return `${Math.max(1, Math.round((arrival.getTime() - now.getTime()) / 60_000))} min`;
}

export function BusTracker() {
  const mapNode = useRef<HTMLDivElement>(null); const map = useRef<MapLibreMap | null>(null); const markers = useRef<Marker[]>([]);
  const [data, setData] = useState<TransitData | null>(null); const [selectedStop, setSelectedStop] = useState(""); const [selectedRoute, setSelectedRoute] = useState("");
  const [userLocation, setUserLocation] = useState<Location | null>(null); const [locationState, setLocationState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  const load = useCallback(async (stopId?: string, location?: Location | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams(); if (stopId) params.set("stopId", stopId);
      if (location) { params.set("lat", String(location.lat)); params.set("lng", String(location.lng)); }
      const response = await fetch(`/api/transit${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const next: TransitData = await response.json(); setData(next); setSelectedStop(next.selectedStopId); setError("");
    } catch { setError("Live service se connection nahi ho saka. Dobara try karein."); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => load(selectedStop, userLocation), 30_000); return () => window.clearInterval(timer); }, [load, selectedStop, userLocation]);
  useEffect(() => {
    if (!mapNode.current || map.current) return;
    map.current = new MapLibreMap({ container: mapNode.current, style: mapStyle, center: KARACHI, zoom: 11.3, attributionControl: false });
    map.current.addControl(new NavigationControl({ showCompass: false }), "top-right"); map.current.addControl(new AttributionControl({ compact: true }), "bottom-right");
    return () => { map.current?.remove(); map.current = null; };
  }, []);

  const locateMe = useCallback(() => {
    if (!navigator.geolocation) { setLocationState("error"); return; }
    setLocationState("loading");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const location = { lat: coords.latitude, lng: coords.longitude }; setUserLocation(location); setLocationState("ready");
      const nearest = data?.stops.length ? [...data.stops].sort((a, b) => distanceKm(location, a) - distanceKm(location, b))[0] : null;
      await load(nearest ? String(nearest.stopId) : selectedStop, location);
    }, () => setLocationState("error"), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 });
  }, [data?.stops, load, selectedStop]);

  useEffect(() => {
    const currentMap = map.current; if (!currentMap || !data) return;
    markers.current.forEach((marker) => marker.remove()); markers.current = [];
    if (userLocation) { const node = document.createElement("div"); node.className = "user-marker"; markers.current.push(new Marker({ element: node }).setLngLat([userLocation.lng, userLocation.lat]).addTo(currentMap)); }
    const selected = data.stops.find((stop) => String(stop.stopId) === data.selectedStopId);
    const stopLat = numeric(data.stopInfo?.lat ?? selected?.lat); const stopLng = numeric(data.stopInfo?.lng ?? selected?.lng);
    if (stopLat !== null && stopLng !== null) { const node = document.createElement("div"); node.className = "stop-marker"; markers.current.push(new Marker({ element: node }).setLngLat([stopLng, stopLat]).addTo(currentMap)); currentMap.easeTo({ center: [stopLng, stopLat], zoom: 14, duration: 700 }); }
    data.buses.filter((bus) => !selectedRoute || bus.routeCode === selectedRoute).forEach((bus) => {
      const lat = numeric(bus.lat ?? bus.latitude); const lng = numeric(bus.lng ?? bus.longitude); if (lat === null || lng === null) return;
      const node = document.createElement("button"); node.className = "bus-marker"; node.textContent = bus.displayRouteCode || "BUS";
      const popup = new Popup({ offset: 20 }).setHTML(`<strong>${bus.displayRouteCode ?? "People’s Bus"}</strong><br>${bus.plate ?? "Live vehicle"}`);
      markers.current.push(new Marker({ element: node }).setLngLat([lng, lat]).setPopup(popup).addTo(currentMap));
    });
  }, [data, selectedRoute, userLocation]);

  const stopName = useMemo(() => data?.stopInfo?.busStopName || data?.stopInfo?.name || data?.stops.find((stop) => String(stop.stopId) === selectedStop)?.name || `Stop ${selectedStop}`, [data, selectedStop]);
  const selectedDistance = useMemo(() => { const stop = data?.stops.find((item) => String(item.stopId) === selectedStop); return userLocation && stop ? distanceKm(userLocation, stop) : null; }, [data, selectedStop, userLocation]);
  const arrivals = useMemo(() => selectedRoute ? (data?.arrivals ?? []).filter((item) => item.routeCode === selectedRoute) : (data?.arrivals ?? []), [data, selectedRoute]);

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark"><span /></span><span><b>Bus Kahan Hai?</b><small>Karachi People’s Bus tracker</small></span></a><span className={`feed-pill ${data?.buses.length ? "is-live" : ""}`}><i />{data?.buses.length ? "Live buses" : "Feed online"}</span></header>
    <section className="tracker" id="top">
      <div className="map-panel"><div ref={mapNode} className="map" aria-label="Karachi bus map" /><div className="map-status"><span className="pulse" /><div><b>{loading ? "Refreshing live feed" : `${data?.buses.length ?? 0} buses near this stop`}</b><small>Har 30 seconds mein refresh</small></div></div></div>
      <aside className="control-panel"><div className="eyebrow">Apna safar plan karein</div><h1>Bus select karo.<br /><em>Live ETA</em><br />dekho.</h1><p className="intro">Location on karein, nearest stop aur route select karein, phir real arrival time dekhein.</p>
        <button className={`location-button ${locationState === "ready" ? "is-ready" : ""}`} onClick={locateMe} disabled={locationState === "loading"}><span className="location-dot" /><span><b>{locationState === "loading" ? "Location mil rahi hai…" : locationState === "ready" ? "Current location enabled" : "Meri current location use karein"}</b><small>{locationState === "error" ? "Permission allow karke dobara try karein" : locationState === "ready" ? "Nearest stop automatically select ho gaya" : "Nearest bus stop foran mil jayega"}</small></span></button>
        <label className="select-label" htmlFor="route">Bus ya route</label><div className="select-wrap route-select"><select id="route" value={selectedRoute} onChange={(event) => setSelectedRoute(event.target.value)}><option value="">Sab routes</option>{(data?.routes ?? []).map((route) => <option key={route.routeCode} value={route.routeCode}>{route.displayRouteCode || route.routeCode} · {route.name}</option>)}</select></div>
        <label className="select-label" htmlFor="stop">Nearest bus stop</label><div className="select-wrap"><select id="stop" value={selectedStop} onChange={(event) => load(event.target.value, userLocation)}>{(data?.stops ?? []).map((stop) => <option key={String(stop.stopId)} value={String(stop.stopId)}>{stop.name || `Stop ${stop.stopId}`}</option>)}</select></div>
        {error ? <div className="notice error" role="alert">{error}</div> : <div className="stop-card"><div><span>Selected stop{selectedDistance !== null ? ` · ${selectedDistance < 1 ? `${Math.round(selectedDistance * 1000)} m` : `${selectedDistance.toFixed(1)} km`} away` : ""}</span><strong>{stopName}</strong></div><button onClick={() => load(selectedStop, userLocation)} disabled={loading}>{loading ? "Checking…" : "Refresh"}</button></div>}
        <section className="arrivals" aria-live="polite"><div className="section-title"><h2>Kitni dair mein ayegi</h2><span>{data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
          {arrivals.length ? arrivals.slice(0, 4).map((arrival, index) => <article className="arrival-row" key={`${arrival.routeCode}-${index}`}><span className="route-badge" style={{ backgroundColor: arrival.routeColor ? `#${arrival.routeColor.replace("#", "")}` : undefined }}>{arrival.displayRouteCode || arrival.routeCode || "BUS"}</span><div><b>{arrival.headSign || arrival.name || "People’s Bus"}</b><small>{arrival.nextTripArrivalTime || arrival.stopArrivalTime || "Live timing pending"}</small></div><strong className="eta">{etaLabel(arrival.nextTripArrivalTime || arrival.stopArrivalTime)}</strong></article>) : <div className="empty-state"><span className="empty-icon">B</span><div><b>Abhi live ETA available nahi</b><p>Service active hote hi bus location aur minutes yahan show honge.</p></div></div>}
        </section><p className="disclaimer">Independent public service. Live information operator feed par depend karti hai.</p>
      </aside>
    </section>
  </main>;
}
