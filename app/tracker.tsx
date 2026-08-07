"use client";

import type { Layer, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import logoEn from "./assets/bus-kahan-hai-en.png";
import logoUr from "./assets/bus-kahan-hai-ur.png";

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
const MAX_REMEMBERED_VEHICLES = 500;
type Language = "en" | "ur";
const translations = {
  en: { subtitle: "Karachi People’s Bus tracker", live: "Live buses", online: "Feed online", refreshing: "Refreshing live feed", across: "People’s Bus vehicles available live", refreshHint: "Refreshes every 30 seconds", eyebrow: "People’s Bus live map", title1: "Where is your", title2: "People’s Bus?", intro: "Choose a route or enable location to see available live buses and nearby stops.", locating: "Finding your location…", enabled: "Current location enabled", useLocation: "Use my current location", permission: "Allow location permission and try again", nearestSelected: "Nearest stop selected automatically", nearestHint: "Find nearby buses and stops instantly", nearby: "Near you", activeNow: "Available live", road: "People’s Bus vehicles are available live", showAll: "Show all", liveLocation: "Live location", away: "away", route: "People’s Bus or route", allRoutes: "All People’s Bus routes", from: "From", to: "To", stopsCount: "stops on this route", nearestStop: "Nearest bus stop", selectedStop: "Selected stop", refresh: "Refresh", checking: "Checking…", arrivals: "When will it arrive?", etaPending: "Live ETA is not available yet", etaHint: "Bus location and minutes will appear when the service feed updates.", disclaimer: "Live information depends on operator feed availability.", madeFor: "Made with love for Karachi commuters." },
  ur: { subtitle: "کراچی پیپلز بس ٹریکر", live: "لائیو بسیں", online: "فیڈ آن لائن", refreshing: "لائیو معلومات آرہی ہیں", across: "پیپلز بس کی دستیاب لائیو گاڑیاں", refreshHint: "ہر 30 سیکنڈ بعد تازہ معلومات", eyebrow: "پیپلز بس کا لائیو نقشہ", title1: "آپ کی پیپلز بس", title2: "کہاں ہے؟", intro: "روٹ منتخب کریں یا اپنی لوکیشن آن کرکے دستیاب لائیو بسیں اور قریبی اسٹاپ دیکھیں۔", locating: "آپ کی لوکیشن مل رہی ہے…", enabled: "موجودہ لوکیشن آن ہے", useLocation: "میری موجودہ لوکیشن استعمال کریں", permission: "لوکیشن کی اجازت دے کر دوبارہ کوشش کریں", nearestSelected: "قریب ترین اسٹاپ خود منتخب ہوگیا", nearestHint: "قریب موجود بسیں اور اسٹاپ فوراً دیکھیں", nearby: "آپ کے قریب", activeNow: "ابھی دستیاب", road: "پیپلز بس کی گاڑیاں لائیو دستیاب ہیں", showAll: "سب دکھائیں", liveLocation: "لائیو لوکیشن", away: "دور", route: "پیپلز بس یا روٹ", allRoutes: "پیپلز بس کے تمام روٹس", from: "کہاں سے", to: "کہاں تک", stopsCount: "اس روٹ پر اسٹاپ", nearestStop: "قریب ترین بس اسٹاپ", selectedStop: "منتخب اسٹاپ", refresh: "تازہ کریں", checking: "چیک ہو رہا ہے…", arrivals: "بس کتنی دیر میں آئے گی؟", etaPending: "ابھی لائیو وقت دستیاب نہیں", etaHint: "سروس فیڈ اپ ڈیٹ ہوتے ہی بس کی لوکیشن اور منٹ یہاں دکھیں گے۔", disclaimer: "لائیو معلومات آپریٹر فیڈ کی دستیابی پر منحصر ہیں۔", madeFor: "کراچی کے مسافروں کے لیے محبت سے بنایا گیا۔" },
} as const;

function numeric(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function clientVehicleKey(bus: Bus) { return bus.vehicleKey || bus.plate || `${bus.displayRouteCode || bus.routeCode}-${bus.lat ?? bus.latitude}-${bus.lng ?? bus.longitude}`; }
function storedVehicleMemory() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(VEHICLE_MEMORY_STORAGE_KEY) || "[]") as Bus[];
    const now = Date.now();
    return saved.map((bus) => {
      const seenAt = Date.parse(bus.lastSeenAt || "");
      const lastSeen = Number.isFinite(seenAt) ? seenAt : now;
      return { ...bus, trackingStatus: "recently_seen" as const, lastSeenAt: new Date(lastSeen).toISOString(), locationAgeSeconds: Math.max(0, Math.round((now - lastSeen) / 1000)) };
    });
  }
  catch { return []; }
}
function saveVehicleMemory(buses: Bus[]) {
  try {
    const safestRecentFleet = [...buses].sort((a, b) => Date.parse(b.lastSeenAt || "") - Date.parse(a.lastSeenAt || "")).slice(0, MAX_REMEMBERED_VEHICLES);
    window.localStorage.setItem(VEHICLE_MEMORY_STORAGE_KEY, JSON.stringify(safestRecentFleet));
  }
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
  const current = incoming.map((bus) => {
    const seenAt = Date.parse(bus.lastSeenAt || "");
    const lastSeen = Number.isFinite(seenAt) ? seenAt : now;
    return { ...bus, lastSeenAt: new Date(lastSeen).toISOString(), locationAgeSeconds: Math.max(0, Math.round((now - lastSeen) / 1000)) };
  });
  return [...current, ...remembered];
}

