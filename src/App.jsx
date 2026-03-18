import { useState, useRef, useCallback, useEffect } from "react";

const DEFAULT_PASSWORD = "irlande2026";
const IRELAND_CENTER = [53.5, -7.5];
const GEO_CACHE = {};
const SAVE_DELAY = 2000;

function proxyPhotoUrl(url) {
  if (!url) return "";
  var match = url.match(/free\.fr\/photos\/(.+)$/);
  if (match) return "/api/storage?action=photo&file=" + encodeURIComponent(match[1]);
  if (url.startsWith("http://")) return url.replace("http://", "https://");
  return url;
}

async function serverLoad() {
  try {
    var r = await fetch("/api/storage?action=load"); if (!r.ok) return null;
    var data = await r.json(); if (!data) return null;
    if (data.days) { data.days = data.days.map(function(d) { if (d.photos) { d.photos = d.photos.map(function(p) { return { id: p.id, url: proxyPhotoUrl(p.url), thumb: proxyPhotoUrl(p.thumb) }; }); } return d; }); }
    return data;
  } catch (e) { return null; }
}
async function serverSave(data) { try { await fetch("/api/storage?action=save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); } catch (e) {} }
async function serverUpload(base64, filename) {
  try { var r = await fetch("/api/storage?action=upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base64: base64, filename: filename }) }); if (!r.ok) return null; var d = await r.json(); return proxyPhotoUrl(d.url); } catch (e) { return null; }
}

function resizeImage(dataUrl, maxW) {
  if (!maxW) maxW = 800;
  return new Promise(function(r) {
    var img = new Image();
    img.onload = function() { var s = Math.min(1, maxW / img.width); var c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); r(c.toDataURL("image/jpeg", 0.7)); };
    img.onerror = function() { r(dataUrl); }; img.src = dataUrl;
  });
}

async function geocode(loc) {
  if (!loc || !loc.trim()) return null;
  var key = loc.toLowerCase().trim();
  if (GEO_CACHE[key]) return GEO_CACHE[key];
  try {
    var q = /ireland|irlande/i.test(key) ? key : key + ", Ireland";
    // Use proxy to avoid CORS and rate limiting
    var url = "/api/storage?action=geocode&q=" + encodeURIComponent(q);
    var r = await fetch(url);
    if (!r.ok) return null; var d = await r.json();
    if (d && d.length > 0) { var c = [parseFloat(d[0].lat), parseFloat(d[0].lon)]; GEO_CACHE[key] = c; return c; }
  } catch (e) {} return null;
}

// Decode OSRM polyline (precision 5)
function decodePolyline(str) {
  var coords = [], lat = 0, lng = 0, i = 0;
  while (i < str.length) {
    var b, shift = 0, result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
    shift = 0; result = 0;
    do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}

async function getRouteWithGeometry(a, b, scenic) {
  var coords = a[1] + "," + a[0] + ";" + b[1] + "," + b[0];
  try {
    var url = "https://router.project-osrm.org/route/v1/driving/" + coords + "?overview=full&alternatives=" + (scenic ? "true" : "false");
    var r = await fetch(url);
    var d = await r.json();
    if (d.code === "Ok" && d.routes && d.routes.length > 0) {
      // If scenic, pick the longest route (more scenic); otherwise pick shortest
      var route = d.routes[0];
      if (scenic && d.routes.length > 1) {
        for (var i = 1; i < d.routes.length; i++) {
          if (d.routes[i].distance > route.distance) route = d.routes[i];
        }
      }
      return {
        km: Math.round(route.distance / 1000),
        mins: Math.round(route.duration / 60),
        geometry: decodePolyline(route.geometry)
      };
    }
  } catch (e) {}
  return null;
}

function formatDuration(mins) {
  var h = Math.floor(mins / 60);
  var m = mins % 60;
  if (h === 0) return m + " min";
  return h + "h" + (m > 0 ? (m < 10 ? "0" + m : "" + m) : "00");
}

function loadLeaflet() {
  return new Promise(function(res) {
    if (window.L) return res(window.L);
    if (!document.querySelector('link[href*="leaflet"]')) { var c = document.createElement("link"); c.rel = "stylesheet"; c.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(c); }
    if (document.querySelector('script[src*="leaflet"]')) { var iv = setInterval(function() { if (window.L) { clearInterval(iv); res(window.L); } }, 100); return; }
    var s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; s.onload = function() { res(window.L); }; s.onerror = function() { res(null); }; document.head.appendChild(s);
  });
}

function addDaysToDate(ds, n) { if (!ds) return ""; var d = new Date(ds); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; }
function makeDay(id, date) { return { id: id, date: date || "", locations: [""], notes: "", photos: [], summary: "", km: 0, kmTime: "" }; }
function getAllLocations(days) {
  var locs = [];
  days.forEach(function(d, idx) { (d.locations || [d.location || ""]).forEach(function(l) { if (l && l.trim()) locs.push({ dayId: d.id, dayNum: idx + 1, loc: l.trim(), day: d }); }); });
  return locs;
}

// ── Lightbox ──
function Lightbox(props) {
  var photos = props.photos, index = props.index, onClose = props.onClose, onNav = props.onNav;
  useEffect(function() {
    var h = function(e) { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") onNav(1); if (e.key === "ArrowLeft") onNav(-1); };
    window.addEventListener("keydown", h); return function() { window.removeEventListener("keydown", h); };
  }, [onClose, onNav]);
  if (index < 0 || !photos.length) return null;
  var p = photos[index];
  var best = p.src || p.url || p.thumb || "";
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}>
      <img src={best} alt="" style={{ maxWidth: "92vw", maxHeight: "90vh", objectFit: "contain", borderRadius: 8 }} onClick={function(e) { e.stopPropagation(); }} />
      <div style={{ position: "absolute", top: 16, right: 20, color: "#fff", fontSize: 14, opacity: 0.7 }}>{index + 1} / {photos.length}</div>
      <button onClick={function(e) { e.stopPropagation(); onClose(); }} style={{ position: "absolute", top: 16, left: 20, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 28, width: 44, height: 44, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
      {photos.length > 1 && <>
        <button onClick={function(e) { e.stopPropagation(); onNav(-1); }} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 30, width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>‹</button>
        <button onClick={function(e) { e.stopPropagation(); onNav(1); }} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 30, width: 48, height: 48, borderRadius: "50%", cursor: "pointer" }}>›</button>
      </>}
    </div>
  );
}

// ── Login ──
function LoginBar(props) {
  var isAdmin = props.isAdmin, onLogin = props.onLogin, onLogout = props.onLogout;
  var _s = useState(false), show = _s[0], setShow = _s[1];
  var _p = useState(""), pw = _p[0], setPw = _p[1];
  var _e = useState(""), err = _e[0], setErr = _e[1];
  var tryLogin = function() { if (pw === DEFAULT_PASSWORD) { onLogin(); setShow(false); setPw(""); setErr(""); } else setErr("Mot de passe incorrect"); };
  if (isAdmin) return <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px", marginBottom: -8 }}><button onClick={onLogout} style={{ background: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>🔓 Admin — Déconnexion</button></div>;
  if (show) return (
    <div style={{ display: "flex", justifyContent: "center", gap: 8, padding: "0 16px", marginBottom: -8, alignItems: "center", flexWrap: "wrap" }}>
      <input type="password" value={pw} onChange={function(e) { setPw(e.target.value); setErr(""); }} onKeyDown={function(e) { if (e.key === "Enter") tryLogin(); }} placeholder="Mot de passe" autoFocus style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 13, outline: "none", width: 160 }} />
      <button onClick={tryLogin} style={{ background: "#fff", color: "#2d6a4f", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>OK</button>
      <button onClick={function() { setShow(false); setErr(""); }} style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>Annuler</button>
      {err && <span style={{ color: "#fca5a5", fontSize: 12, width: "100%", textAlign: "center" }}>{err}</span>}
    </div>
  );
  return <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px", marginBottom: -8 }}><button onClick={function() { setShow(true); }} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.2)", color: "#b7e4c7", borderRadius: 8, padding: "6px 14px", fontSize: 12, cursor: "pointer" }}>🔒 Connexion admin</button></div>;
}

// ── Settings ──
function Settings(props) {
  var config = props.config, setConfig = props.setConfig, isAdmin = props.isAdmin;
  var set = function(k, v) { setConfig(function(p) { var n = Object.assign({}, p); n[k] = v; return n; }); };
  var inputSt = { padding: "10px 14px", borderRadius: 10, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit", width: "100%", boxSizing: "border-box" };
  if (!isAdmin) return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #d8f3dc" }}>
      <h3 style={{ color: "#2d6a4f", marginBottom: 16, fontSize: 18 }}>⚙️ Paramètres</h3>
      <div style={{ display: "grid", gap: 12, fontSize: 14, color: "#444" }}>
        <div><b>Titre :</b> {config.title}</div><div><b>Dates :</b> {config.startDate} → {config.endDate}</div>
        <div><b>Destination(s) :</b> {config.destinations}</div><div><b>Participants :</b> {config.participants}</div>
      </div>
    </div>
  );
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, border: "1px solid #d8f3dc" }}>
      <h3 style={{ color: "#2d6a4f", marginBottom: 16, fontSize: 18 }}>⚙️ Paramètres</h3>
      <div style={{ display: "grid", gap: 16 }}>
        <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Titre</label><input value={config.title} onChange={function(e) { set("title", e.target.value); }} style={inputSt} /></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Début</label><input type="date" value={config.startDate} onChange={function(e) { set("startDate", e.target.value); }} style={inputSt} /></div>
          <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Fin</label><input type="date" value={config.endDate} onChange={function(e) { set("endDate", e.target.value); }} style={inputSt} /></div>
        </div>
        <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Destination(s)</label><input value={config.destinations} onChange={function(e) { set("destinations", e.target.value); }} style={inputSt} /></div>
        <div><label style={{ fontSize: 13, fontWeight: 600, color: "#2d6a4f", display: "block", marginBottom: 4 }}>Participants</label><input value={config.participants} onChange={function(e) { set("participants", e.target.value); }} style={inputSt} /></div>
      </div>
    </div>
  );
}

