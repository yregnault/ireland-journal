import { useState, useRef, useCallback, useEffect } from "react";

const DEFAULT_PASSWORD = "irlande2026";
const IRELAND_CENTER = [53.5, -7.5];
const GEO_CACHE = {};
const SAVE_DELAY = 2000;

// ── Server storage (passe par Vercel qui relaye vers Free) ──
function proxyPhotoUrl(url) {
  if (!url) return "";
  var match = url.match(/free\.fr\/photos\/(.+)$/);
  if (match) return "/api/storage?action=photo&file=" + encodeURIComponent(match[1]);
  if (url.startsWith("http://")) return url.replace("http://", "https://");
  return url;
}

async function serverLoad() {
  try {
    const r = await fetch("/api/storage?action=load");
    if (!r.ok) return null;
    const data = await r.json();
    if (!data) return null;
    if (data.days) {
      data.days = data.days.map(function(d) {
        if (d.photos) {
          d.photos = d.photos.map(function(p) {
            return { id: p.id, url: proxyPhotoUrl(p.url), thumb: proxyPhotoUrl(p.thumb) };
          });
        }
        return d;
      });
    }
    return data;
  } catch { return null; }
}
async function serverSave(data) {
  try { await fetch("/api/storage?action=save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); } catch {}
}
async function serverUpload(base64, filename) {
  try {
    const r = await fetch("/api/storage?action=upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64, filename }) });
    if (!r.ok) return null;
    const d = await r.json();
    return proxyPhotoUrl(d.url);
  } catch { return null; }
}

function resizeImage(dataUrl, maxW = 800) {
  return new Promise((r) => {
    const img = new Image();
    img.onload = () => { const s = Math.min(1, maxW / img.width); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); r(c.toDataURL("image/jpeg", 0.7)); };
    img.onerror = () => r(dataUrl); img.src = dataUrl;
  });
}

async function geocode(loc) {
  if (!loc?.trim()) return null;
  const key = loc.toLowerCase().trim();
  if (GEO_CACHE[key]) return GEO_CACHE[key];
  try {
    const q = /ireland|irlande/i.test(key) ? key : `${key}, Ireland`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d?.length) { const c = [parseFloat(d[0].lat), parseFloat(d[0].lon)]; GEO_CACHE[key] = c; return c; }
  } catch {}
  return null;
}

async function getRouteDistance(a, b, avoidMotorway) {
  var coords = a[1] + "," + a[0] + ";" + b[1] + "," + b[0];
  var base = "https://router.project-osrm.org/route/v1/driving/";
  var exclude = avoidMotorway ? "&exclude=motorway" : "";
  try {
    var url = base + coords + "?overview=false" + exclude;
    var r = await fetch(url);
    var d = await r.json();
    if (d.code === "Ok" && d.routes && d.routes.length > 0) {
      return { km: Math.round(d.routes[0].distance / 1000), mins: Math.round(d.routes[0].duration / 60) };
    }
    if (avoidMotorway) return await getRouteDistance(a, b, false);
  } catch (e) { /* ignore */ }
  return null;
}

function formatDuration(mins) {
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  if (h === 0) return m + " min";
  return h + "h" + (m > 0 ? (m < 10 ? "0" + m : m) : "00");
}

function loadLeaflet() {
  return new Promise((res) => {
    if (window.L) return res(window.L);
    if (!document.querySelector('link[href*="leaflet"]')) { const c = document.createElement("link"); c.rel = "stylesheet"; c.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(c); }
    if (document.querySelector('script[src*="leaflet"]')) { const iv = setInterval(() => { if (window.L) { clearInterval(iv); res(window.L); } }, 100); return; }
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; s.onload = () => res(window.L); s.onerror = () => res(null); document.head.appendChild(s);
  });
}

function addDaysToDate(ds, n) { if (!ds) return ""; const d = new Date(ds); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; }

function makeDay(id, date) { return { id, date: date || "", locations: [""], notes: "", photos: [], summary: "" }; }

function getAllLocations(days) {
  const locs = [];
  days.forEach((d) => { (d.locations || [d.location || ""]).forEach((l) => { if (l?.trim()) locs.push({ dayId: d.id, loc: l.trim(), day: d }); }); });
  return locs;
}

// ── Lightbox ──
function Lightbox({ photos, index, onClose, onNav }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") onNav(1); if (e.key === "ArrowLeft") onNav(-1); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onClose, onNav]);
  if (index < 0 || !photos.length) return null;
  const p = photos[index];
  const best = p.src || p.url || p.thumb || "";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
      <img src={best} alt="" style={{ maxWidth: "92vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }} onClick={(e) => e.stopPropagation()} />
      <div style={{ position: "absolute", top: 16, right: 20, color: "#fff", fontSize: 14, opacity: 0.7 }}>{index + 1} / {photos.length}</div>
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ position: "absolute", top: 16, left: 20, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 28, width: 44, height: 44, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
      {photos.length > 1 && <>
        <button onClick={(e) => { e.stopPropagation(); onNav(-1); }} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 30, width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>‹</button>
        <button onClick={(e) => { e.stopPropagation(); onNav(1); }} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 30, width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>›</button>
      </>}
    </div>
  );
}

// ── Login ──
function LoginBar({ isAdmin, onLogin, onLogout }) {
  const [show, setShow] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const tryLogin = () => { if (pw === DEFAULT_PASSWORD) { onLogin(); setShow(false); setPw(""); setErr(""); } else setErr("Mot de passe incorrect"); };
  if (isAdmin) return <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px", marginBottom: -8 }}><button onClick={onLogout} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>🔓 Admin — Déconnexion</button></div>;
  if (show) return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "0 16px", marginBottom: -8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && tryLogin()} placeholder="Mot de passe" autoFocus style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 13, outline: "none", width: 160 }} />
      <button onClick={tryLogin} style={{ background: "#fff", color: "#2d6a4f", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>OK</button>
      <button onClick={() => { setShow(false); setErr(""); }} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>Annuler</button>
      {err && <span style={{ color: "#fca5a5", fontSize: 12, width: "100%", textAlign: "center" }}>{err}</span>}
    </div>
  );
  return <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px", marginBottom: -8 }}><button onClick={() => setShow(true)} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#b7e4c7", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>🔒 Connexion admin</button></div>;
}

