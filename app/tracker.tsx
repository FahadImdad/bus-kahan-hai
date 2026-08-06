"use client";

import type { Layer, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Stop = { stopId: string | number; name?: string; lat?: string | number; lng?: string | number };
type Route = { routeCode: string; displayRouteCode?: string; name?: string; routeColor?: string };
type Bus = { vehicleKey?: string; plate?: string; displayRouteCode?: string; routeCode?: string; lat?: string | number; lng?: string | number; latitude?: string | number; longitude?: string | number; bearing?: string | number; trackingStatus?: "live" | "recently_seen"; lastSeenAt?: string; locationAgeSeconds?: number };
type Arrival = { routeCode?: string; displayRouteCode?: string; name?: string; headSign?: string; nextTripArrivalTime?: string; stopArrivalTime?: string; routeColor?: string };
type RoutePath = { displayRouteCode?: string; direction?: string; headSign?: string; pointList?: Array<{ lat?: string | number; lng?: string | number }>; busStopList?: Array<{ stopId?: string | number; stopName?: string; lat?: string | number; lng?: string | number }> };
type Location = { lat: number; lng: number };
type MotionSample = Location & { at: number };
type TransitData = { ok: boolean; checkedAt: string; selectedStopId: string; stops: Stop[]; routes: Route[]; buses: Bus[]; arrivals: Arrival[]; routePaths?: RoutePath[]; referenceRoutePaths?: RoutePath[]; coverage?: { requestedRouteDirections: number; freshRouteDirections: number; retainedRouteDirections: number; unavailableRouteDirections: number }; stopInfo?: { busStopName?: string; name?: string; lat?: string | number; lng?: string | number } };

const KARACHI: [number, number] = [67.0099, 24.8615];
const VEHICLE_MEMORY_STORAGE_KEY = "bus-kahan-hai-vehicle-memory";
type Language = "en" | "ur";
const translations = {
  en: { subtitle: "Karachi People’s Bus tracker", live: "Live buses", online: "Feed online", refreshing: "Refreshing live feed", across: "live buses across Karachi", refreshHint: "Refreshes every 30 seconds", eyebrow: "Karachi live bus map", title1: "How far is", title2: "your bus?", intro: "Enable location. We will show nearby active buses and your nearest stop.", locating: "Finding your location…", enabled: "Current location enabled", useLocation: "Use my current location", permission: "Allow location permission and try again", nearestSelected: "Nearest stop selected automatically", nearestHint: "Find nearby buses and stops instantly", nearby: "Near you", activeNow: "Live now", road: "buses are on the road", showAll: "Show all", liveLocation: "Live location", away: "away", route: "Bus or route", allRoutes: "All routes", from: "From", to: "To", stopsCount: "stops on this route", nearestStop: "Nearest bus stop", selectedStop: "Selected stop", refresh: "Refresh", checking: "Checking…", arrivals: "When will it arrive?", etaPending: "Live ETA is not available yet", etaHint: "Bus location and minutes will appear when the service feed updates.", disclaimer: "Independent public service. Live information depends on the operator feed." },
  ur: { subtitle: "کراچی پیپلز بس ٹریکر", live: "لائیو بسیں", online: "فیڈ آن لائن", refreshing: "لائیو معلومات آرہی ہیں", across: "لائیو بسیں کراچی میں", refreshHint: "ہر 30 سیکنڈ بعد تازہ معلومات", eyebrow: "کراچی کا لائیو بس نقشہ", title1: "آپ کی بس", title2: "کتنی دور ہے؟", intro: "اپنی لوکیشن آن کریں، ہم قریب موجود بسیں اور نزدیک ترین اسٹاپ دکھائیں گے۔", locating: "آپ کی لوکیشن مل رہی ہے…", enabled: "موجودہ لوکیشن آن ہے", useLocation: "میری موجودہ لوکیشن استعمال کریں", permission: "لوکیشن کی اجازت دے کر دوبارہ کوشش کریں", nearestSelected: "قریب ترین اسٹاپ خود منتخب ہوگیا", nearestHint: "قریب موجود بسیں اور اسٹاپ فوراً دیکھیں", nearby: "آپ کے قریب", activeNow: "ابھی لائیو", road: "بسیں سڑک پر موجود ہیں", showAll: "سب دکھائیں", liveLocation: "لائیو لوکیشن", away: "دور", route: "بس یا روٹ", allRoutes: "تمام روٹس", from: "کہاں سے", to: "کہاں تک", stopsCount: "اس روٹ پر اسٹاپ", nearestStop: "قریب ترین بس اسٹاپ", selectedStop: "منتخب اسٹاپ", refresh: "تازہ کریں", checking: "چیک ہو رہا ہے…", arrivals: "بس کتنی دیر میں آئے گی؟", etaPending: "ابھی لائیو وقت دستیاب نہیں", etaHint: "سروس فیڈ اپ ڈیٹ ہوتے ہی بس کی لوکیشن اور منٹ یہاں دکھیں گے۔", disclaimer: "یہ ایک آزاد عوامی سروس ہے۔ لائیو معلومات آپریٹر کی فیڈ پر منحصر ہیں۔" },
} as const;

function numeric(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function clientVehicleKey(bus: Bus) { return bus.vehicleKey || bus.plate || `${bus.displayRouteCode || bus.routeCode}-${bus.lat ?? bus.latitude}-${bus.lng ?? bus.longitude}`; }
function storedVehicleMemory() {
  try { return JSON.parse(window.localStorage.getItem(VEHICLE_MEMORY_STORAGE_KEY) || "[]") as Bus[]; }
  catch { return []; }
}
function saveVehicleMemory(buses: Bus[]) {
  try { window.localStorage.setItem(VEHICLE_MEMORY_STORAGE_KEY, JSON.stringify(buses)); }
  catch { /* Tracking continues even when browser storage is unavailable. */ }
}
function mergeRememberedBuses(previous: Bus[], incoming: Bus[]) {
  const incomingKeys = new Set(incoming.map(clientVehicleKey));
  const now = Date.now();
  const remembered = previous.filter((bus) => !incomingKeys.has(clientVehicleKey(bus))).map((bus) => {
    const seenAt = Date.parse(bus.lastSeenAt || "");
    const lastSeen = Number.isFinite(seenAt) ? seenAt : now;
    return { ...bus, trackingStatus: "recently_seen" as const, lastSeenAt: new Date(lastSeen).toISOString(), locationAgeSeconds: Math.round((now - lastSeen) / 1000) };
  });
  return [...incoming, ...remembered];
}
function canonicalRouteCode(value = "") {
  const normalized = value.toUpperCase();
  const electric = normalized.match(/^EV-?0*(\d+)$/);
  return electric ? `EV-${Number(electric[1])}` : normalized;
}
function isKarachiBus(bus: Bus) { const lat = numeric(bus.lat ?? bus.latitude); const lng = numeric(bus.lng ?? bus.longitude); return lat !== null && lng !== null && lat >= 24.65 && lat <= 25.18 && lng >= 66.75 && lng <= 67.45; }
function routeLineColor(code = "") {
  const pinkRoute = code.match(/^pink-?(\d+)/i);
  if (pinkRoute) {
    const number = Number(pinkRoute[1]);
    const pinkShades = ["#ec407a", "#d81b60", "#ad1457", "#f06292", "#c2185b", "#e91e63", "#880e4f", "#f48fb1", "#b31264", "#ff4f87"];
    return pinkShades[(number - 1) % pinkShades.length];
  }
  const hash = [...code].reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 7), 0);
  return `hsl(${(hash * 47) % 360} 72% 39%)`;
}
function distanceKm(point: Location, stop: Stop) {
  const lat = numeric(stop.lat); const lng = numeric(stop.lng);
  if (lat === null || lng === null) return Number.POSITIVE_INFINITY;
  const rad = (value: number) => value * Math.PI / 180;
  const dLat = rad(lat - point.lat); const dLng = rad(lng - point.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(point.lat)) * Math.cos(rad(lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function busLocation(bus: Bus): Location | null {
  const lat = numeric(bus.lat ?? bus.latitude); const lng = numeric(bus.lng ?? bus.longitude);
  return lat === null || lng === null ? null : { lat, lng };
}
function routeDistanceKm(from: Location, to: Location, paths: RoutePath[]) {
  let best = Number.POSITIVE_INFINITY;
  paths.forEach((path) => {
    const points = (path.pointList ?? []).map((point) => ({ lat: numeric(point.lat), lng: numeric(point.lng) })).filter((point): point is Location => point.lat !== null && point.lng !== null);
    if (points.length < 2) return;
    const nearestIndex = (location: Location) => points.reduce((bestIndex, point, index) => distanceKm(location, { stopId: index, ...point }) < distanceKm(location, { stopId: bestIndex, ...points[bestIndex] }) ? index : bestIndex, 0);
    const fromIndex = nearestIndex(from); const toIndex = nearestIndex(to);
    let along = 0;
    for (let index = Math.min(fromIndex, toIndex); index < Math.max(fromIndex, toIndex); index += 1) along += distanceKm(points[index], { stopId: index + 1, ...points[index + 1] });
    const access = distanceKm(from, { stopId: "from", ...points[fromIndex] }) + distanceKm(to, { stopId: "to", ...points[toIndex] });
    best = Math.min(best, along + access);
  });
  return Number.isFinite(best) ? best : distanceKm(from, { stopId: "target", ...to }) * 1.22;
}
function distanceToRouteKm(point: Location, paths: RoutePath[]) {
  const latitudeScale = 111.32; const longitudeScale = 111.32 * Math.cos(point.lat * Math.PI / 180);
  let nearest = Number.POSITIVE_INFINITY;
  paths.forEach((path) => {
    const points = (path.pointList ?? []).map((item) => ({ lat: numeric(item.lat), lng: numeric(item.lng) })).filter((item): item is Location => item.lat !== null && item.lng !== null);
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]; const end = points[index];
      const ax = (start.lng - point.lng) * longitudeScale; const ay = (start.lat - point.lat) * latitudeScale;
      const bx = (end.lng - point.lng) * longitudeScale; const by = (end.lat - point.lat) * latitudeScale;
      const dx = bx - ax; const dy = by - ay; const lengthSquared = dx * dx + dy * dy;
      const ratio = lengthSquared ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared)) : 0;
      nearest = Math.min(nearest, Math.hypot(ax + dx * ratio, ay + dy * ratio));
    }
  });
  return nearest;
}
function stopsForRoute(data: TransitData | null, routeCode: string) {
  if (!data || !routeCode) return data?.stops ?? [];
  const matchingPaths = [...(data.referenceRoutePaths ?? []), ...(data.routePaths ?? [])].filter((path) => canonicalRouteCode(path.displayRouteCode) === canonicalRouteCode(routeCode));
  const unique = new Map<string, Stop>();
  matchingPaths.forEach((path) => (path.busStopList ?? []).forEach((stop) => {
    if (stop.stopId === undefined) return;
    unique.set(String(stop.stopId), { stopId: stop.stopId, name: stop.stopName, lat: stop.lat, lng: stop.lng });
  }));
  return unique.size ? [...unique.values()] : data.stops;
}
function offsetRoute(points: readonly (readonly [number, number])[], offset: number, currentMap: LeafletMap) {
  if (!offset) return points.map(([lat, lng]) => [lat, lng] as [number, number]);
  return points.map(([lat, lng]) => {
    const point = currentMap.latLngToLayerPoint([lat, lng]);
    return currentMap.layerPointToLatLng([point.x + offset, point.y + offset * .32]);
  });
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
  const mapNode = useRef<HTMLDivElement>(null); const map = useRef<LeafletMap | null>(null); const leaflet = useRef<typeof import("leaflet").default | null>(null); const baseMapLayer = useRef<Layer | null>(null); const markers = useRef<Layer[]>([]); const lastFittedMode = useRef("");
  const activeRequest = useRef<AbortController | null>(null); const requestSequence = useRef(0);
  const motionHistory = useRef(new Map<string, MotionSample[]>()); const pinModeRef = useRef(false);
  const [data, setData] = useState<TransitData | null>(null); const [selectedStop, setSelectedStop] = useState(""); const [selectedRoute, setSelectedRoute] = useState("");
  const [userLocation, setUserLocation] = useState<Location | null>(null); const [locationState, setLocationState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [manualLocation, setManualLocation] = useState<Location | null>(null); const [pinMode, setPinMode] = useState(false); const [mapRevision, setMapRevision] = useState(0);
  const [locationError, setLocationError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [language, setLanguage] = useState<Language>("en");
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");

  const load = useCallback(async (stopId?: string, location?: Location | null, routeCode?: string, silent = false) => {
    if (silent && activeRequest.current) return;
    activeRequest.current?.abort();
    const controller = new AbortController(); activeRequest.current = controller;
    const sequence = ++requestSequence.current;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams(); if (stopId) params.set("stopId", stopId);
      params.set("lang", language);
      if (location) { params.set("lat", String(location.lat)); params.set("lng", String(location.lng)); }
      if (routeCode) params.set("route", routeCode);
      const response = await fetch(`/api/transit${params.size ? `?${params}` : ""}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error();
      const next: TransitData = await response.json();
      if (sequence === requestSequence.current) {
        const sampledAt = Date.parse(next.checkedAt) || Date.now();
        next.buses.forEach((bus) => { const location = busLocation(bus); if (!location) return; const key = clientVehicleKey(bus); const samples = motionHistory.current.get(key) ?? []; const last = samples.at(-1); if (!last || distanceKm(location, { stopId: key, ...last }) > .005) motionHistory.current.set(key, [...samples.slice(-2), { ...location, at: sampledAt }]); });
        setData((previous) => { const mergedBuses = mergeRememberedBuses(previous?.buses?.length ? previous.buses : storedVehicleMemory(), next.buses); saveVehicleMemory(mergedBuses); return { ...next, buses: mergedBuses }; }); setSelectedStop(stopId || next.selectedStopId); setError("");
      }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError") && sequence === requestSequence.current) setError("Live service se connection nahi ho saka. Dobara try karein.");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (!silent && sequence === requestSequence.current) setLoading(false);
    }
  }, [language]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const saved = window.localStorage.getItem("bus-language"); if (saved === "ur") setLanguage("ur"); }, []);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === "ur" ? "rtl" : "ltr"; window.localStorage.setItem("bus-language", language); }, [language]);
  useEffect(() => { const node = mapNode.current; if (!node) return; node.classList.toggle("language-en", language === "en"); node.classList.toggle("pin-mode", pinMode); }, [language, pinMode]);
  const targetLocation = manualLocation ?? userLocation;
  useEffect(() => { pinModeRef.current = pinMode; }, [pinMode]);
  useEffect(() => { const timer = window.setInterval(() => load(selectedStop, targetLocation, selectedRoute, true), selectedRoute ? 10_000 : 15_000); return () => window.clearInterval(timer); }, [load, selectedRoute, selectedStop, targetLocation]);
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !mapNode.current || map.current) return;
      leaflet.current = L;
      map.current = L.map(mapNode.current, { zoomControl: true, attributionControl: true, minZoom: 10, maxZoom: 18, maxBounds: [[24.65, 66.75], [25.18, 67.45]], maxBoundsViscosity: 0.9 }).setView([KARACHI[1], KARACHI[0]], 11);
      map.current.on("zoomend", () => setMapRevision((value) => value + 1));
      window.setTimeout(() => { map.current?.invalidateSize(); setMapReady(true); }, 100);
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; leaflet.current = null; baseMapLayer.current = null; };
  }, []);

  useEffect(() => {
    const currentMap = map.current; if (!currentMap || !mapReady) return;
    const selectPoint = async (event: { latlng: { lat: number; lng: number } }) => {
      if (!pinModeRef.current) return;
      const location = { lat: event.latlng.lat, lng: event.latlng.lng };
      const selectedPaths = [...(data?.referenceRoutePaths ?? []), ...(data?.routePaths ?? [])].filter((path) => canonicalRouteCode(path.displayRouteCode) === canonicalRouteCode(selectedRoute));
      if (!selectedPaths.length || distanceToRouteKm(location, selectedPaths) > .5) { setLocationError(language === "ur" ? "منتخب مقام روٹ سے بہت دور ہے۔ روٹ کے قریب پن لگائیں۔" : "That point is too far from the selected route. Place the pin within 500 m of the route."); setLocationState("error"); return; }
      setLocationError(""); setManualLocation(location); setPinMode(false); setLocationState("idle");
      const routeStops = stopsForRoute(data, selectedRoute);
      const nearest = routeStops.length ? [...routeStops].sort((a, b) => distanceKm(location, a) - distanceKm(location, b))[0] : null;
      await load(nearest ? String(nearest.stopId) : selectedStop, location, selectedRoute);
    };
    currentMap.on("click", selectPoint);
    return () => { currentMap.off("click", selectPoint); };
  }, [data, language, load, mapReady, selectedRoute, selectedStop]);

  useEffect(() => {
    const currentMap = map.current; const L = leaflet.current;
    if (!currentMap || !L || !mapReady) return;
    baseMapLayer.current?.remove();
    const isUrdu = language === "ur";
    const url = isUrdu
      ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
    baseMapLayer.current = L.tileLayer(url, {
      maxZoom: 18,
      noWrap: true,
      bounds: [[24.55, 66.65], [25.3, 67.6]],
      attribution: isUrdu ? "© OpenStreetMap contributors" : "Tiles © Esri",
    }).addTo(currentMap);
  }, [language, mapReady]);

  const locateMe = useCallback(() => {
    if (!selectedRoute) return;
    if (userLocation && !manualLocation) { setUserLocation(null); setLocationState("idle"); setLocationError(""); void load(selectedStop, null, selectedRoute); return; }
    if (!navigator.geolocation) { setLocationState("error"); setLocationError(language === "ur" ? "یہ براؤزر لوکیشن سپورٹ نہیں کرتا" : "This browser does not support location"); return; }
    setLocationState("loading"); setLocationError("");
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const location = { lat: coords.latitude, lng: coords.longitude };
      const selectedPaths = [...(data?.referenceRoutePaths ?? []), ...(data?.routePaths ?? [])].filter((path) => canonicalRouteCode(path.displayRouteCode) === canonicalRouteCode(selectedRoute));
      if (!selectedPaths.length || distanceToRouteKm(location, selectedPaths) > .5) { setLocationState("error"); setLocationError(language === "ur" ? "آپ کی لوکیشن منتخب روٹ سے بہت دور ہے۔ روٹ کے قریب مقام منتخب کریں۔" : "Your location is too far from the selected route. Choose a point within 500 m of the route."); return; }
      setLocationError(""); setManualLocation(null); setPinMode(false); setUserLocation(location); setLocationState("ready");
      if (map.current) {
        const focusBounds = map.current.getBounds().extend([location.lat, location.lng]).pad(0.15);
        map.current.setMaxBounds(focusBounds);
        map.current.flyTo([location.lat, location.lng], 15, { animate: true, duration: 0.8 });
      }
      const routeStops = stopsForRoute(data, selectedRoute);
      const nearest = routeStops.length ? [...routeStops].sort((a, b) => distanceKm(location, a) - distanceKm(location, b))[0] : null;
      await load(nearest ? String(nearest.stopId) : selectedStop, location, selectedRoute);
    }, (failure) => { setLocationState("error"); setLocationError(failure.code === 1 ? (language === "ur" ? "براؤزر سیٹنگ میں لوکیشن کی اجازت دیں" : "Allow location permission in browser settings") : failure.code === 2 ? (language === "ur" ? "آپ کی لوکیشن دستیاب نہیں" : "Your location is currently unavailable") : (language === "ur" ? "لوکیشن ملنے میں زیادہ وقت لگ رہا ہے، دوبارہ کوشش کریں" : "Location timed out, please try again")); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 });
  }, [data, language, load, manualLocation, selectedRoute, selectedStop, userLocation]);

  useEffect(() => {
    if (selectedRoute) return;
    setPinMode(false); setManualLocation(null); setUserLocation(null); setLocationState("idle"); setLocationError("");
  }, [selectedRoute]);

  useEffect(() => {
    const currentMap = map.current; const L = leaflet.current; if (!currentMap || !L || !data) return;
    markers.current.forEach((marker) => marker.remove()); markers.current = [];
    if (targetLocation) { const marker = L.marker([targetLocation.lat, targetLocation.lng], { icon: L.divIcon({ className: "user-marker-wrap", html: `<div class="user-marker${manualLocation ? " manual" : ""}"></div>`, iconSize: [23, 23], iconAnchor: [11, 22] }) }).addTo(currentMap); marker.bindTooltip(manualLocation ? (language === "ur" ? "منتخب مقام" : "Selected location") : (language === "ur" ? "آپ کی موجودہ لوکیشن" : "Your current location")); markers.current.push(marker); }
    const selected = data.stops.find((stop) => String(stop.stopId) === data.selectedStopId);
    const stopLat = numeric(data.stopInfo?.lat ?? selected?.lat); const stopLng = numeric(data.stopInfo?.lng ?? selected?.lng);
    if (stopLat !== null && stopLng !== null) { const marker = L.marker([stopLat, stopLng], { icon: L.divIcon({ className: "stop-marker-wrap", html: '<div class="stop-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(currentMap); marker.bindTooltip(language === "ur" ? "منتخب بس اسٹاپ" : "Selected bus stop"); markers.current.push(marker); }
    const fitMode = selectedRoute || "__all__";
    const shouldAutoFit = lastFittedMode.current !== fitMode;
    const busPositions: [number, number][] = [];
    const referencePaths = data.referenceRoutePaths ?? [];
    const selectedReferencePaths = selectedRoute ? referencePaths.filter((path) => canonicalRouteCode(path.displayRouteCode) === canonicalRouteCode(selectedRoute)) : [];
    const displayRoutePaths = selectedRoute && !selectedReferencePaths.length ? (data.routePaths ?? []) : referencePaths.length ? referencePaths.filter((path) => path.direction !== "1") : (data.routePaths ?? []);
    data.buses.filter((bus) => isKarachiBus(bus) && (!selectedRoute || bus.routeCode === selectedRoute)).forEach((bus) => {
      const lat = numeric(bus.lat ?? bus.latitude); const lng = numeric(bus.lng ?? bus.longitude); if (lat === null || lng === null) return;
      busPositions.push([lng, lat]);
      const label = bus.displayRouteCode || "BUS";
      const color = routeLineColor(label);
      const isRecentlySeen = bus.trackingStatus === "recently_seen";
      const ageMinutes = Math.max(1, Math.round((bus.locationAgeSeconds ?? 0) / 60));
      const statusLabel = isRecentlySeen
        ? (language === "ur" ? `${ageMinutes} منٹ پہلے دیکھا گیا` : `Last seen ${ageMinutes} min ago`)
        : (language === "ur" ? "ابھی لائیو" : "Live now");
      const vehicleLabel = bus.plate ?? (language === "ur" ? "بس گاڑی" : "Bus vehicle");
      const marker = L.marker([lat, lng], { icon: L.divIcon({ className: "bus-marker-wrap", html: `<button class="bus-marker${isRecentlySeen ? " recently-seen" : ""}" style="background:${color}" aria-label="${statusLabel} bus ${label}">${label}</button>`, iconSize: [48, 30], iconAnchor: [24, 15] }) }).addTo(currentMap);
      marker.bindPopup(`<div dir="${language === "ur" ? "rtl" : "ltr"}"><strong>${label}</strong><br>${vehicleLabel}<br>${statusLabel}</div>`); markers.current.push(marker);
    });
    const operatingAreaPoints: Array<[number, number]> = busPositions.map(([lng, lat]) => [lat, lng]);
    const activeRouteCodes = new Set(data.buses.filter(isKarachiBus).map((bus) => canonicalRouteCode(bus.displayRouteCode || bus.routeCode)).filter(Boolean));
    if (!selectedRoute) {
      const orderedPaths = [...displayRoutePaths].sort((a, b) => canonicalRouteCode(a.displayRouteCode).localeCompare(canonicalRouteCode(b.displayRouteCode), undefined, { numeric: true }));
      orderedPaths.forEach((path, index) => {
        const points = (path.pointList ?? []).map((point) => [numeric(point.lat), numeric(point.lng)] as const).filter((point): point is readonly [number, number] => point[0] !== null && point[1] !== null && point[0] >= 24.65 && point[0] <= 25.18 && point[1] >= 66.75 && point[1] <= 67.45);
        if (points.length < 2) return;
        if (!activeRouteCodes.size || activeRouteCodes.has(canonicalRouteCode(path.displayRouteCode))) {
          operatingAreaPoints.push(...points.map(([lat, lng]) => [lat, lng] as [number, number]));
        }
        const coordinates = offsetRoute(points, ((index % 9) - 4) * 2.1, currentMap);
        const casing = L.polyline(coordinates, { color: "#ffffff", weight: 0, opacity: 0, lineCap: "round", lineJoin: "round", interactive: false }).addTo(currentMap);
        const line = L.polyline(coordinates, { color: routeLineColor(path.displayRouteCode), weight: 4, opacity: 0.96, lineCap: "round", lineJoin: "round" }).addTo(currentMap);
        line.bindTooltip(path.displayRouteCode || (language === "ur" ? "بس روٹ" : "Bus route"), { sticky: true }); markers.current.push(line);
        markers.current.push(casing);
      });
    }
    const selectedPathPoints = selectedRoute ? (selectedReferencePaths.length ? selectedReferencePaths : displayRoutePaths).flatMap((path) => (path.pointList ?? []).map((point) => [numeric(point.lat), numeric(point.lng)] as const).filter((point): point is readonly [number, number] => point[0] !== null && point[1] !== null)) : [];
    if (selectedPathPoints.length > 1) {
      const selectedColor = routeLineColor(selectedRoute);
      const selectedCoordinates = selectedPathPoints.map(([lat, lng]) => [lat, lng]);
      const casing = L.polyline(selectedCoordinates, { color: "#ffffff", weight: 11, opacity: 0.94, lineCap: "round", lineJoin: "round", interactive: false }).addTo(currentMap);
      const line = L.polyline(selectedCoordinates, { color: selectedColor, weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(currentMap);
      markers.current.push(casing, line);
      const primaryDirectionPoints = (selectedReferencePaths[0]?.pointList ?? []).map((point) => [numeric(point.lat), numeric(point.lng)] as const).filter((point): point is readonly [number, number] => point[0] !== null && point[1] !== null);
      const endpointPoints = primaryDirectionPoints.length > 1 ? primaryDirectionPoints : selectedPathPoints;
      const endpoints = [[endpointPoints[0], "A", language === "ur" ? "روٹ کا آغاز" : "Route start"], [endpointPoints[endpointPoints.length - 1], "B", language === "ur" ? "روٹ کا اختتام" : "Route end"]] as const;
      endpoints.forEach(([point, label, title]) => { const marker = L.marker([point[0], point[1]], { icon: L.divIcon({ className: "route-end-wrap", html: `<div class="route-end" style="border-color:${selectedColor};color:${selectedColor}">${label}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(currentMap); marker.bindTooltip(title); markers.current.push(marker); });
      false && selectedReferencePaths.forEach((path, index) => {
        const points = (path.pointList ?? []).map((point) => [numeric(point.lat), numeric(point.lng)] as const).filter((point): point is readonly [number, number] => point[0] !== null && point[1] !== null);
        if (points.length < 3) return;
        const arrowPoint = points[Math.floor(points.length * .36)];
        const arrow = index === 0 ? "→" : "←";
        const title = index === 0 ? (language === "ur" ? "A سے B" : "A to B") : (language === "ur" ? "B سے A" : "B to A");
        const marker = L.marker([arrowPoint[0], arrowPoint[1]], { icon: L.divIcon({ className: "route-direction-wrap", html: `<div class="route-direction" style="background:${selectedColor}">${arrow}</div>`, iconSize: [30, 24], iconAnchor: [15, 12] }) }).addTo(currentMap);
        marker.bindTooltip(title, { direction: "top" }); markers.current.push(marker);
      });
      const selectedBounds = line.getBounds();
      if (targetLocation) selectedBounds.extend([targetLocation.lat, targetLocation.lng]);
      const selectedNavigationBounds = selectedBounds.pad(0.08);
      currentMap.setMaxBounds(selectedNavigationBounds);
      currentMap.setMinZoom(Math.max(10, currentMap.getBoundsZoom(selectedNavigationBounds, false, [36, 36])));
      if (shouldAutoFit) { currentMap.fitBounds(selectedNavigationBounds, { padding: [36, 36], maxZoom: 14, animate: true }); lastFittedMode.current = fitMode; }
    }
    if (!selectedRoute && operatingAreaPoints.length) {
      const operatingBounds = L.latLngBounds(operatingAreaPoints);
      if (targetLocation) operatingBounds.extend([targetLocation.lat, targetLocation.lng]);
      const operatingNavigationBounds = operatingBounds.pad(0.04);
      currentMap.setMaxBounds(operatingNavigationBounds);
      currentMap.setMinZoom(Math.max(10, currentMap.getBoundsZoom(operatingNavigationBounds, false, [30, 30])));
      if (shouldAutoFit) { currentMap.fitBounds(operatingNavigationBounds, { padding: [30, 30], maxZoom: 13, animate: true }); lastFittedMode.current = fitMode; }
    }
  }, [data, language, manualLocation, mapReady, mapRevision, selectedRoute, targetLocation]);

  const availableStops = useMemo(() => stopsForRoute(data, selectedRoute), [data, selectedRoute]);
  const stopName = useMemo(() => availableStops.find((stop) => String(stop.stopId) === selectedStop)?.name || data?.stopInfo?.busStopName || data?.stopInfo?.name || `Stop ${selectedStop}`, [availableStops, data?.stopInfo, selectedStop]);
  const selectedDistance = useMemo(() => { const stop = availableStops.find((item) => String(item.stopId) === selectedStop); return targetLocation && stop ? distanceKm(targetLocation, stop) : null; }, [availableStops, selectedStop, targetLocation]);
  const arrivals = useMemo(() => selectedRoute ? (data?.arrivals ?? []).filter((item) => item.routeCode === selectedRoute) : (data?.arrivals ?? []), [data, selectedRoute]);
  const nearbyBuses = useMemo(() => {
    const buses = (data?.buses ?? []).filter((bus) => bus.trackingStatus !== "recently_seen" && isKarachiBus(bus) && (!selectedRoute || canonicalRouteCode(bus.displayRouteCode || bus.routeCode) === canonicalRouteCode(selectedRoute)));
    if (!targetLocation) return buses.map((bus) => ({ bus, distance: null as number | null, movement: "unknown" as const, etaMinutes: null as number | null }));
    return buses.map((bus) => {
      const current = busLocation(bus); if (!current) return { bus, distance: Number.POSITIVE_INFINITY, movement: "unknown" as const, etaMinutes: null as number | null };
      const routeCode = canonicalRouteCode(bus.displayRouteCode || bus.routeCode);
      const paths = [...(data?.referenceRoutePaths ?? []), ...(data?.routePaths ?? [])].filter((path) => canonicalRouteCode(path.displayRouteCode) === routeCode);
      const distance = routeDistanceKm(current, targetLocation, paths);
      const samples = motionHistory.current.get(clientVehicleKey(bus)) ?? [];
      const previous = samples.length > 1 ? samples[samples.length - 2] : null;
      const currentDistance = distanceKm(current, { stopId: "target", ...targetLocation });
      const previousDistance = previous ? distanceKm(previous, { stopId: "target", ...targetLocation }) : null;
      const moved = previous ? distanceKm(previous, { stopId: "current", ...current }) : 0;
      const movement = bus.trackingStatus === "recently_seen" || moved < .015 ? "unknown" : previousDistance !== null && currentDistance < previousDistance - .01 ? "approaching" : "away";
      const elapsedHours = previous ? Math.max((samples[samples.length - 1].at - previous.at) / 3_600_000, 1 / 3600) : 0;
      const observedSpeed = elapsedHours ? moved / elapsedHours : 18; const speed = Math.min(45, Math.max(10, observedSpeed));
      const etaMinutes = movement === "away" ? null : Math.max(1, Math.round(distance / speed * 60));
      return { bus, distance, movement, etaMinutes };
    }).sort((a, b) => (a.movement === "approaching" ? -1 : 0) - (b.movement === "approaching" ? -1 : 0) || a.distance - b.distance);
  }, [data, selectedRoute, targetLocation]);
  const liveRouteGroups = useMemo(() => {
    const groups = new Map<string, typeof nearbyBuses>();
    nearbyBuses.forEach((item) => { const route = item.bus.displayRouteCode || item.bus.routeCode || "BUS"; groups.set(route, [...(groups.get(route) ?? []), item]); });
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([route, buses]) => ({ route, buses }));
  }, [nearbyBuses]);
  const routeSummary = useMemo(() => {
    if (!selectedRoute) return null;
    const path = (data?.routePaths ?? []).find((item) => item.displayRouteCode === selectedRoute && (item.busStopList?.length ?? 0) > 1) ?? data?.routePaths?.[0];
    const stops = path?.busStopList ?? [];
    if (!stops.length) return null;
    return { from: stops[0]?.stopName || "Starting stop", to: stops[stops.length - 1]?.stopName || "Last stop", stops: stops.length };
  }, [data?.routePaths, selectedRoute]);
  const karachiRoutes = useMemo(() => (data?.routes ?? []).filter((route) => /^(R\d+|Pink-?\d+|EV-?0*\d+)$/i.test(route.displayRouteCode || route.routeCode || "")), [data?.routes]);
  const t = translations[language];
  const routeMatches = (bus: Bus) => !selectedRoute || canonicalRouteCode(bus.displayRouteCode || bus.routeCode) === canonicalRouteCode(selectedRoute);
  const visibleBusCount = (data?.buses ?? []).filter((bus) => isKarachiBus(bus) && routeMatches(bus) && bus.trackingStatus !== "recently_seen").length;
  const recentlySeenBusCount = (data?.buses ?? []).filter((bus) => isKarachiBus(bus) && routeMatches(bus) && bus.trackingStatus === "recently_seen").length;

  return <main className="app-shell" dir={language === "ur" ? "rtl" : "ltr"}>
    <header className="topbar"><a className="brand" href="#top" aria-label={language === "ur" ? "بس کہاں ہے؟" : "Bus Kahan Hai?"}><img className={`brand-logo ${language === "ur" ? "brand-logo-ur" : ""}`} src={language === "ur" ? "/brand/bus-kahan-hai-ur.png" : "/brand/bus-kahan-hai-en.png"} alt={language === "ur" ? "بس کہاں ہے؟" : "Bus Kahan Hai?"} /></a><div className="topbar-actions"><div className="language-toggle" aria-label="Choose language"><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button><button className={language === "ur" ? "active" : ""} onClick={() => setLanguage("ur")}>اردو</button></div><span className={`feed-pill ${visibleBusCount ? "is-live" : ""}`}><i />{visibleBusCount ? t.live : t.online}</span></div></header>
    <section className="tracker" id="top">
      <div className="map-panel"><div ref={mapNode} className="map" aria-label={language === "ur" ? "کراچی بس کا نقشہ" : "Karachi bus map"} /><div className="map-status"><span className="pulse" /><div><b>{loading ? t.refreshing : `${visibleBusCount} ${t.across}${recentlySeenBusCount ? `, ${recentlySeenBusCount} recently seen` : ""}`}</b><small>{language === "ur" ? `ہر ${selectedRoute ? 10 : 15} سیکنڈ بعد تازہ معلومات` : `Refreshes every ${selectedRoute ? 10 : 15} seconds`}</small></div></div></div>
      <aside className="control-panel"><div className="sheet-handle" aria-hidden="true" /><div className="eyebrow-row"><div className="eyebrow">{t.eyebrow}</div>{data?.coverage && <div className="coverage-mini" role="status"><b>{data.coverage.freshRouteDirections + data.coverage.retainedRouteDirections}/{data.coverage.requestedRouteDirections}</b><span>{language === "ur" ? "فیڈ چیک" : "feeds checked"}</span></div>}</div><h1>{t.title1}<br /><em>{t.title2}</em></h1><p className="intro">{t.intro}</p>
        <div className="nearby-heading live-heading"><div><span>{targetLocation ? t.nearby : t.activeNow}</span><b>{visibleBusCount} {t.road}</b></div>{selectedRoute && <button onClick={() => { setSelectedRoute(""); load(selectedStop, targetLocation); }}>{t.showAll}</button>}</div>
        <div className="live-route-groups" aria-label="Active buses grouped by route">{liveRouteGroups.map(({ route, buses }) => <section className="live-route-group" key={route}><button className="live-route-title" onClick={() => { setSelectedRoute(route); setUserLocation(null); setManualLocation(null); setPinMode(false); setLocationState("idle"); void load("", null, route); }}><span style={{ backgroundColor: routeLineColor(route) }}>{route}</span><b>{buses.length} {language === "ur" ? "لائیو بسیں" : buses.length === 1 ? "live bus" : "live buses"}</b></button><div className="bus-strip">{buses.map(({ bus, distance, movement, etaMinutes }, index) => <button className={selectedRoute === route ? "active" : ""} key={`${route}-${bus.plate}-${index}`} onClick={() => { setSelectedRoute(route); void load(selectedStop, targetLocation, route); }}><span style={{ backgroundColor: routeLineColor(route) }}>{route}</span><div><b>{bus.plate || "Live bus"}</b><small>{distance === null ? t.liveLocation : `${distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`} · ${movement === "approaching" ? (language === "ur" ? "آپ کی طرف" : "Approaching") : movement === "away" ? (language === "ur" ? "دور جا رہی ہے" : "Moving away") : (language === "ur" ? "حرکت چیک ہو رہی ہے" : "Checking movement")}${etaMinutes ? ` · ~${etaMinutes} min` : ""}`}</small></div></button>)}</div></section>)}</div>
        <label className="select-label" htmlFor="route">{t.route}</label><div className="select-wrap route-select"><select id="route" value={selectedRoute} onChange={(event) => { const route = event.target.value; setSelectedRoute(route); setUserLocation(null); setManualLocation(null); setPinMode(false); setLocationState("idle"); setLocationError(""); void load("", null, route); }}><option value="">{t.allRoutes}</option>{karachiRoutes.map((route) => <option key={route.routeCode} value={route.displayRouteCode || route.routeCode}>{route.displayRouteCode || route.routeCode} · {route.name}</option>)}</select></div>
        {routeSummary && <div className="route-summary"><span className="route-summary-code" style={{ backgroundColor: routeLineColor(selectedRoute) }}>{selectedRoute}</span><div className="route-journey"><div><i style={{ borderColor: routeLineColor(selectedRoute), color: routeLineColor(selectedRoute) }}>A</i><span><small>{t.from}</small><b>{routeSummary.from}</b></span></div><div className="route-connector" style={{ backgroundColor: routeLineColor(selectedRoute) }} /><div><i style={{ borderColor: routeLineColor(selectedRoute), color: routeLineColor(selectedRoute) }}>B</i><span><small>{t.to}</small><b>{routeSummary.to}</b></span></div></div><small className="route-stop-count">{routeSummary.stops} {t.stopsCount}</small></div>}
        {!selectedRoute && <div className="route-required" role="status">{language === "ur" ? "جاری رکھنے کے لیے پہلے ایک بس روٹ منتخب کریں" : "Select one bus route to continue."}</div>}
        {selectedRoute && <div className="location-options"><button className={`location-button ${locationState === "ready" && !manualLocation ? "is-ready" : locationState === "error" ? "has-error" : ""}`} onClick={locateMe} disabled={locationState === "loading"}><span className="location-dot" /><span><b>{locationState === "loading" ? t.locating : locationState === "ready" && !manualLocation ? t.enabled : t.useLocation}</b><small>{locationState === "ready" && !manualLocation ? (language === "ur" ? "ہٹانے کے لیے دوبارہ کلک کریں" : "Click again to remove") : locationState === "error" ? locationError || t.permission : t.nearestHint}</small></span></button><button className={`location-button pin-button ${pinMode || manualLocation ? "is-ready" : ""}`} onClick={() => { if (manualLocation) { setManualLocation(null); setPinMode(false); setLocationError(""); void load(selectedStop, null, selectedRoute); } else { setUserLocation(null); setLocationState("idle"); setLocationError(""); setPinMode((value) => !value); } }}><span className="pin-dot" /><span><b>{language === "ur" ? "نقشے پر مقام منتخب کریں" : "Choose a point on the map"}</b><small>{manualLocation ? (language === "ur" ? "ہٹانے کے لیے دوبارہ کلک کریں" : "Click again to remove") : pinMode ? (language === "ur" ? "منسوخ کرنے کے لیے دوبارہ کلک کریں" : "Click again to cancel") : (language === "ur" ? "پن لگا کر بس کا وقت دیکھیں" : "Drop a pin to estimate arrivals")}</small></span></button></div>}
        {selectedRoute && targetLocation && <><label className="select-label" htmlFor="stop">{t.nearestStop}</label><div className="select-wrap"><select id="stop" value={selectedStop} onChange={(event) => { setSelectedStop(event.target.value); void load(event.target.value, targetLocation, selectedRoute); }}>{availableStops.map((stop) => <option key={String(stop.stopId)} value={String(stop.stopId)}>{stop.name || `Stop ${stop.stopId}`}</option>)}</select></div>{error ? <div className="notice error" role="alert">{error}</div> : <div className="stop-card"><div><span>{t.selectedStop}{selectedDistance !== null ? ` · ${selectedDistance < 1 ? `${Math.round(selectedDistance * 1000)} m` : `${selectedDistance.toFixed(1)} km`} ${t.away}` : ""}</span><strong>{stopName}</strong></div><button onClick={() => load(selectedStop, targetLocation, selectedRoute)} disabled={loading}>{loading ? t.checking : t.refresh}</button></div>}</>}
        {selectedRoute && targetLocation && <section className="arrivals" aria-live="polite"><div className="section-title"><h2>{t.arrivals}</h2><span>{data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
          {arrivals.length ? arrivals.slice(0, 4).map((arrival, index) => <article className="arrival-row" key={`${arrival.routeCode}-${index}`}><span className="route-badge" style={{ backgroundColor: routeLineColor(arrival.displayRouteCode || arrival.routeCode) }}>{arrival.displayRouteCode || arrival.routeCode || "BUS"}</span><div><b>{arrival.headSign || arrival.name || "People’s Bus"}</b><small>{arrival.nextTripArrivalTime || arrival.stopArrivalTime || t.etaPending}</small></div><strong className="eta">{etaLabel(arrival.nextTripArrivalTime || arrival.stopArrivalTime)}</strong></article>) : <div className="empty-state"><span className="empty-icon">B</span><div><b>{t.etaPending}</b><p>{t.etaHint}</p></div></div>}
        </section>}<p className="disclaimer">{t.disclaimer}</p>
      </aside>
    </section>
  </main>;
}