// ── KmCounter ──
function KmCounter(props) {
  var days = props.days, routeGeo = props.routeGeo, setRouteGeo = props.setRouteGeo, updateDay = props.updateDay;
  var _t = useState(0), totalKm = _t[0], setTotalKm = _t[1];
  var _m = useState(0), totalMins = _m[0], setTotalMins = _m[1];
  var _c = useState(false), computing = _c[0], setComputing = _c[1];
  var _s = useState([]), segments = _s[0], setSegments = _s[1];
  var _r = useState("normal"), routeType = _r[0], setRouteType = _r[1];

  var compute = async function() {
    setComputing(true);
    var allLocs = getAllLocations(days);
    var coords = [];
    for (var i = 0; i < allLocs.length; i++) {
      var c = await geocode(allLocs[i].loc);
      if (c) coords.push({ loc: allLocs[i].loc, coords: c, dayId: allLocs[i].dayId });
    }
    var total = 0, totalT = 0, segs = [], allGeo = [];
    var scenic = routeType === "scenic";
    // Track km per day
    var dayKm = {};
    for (var j = 1; j < coords.length; j++) {
      var result = await getRouteWithGeometry(coords[j - 1].coords, coords[j].coords, scenic);
      if (result) {
        total += result.km; totalT += result.mins;
        segs.push({ from: coords[j - 1].loc, to: coords[j].loc, km: result.km, mins: result.mins });
        if (result.geometry) allGeo = allGeo.concat(result.geometry);
        // Add km to day
        var did = coords[j].dayId;
        if (!dayKm[did]) dayKm[did] = { km: 0, mins: 0 };
        dayKm[did].km += result.km;
        dayKm[did].mins += result.mins;
      }
      await new Promise(function(r) { setTimeout(r, 350); });
    }
    setTotalKm(Math.round(total));
    setTotalMins(totalT);
    setSegments(segs);
    setRouteGeo(allGeo);
    // Update each day with km
    Object.keys(dayKm).forEach(function(did) {
      var id = parseInt(did) || did;
      updateDay(id, { km: dayKm[id].km, kmTime: formatDuration(dayKm[id].mins) });
    });
    setComputing(false);
  };

  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, border: "1px solid #d8f3dc", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 28 }}>🚗</span>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#2d6a4f" }}>{totalKm} km</div>
          <div style={{ fontSize: 12, color: "#95d5b2" }}>{totalMins > 0 ? formatDuration(totalMins) + " de route" : "Distance par la route"}</div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden", border: "1.5px solid #b7e4c7" }}>
            <button onClick={function() { setRouteType("normal"); }} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: routeType === "normal" ? "#2d6a4f" : "#fff", color: routeType === "normal" ? "#fff" : "#2d6a4f", fontFamily: "inherit" }}>🛣️ Rapide</button>
            <button onClick={function() { setRouteType("scenic"); }} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", background: routeType === "scenic" ? "#2d6a4f" : "#fff", color: routeType === "scenic" ? "#fff" : "#2d6a4f", borderLeft: "1px solid #b7e4c7", fontFamily: "inherit" }}>🌿 Touristique</button>
          </div>
          <button onClick={compute} disabled={computing} style={{ background: "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: computing ? 0.7 : 1 }}>
            {computing ? "⏳ Calcul..." : "🔄 Calculer"}
          </button>
        </div>
      </div>
      {segments.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {segments.map(function(s, i) { return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: i < segments.length - 1 ? "1px solid #f0fdf4" : "none" }}>
              <span style={{ fontSize: 13, color: "#2d6a4f", flex: 1 }}>{s.from} → {s.to}</span>
              <span style={{ fontWeight: 700, color: "#2d6a4f", fontSize: 13 }}>{s.km} km</span>
              <span style={{ fontSize: 12, color: "#95d5b2", minWidth: 55, textAlign: "right" }}>{formatDuration(s.mins)}</span>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

// ── Map ──
function TripMap(props) {
  var days = props.days, routeGeo = props.routeGeo, setRouteGeo = props.setRouteGeo, updateDay = props.updateDay;
  var cRef = useRef(null), mRef = useRef(null), markersRef = useRef([]), routeRef = useRef([]);
  var _s = useState(""), status = _s[0], setStatus = _s[1];
  var _r = useState(false), ready = _r[0], setReady = _r[1];

  useEffect(function() {
    var c = false;
    loadLeaflet().then(function(L) {
      if (c || !L) return;
      if (!mRef.current && cRef.current) {
        mRef.current = L.map(cRef.current, { scrollWheelZoom: true }).setView(IRELAND_CENTER, 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OSM" }).addTo(mRef.current);
        setTimeout(function() { if (mRef.current) mRef.current.invalidateSize(); }, 200);
      }
      setReady(true);
    });
    return function() { c = true; };
  }, []);

  // Draw route geometry when it changes
  useEffect(function() {
    if (!ready || !window.L || !mRef.current) return;
    var L = window.L, m = mRef.current;
    routeRef.current.forEach(function(l) { m.removeLayer(l); });
    routeRef.current = [];
    if (routeGeo && routeGeo.length > 1) {
      var routeLine = L.polyline(routeGeo, { color: "#2d6a4f", weight: 4, opacity: 0.8 }).addTo(m);
      routeRef.current.push(routeLine);
    }
  }, [routeGeo, ready]);

  var _tk = useState(0), tick = _tk[0], setTick = _tk[1];

  var refresh = useCallback(async function() {
    if (!ready || !window.L || !mRef.current) return;
    var L = window.L, m = mRef.current;
    m.invalidateSize();
    // Clear markers
    markersRef.current.forEach(function(l) { m.removeLayer(l); });
    markersRef.current = [];
    var allLocs = getAllLocations(days);
    if (!allLocs.length) { setStatus("Aucun lieu renseigné"); m.setView(IRELAND_CENTER, 7); return; }
    setStatus("Recherche de " + allLocs.length + " lieu(x)...");
    var pts = [];
    for (var i = 0; i < allLocs.length; i++) {
      var item = allLocs[i];
      var c = await geocode(item.loc); if (!c) continue;
      var icon = L.divIcon({ html: '<div style="background:#2d6a4f;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)">' + (i + 1) + '</div>', className: "", iconSize: [28, 28], iconAnchor: [14, 14] });
      var th = item.day.photos.slice(0, 2).map(function(p) { return '<img src="' + (p.thumb || p.url || p.src) + '" style="width:40px;height:40px;object-fit:cover;border-radius:4px"/>'; }).join("");
      var popup = '<div style="font-family:system-ui;min-width:100px"><b style="color:#2d6a4f">Jour ' + item.dayNum + '</b><br/>' + item.loc + (item.day.date ? '<br/><small style="color:#999">' + item.day.date + '</small>' : "") + (th ? '<div style="display:flex;gap:3px;margin-top:4px">' + th + '</div>' : "") + '</div>';
      var mk = L.marker(c, { icon: icon }).addTo(m).bindPopup(popup);
      markersRef.current.push(mk);
      pts.push(c);
      await new Promise(function(r) { setTimeout(r, 250); });
    }
    if (pts.length > 1) { m.fitBounds(L.latLngBounds(pts).pad(0.2)); }
    else if (pts.length === 1) m.setView(pts[0], 11);
    setStatus(pts.length + " étape(s)");
  }, [ready, days, tick]);

  // Auto-refresh when map is ready or locations change
  var locsKey = days.map(function(d) { return (d.locations || []).filter(function(l) { return l && l.trim(); }).join(","); }).join("|");

  useEffect(function() {
    if (!ready) return;
    var timer = setTimeout(function() { refresh(); }, 500);
    return function() { clearTimeout(timer); };
  }, [ready, tick, locsKey]);

  return (
    <div>
      <KmCounter days={days} routeGeo={routeGeo} setRouteGeo={setRouteGeo} updateDay={updateDay} />
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={function() { setTick(function(t) { return t + 1; }); }} style={{ background: "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600 }}>🔄 Actualiser les marqueurs</button>
        {status && <span style={{ fontSize: 13, color: "#52b788" }}>{status}</span>}
      </div>
      <div ref={cRef} style={{ width: "100%", height: 420, borderRadius: 14, overflow: "hidden", border: "2px solid #d8f3dc", background: "#e8f5e9" }} />
      {getAllLocations(days).length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {getAllLocations(days).map(function(item, i) { return (
            <div key={i} style={{ background: "#fff", borderRadius: 8, padding: "4px 10px", fontSize: 12, border: "1px solid #d8f3dc", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ background: "#2d6a4f", color: "#fff", borderRadius: "50%", width: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>{i + 1}</span>
              <span style={{ color: "#555", fontSize: 11 }}>J{item.dayNum}</span>
              <span style={{ color: "#2d6a4f", fontWeight: 500 }}>{item.loc}</span>
            </div>
          ); })}
        </div>
      )}
    </div>
  );
}

// ── Route Badge (for journal/summary) ──
function RouteBadge(props) {
  var day = props.day, isAdmin = props.isAdmin, updateDay = props.updateDay, onGoMap = props.onGoMap;
  var locs = (day.locations || []).filter(function(l) { return l && l.trim(); });
  if (!locs.length && !day.km) return null;
  var locStr = locs.join(" → ");
  return (
    <div onClick={onGoMap} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "#f0fdf4", borderRadius: 10, marginBottom: 12, cursor: "pointer", border: "1px solid #d8f3dc", flexWrap: "wrap" }}>
      <span style={{ fontSize: 18 }}>🗺️</span>
      {locStr && <span style={{ fontSize: 13, color: "#2d6a4f", fontWeight: 500 }}>{locStr}</span>}
      {day.km > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          <span style={{ fontSize: 13 }}>🚗</span>
          {isAdmin ? (
            <input type="number" value={day.km} onChange={function(e) { updateDay(day.id, { km: parseInt(e.target.value) || 0 }); }} onClick={function(e) { e.stopPropagation(); }} style={{ width: 55, padding: "2px 6px", borderRadius: 6, border: "1px solid #b7e4c7", fontSize: 13, fontWeight: 700, color: "#2d6a4f", outline: "none", textAlign: "right", fontFamily: "inherit" }} />
          ) : (
            <span style={{ fontWeight: 700, color: "#2d6a4f", fontSize: 13 }}>{day.km}</span>
          )}
          <span style={{ fontSize: 13, color: "#2d6a4f" }}>km</span>
          {day.kmTime && <span style={{ fontSize: 12, color: "#95d5b2" }}>({day.kmTime})</span>}
        </span>
      )}
    </div>
  );
}

// ── Mini Map per day ──
function MiniMap(props) {
  var locations = props.locations || [];
  var containerRef = useRef(null);
  var mapRef = useRef(null);
  var layersRef = useRef([]);
  var _r = useState(false), ready = _r[0], setReady = _r[1];

  useEffect(function() {
    var cancelled = false;
    loadLeaflet().then(function(L) {
      if (cancelled || !L || !containerRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current, {
          scrollWheelZoom: false,
          dragging: true,
          zoomControl: false,
          attributionControl: false
        }).setView(IRELAND_CENTER, 7);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "" }).addTo(mapRef.current);
        setTimeout(function() { if (mapRef.current) mapRef.current.invalidateSize(); }, 200);
      }
      setReady(true);
    });
    return function() { cancelled = true; };
  }, []);

  useEffect(function() {
    if (!ready || !window.L || !mapRef.current) return;
    var L = window.L, m = mapRef.current;
    var cancelled = false;

    // Clear old layers
    layersRef.current.forEach(function(l) { m.removeLayer(l); });
    layersRef.current = [];

    var locs = locations.filter(function(l) { return l && l.trim(); });
    if (locs.length === 0) return;

    (async function() {
      var pts = [];
      for (var i = 0; i < locs.length; i++) {
        var c = await geocode(locs[i]);
        if (cancelled || !c) continue;
        var icon = L.divIcon({
          html: '<div style="background:#2d6a4f;color:#fff;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:10px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3)">' + (i + 1) + '</div>',
          className: "", iconSize: [22, 22], iconAnchor: [11, 11]
        });
        var mk = L.marker(c, { icon: icon }).addTo(m);
        layersRef.current.push(mk);
        pts.push(c);
      }
      if (cancelled) return;

      // Get route between points
      if (pts.length >= 2) {
        for (var j = 1; j < pts.length; j++) {
          var route = await getRouteWithGeometry(pts[j - 1], pts[j], false);
          if (cancelled) return;
          if (route && route.geometry && route.geometry.length > 1) {
            var line = L.polyline(route.geometry, { color: "#40916c", weight: 3, opacity: 0.8 }).addTo(m);
            layersRef.current.push(line);
          }
          await new Promise(function(r) { setTimeout(r, 300); });
        }
      }

      if (pts.length > 1) {
        m.fitBounds(L.latLngBounds(pts).pad(0.3));
      } else if (pts.length === 1) {
        m.setView(pts[0], 12);
      }
      setTimeout(function() { if (mapRef.current) mapRef.current.invalidateSize(); }, 100);
    })();

    return function() { cancelled = true; };
  }, [ready, locations.join(",")]);

  // Resize fix when container becomes visible
  useEffect(function() {
    var timer = setTimeout(function() {
      if (mapRef.current) mapRef.current.invalidateSize();
    }, 500);
    return function() { clearTimeout(timer); };
  });

  return (
    <div ref={containerRef} style={{
      width: "100%", height: 180, borderRadius: 12, overflow: "hidden",
      border: "1.5px solid #d8f3dc", background: "#e8f5e9", marginBottom: 12
    }} />
  );
}

// ── Day Card ──
function DayCard(props) {
  var day = props.day, dayNumber = props.dayNumber, updateDay = props.updateDay, removeDay = props.removeDay;
  var isAdmin = props.isAdmin, config = props.config, onOpenLightbox = props.onOpenLightbox, onUploadPhoto = props.onUploadPhoto, onGoMap = props.onGoMap;
  var forceExpand = props.forceExpand;
  var fileRef = useRef();
  var _e = useState(true), expanded = _e[0], setExpanded = _e[1];
  var isExpanded = forceExpand || expanded;
  var _l = useState(false), loadingAI = _l[0], setLoadingAI = _l[1];
  var _a = useState(""), aiError = _a[0], setAiError = _a[1];
  var _u = useState(false), uploading = _u[0], setUploading = _u[1];
  var locs = day.locations || [day.location || ""];
  var setLoc = function(idx, val) { var nl = locs.slice(); nl[idx] = val; updateDay(day.id, { locations: nl }); };
  var addLoc = function() { updateDay(day.id, { locations: locs.concat([""]) }); };
  var removeLoc = function(idx) { if (locs.length <= 1) return; updateDay(day.id, { locations: locs.filter(function(_, i) { return i !== idx; }) }); };
  var handlePhotos = async function(e) {
    var files = Array.from(e.target.files); if (!files.length) return;
    setUploading(true);
    var newPhotos = day.photos.slice();
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var dataUrl = await new Promise(function(r) { var rd = new FileReader(); rd.onload = function(ev) { r(ev.target.result); }; rd.readAsDataURL(file); });
      var compressed = await resizeImage(dataUrl, 800);
      var thumb = await resizeImage(dataUrl, 300);
      var b64 = compressed.split(",")[1];
      var fname = "day" + day.id + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6) + ".jpg";
      var url = await onUploadPhoto(b64, fname);
      var thumbB64 = thumb.split(",")[1];
      var thumbUrl = await onUploadPhoto(thumbB64, "thumb_" + fname);
      newPhotos.push({ id: Date.now() + Math.random(), url: url || compressed, thumb: thumbUrl || thumb, src: dataUrl });
    }
    updateDay(day.id, { photos: newPhotos });
    setUploading(false); e.target.value = "";
  };
  var generateSummary = async function() {
    if (!day.photos.length) return;
    setLoadingAI(true); setAiError("");
    try {
      var imgs = [];
      for (var i = 0; i < Math.min(day.photos.length, 5); i++) {
        var p = day.photos[i];
        var imgData = p.src || p.url;
        if (!imgData) continue;
        if (!imgData.startsWith("data:")) {
          try { var r2 = await fetch(imgData); var blob = await r2.blob(); imgData = await new Promise(function(res) { var rd = new FileReader(); rd.onload = function() { res(rd.result); }; rd.readAsDataURL(blob); }); } catch(e2) { continue; }
        }
        var small = await resizeImage(imgData, 600);
        imgs.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: small.split(",")[1] } });
      }
      if (!imgs.length) { setAiError("Aucune photo exploitable."); setLoadingAI(false); return; }
      var parts = [];
      if (day.date) parts.push("Date : " + day.date + ".");
      var locStr = locs.filter(function(l) { return l && l.trim(); }).join(", ");
      if (locStr) parts.push("Lieux : " + locStr + ".");
      if (config.destinations) parts.push("Destination : " + config.destinations + ".");
      if (config.participants) parts.push("Participants : " + config.participants + ".");
      var nb = config.participants ? config.participants.split(",").length : 4;
      var body = JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 1000,
        messages: [{ role: "user", content: imgs.concat([{ type: "text", text: "Tu es un assistant de carnet de voyage pour un groupe de " + nb + " voyageurs" + (config.participants ? " (" + config.participants + ")" : "") + ". " + parts.join(" ") + "\nRédige un résumé concis en français (50-70 mots). Utilise nous/on et les prénoms quand pertinent. Ne mentionne PAS le numéro du jour, la date ni les noms de lieux en début de résumé car ils sont déjà affichés en titre. Concentre-toi sur l'ambiance, les ressentis, les moments forts et les découvertes. Ton enthousiaste, style journal de bord." }]) }]
      });
      var resp;
      try { resp = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: body }); if (!resp.ok) throw new Error(); } catch(e3) { resp = await fetch("/api/summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: body }); }
      if (!resp.ok) throw new Error("API " + resp.status);
      var data = await resp.json();
      var text = (data.content || []).map(function(c) { return c.text || ""; }).filter(Boolean).join("");
      updateDay(day.id, { summary: text || "Aucun résumé." });
    } catch (err) { setAiError(err.message); }
    setLoadingAI(false);
  };
  var photoDisp = function(p) { return p.thumb || p.url || p.src || ""; };
  var locDisplay = locs.filter(function(l) { return l && l.trim(); }).join(" → ");

  return (
    <div className="day-card-print" style={{ background: "#fff", borderRadius: 16, marginBottom: 12, marginTop: 8, boxShadow: "0 2px 16px rgba(45,106,79,0.10)", border: "1px solid #d8f3dc", overflow: "hidden" }}>
      <div onClick={function() { setExpanded(!expanded); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", cursor: "pointer", background: isExpanded ? "linear-gradient(135deg, #2d6a4f, #40916c)" : "#f7fdf9" }}>
        <span style={{ fontSize: 22, color: isExpanded ? "#fff" : "#2d6a4f", fontWeight: 700 }}>Jour {dayNumber}</span>
        {locDisplay && <span style={{ color: isExpanded ? "#b7e4c7" : "#52b788", fontSize: 17, fontWeight: 600, marginLeft: 4 }}>— {locDisplay}</span>}
        {day.km > 0 && <span style={{ color: isExpanded ? "#b7e4c7" : "#95d5b2", fontSize: 15, fontWeight: 600 }}>🚗 {day.km}km</span>}
        {day.date && <span style={{ color: isExpanded ? "#b7e4c7" : "#95d5b2", fontSize: 13, marginLeft: "auto" }}>{day.date}</span>}
        <span style={{ marginLeft: day.date ? 8 : "auto", color: isExpanded ? "#fff" : "#2d6a4f", fontSize: 18, transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▾</span>
      </div>
      {isExpanded && (
        <div style={{ padding: 20 }}>
          <RouteBadge day={day} isAdmin={isAdmin} updateDay={updateDay} onGoMap={onGoMap} />
          {locs.some(function(l) { return l && l.trim(); }) && <MiniMap locations={locs} />}
          {isAdmin ? (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                <input type="date" value={day.date} onChange={function(e) { updateDay(day.id, { date: e.target.value }); }} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
              </div>
              {locs.map(function(l, i) { return (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "#95d5b2", width: 20, textAlign: "center", flexShrink: 0 }}>{i + 1}.</span>
                  <input type="text" placeholder={i === 0 ? "📍 Lieu principal" : "📍 Autre lieu"} value={l} onChange={function(e) { setLoc(i, e.target.value); }} style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
                  {locs.length > 1 && <button onClick={function() { removeLoc(i); }} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 18 }}>×</button>}
                </div>
              ); })}
              <button onClick={addLoc} style={{ background: "none", border: "1px dashed #b7e4c7", borderRadius: 8, padding: "4px 12px", color: "#52b788", fontSize: 12, cursor: "pointer", marginTop: 2 }}>+ Ajouter un lieu</button>
            </div>
          ) : (day.date || locDisplay) && !day.km ? (
            <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 14, color: "#555", flexWrap: "wrap" }}>
              {day.date && <span>📅 {day.date}</span>}{locDisplay && <span>📍 {locDisplay}</span>}
            </div>
          ) : null}
          {isAdmin ? (
            <textarea placeholder="Notes, anecdotes..." value={day.notes} onChange={function(e) { updateDay(day.id, { notes: e.target.value }); }} rows={2} style={{ width: "100%", padding: 12, borderRadius: 10, border: "1.5px solid #d8f3dc", fontSize: 14, resize: "vertical", fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          ) : day.notes ? <div style={{ fontSize: 14, color: "#444", lineHeight: 1.6, marginBottom: 8, whiteSpace: "pre-wrap" }}>{day.notes}</div> : null}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontWeight: 600, color: "#2d6a4f" }}>📸 Photos</span>
              {isAdmin && <><button onClick={function() { fileRef.current.click(); }} disabled={uploading} style={{ background: "#d8f3dc", color: "#2d6a4f", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: uploading ? 0.6 : 1 }}>{uploading ? "⏳ Upload..." : "+ Ajouter"}</button><input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotos} style={{ display: "none" }} /></>}
              <span style={{ fontSize: 12, color: "#95d5b2" }}>{day.photos.length} photo{day.photos.length !== 1 ? "s" : ""}</span>
            </div>
            {day.photos.length > 0 && (
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
                {day.photos.map(function(p, i) { return (
                  <div key={p.id} style={{ position: "relative", width: 110, height: 110, borderRadius: 10, overflow: "hidden", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
                    <img src={photoDisp(p)} alt="" onClick={function() { onOpenLightbox(day.photos, i); }} style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "pointer" }} />
                    {isAdmin && <button onClick={function() { updateDay(day.id, { photos: day.photos.filter(function(x) { return x.id !== p.id; }) }); }} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>}
                  </div>
                ); })}
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
                <textarea value={day.summary} onChange={function(e) { updateDay(day.id, { summary: e.target.value }); }} rows={3} style={{ width: "100%", padding: 10, borderRadius: 8, border: "1px solid #b7e4c7", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "rgba(255,255,255,0.6)", color: "#1b4332", lineHeight: 1.6, resize: "vertical" }} />
              ) : (
                <div style={{ fontSize: 14, color: "#1b4332", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{day.summary}</div>
              )}
            </div>
          )}
          {isAdmin && removeDay && <button onClick={function() { removeDay(day.id); }} style={{ marginTop: 14, background: "none", border: "1px solid #e0e0e0", borderRadius: 8, padding: "6px 14px", color: "#999", fontSize: 12, cursor: "pointer" }}>🗑️ Supprimer ce jour</button>}
        </div>
      )}
    </div>
  );
}