// ── Settings ──
function Settings({ config, setConfig, isAdmin }) {
  const set = (k, v) => setConfig((p) => ({ ...p, [k]: v }));
  const inputSt = { padding: "10px 14px", borderRadius: 10, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  if (!isAdmin) return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #d8f3dc" }}>
      <h3 style={{ color: "#2d6a4f", marginBottom: 16 }}>⚙️ Paramètres</h3>
      <div style={{ display: "grid", gap: 12, fontSize: 14, color: "#444" }}>
        <div><b>Titre :</b> {config.title}</div>
        <div><b>Dates :</b> {config.startDate} → {config.endDate}</div>
        <div><b>Destination(s) :</b> {config.destinations}</div>
        <div><b>Participants :</b> {config.participants}</div>
      </div>
    </div>
  );
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #d8f3dc" }}>
      <h3 style={{ color: "#2d6a4f", marginBottom: 16 }}>⚙️ Paramètres</h3>
      <div style={{ display: "grid", gap: 16 }}>
        <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Titre du site</label><input value={config.title} onChange={(e) => set("title", e.target.value)} style={inputSt} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Date début</label><input type="date" value={config.startDate} onChange={(e) => set("startDate", e.target.value)} style={inputSt} /></div>
          <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Date fin</label><input type="date" value={config.endDate} onChange={(e) => set("endDate", e.target.value)} style={inputSt} /></div>
        </div>
        <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Destination(s)</label><input value={config.destinations} onChange={(e) => set("destinations", e.target.value)} style={inputSt} placeholder="Irlande, Irlande du Nord..." /></div>
        <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Participants</label><input value={config.participants} onChange={(e) => set("participants", e.target.value)} style={inputSt} placeholder="Yann, Alice, Marc, Julie" /></div>
      </div>
      <div style={{ marginTop: 16, padding: 12, background: "#f0fdf4", borderRadius: 10, fontSize: 13, color: "#52b788" }}>💡 Tout est sauvegardé automatiquement sur le serveur.</div>
    </div>
  );
}