function lastSeenLabel(bus: Bus, language: Language) {
  const seconds = Math.max(0, bus.locationAgeSeconds ?? Math.round((Date.now() - Date.parse(bus.lastSeenAt || "")) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  const elapsed = `${hours ? `${hours}h ` : ""}${minutes ? `${minutes}m ` : ""}${remainingSeconds}s`;
  return language === "ur" ? `آخری مقام ${elapsed} پہلے` : `Last seen ${elapsed} ago`;
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
function snapToRoute(point: Location, paths: RoutePath[]) {
  const longitudeScale = Math.cos(point.lat * Math.PI / 180);
  let closest = point; let closestDistance = Number.POSITIVE_INFINITY;
  paths.forEach((path) => {
    const points = (path.pointList ?? []).map((item) => ({ lat: numeric(item.lat), lng: numeric(item.lng) })).filter((item): item is Location => item.lat !== null && item.lng !== null);
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]; const end = points[index];
      const dx = (end.lng - start.lng) * longitudeScale; const dy = end.lat - start.lat;
      const px = (point.lng - start.lng) * longitudeScale; const py = point.lat - start.lat;
      const lengthSquared = dx * dx + dy * dy;
      const ratio = lengthSquared ? Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared)) : 0;
      const candidate = { lat: start.lat + (end.lat - start.lat) * ratio, lng: start.lng + (end.lng - start.lng) * ratio };
      const distance = distanceKm(point, { stopId: "route", ...candidate });
      if (distance < closestDistance) { closestDistance = distance; closest = candidate; }
    }
  });
  return closestDistance <= .8 ? closest : point;
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
  const motionHistory = useRef(new Map<string, MotionSample[]>()); const pinModeRef = useRef(false); const autoLocationRequested = useRef(false);
  const [data, setData] = useState<TransitData | null>(null); const [selectedStop, setSelectedStop] = useState(""); const [selectedRoute, setSelectedRoute] = useState("");
  const [userLocation, setUserLocation] = useState<Location | null>(null); const [locationState, setLocationState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [manualLocation, setManualLocation] = useState<Location | null>(null); const [stopLocation, setStopLocation] = useState<Location | null>(null); const [pinMode, setPinMode] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [language, setLanguage] = useState<Language>("en"); const [liveFleetExpanded, setLiveFleetExpanded] = useState(false); const [inactiveFleetExpanded, setInactiveFleetExpanded] = useState(false); const [routeStopsExpanded, setRouteStopsExpanded] = useState(false);
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
        setData((previous) => { const mergedBuses = mergeRememberedBuses(previous?.buses?.length ? previous.buses : storedVehicleMemory(), next.buses); saveVehicleMemory(mergedBuses); return { ...next, buses: mergedBuses }; }); setSelectedStop(stopId || (routeCode ? "" : next.selectedStopId)); setError("");
      }
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError") && sequence === requestSequence.current) {
        setData((previous) => previous ?? { ok: false, checkedAt: new Date().toISOString(), selectedStopId: "", stops: [], routes: [], buses: storedVehicleMemory(), arrivals: [] });
        setError("Live service se connection nahi ho saka. Saved last locations dikhayi ja rahi hain.");
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      if (!silent && sequence === requestSequence.current) setLoading(false);
    }
  }, [language]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (autoLocationRequested.current || !navigator.geolocation) return;
    autoLocationRequested.current = true; setLocationState("loading");
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const location = { lat: coords.latitude, lng: coords.longitude };
      setUserLocation(location); setLocationState("ready"); setLocationError("");
      map.current?.flyTo([location.lat, location.lng], 13, { animate: true, duration: .65 });
      void load("", location);
    }, () => setLocationState("idle"), { enableHighAccuracy: false, timeout: 8_000, maximumAge: 120_000 });
  }, [load]);
  useEffect(() => { const saved = window.localStorage.getItem("bus-language"); if (saved === "ur") setLanguage("ur"); }, []);
  useEffect(() => { document.documentElement.lang = language; document.documentElement.dir = language === "ur" ? "rtl" : "ltr"; window.localStorage.setItem("bus-language", language); }, [language]);
  useEffect(() => { const node = mapNode.current; if (!node) return; node.classList.toggle("language-en", language === "en"); node.classList.toggle("pin-mode", pinMode); }, [language, pinMode]);
  const targetLocation = manualLocation ?? userLocation ?? stopLocation;
  useEffect(() => { pinModeRef.current = pinMode; }, [pinMode]);
  useEffect(() => { const timer = window.setInterval(() => load(selectedStop, targetLocation, selectedRoute, true), selectedRoute ? 10_000 : 15_000); return () => window.clearInterval(timer); }, [load, selectedRoute, selectedStop, targetLocation]);
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !mapNode.current || map.current) return;
      leaflet.current = L;
      map.current = L.map(mapNode.current, { zoomControl: true, attributionControl: true, preferCanvas: true, zoomAnimation: true, fadeAnimation: false, markerZoomAnimation: true, zoomAnimationThreshold: 8, wheelDebounceTime: 40, wheelPxPerZoomLevel: 120, minZoom: 9, maxZoom: 18, maxBounds: [[24.52, 66.55], [25.35, 67.65]], maxBoundsViscosity: 1 }).setView([KARACHI[1], KARACHI[0]], 10);
      const updateBusScale = () => mapNode.current?.style.setProperty("--bus-marker-scale", String(Math.max(.52, Math.min(1.15, .52 + (map.current!.getZoom() - 9) * .12))));
      map.current.on("zoom zoomend", updateBusScale); updateBusScale();
      window.setTimeout(() => { map.current?.invalidateSize(); setMapReady(true); }, 100);
    });
    return () => { cancelled = true; map.current?.remove(); map.current = null; leaflet.current = null; baseMapLayer.current = null; };
  }, []);

  useEffect(() => {
    const node = mapNode.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => map.current?.invalidateSize({ pan: false }));
    });
    observer.observe(node);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  useEffect(() => {
    const currentMap = map.current; if (!currentMap || !mapReady) return;
    const selectPoint = async (event: { latlng: { lat: number; lng: number } }) => {
      if (!pinModeRef.current) return;
      const location = { lat: event.latlng.lat, lng: event.latlng.lng };
      const selectedPaths = [...(data?.referenceRoutePaths ?? []), ...(data?.routePaths ?? [])].filter((path) => canonicalRouteCode(path.displayRouteCode) === canonicalRouteCode(selectedRoute));
      if (!selectedPaths.length || distanceToRouteKm(location, selectedPaths) > .5) { setLocationError(language === "ur" ? "منتخب مقام روٹ سے بہت دور ہے۔ روٹ کے قریب پن لگائیں۔" : "That point is too far from the selected route. Place the pin within 500 m of the route."); setLocationState("error"); return; }
      setLocationError(""); setStopLocation(null); setManualLocation(location); setPinMode(false); setLocationState("idle");
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
    const url = language === "ur" ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png";
    baseMapLayer.current = L.tileLayer(url, {
      maxZoom: 18,
      keepBuffer: 12,
      updateWhenIdle: true,
      updateWhenZooming: false,
      updateInterval: 150,
      attribution: language === "ur" ? "© OpenStreetMap" : "© OpenStreetMap © CARTO",
    });
    baseMapLayer.current.on("tileerror", (event: { tile: HTMLImageElement; coords: { x: number; y: number; z: number } }) => {
      const { x, y, z } = event.coords;
      if (!event.tile.src.includes("tile.openstreetmap.org")) event.tile.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    });
    baseMapLayer.current.on("load", () => currentMap.invalidateSize({ pan: false }));
    baseMapLayer.current.addTo(currentMap);
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
      setLocationError(""); setStopLocation(null); setManualLocation(null); setPinMode(false); setUserLocation(location); setLocationState("ready");
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
    setPinMode(false); setManualLocation(null); setStopLocation(null); setLocationError("");
  }, [selectedRoute]);
  useEffect(() => { setRouteStopsExpanded(false); }, [selectedRoute]);

  useEffect(() => {
    const currentMap = map.current; const L = leaflet.current; if (!currentMap || !L || !data) return;
    markers.current.forEach((marker) => marker.remove()); markers.current = [];
    if (targetLocation) { const marker = L.marker([targetLocation.lat, targetLocation.lng], { icon: L.divIcon({ className: "user-marker-wrap", html: `<div class="user-marker${manualLocation ? " manual" : ""}"></div>`, iconSize: [23, 23], iconAnchor: [11, 22] }) }).addTo(currentMap); marker.bindTooltip(manualLocation ? (language === "ur" ? "منتخب مقام" : "Selected location") : (language === "ur" ? "آپ کی موجودہ لوکیشن" : "Your current location")); markers.current.push(marker); }
    const selected = data.stops.find((stop) => String(stop.stopId) === data.selectedStopId);
    const stopLat = numeric(data.stopInfo?.lat ?? selected?.lat); const stopLng = numeric(data.stopInfo?.lng ?? selected?.lng);
    if (selectedRoute && targetLocation && stopLat !== null && stopLng !== null) { const marker = L.marker([stopLat, stopLng], { icon: L.divIcon({ className: "stop-marker-wrap", html: '<div class="stop-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(currentMap); marker.bindTooltip(language === "ur" ? "منتخب بس اسٹاپ" : "Selected bus stop"); markers.current.push(marker); }
    const fitMode = selectedRoute || "__all__";
    const shouldAutoFit = lastFittedMode.current !== fitMode;
    const busPositions: [number, number][] = [];
    const referencePaths = data.referenceRoutePaths ?? [];
    const selectedReferencePaths = selectedRoute ? referencePaths.filter((path) => canonicalRouteCode(path.displayRouteCode) === canonicalRouteCode(selectedRoute)) : [];
    const displayRoutePaths = selectedRoute && !selectedReferencePaths.length ? (data.routePaths ?? []) : referencePaths.length ? referencePaths.filter((path) => path.direction !== "1") : (data.routePaths ?? []);
    data.buses.filter((bus) => isKarachiBus(bus) && (!selectedRoute || canonicalRouteCode(bus.displayRouteCode || bus.routeCode) === canonicalRouteCode(selectedRoute))).forEach((bus) => {
      const lat = numeric(bus.lat ?? bus.latitude); const lng = numeric(bus.lng ?? bus.longitude); if (lat === null || lng === null) return;
      const routePathsForBus = [...(data.referenceRoutePaths ?? []), ...(data.routePaths ?? [])].filter((path) => canonicalRouteCode(path.displayRouteCode) === canonicalRouteCode(bus.displayRouteCode || bus.routeCode));
      const snapped = snapToRoute({ lat, lng }, routePathsForBus);
      busPositions.push([snapped.lng, snapped.lat]);
      const label = bus.displayRouteCode || "BUS";
      const color = routeLineColor(label);
      const isRecentlySeen = bus.trackingStatus === "recently_seen";
      const statusLabel = isRecentlySeen
        ? lastSeenLabel(bus, language)
        : (language === "ur" ? "ابھی لائیو" : "Live now");
      const vehicleLabel = bus.plate ?? (language === "ur" ? "بس گاڑی" : "Bus vehicle");
      const bearing = numeric(bus.bearing) ?? 0;
      const busKind = label.toLowerCase().includes("pink") ? "pink" : label.toUpperCase().startsWith("EV") ? "white" : "red";
      const marker = L.marker([snapped.lat, snapped.lng], { icon: L.divIcon({ className: "bus-marker-wrap", html: `<button class="bus-map-icon ${busKind}${bearing > 0 && bearing < 180 ? " facing-right" : ""}${isRecentlySeen ? " recently-seen" : ""}" style="--route-color:${color}" aria-label="${statusLabel} bus ${label}"><img src="/bus-map-icon.png" alt=""><b>${label}</b></button>`, iconSize: [54, 48], iconAnchor: [27, 45], popupAnchor: [0, -45] }) }).addTo(currentMap);
      marker.bindPopup(`<div dir="${language === "ur" ? "rtl" : "ltr"}"><strong>${label}</strong><br>${vehicleLabel}<br>${statusLabel}</div>`); markers.current.push(marker);
    });
    const operatingAreaPoints: Array<[number, number]> = busPositions.map(([lng, lat]) => [lat, lng]);
    if (!selectedRoute) {
      const orderedPaths = [...displayRoutePaths].sort((a, b) => canonicalRouteCode(a.displayRouteCode).localeCompare(canonicalRouteCode(b.displayRouteCode), undefined, { numeric: true }));
      orderedPaths.forEach((path) => {
        const points = (path.pointList ?? []).map((point) => [numeric(point.lat), numeric(point.lng)] as const).filter((point): point is readonly [number, number] => point[0] !== null && point[1] !== null && point[0] >= 24.65 && point[0] <= 25.18 && point[1] >= 66.75 && point[1] <= 67.45);
        if (points.length < 2) return;
        operatingAreaPoints.push(...points.map(([lat, lng]) => [lat, lng] as [number, number]));
        const coordinates = points.map(([lat, lng]) => [lat, lng] as [number, number]);
        const line = L.polyline(coordinates, { color: routeLineColor(path.displayRouteCode), weight: 4, opacity: .96, lineCap: "round", lineJoin: "round" }).addTo(currentMap);
        line.bindTooltip(path.displayRouteCode || (language === "ur" ? "بس روٹ" : "Bus route"), { sticky: true });
        line.on("click", () => { const route = path.displayRouteCode || path.routeCode; if (!route) return; setSelectedRoute(route); setUserLocation(null); setManualLocation(null); setStopLocation(null); setSelectedStop(""); setPinMode(false); setLocationState("idle"); setLocationError(""); void load("", null, route); });
        markers.current.push(line);
      });
    }
    // A route can contain the same geometry in both travel directions. Joining
    // those arrays creates an artificial connector and can make a long route
    // look cut or doubled. Render the most detailed continuous direction.
    const selectedPath = selectedRoute
      ? [...(selectedReferencePaths.length ? selectedReferencePaths : displayRoutePaths)].sort((a, b) => (b.pointList?.length ?? 0) - (a.pointList?.length ?? 0))[0]
      : undefined;
    const selectedPathPoints = (selectedPath?.pointList ?? []).map((point) => [numeric(point.lat), numeric(point.lng)] as const).filter((point): point is readonly [number, number] => point[0] !== null && point[1] !== null);
    if (selectedPathPoints.length > 1) {
      const selectedColor = routeLineColor(selectedRoute);
      const selectedCoordinates = selectedPathPoints.map(([lat, lng]) => [lat, lng]);
      const casing = L.polyline(selectedCoordinates, { color: "#ffffff", weight: 11, opacity: 0.94, lineCap: "round", lineJoin: "round", interactive: false }).addTo(currentMap);
      const line = L.polyline(selectedCoordinates, { color: selectedColor, weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" }).addTo(currentMap);
      markers.current.push(casing, line);
      const primaryDirectionPoints = (selectedPath?.pointList ?? []).map((point) => [numeric(point.lat), numeric(point.lng)] as const).filter((point): point is readonly [number, number] => point[0] !== null && point[1] !== null);
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
      const operatingNavigationBounds = operatingBounds.pad(0.08);
      currentMap.setMaxBounds(operatingNavigationBounds);
      currentMap.setMinZoom(9);
      if (shouldAutoFit) { currentMap.setView([24.91, 67.04], 10, { animate: false }); lastFittedMode.current = fitMode; }
    }
  }, [data, language, manualLocation, mapReady, selectedRoute, targetLocation]);

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
  const inactiveBuses = useMemo(() => (data?.buses ?? [])
    .filter((bus) => bus.trackingStatus === "recently_seen" && isKarachiBus(bus) && (!selectedRoute || canonicalRouteCode(bus.displayRouteCode || bus.routeCode) === canonicalRouteCode(selectedRoute)))
    .sort((a, b) => Date.parse(b.lastSeenAt || "") - Date.parse(a.lastSeenAt || "")), [data?.buses, selectedRoute]);
  const routeSummary = useMemo(() => {
    if (!selectedRoute) return null;
    const path = (data?.routePaths ?? []).find((item) => item.displayRouteCode === selectedRoute && (item.busStopList?.length ?? 0) > 1) ?? data?.routePaths?.[0];
    const stops = path?.busStopList ?? [];
    if (!stops.length) return null;
    return { from: stops[0]?.stopName || "Starting stop", to: stops[stops.length - 1]?.stopName || "Last stop", stops: stops.length, stopNames: stops.map((stop, index) => stop.stopName || `Stop ${index + 1}`) };
  }, [data?.routePaths, selectedRoute]);
  const karachiRoutes = useMemo(() => (data?.routes ?? []).filter((route) => /^(R\d+|Pink-?\d+|EV-?0*\d+)$/i.test(route.displayRouteCode || route.routeCode || "")), [data?.routes]);
  const t = translations[language];
  const routeMatches = (bus: Bus) => !selectedRoute || canonicalRouteCode(bus.displayRouteCode || bus.routeCode) === canonicalRouteCode(selectedRoute);
  const visibleBusCount = (data?.buses ?? []).filter((bus) => isKarachiBus(bus) && routeMatches(bus) && bus.trackingStatus !== "recently_seen").length;
  const recentlySeenBusCount = (data?.buses ?? []).filter((bus) => isKarachiBus(bus) && routeMatches(bus) && bus.trackingStatus === "recently_seen").length;

  return <main className="app-shell" dir={language === "ur" ? "rtl" : "ltr"}>
    <header className="topbar"><a className="brand" href="#top" aria-label={language === "ur" ? "بس کہاں ہے؟" : "Bus Kahan Hai?"}><img className={`brand-logo ${language === "ur" ? "brand-logo-ur" : ""}`} src={language === "ur" ? logoUr.src : logoEn.src} alt={language === "ur" ? "بس کہاں ہے؟" : "Bus Kahan Hai?"} /></a><div className="topbar-actions"><div className="language-toggle" aria-label="Choose language"><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")}>English</button><button className={language === "ur" ? "active" : ""} onClick={() => setLanguage("ur")}>اردو</button></div><span className={`feed-pill ${visibleBusCount ? "is-live" : ""}`}><i />{visibleBusCount ? t.live : t.online}</span></div></header>
    <section className="tracker" id="top">
      <div className="map-panel"><div ref={mapNode} className="map" aria-label={language === "ur" ? "کراچی بس کا نقشہ" : "Karachi bus map"} /><div className="map-status"><span className="pulse" /><div><b>{loading ? t.refreshing : `${visibleBusCount} ${t.across}${recentlySeenBusCount ? `, ${recentlySeenBusCount} recently seen` : ""}`}</b><small>{language === "ur" ? `ہر ${selectedRoute ? 10 : 15} سیکنڈ بعد تازہ معلومات` : `Refreshes every ${selectedRoute ? 10 : 15} seconds`}</small></div></div>{selectedRoute && <button className="map-all-routes" onClick={() => { setSelectedRoute(""); setUserLocation(null); setManualLocation(null); setStopLocation(null); setSelectedStop(""); setPinMode(false); setLocationState("idle"); setLocationError(""); void load("", null, ""); }}>{language === "ur" ? "تمام روٹس" : "← All routes"}</button>}</div>
      <aside className="control-panel"><div className="sheet-handle" aria-hidden="true" /><div className="eyebrow-row"><div className="eyebrow">{t.eyebrow}</div></div><h1>{t.title1}<br /><em>{t.title2}</em></h1><p className="intro">{t.intro}</p>
        <div className="nearby-heading live-heading"><div><span>{targetLocation ? t.nearby : t.activeNow}</span><b>{visibleBusCount} {t.road}</b></div><button className="fleet-toggle" onClick={() => setLiveFleetExpanded((value) => !value)} aria-expanded={liveFleetExpanded}>{language === "ur" ? (liveFleetExpanded ? "لائیو بسیں چھپائیں" : "لائیو بسیں دیکھیں") : (liveFleetExpanded ? "Hide live buses" : "View live buses")} <i>{liveFleetExpanded ? "▲" : "▼"}</i></button></div>
        {liveFleetExpanded && <div className="live-route-groups" aria-label="Active buses grouped by route">{liveRouteGroups.map(({ route, buses }) => <section className="live-route-group" key={route}><button className="live-route-title" onClick={() => { setSelectedRoute(route); setUserLocation(null); setManualLocation(null); setStopLocation(null); setSelectedStop(""); setPinMode(false); setLocationState("idle"); void load("", null, route); }}><span style={{ backgroundColor: routeLineColor(route) }}>{route}</span><b>{buses.length} {language === "ur" ? "لائیو بسیں" : buses.length === 1 ? "live moving bus" : "live moving buses"}</b></button><div className="bus-strip">{buses.map(({ bus, distance, movement, etaMinutes }, index) => <button className={selectedRoute === route ? "active" : ""} key={`${route}-${bus.plate}-${index}`} onClick={() => { setSelectedRoute(route); void load(selectedStop, targetLocation, route); }}><span style={{ backgroundColor: routeLineColor(route) }}>{route}</span><div><b>{bus.plate || "Live bus"}</b><small>{distance === null ? (language === "ur" ? "لائیو حرکت" : "Live moving") : `${distance < 1 ? `${Math.round(distance * 1000)} m` : `${distance.toFixed(1)} km`} · ${movement === "approaching" ? (language === "ur" ? "آپ کی طرف" : "Approaching") : movement === "away" ? (language === "ur" ? "دور جا رہی ہے" : "Moving away") : (language === "ur" ? "حرکت چیک ہو رہی ہے" : "Checking movement")}${etaMinutes ? ` · ~${etaMinutes} min` : ""}`}</small></div></button>)}</div></section>)}</div>}
        <section className="inactive-fleet" aria-label={language === "ur" ? "غیر فعال بسوں کے آخری مقامات" : "Saved last locations of inactive buses"}><button className="inactive-heading" onClick={() => setInactiveFleetExpanded((value) => !value)} aria-expanded={inactiveFleetExpanded}><span>{language === "ur" ? "غیر فعال بسیں — محفوظ آخری مقام" : "Inactive buses — saved locations"}</span><b>{inactiveBuses.length}</b><i>{language === "ur" ? (inactiveFleetExpanded ? "چھپائیں ▲" : "فہرست دیکھیں ▼") : (inactiveFleetExpanded ? "Hide list ▲" : "View saved buses ▼")}</i></button>{inactiveFleetExpanded && <div className="inactive-list">{inactiveBuses.length === 0 ? <p className="inactive-empty">{language === "ur" ? "اس روٹ پر کوئی محفوظ غیر فعال بس نہیں ہے۔" : "No inactive bus is saved for this route."}</p> : inactiveBuses.slice(0, 12).map((bus) => { const route = bus.displayRouteCode || bus.routeCode || "BUS"; return <article key={clientVehicleKey(bus)}><span style={{ backgroundColor: routeLineColor(route) }}>{route}</span><div><b>{bus.plate || (language === "ur" ? "بس گاڑی" : "Bus vehicle")}</b><small>{lastSeenLabel(bus, language)} · {language === "ur" ? "فعال ہوتے ہی لائیو ہو جائے گی" : "Returns to live when active"}</small></div></article>; })}</div>}</section>
        <label className="select-label" htmlFor="route">{t.route}</label><div className="select-wrap route-select"><select id="route" value={selectedRoute} onChange={(event) => { const route = event.target.value; setSelectedRoute(route); setUserLocation(null); setManualLocation(null); setStopLocation(null); setSelectedStop(""); setPinMode(false); setLocationState("idle"); setLocationError(""); void load("", null, route); }}><option value="">{t.allRoutes}</option>{karachiRoutes.map((route) => <option key={route.routeCode} value={route.displayRouteCode || route.routeCode}>{route.displayRouteCode || route.routeCode} · {route.name}</option>)}</select></div>
        {routeSummary && <div className="route-summary"><span className="route-summary-code" style={{ backgroundColor: routeLineColor(selectedRoute) }}>{selectedRoute}</span><div className="route-journey"><div><i style={{ borderColor: routeLineColor(selectedRoute), color: routeLineColor(selectedRoute) }}>A</i><span><small>{t.from}</small><b>{routeSummary.from}</b></span></div><div className="route-connector" style={{ backgroundColor: routeLineColor(selectedRoute) }} /><div><i style={{ borderColor: routeLineColor(selectedRoute), color: routeLineColor(selectedRoute) }}>B</i><span><small>{t.to}</small><b>{routeSummary.to}</b></span></div></div><button className="route-stops-toggle" onClick={() => setRouteStopsExpanded((value) => !value)} aria-expanded={routeStopsExpanded}><span>{routeSummary.stops} {t.stopsCount}</span><b>{language === "ur" ? (routeStopsExpanded ? "اسٹاپ چھپائیں ▲" : "تمام اسٹاپ دیکھیں ▼") : (routeStopsExpanded ? "Hide stops ▲" : "View all stops ▼")}</b></button>{routeStopsExpanded && <ol className="route-stops-list">{routeSummary.stopNames.map((name, index) => <li key={`${name}-${index}`}><i style={{ borderColor: routeLineColor(selectedRoute) }}>{index + 1}</i><span>{name}</span></li>)}</ol>}</div>}
        {!selectedRoute && <div className="route-required" role="status">{language === "ur" ? "جاری رکھنے کے لیے پہلے ایک بس روٹ منتخب کریں" : "Select one bus route to continue."}</div>}
        {selectedRoute && <div className="location-options"><button className={`location-button ${locationState === "ready" && !manualLocation ? "is-ready" : locationState === "error" ? "has-error" : ""}`} onClick={locateMe} disabled={locationState === "loading"}><span className="location-dot" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><circle className="icon-fill" cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg></span><span><b>{locationState === "loading" ? t.locating : locationState === "ready" && !manualLocation ? t.enabled : t.useLocation}</b><small>{locationState === "ready" && !manualLocation ? (language === "ur" ? "ہٹانے کے لیے دوبارہ کلک کریں" : "Click again to remove") : locationState === "error" ? locationError || t.permission : t.nearestHint}</small></span></button><button className={`location-button pin-button ${pinMode || manualLocation ? "is-ready" : ""}`} onClick={() => { if (manualLocation) { setManualLocation(null); setPinMode(false); setLocationError(""); void load(selectedStop, null, selectedRoute); } else { setUserLocation(null); setStopLocation(null); setSelectedStop(""); setLocationState("idle"); setLocationError(""); setPinMode((value) => !value); } }}><span className="pin-dot" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.4 7-13A7 7 0 0 0 5 9c0 6.6 7 13 7 13Z"/><circle cx="12" cy="9" r="2.5"/></svg></span><span><b>{language === "ur" ? "نقشے پر مقام منتخب کریں" : "Choose a point on the map"}</b><small>{manualLocation ? (language === "ur" ? "ہٹانے کے لیے دوبارہ کلک کریں" : "Click again to remove") : pinMode ? (language === "ur" ? "منسوخ کرنے کے لیے دوبارہ کلک کریں" : "Click again to cancel") : (language === "ur" ? "پن لگا کر بس کا وقت دیکھیں" : "Drop a pin to estimate arrivals")}</small></span></button></div>}
        {selectedRoute && <><label className="select-label" htmlFor="stop">{language === "ur" ? "اس روٹ کا بس اسٹاپ" : "Bus stop on this route"}</label><div className="select-wrap"><select id="stop" value={selectedStop} onChange={(event) => { const stopId = event.target.value; const stop = availableStops.find((item) => String(item.stopId) === stopId); const lat = numeric(stop?.lat); const lng = numeric(stop?.lng); setSelectedStop(stopId); setUserLocation(null); setManualLocation(null); setPinMode(false); setLocationState("idle"); if (stopId && lat !== null && lng !== null) { const location = { lat, lng }; setStopLocation(location); void load(stopId, location, selectedRoute); } else { setStopLocation(null); void load("", null, selectedRoute); } }}><option value="">{language === "ur" ? "بس اسٹاپ منتخب کریں" : "Select a bus stop"}</option>{availableStops.map((stop) => <option key={String(stop.stopId)} value={String(stop.stopId)}>{stop.name || `Stop ${stop.stopId}`}</option>)}</select></div>{selectedStop && targetLocation && (error ? <div className="notice error" role="alert">{error}</div> : <div className="stop-card"><div><span>{t.selectedStop}</span><strong>{stopName}</strong></div><button onClick={() => load(selectedStop, targetLocation, selectedRoute)} disabled={loading}>{loading ? t.checking : t.refresh}</button></div>)}</>}
        {selectedRoute && selectedStop && targetLocation && arrivals.length > 0 && <section className="arrivals" aria-live="polite"><div className="section-title"><h2>{t.arrivals}</h2><span>{data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span></div>
          {arrivals.length ? arrivals.slice(0, 4).map((arrival, index) => <article className="arrival-row" key={`${arrival.routeCode}-${index}`}><span className="route-badge" style={{ backgroundColor: routeLineColor(arrival.displayRouteCode || arrival.routeCode) }}>{arrival.displayRouteCode || arrival.routeCode || "BUS"}</span><div><b>{arrival.headSign || arrival.name || "People’s Bus"}</b><small>{arrival.nextTripArrivalTime || arrival.stopArrivalTime || t.etaPending}</small></div><strong className="eta">{etaLabel(arrival.nextTripArrivalTime || arrival.stopArrivalTime)}</strong></article>) : <div className="empty-state"><span className="empty-icon">B</span><div><b>{t.etaPending}</b><p>{t.etaHint}</p></div></div>}
        </section>}
        <nav className="social-links" aria-label="Bus Kahan Hai social media">
          <span>{language === "ur" ? "ہمیں فالو کریں" : "Follow us"}</span>
          <div>
            <a className="social-icon" href="https://instagram.com/buskahanhai" target="_blank" rel="noopener noreferrer" aria-label="Bus Kahan Hai on Instagram"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16Zm0 1.98c-3.15 0-3.5.01-4.74.07-.89.04-1.37.19-1.7.32-.42.16-.72.36-1.04.68-.32.32-.52.62-.68 1.04-.13.33-.28.81-.32 1.7-.06 1.24-.07 1.59-.07 4.74s.01 3.5.07 4.74c.04.89.19 1.37.32 1.7.16.42.36.72.68 1.04.32.32.62.52 1.04.68.33.13.81.28 1.7.32 1.24.06 1.59.07 4.74.07s3.5-.01 4.74-.07c.89-.04 1.37-.19 1.7-.32.42-.16.72-.36 1.04-.68.32-.32.52-.62.68-1.04.13-.33.28-.81.32-1.7.06-1.24.07-1.59.07-4.74s-.01-3.5-.07-4.74c-.04-.89-.19-1.37-.32-1.7a2.8 2.8 0 0 0-.68-1.04 2.8 2.8 0 0 0-1.04-.68c-.33-.13-.81-.28-1.7-.32-1.24-.06-1.59-.07-4.74-.07Zm0 3.37a4.49 4.49 0 1 1 0 8.98 4.49 4.49 0 0 1 0-8.98Zm0 7.4a2.91 2.91 0 1 0 0-5.82 2.91 2.91 0 0 0 0 5.82Zm5.72-7.6a1.05 1.05 0 1 1-2.1 0 1.05 1.05 0 0 1 2.1 0Z"/></svg></a>
            <a className="social-icon" href="https://facebook.com/buskahanhai" target="_blank" rel="noopener noreferrer" aria-label="Bus Kahan Hai on Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.78-3.89 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12Z"/></svg></a>
            <a className="social-icon" href="https://linkedin.com/company/buskahanhai" target="_blank" rel="noopener noreferrer" aria-label="Bus Kahan Hai on LinkedIn"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.8 0 0 .78 0 1.75v20.5C0 23.2.8 24 1.77 24h20.45c.98 0 1.78-.8 1.78-1.75V1.75C24 .78 23.2 0 22.22 0Z"/></svg></a>
            <a className="social-icon" href="https://youtube.com/@buskahanhai" target="_blank" rel="noopener noreferrer" aria-label="Bus Kahan Hai on YouTube"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.5 6.2a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.51A3.02 3.02 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3.02 3.02 0 0 0 2.12 2.14c1.88.51 9.38.51 9.38.51s7.5 0 9.38-.51a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.24 3.6-6.24 3.6Z"/></svg></a>
            <a className="social-icon" href="https://tiktok.com/@buskahanhai" target="_blank" rel="noopener noreferrer" aria-label="Bus Kahan Hai on TikTok"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16.6 5.82a4.28 4.28 0 0 1-1.04-2.82h-3.1v12.4a2.59 2.59 0 0 1-2.59 2.5 2.59 2.59 0 0 1-.36-5.15v-3.16a5.7 5.7 0 0 0-5.5 5.7A5.7 5.7 0 0 0 12.05 21a5.7 5.7 0 0 0 5.7-5.7V9.01a7.35 7.35 0 0 0 4.29 1.37V7.28a4.28 4.28 0 0 1-2.94-1.03 4.3 4.3 0 0 1-2.5-.43Z"/></svg></a>
            <a className="social-icon" href="https://x.com/buskahanhai" target="_blank" rel="noopener noreferrer" aria-label="Bus Kahan Hai on X"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.96 6.82H1.7l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23Zm-1.16 17.52h1.83L7.01 4.13H5.05l12.03 15.64Z"/></svg></a>
          </div>
        </nav>
        <p className="made-for">{t.madeFor}</p><p className="disclaimer">{t.disclaimer}</p>
      </aside>
    </section>
  </main>;
}