function InsertDayBtn(props) {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "2px 0", marginBottom: 4 }}>
      <button onClick={props.onClick} style={{ background: "none", border: "2px dashed #d8f3dc", borderRadius: 20, padding: "2px 16px", color: "#95d5b2", fontSize: 12, cursor: "pointer" }}>+ insérer un jour</button>
    </div>
  );
}

function TripHeader(props) {
  return (
    <div style={{ textAlign: "center", padding: "30px 20px 24px", background: "linear-gradient(160deg, #1b4332 0%, #2d6a4f 50%, #40916c 100%)", color: "#fff", borderRadius: "0 0 30px 30px", marginBottom: 24, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 10, left: 20, opacity: 0.15, fontSize: 80 }}>☘️</div>
      <div style={{ position: "absolute", bottom: -10, right: 20, opacity: 0.10, fontSize: 120 }}>🏰</div>
      <LoginBar isAdmin={props.isAdmin} onLogin={props.onLogin} onLogout={props.onLogout} />
      <div style={{ fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "#b7e4c7", marginBottom: 8, marginTop: 10 }}>Carnet de Voyage</div>
      <div style={{ fontSize: 38, fontWeight: 800 }}>{props.config.title || "Mon voyage"}</div>
      {(props.config.startDate || props.config.endDate) && <div style={{ marginTop: 10, color: "#b7e4c7", fontSize: 18 }}>{props.config.startDate} → {props.config.endDate}</div>}
      {props.config.participants && <div style={{ marginTop: 8, color: "#95d5b2", fontSize: 17 }}>👥 {props.config.participants}</div>}
      <div style={{ marginTop: 6, display: "flex", justifyContent: "center", gap: 8, alignItems: "center" }}>
        {!props.isAdmin && <span className="no-print" style={{ fontSize: 12, color: "#95d5b2" }}>👀 Mode visiteur</span>}
        {props.saveStatus && <span style={{ fontSize: 11, color: "#b7e4c7", background: "rgba(255,255,255,0.1)", padding: "2px 10px", borderRadius: 6 }}>{props.saveStatus}</span>}
      </div>
    </div>
  );
}