// ── Kilometer Counter ──
function KmCounter({ days }) {
  const [totalKm, setTotalKm] = useState(0);
  const [totalMins, setTotalMins] = useState(0);
  const [computing, setComputing] = useState(false);
  const [segments, setSegments] = useState([]);
  const [routeType, setRouteType] = useState("normal"); // "normal" or "scenic"

  const compute = async () => {
    setComputing(true);
    const allLocs = getAllLocations(days);
    const coords = [];
    for (const item of allLocs) {
      const c = await geocode(item.loc);
      if (c) coords.push({ ...item, coords: c });
    }
    let total = 0;
    let totalT = 0;
    const segs = [];
    const avoidMotorway = routeType === "scenic";
    for (let i = 1; i < coords.length; i++) {
      const result = await getRouteDistance(coords[i - 1].coords, coords[i].coords, avoidMotorway);
      if (result) {
        total += result.km;
        totalT += result.mins;
        segs.push({ from: coords[i - 1].loc, to: coords[i].loc, km: result.km, mins: result.mins });
      }
      // Petit délai pour ne pas surcharger OSRM
      await new Promise((r) => setTimeout(r, 300));
    }
    setTotalKm(Math.round(total));
    setTotalMins(totalT);
    setSegments(segs);
    setComputing(false);
  };

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #d8f3dc", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28 }}>🚗</span>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#2d6a4f" }}>{totalKm} km</div>
          <div style={{ fontSize: 12, color: "#95d5b2" }}>
            {totalMins > 0 ? `${formatDuration(totalMins)} de route` : "Distance par la route"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid #b7e4c7" }}>
            <button onClick={() => setRouteType("normal")} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: routeType === "normal" ? "#2d6a4f" : "#fff", color: routeType === "normal" ? "#fff" : "#2d6a4f", fontFamily: "inherit" }}>🛣️ Autoroute</button>
            <button onClick={() => setRouteType("scenic")} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: routeType === "scenic" ? "#2d6a4f" : "#fff", color: routeType === "scenic" ? "#fff" : "#2d6a4f", borderLeft: "1px solid #b7e4c7", fontFamily: "inherit" }}>🌿 Touristique</button>
          </div>
          <button onClick={compute} disabled={computing} style={{ background: "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: computing ? 0.7 : 1 }}>
            {computing ? "⏳ Calcul..." : "🔄 Calculer"}
          </button>
        </div>
      </div>
      {segments.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {segments.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < segments.length - 1 ? "1px solid #f0fdf4" : "none" }}>
              <span style={{ fontSize: 13, color: "#2d6a4f", flex: 1 }}>{s.from} → {s.to}</span>
              <span style={{ fontWeight: 700, color: "#2d6a4f", fontSize: 13 }}>{s.km} km</span>
              <span style={{ fontSize: 12, color: "#95d5b2", minWidth: 55, textAlign: "right" }}>{formatDuration(s.mins)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Map ──
function TripMap({ days }) {
  const cRef = useRef(null);
  const mRef = useRef(null);
  const lRef = useRef([]);
  const [status, setStatus] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let c = false;
    loadLeaflet().then((L) => {
      if (c || !L) return;
      if (!mRef.current && cRef.current) {
        mRef.current = L.map(cRef.current, { scrollWheelZoom: true }).setView(IRELAND_CENTER, 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(mRef.current);
        setTimeout(() => mRef.current?.invalidateSize(), 200);
      }
      setReady(true);
    });
    return () => { c = true; };
  }, []);

  const refresh = useCallback(async () => {
    if (!ready || !window.L || !mRef.current) return;
    const L = window.L, m = mRef.current;
    lRef.current.forEach((l) => m.removeLayer(l)); lRef.current = [];
    const allLocs = getAllLocations(days);
    if (!allLocs.length) { setStatus("Aucun lieu"); m.setView(IRELAND_CENTER, 7); return; }
    setStatus(`Recherche de ${allLocs.length} lieu(x)...`);
    const pts = [];
    let idx = 0;
    for (const item of allLocs) {
      idx++;
      const c = await geocode(item.loc); if (!c) continue;
      const icon = L.divIcon({ html: `<div style="background:#2d6a4f;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)">${idx}</div>`, className: "", iconSize: [28, 28], iconAnchor: [14, 14] });
      const th = item.day.photos.slice(0, 2).map((p) => `<img src="${p.thumb || p.url || p.src}" style="width:40px;height:40px;object-fit:cover;border-radius:4px"/>`).join("");
      const popup = `<div style="font-family:system-ui;min-width:100px"><b style="color:#2d6a4f">Jour ${item.dayId}</b><br/>${item.loc}${item.day.date ? `<br/><small style="color:#999">${item.day.date}</small>` : ""}${th ? `<div style="display:flex;gap:3px;margin-top:4px">${th}</div>` : ""}</div>`;
      lRef.current.push(L.marker(c, { icon }).addTo(m).bindPopup(popup));
      pts.push(c);
      await new Promise((r) => setTimeout(r, 250));
    }
    if (pts.length > 1) { const pl = L.polyline(pts, { color: "#40916c", weight: 3, dashArray: "8 6" }).addTo(m); lRef.current.push(pl); m.fitBounds(L.latLngBounds(pts).pad(0.2)); }
    else if (pts.length === 1) m.setView(pts[0], 11);
    setStatus(`${pts.length} étape(s)`);
    setTimeout(() => m.invalidateSize(), 100);
  }, [ready, days]);

  useEffect(() => { if (ready) refresh(); }, [ready]);

  return (
    <div>
      <KmCounter days={days} />
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={refresh} style={{ background: "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>🔄 Actualiser</button>
        {status && <span style={{ fontSize: 13, color: "#52b788" }}>{status}</span>}
      </div>
      <div ref={cRef} style={{ width: "100%", height: 420, borderRadius: 14, overflow: "hidden", border: "2px solid #d8f3dc", background: "#e8f5e9" }} />
      {getAllLocations(days).length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {getAllLocations(days).map((item, i) => (
            <div key={i} style={{ background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, border: "1px solid #d8f3dc", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ background: "#2d6a4f", color: "#fff", borderRadius: "50%", width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
              <span style={{ color: "#555", fontSize: 11 }}>J{item.dayId}</span>
              <span style={{ color: "#2d6a4f", fontWeight: 500 }}>{item.loc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Day Card ──
function DayCard({ day, dayNumber, updateDay, removeDay, isAdmin, config, onOpenLightbox, onUploadPhoto }) {
  const fileRef = useRef();
  const [expanded, setExpanded] = useState(true);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState("");
  const [uploading, setUploading] = useState(false);

  const locs = day.locations || [day.location || ""];

  const setLoc = (idx, val) => {
    const newLocs = [...locs];
    newLocs[idx] = val;
    updateDay(day.id, { locations: newLocs });
  };
  const addLoc = () => updateDay(day.id, { locations: [...locs, ""] });
  const removeLoc = (idx) => { if (locs.length <= 1) return; const nl = locs.filter((_, i) => i !== idx); updateDay(day.id, { locations: nl }); };

  const handlePhotos = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    setUploading(true);
    const newPhotos = [...day.photos];
    for (const file of files) {
      const dataUrl = await new Promise((r) => { const rd = new FileReader(); rd.onload = (ev) => r(ev.target.result); rd.readAsDataURL(file); });
      const compressed = await resizeImage(dataUrl, 800);
      const thumb = await resizeImage(dataUrl, 300);
      const b64 = compressed.split(",")[1];
      const fname = `day${day.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
      const url = await onUploadPhoto(b64, fname);
      const thumbB64 = thumb.split(",")[1];
      const thumbUrl = await onUploadPhoto(thumbB64, `thumb_${fname}`);
      newPhotos.push({ id: Date.now() + Math.random(), url: url || compressed, thumb: thumbUrl || thumb, src: dataUrl });
    }
    updateDay(day.id, { photos: newPhotos });
    setUploading(false);
    e.target.value = "";
  };

  const generateSummary = async () => {
    if (!day.photos.length) return;
    setLoadingAI(true); setAiError("");
    try {
      const imgs = [];
      for (const p of day.photos.slice(0, 5)) {
        let imgData = p.src || p.url;
        if (!imgData) continue;
        if (!imgData.startsWith("data:")) {
          try { const r = await fetch(imgData); const blob = await r.blob(); imgData = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(blob); }); } catch { continue; }
        }
        const small = await resizeImage(imgData, 600);
        imgs.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.split(",")[1] } });
      }
      if (!imgs.length) { setAiError("Aucune photo exploitable."); setLoadingAI(false); return; }
      const parts = [];
      if (day.date) parts.push(`Date : ${day.date}.`);
      const locStr = locs.filter(l => l.trim()).join(", ");
      if (locStr) parts.push(`Lieux visités : ${locStr}.`);
      if (config.destinations) parts.push(`Destination : ${config.destinations}.`);
      if (config.participants) parts.push(`Participants : ${config.participants}.`);
      const nb = config.participants ? config.participants.split(",").length : 4;
      const body = JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 1000,
        messages: [{ role: "user", content: [...imgs, { type: "text", text: `Tu es un assistant de carnet de voyage pour un groupe de ${nb} voyageurs${config.participants ? ` (${config.participants})` : ""}. ${parts.join(" ")}
Rédige un résumé concis en français (50-70 mots). Utilise "nous"/"on" et les prénoms quand pertinent. Décris les lieux, l'ambiance, les moments forts. Ton enthousiaste, style journal de bord.` }] }]
      });
      let resp;
      try { resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body }); if (!resp.ok) throw new Error(); } catch { resp = await fetch("/api/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body }); }
      if (!resp.ok) throw new Error(`API ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
      const data = await resp.json();
      updateDay(day.id, { summary: data.content?.map((c) => c.text || "").filter(Boolean).join("") || "Aucun résumé." });
    } catch (err) { setAiError(err.message); }
    setLoadingAI(false);
  };

  const photoDisplay = (p) => p.thumb || p.url || p.src || "";
  const locDisplay = locs.filter(l => l.trim()).join(" → ");

  return (
    <div style={{ background: "#fff", borderRadius: 16, marginBottom: 4, boxShadow: "0 2px 16px rgba(45,106,79,0.10)", border: "1px solid #d8f3dc", overflow: "hidden" }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", cursor: "pointer", background: expanded ? "linear-gradient(135deg, #2d6a4f, #40916c)" : "#f7fdf9" }}>
        <span style={{ fontSize: 22, color: expanded ? "#fff" : "#2d6a4f", fontWeight: 700 }}>Jour {dayNumber}</span>
        {locDisplay && <span style={{ color: expanded ? "#b7e4c7" : "#52b788", fontSize: 14, marginLeft: 4 }}>— {locDisplay}</span>}
        {day.date && <span style={{ color: expanded ? "#b7e4c7" : "#95d5b2", fontSize: 13, marginLeft: "auto" }}>{day.date}</span>}
        <span style={{ marginLeft: day.date ? 8 : "auto", color: expanded ? "#fff" : "#2d6a4f", fontSize: 18, transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▾</span>
      </div>
      {expanded && (
        <div style={{ padding: 20 }}>
          {isAdmin ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <input type="date" value={day.date} onChange={(e) => updateDay(day.id, { date: e.target.value })} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
              </div>
              {locs.map((l, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#95d5b2", width: 20, textAlign: "center", flexShrink: 0 }}>{i + 1}.</span>
                  <input type="text" placeholder={i === 0 ? "📍 Lieu principal" : "📍 Autre lieu visité"} value={l} onChange={(e) => setLoc(i, e.target.value)} style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
                  {locs.length > 1 && <button onClick={() => removeLoc(i)} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18 }}>×</button>}
                </div>
              ))}
              <button onClick={addLoc} style={{ background: "none", border: "1px dashed #b7e4c7", borderRadius: 8, padding: "4px 12px", color: "#52b788", fontSize: 12, cursor: "pointer", marginTop: 2 }}>+ Ajouter un lieu</button>
            </div>
          ) : (
            (day.date || locDisplay) && (
              <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 14, color: "#555", flexWrap: "wrap" }}>
                {day.date && <span>📅 {day.date}</span>}
                {locDisplay && <span>📍 {locDisplay}</span>}
              </div>
            )
          )}

          {isAdmin ? (
            <textarea placeholder="Notes, anecdotes..." value={day.notes} onChange={(e) => updateDay(day.id, { notes: e.target.value })} rows={2} style={{ width: "100%", padding: 12, borderRadius: 10, border: "1.5px solid #d8f3dc", fontSize: 14, resize: "vertical", fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          ) : day.notes ? <div style={{ fontSize: 14, color: "#444", lineHeight: 1.6, marginBottom: 8, whiteSpace: "pre-wrap" }}>{day.notes}</div> : null}

          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontWeight: 600, color: "#2d6a4f" }}>📸 Photos</span>
              {isAdmin && <><button onClick={() => fileRef.current?.click()} disabled={uploading} style={{ background: "#d8f3dc", color: "#2d6a4f", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: uploading ? 0.6 : 1 }}>{uploading ? "⏳ Upload..." : "+ Ajouter"}</button><input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotos} style={{ display: "none" }} /></>}
              <span style={{ fontSize: 12, color: "#95d5b2" }}>{day.photos.length} photo{day.photos.length !== 1 ? "s" : ""}</span>
            </div>
            {day.photos.length > 0 && (
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
                {day.photos.map((p, i) => (
                  <div key={p.id} style={{ position: "relative", width: 110, height: 110, borderRadius: 10, overflow: "hidden", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
                    <img src={photoDisplay(p)} alt="" onClick={() => onOpenLightbox(day.photos, i)} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "pointer" }} />
                    {isAdmin && <button onClick={() => updateDay(day.id, { photos: day.photos.filter((x) => x.id !== p.id) })} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {isAdmin && (
            <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={generateSummary} disabled={!day.photos.length || loadingAI} style={{ background: !day.photos.length ? "#ccc" : "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: !day.photos.length ? "default" : "pointer", fontSize: 14, fontWeight: 600, opacity: loadingAI ? 0.7 : 1, display: "flex", alignItems: "center", gap: 8 }}>
                {loadingAI ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span> Analyse...</> : <>✨ Générer le résumé</>}
              </button>
            </div>
          )}
          {aiError && <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 12, fontSize: 13, color: "#b91c1c" }}>⚠️ {aiError}</div>}

          {day.summary && (
            <div style={{ marginTop: 16, background: "linear-gradient(135deg, #f0fdf4, #d8f3dc)", borderRadius: 12, padding: 16, borderLeft: "4px solid #40916c" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#2d6a4f", marginBottom: 6 }}>📝 Résumé de la journée</div>
              {isAdmin ? (
                <textarea value={day.summary} onChange={(e) => updateDay(day.id, { summary: e.target.value })} rows={3} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b7e4c7", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "rgba(255,255,255,0.6)", color: "#1b4332", lineHeight: 1.6, resize: "vertical" }} />
              ) : (
                <div style={{ fontSize: 14, color: "#1b4332", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{day.summary}</div>
              )}
            </div>
          )}

          {isAdmin && removeDay && <button onClick={() => removeDay(day.id)} style={{ marginTop: 14, background: "none", border: "1px solid #e0e0e0", borderRadius: 8, padding: "6px 14px", color: "#999", fontSize: 12, cursor: "pointer" }}>🗑️ Supprimer ce jour</button>}
        </div>
      )}
    </div>
  );
}

// ── Insert Day Button ──
function InsertDayBtn({ onClick }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2px 0", marginBottom: 4 }}>
      <button onClick={onClick} title="Intercaler un jour" style={{ background: "none", border: "2px dashed #d8f3dc", borderRadius: 20, padding: "2px 16px", color: "#95d5b2", fontSize: 12, cursor: "pointer", transition: "all 0.2s" }} onMouseEnter={(e) => { e.target.style.borderColor = "#52b788"; e.target.style.color = "#2d6a4f"; }} onMouseLeave={(e) => { e.target.style.borderColor = "#d8f3dc"; e.target.style.color = "#95d5b2"; }}>
        + insérer un jour
      </button>
    </div>
  );
}

// ── Header ──
function TripHeader({ config, isAdmin, onLogin, onLogout, saveStatus }) {
  return (
    <div style={{ textAlign: "center", padding: "30px 20px 24px", background: "linear-gradient(160deg, #1b4332 0%, #2d6a4f 50%, #40916c 100%)", color: "#fff", borderRadius: "0 0 30px 30px", marginBottom: 24, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 10, left: 20, opacity: 0.15, fontSize: 80 }}>☘️</div>
      <div style={{ position: "absolute", bottom: -10, right: 20, opacity: 0.10, fontSize: 120 }}>🏰</div>
      <LoginBar isAdmin={isAdmin} onLogin={onLogin} onLogout={onLogout} />
      <div style={{ fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "#b7e4c7", marginBottom: 8, marginTop: 10 }}>Carnet de Voyage</div>
      <div style={{ fontSize: 32, fontWeight: 800 }}>{config.title || "Mon voyage"}</div>
      {(config.startDate || config.endDate) && <div style={{ marginTop: 8, color: "#b7e4c7", fontSize: 14 }}>{config.startDate} → {config.endDate}</div>}
      {config.participants && <div style={{ marginTop: 6, color: "#95d5b2", fontSize: 13 }}>👥 {config.participants}</div>}
      <div style={{ marginTop: 6, display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
        {!isAdmin && <span style={{ fontSize: 12, color: "#95d5b2" }}>👀 Mode visiteur</span>}
        {saveStatus && <span style={{ fontSize: 11, color: "#b7e4c7", background: "rgba(255,255,255,0.1)", padding: "2px 10px", borderRadius: 6 }}>{saveStatus}</span>}
      </div>
    </div>
  );
}

function StatsBar({ days }) {
  const nbPhotos = days.reduce((s, d) => s + d.photos.length, 0);
  const nbLocs = getAllLocations(days).length;
  const items = [{ icon: "📅", l: "Jours", v: days.length }, { icon: "📸", l: "Photos", v: nbPhotos }, { icon: "📍", l: "Étapes", v: nbLocs }, { icon: "📝", l: "Résumés", v: days.filter((d) => d.summary).length }];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
      {items.map((it) => (
        <div key={it.l} style={{ background: "#fff", borderRadius: 12, padding: "12px 20px", boxShadow: "0 2px 8px rgba(45,106,79,0.08)", textAlign: "center", minWidth: 70, border: "1px solid #d8f3dc" }}>
          <div style={{ fontSize: 22 }}>{it.icon}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2d6a4f" }}>{it.v}</div>
          <div style={{ fontSize: 11, color: "#95d5b2" }}>{it.l}</div>
        </div>
      ))}
    </div>
  );
}

function TabBar({ tab, setTab }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
      {[{ id: "journal", l: "📖 Journal" }, { id: "map", l: "🗺️ Carte" }, { id: "gallery", l: "🖼️ Galerie" }, { id: "summary", l: "📝 Résumé" }, { id: "settings", l: "⚙️ Paramètres" }].map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "10px 16px", borderRadius: 10, border: tab === t.id ? "2px solid #2d6a4f" : "1.5px solid #d8f3dc", background: tab === t.id ? "#2d6a4f" : "#fff", color: tab === t.id ? "#fff" : "#2d6a4f", fontWeight: 600, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{t.l}</button>
      ))}
    </div>
  );
}

function Gallery({ days, onOpenLightbox }) {
  const all = days.flatMap((d, di) => d.photos.map((p) => ({ ...p, dayNum: di + 1, location: (d.locations || []).filter(l => l.trim()).join(", ") })));
  const allFlat = days.flatMap((d) => d.photos);
  if (!all.length) return <div style={{ textAlign: "center", padding: 40, color: "#95d5b2" }}>Aucune photo.</div>;
  let gi = 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {all.map((p) => {
        const idx = gi++;
        return (
          <div key={p.id} onClick={() => onOpenLightbox(allFlat, idx)} style={{ borderRadius: 12, overflow: "hidden", position: "relative", aspectRatio: "1", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", cursor: "pointer" }}>
            <img src={p.thumb || p.url || p.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.6))", padding: "20px 8px 8px", color: "#fff", fontSize: 11 }}>
              <div style={{ fontWeight: 600 }}>Jour {p.dayNum}</div>{p.location && <div>{p.location}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FullSummary({ days, onOpenLightbox }) {
  const s = days.filter((d) => d.summary);
  if (!s.length) return <div style={{ textAlign: "center", padding: 40, color: "#95d5b2" }}>Aucun résumé.</div>;
  return (
    <div>
      {s.map((d, i) => {
        const dayNum = days.indexOf(d) + 1;
        const locStr = (d.locations || []).filter(l => l.trim()).join(" → ");
        return (
          <div key={d.id} style={{ marginBottom: 20, background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 10px rgba(45,106,79,0.08)", border: "1px solid #d8f3dc" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#2d6a4f" }}>Jour {dayNum}</span>
              {locStr && <span style={{ color: "#52b788", fontSize: 14 }}>📍 {locStr}</span>}
              {d.date && <span style={{ color: "#95d5b2", fontSize: 13, marginLeft: "auto" }}>{d.date}</span>}
            </div>
            <div style={{ color: "#1b4332", lineHeight: 1.65, fontSize: 14, whiteSpace: "pre-wrap" }}>{d.summary}</div>
            {d.photos.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 12, overflowX: "auto" }}>
                {d.photos.slice(0, 5).map((p, pi) => <img key={p.id} src={p.thumb || p.url || p.src} alt="" onClick={() => onOpenLightbox(d.photos, pi)} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8, cursor: "pointer" }} />)}
                {d.photos.length > 5 && <div style={{ width: 60, height: 60, borderRadius: 8, background: "#d8f3dc", display: "flex", alignItems: "center", justifyContent: "center", color: "#2d6a4f", fontWeight: 700, fontSize: 13 }}>+{d.photos.length - 5}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── App ──
const DEFAULT_CONFIG = { title: "Irlande été 2026 ☘️", startDate: "2026-07-01", endDate: "2026-07-14", destinations: "Irlande", participants: "" };

export default function App() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [days, setDays] = useState([]);
  const [tab, setTab] = useState("journal");
  const [isAdmin, setIsAdmin] = useState(false);
  const [lbPhotos, setLbPhotos] = useState([]);
  const [lbIndex, setLbIndex] = useState(-1);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const saveTimer = useRef(null);
  const initialized = useRef(false);

  useEffect(() => {
    (async () => {
      const data = await serverLoad();
      if (data) {
        if (data.config) setConfig(data.config);
        if (data.days?.length) {
          // Migration: location string → locations array
          setDays(data.days.map(d => {
            if (!d.locations) d.locations = d.location ? [d.location] : [""];
            if (!d.summary && d.aiSummary) d.summary = d.aiSummary;
            return d;
          }));
        }
      }
      initialized.current = true;
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!initialized.current) return;
    if (!config.startDate || !config.endDate) return;
    const start = new Date(config.startDate), end = new Date(config.endDate);
    if (isNaN(start) || isNaN(end) || end < start) return;
    const nb = Math.round((end - start) / 86400000) + 1;
    setDays((prev) => {
      if (prev.length > 0 && prev.some(d => d.photos.length || d.summary || d.notes || (d.locations || []).some(l => l.trim()))) return prev;
      const nd = [];
      for (let i = 0; i < nb; i++) {
        const ex = prev.find((d) => d.id === i + 1);
        nd.push(ex || makeDay(i + 1, addDaysToDate(config.startDate, i)));
      }
      return nd;
    });
  }, [config.startDate, config.endDate]);

  useEffect(() => { if (!loading && !days.length) setDays([makeDay(1, config.startDate || "")]); }, [loading]);

  // Auto-save
  useEffect(() => {
    if (!initialized.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("Modifications non sauvegardées...");
    saveTimer.current = setTimeout(async () => {
      const cleanDays = days.map((d) => ({
        ...d,
        photos: d.photos.map((p) => ({ id: p.id, url: p.url || "", thumb: p.thumb || "" }))
      }));
      setSaveStatus("💾 Sauvegarde...");
      await serverSave({ config, days: cleanDays });
      setSaveStatus("✅ Sauvegardé");
      setTimeout(() => setSaveStatus(""), 3000);
    }, SAVE_DELAY);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [config, days]);

  const updateDay = useCallback((id, patch) => { setDays((p) => p.map((d) => d.id === id ? { ...d, ...patch } : d)); }, []);

  const addDay = () => {
    const lastDay = days[days.length - 1];
    const dt = lastDay?.date ? addDaysToDate(lastDay.date, 1) : "";
    const nId = Date.now();
    setDays([...days, makeDay(nId, dt)]);
  };

  const insertDay = (afterIndex) => {
    const nId = Date.now();
    const prevDay = days[afterIndex];
    const nextDay = days[afterIndex + 1];
    let dt = "";
    if (prevDay?.date && nextDay?.date) dt = prevDay.date;
    else if (prevDay?.date) dt = addDaysToDate(prevDay.date, 1);
    const nd = [...days];
    nd.splice(afterIndex + 1, 0, makeDay(nId, dt));
    setDays(nd);
  };

  const removeDay = (id) => { if (days.length > 1) setDays(days.filter((d) => d.id !== id)); };

  const openLightbox = useCallback((photos, index) => { setLbPhotos(photos); setLbIndex(index); }, []);
  const navLightbox = useCallback((dir) => { setLbIndex((i) => { const n = i + dir; if (n < 0) return lbPhotos.length - 1; if (n >= lbPhotos.length) return 0; return n; }); }, [lbPhotos]);
  const handleUpload = useCallback(async (b64, fname) => await serverUpload(b64, fname), []);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f0fdf4, #e8f5e9)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center", color: "#2d6a4f" }}>
        <div style={{ fontSize: 60, marginBottom: 16 }}>☘️</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Chargement du carnet...</div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f0fdf4 0%, #e8f5e9 100%)", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.leaflet-container{font-family:inherit;}`}</style>
      <TripHeader config={config} isAdmin={isAdmin} onLogin={() => setIsAdmin(true)} onLogout={() => setIsAdmin(false)} saveStatus={saveStatus} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px 40px" }}>
        <StatsBar days={days} />
        <TabBar tab={tab} setTab={setTab} />
        {tab === "journal" && (
          <>
            {days.map((d, i) => (
              <div key={d.id}>
                <DayCard day={d} dayNumber={i + 1} updateDay={updateDay} removeDay={days.length > 1 ? removeDay : null} isAdmin={isAdmin} config={config} onOpenLightbox={openLightbox} onUploadPhoto={handleUpload} />
                {isAdmin && <InsertDayBtn onClick={() => insertDay(i)} />}
              </div>
            ))}
            {isAdmin && <button onClick={addDay} style={{ width: "100%", padding: 14, borderRadius: 12, border: "2px dashed #95d5b2", background: "transparent", color: "#2d6a4f", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>+ Ajouter un jour à la fin</button>}
          </>
        )}
        {tab === "map" && <TripMap days={days} />}
        {tab === "gallery" && <Gallery days={days} onOpenLightbox={openLightbox} />}
        {tab === "summary" && <FullSummary days={days} onOpenLightbox={openLightbox} />}
        {tab === "settings" && <Settings config={config} setConfig={setConfig} isAdmin={isAdmin} />}
      </div>
      {lbIndex >= 0 && <Lightbox photos={lbPhotos} index={lbIndex} onClose={() => setLbIndex(-1)} onNav={navLightbox} />}
    </div>
  );
}