function StatsBar(props) {
  var days = props.days;
  var totalKm = days.reduce(function(s, d) { return s + (d.km || 0); }, 0);
  var items = [{ icon: "📅", l: "Jours", v: days.length }, { icon: "📸", l: "Photos", v: days.reduce(function(s, d) { return s + d.photos.length; }, 0) }, { icon: "📍", l: "Étapes", v: getAllLocations(days).length }, { icon: "🚗", l: "Km", v: totalKm }];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
      {items.map(function(it) { return (
        <div key={it.l} style={{ background: "#fff", borderRadius: 12, padding: "12px 20px", boxShadow: "0 2px 8px rgba(45,106,79,0.08)", textAlign: "center", minWidth: 70, border: "1px solid #d8f3dc" }}>
          <div style={{ fontSize: 22 }}>{it.icon}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2d6a4f" }}>{it.v}</div>
          <div style={{ fontSize: 11, color: "#95d5b2" }}>{it.l}</div>
        </div>
      ); })}
    </div>
  );
}

function TabBar(props) {
  var tab = props.tab, setTab = props.setTab;
  var tabs = [{ id: "journal", l: "📖 Journal" }, { id: "map", l: "🗺️ Carte" }, { id: "gallery", l: "🖼️ Galerie" }, { id: "summary", l: "📝 Résumé" }, { id: "settings", l: "⚙️ Paramètres" }];
  return (
    <div className="no-print" style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
      {tabs.map(function(t) { return (
        <button key={t.id} onClick={function() { setTab(t.id); }} style={{ padding: "10px 16px", borderRadius: 10, border: tab === t.id ? "2px solid #2d6a4f" : "1.5px solid #d8f3dc", background: tab === t.id ? "#2d6a4f" : "#fff", color: tab === t.id ? "#fff" : "#2d6a4f", fontWeight: 600, cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>{t.l}</button>
      ); })}
    </div>
  );
}

function Gallery(props) {
  var days = props.days, onOpenLightbox = props.onOpenLightbox;
  var all = days.flatMap(function(d, di) { return d.photos.map(function(p) { return Object.assign({}, p, { dayNum: di + 1, location: (d.locations || []).filter(function(l) { return l && l.trim(); }).join(", ") }); }); });
  var allFlat = days.flatMap(function(d) { return d.photos; });
  if (!all.length) return <div style={{ textAlign: "center", padding: 40, color: "#95d5b2" }}>Aucune photo.</div>;
  var gi = 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {all.map(function(p) {
        var idx = gi++;
        return (
          <div key={p.id + "-" + idx} onClick={function() { onOpenLightbox(allFlat, idx); }} style={{ borderRadius: 12, overflow: "hidden", position: "relative", aspectRatio: "1", boxShadow: "0 2px 8px rgba(0,0,0,0.12)", cursor: "pointer" }}>
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

function FullSummary(props) {
  var days = props.days, onOpenLightbox = props.onOpenLightbox, config = props.config;
  var s = days.filter(function(d) { return d.summary; });

  var printSummary = function() {
    window.print();
  };

  if (!s.length) return <div style={{ textAlign: "center", padding: 40, color: "#95d5b2" }}>Aucun résumé.</div>;
  return (
    <div>
      <div className="no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button onClick={printSummary} style={{ background: "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
          📄 Exporter en PDF
        </button>
      </div>
      {s.map(function(d) {
        var dayNum = days.indexOf(d) + 1;
        var locStr = (d.locations || []).filter(function(l) { return l && l.trim(); }).join(" → ");
        return (
          <div key={d.id} className="summary-card" style={{ marginBottom: 28, marginTop: 20, background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 2px 10px rgba(45,106,79,0.08)", border: "1px solid #d8f3dc" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: "#2d6a4f" }}>Jour {dayNum}</span>
              {locStr && <span style={{ color: "#52b788", fontSize: 17, fontWeight: 600 }}>📍 {locStr}</span>}
              {d.km > 0 && <span style={{ fontSize: 15, fontWeight: 600, color: "#2d6a4f" }}>🚗 {d.km} km</span>}
              {d.date && <span style={{ color: "#95d5b2", fontSize: 14, marginLeft: "auto" }}>{d.date}</span>}
            </div>
            <div style={{ color: "#1b4332", lineHeight: 1.65, fontSize: 14, whiteSpace: "pre-wrap", marginBottom: 12 }}>{d.summary}</div>
            {d.notes && (
              <div style={{ fontSize: 13, color: "#555", lineHeight: 1.5, whiteSpace: "pre-wrap", marginBottom: 12, padding: "10px 14px", background: "#f9fafb", borderRadius: 10, borderLeft: "3px solid #d8f3dc", fontStyle: "italic" }}>{d.notes}</div>
            )}
            {(d.locations || []).some(function(l) { return l && l.trim(); }) && (
              <div style={{ marginBottom: 12 }}>
                <MiniMap locations={d.locations || []} />
              </div>
            )}
            {d.photos.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                {d.photos.slice(0, 8).map(function(p, pi) { return (
                  <img key={p.id} src={p.url || p.thumb || p.src} alt="" onClick={function() { onOpenLightbox(d.photos, pi); }}
                    style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 10, cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.1)" }} />
                ); })}
                {d.photos.length > 8 && <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#d8f3dc", borderRadius: 10, fontSize: 15, fontWeight: 700, color: "#2d6a4f", aspectRatio: "4/3" }}>+{d.photos.length - 8}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── App ──
var DEFAULT_CONFIG = { title: "Irlande été 2026 ☘️", startDate: "2026-07-01", endDate: "2026-07-14", destinations: "Irlande", participants: "" };

export default function App() {
  var _c = useState(DEFAULT_CONFIG), config = _c[0], setConfig = _c[1];
  var _d = useState([]), days = _d[0], setDays = _d[1];
  var _t = useState("journal"), tab = _t[0], setTab = _t[1];
  var _a = useState(false), isAdmin = _a[0], setIsAdmin = _a[1];
  var _lp = useState([]), lbPhotos = _lp[0], setLbPhotos = _lp[1];
  var _li = useState(-1), lbIndex = _li[0], setLbIndex = _li[1];
  var _lo = useState(true), loading = _lo[0], setLoading = _lo[1];
  var _ss = useState(""), saveStatus = _ss[0], setSaveStatus = _ss[1];
  var _pr = useState(false), printing = _pr[0], setPrinting = _pr[1];
  var _rg = useState([]), routeGeo = _rg[0], setRouteGeo = _rg[1];

  var printJournal = function() {
    setPrinting(true);
    setTimeout(function() { window.print(); setTimeout(function() { setPrinting(false); }, 500); }, 300);
  };
  var saveTimer = useRef(null);
  var initialized = useRef(false);

  useEffect(function() {
    (async function() {
      var data = await serverLoad();
      if (data) {
        if (data.config) setConfig(data.config);
        if (data.days && data.days.length) {
          setDays(data.days.map(function(d) {
            if (!d.locations) d.locations = d.location ? [d.location] : [""];
            if (!d.summary && d.aiSummary) d.summary = d.aiSummary;
            if (!d.km) d.km = 0;
            if (!d.kmTime) d.kmTime = "";
            return d;
          }));
        }
      }
      initialized.current = true;
      setLoading(false);
    })();
  }, []);

  useEffect(function() {
    if (!initialized.current) return;
    if (!config.startDate || !config.endDate) return;
    var start = new Date(config.startDate), end = new Date(config.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return;
    var nb = Math.round((end - start) / 86400000) + 1;
    setDays(function(prev) {
      if (prev.length > 0 && prev.some(function(d) { return d.photos.length || d.summary || d.notes || (d.locations || []).some(function(l) { return l && l.trim(); }); })) return prev;
      var nd = [];
      for (var i = 0; i < nb; i++) {
        var ex = prev.find(function(d) { return d.id === i + 1; });
        nd.push(ex || makeDay(i + 1, addDaysToDate(config.startDate, i)));
      }
      return nd;
    });
  }, [config.startDate, config.endDate]);

  useEffect(function() { if (!loading && !days.length) setDays([makeDay(1, config.startDate || "")]); }, [loading]);

  useEffect(function() {
    if (!initialized.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("Modifications non sauvegardées...");
    saveTimer.current = setTimeout(async function() {
      var cleanDays = days.map(function(d) {
        return Object.assign({}, d, { photos: d.photos.map(function(p) { return { id: p.id, url: p.url || "", thumb: p.thumb || "" }; }) });
      });
      setSaveStatus("💾 Sauvegarde...");
      await serverSave({ config: config, days: cleanDays });
      setSaveStatus("✅ Sauvegardé");
      setTimeout(function() { setSaveStatus(""); }, 3000);
    }, SAVE_DELAY);
    return function() { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [config, days]);

  var updateDay = useCallback(function(id, patch) { setDays(function(p) { return p.map(function(d) { return d.id === id ? Object.assign({}, d, patch) : d; }); }); }, []);
  var addDay = function() {
    var lastDay = days[days.length - 1];
    var dt = lastDay && lastDay.date ? addDaysToDate(lastDay.date, 1) : "";
    setDays(days.concat([makeDay(Date.now(), dt)]));
  };
  var insertDay = function(afterIndex) {
    var prevDay = days[afterIndex];
    var dt = prevDay && prevDay.date ? addDaysToDate(prevDay.date, 1) : "";
    var nd = days.slice();
    nd.splice(afterIndex + 1, 0, makeDay(Date.now(), dt));
    setDays(nd);
  };
  var removeDay = function(id) { if (days.length > 1) setDays(days.filter(function(d) { return d.id !== id; })); };
  var openLightbox = useCallback(function(photos, index) { setLbPhotos(photos); setLbIndex(index); }, []);
  var navLightbox = useCallback(function(dir) { setLbIndex(function(i) { var n = i + dir; if (n < 0) return lbPhotos.length - 1; if (n >= lbPhotos.length) return 0; return n; }); }, [lbPhotos]);
  var handleUpload = useCallback(async function(b64, fname) { return await serverUpload(b64, fname); }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f0fdf4, #e8f5e9)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui" }}>
      <div style={{ textAlign: "center", color: "#2d6a4f" }}><div style={{ fontSize: 60, marginBottom: 16 }}>☘️</div><div style={{ fontSize: 20, fontWeight: 700 }}>Chargement du carnet...</div></div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f0fdf4 0%, #e8f5e9 100%)", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
      <style>{
        "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}" +
        ".leaflet-container{font-family:inherit;}" +
        "@media print{" +
        "@page{margin:5mm 3mm;}" +
        ".no-print{display:none !important;}" +
        "body,html{background:#e8f5e9 !important;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact;margin:0 !important;padding:0 !important;}" +
        "div[style*='minHeight']{background:#e8f5e9 !important;padding:15mm 5mm !important;}" +
        "*, *::before, *::after{background-color:transparent;}" +
        ".summary-card{break-inside:avoid;box-shadow:none !important;border:1px solid #d8f3dc !important;margin:20px 20px !important;page-break-inside:avoid;background:#fff !important;}" +
        ".day-card-print{break-inside:avoid;box-shadow:none !important;border:1px solid #d8f3dc !important;margin:20px 20px !important;page-break-inside:avoid;background:#fff !important;}" +
        ".leaflet-container{height:160px !important;}" +
        "textarea{border:none !important;resize:none !important;background:transparent !important;}" +
        "button{display:none !important;}" +
        "input{border:none !important;background:transparent !important;}" +
        "img{max-height:200px !important;}" +
        "}"
      }</style>
      <TripHeader config={config} isAdmin={isAdmin} onLogin={function() { setIsAdmin(true); }} onLogout={function() { setIsAdmin(false); }} saveStatus={saveStatus} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px 40px" }}>
        <StatsBar days={days} />
        <TabBar tab={tab} setTab={setTab} />
        {tab === "journal" && (
          <>
            {days.map(function(d, i) { return (
              <div key={d.id}>
                <DayCard day={d} dayNumber={i + 1} updateDay={updateDay} removeDay={days.length > 1 ? removeDay : null} isAdmin={isAdmin} config={config} onOpenLightbox={openLightbox} onUploadPhoto={handleUpload} onGoMap={function() { setTab("map"); }} forceExpand={printing} />
                {isAdmin && <InsertDayBtn onClick={function() { insertDay(i); }} />}
              </div>
            ); })}
            {isAdmin && <button onClick={addDay} style={{ width: "100%", padding: 14, borderRadius: 12, border: "2px dashed #95d5b2", background: "transparent", color: "#2d6a4f", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 8 }}>+ Ajouter un jour</button>}
          </>
        )}
        {tab === "map" && <TripMap days={days} routeGeo={routeGeo} setRouteGeo={setRouteGeo} updateDay={updateDay} />}
        {tab === "gallery" && <Gallery days={days} onOpenLightbox={openLightbox} />}
        {tab === "summary" && <FullSummary days={days} onOpenLightbox={openLightbox} config={config} />}
        {tab === "settings" && <Settings config={config} setConfig={setConfig} isAdmin={isAdmin} />}
      </div>
      {lbIndex >= 0 && <Lightbox photos={lbPhotos} index={lbIndex} onClose={function() { setLbIndex(-1); }} onNav={navLightbox} />}
    </div>
  );
}