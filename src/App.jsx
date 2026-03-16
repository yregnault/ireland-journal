import { useState, useRef, useCallback, useEffect } from "react";

const IRELAND_CENTER = [53.5, -7.5];
const GEOCODE_CACHE = {};

function resizeImage(dataUrl, maxWidth = 800) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function geocode(loc) {
  if (!loc || !loc.trim()) return null;
  const key = loc.toLowerCase().trim();
  if (GEOCODE_CACHE[key]) return GEOCODE_CACHE[key];
  try {
    const q = key.includes("ireland") || key.includes("irlande") ? key : `${key}, Ireland`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1`, {
      headers: { "Accept": "application/json" }
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d && d.length > 0) {
      const coords = [parseFloat(d[0].lat), parseFloat(d[0].lon)];
      GEOCODE_CACHE[key] = coords;
      return coords;
    }
  } catch (e) {
    console.warn("Geocode error:", e);
  }
  return null;
}

function loadLeaflet() {
  return new Promise((resolve) => {
    if (window.L) return resolve(window.L);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
    js.onload = () => resolve(window.L);
    js.onerror = () => resolve(null);
    document.head.appendChild(js);
  });
}

function TripMap({ days }) {
  const mapRef = useRef(null);
  const mapInst = useRef(null);
  const markersRef = useRef([]);
  const polyRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [locKey, setLocKey] = useState(0);

  useEffect(() => {
    let c = false;
    loadLeaflet().then((L) => {
      if (c || !L || mapInst.current) return;
      const m = L.map(mapRef.current, { scrollWheelZoom: true, zoomControl: true }).setView(IRELAND_CENTER, 7);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© OSM'
      }).addTo(m);
      mapInst.current = m;
      setReady(true);
      setTimeout(() => m.invalidateSize(), 300);
    });
    return () => { c = true; };
  }, []);

  const refreshMap = useCallback(async () => {
    if (!ready || !window.L) return;
    const L = window.L;
    const m = mapInst.current;
    markersRef.current.forEach((mk) => m.removeLayer(mk));
    markersRef.current = [];
    if (polyRef.current) { m.removeLayer(polyRef.current); polyRef.current = null; }

    const daysWithLoc = days.filter((d) => d.location && d.location.trim());
    if (daysWithLoc.length === 0) {
      setStatus("Aucun lieu renseigné");
      m.setView(IRELAND_CENTER, 7);
      return;
    }

    setStatus(`Géolocalisation de ${daysWithLoc.length} lieu(x)...`);
    const valid = [];

    for (const d of daysWithLoc) {
      const c = await geocode(d.location);
      if (!c) { setStatus(`"${d.location}" non trouvé, essayez un nom plus précis`); continue; }

      const iconHtml = `<div style="background:#2d6a4f;color:#fff;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35);">${d.id}</div>`;
      const icon = L.divIcon({ html: iconHtml, className: "", iconSize: [32, 32], iconAnchor: [16, 16] });
      const thumbs = d.photos.slice(0, 3).map((p) => `<img src="${p.thumb || p.src}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;"/>`).join("");
      const popup = `<div style="font-family:system-ui;min-width:130px;"><b style="color:#2d6a4f;">Jour ${d.id}</b><br/>${d.location}${d.date ? `<br/><small style="color:#999;">${d.date}</small>` : ""}${thumbs ? `<div style="display:flex;gap:3px;margin-top:5px;">${thumbs}</div>` : ""}${d.aiSummary ? `<p style="font-size:11px;color:#444;margin:5px 0 0;max-width:200px;">${d.aiSummary.slice(0, 100)}...</p>` : ""}</div>`;
      const marker = L.marker(c, { icon }).addTo(m).bindPopup(popup);
      markersRef.current.push(marker);
      valid.push(c);
    }

    if (valid.length > 1) {
      polyRef.current = L.polyline(valid, { color: "#40916c", weight: 3, opacity: 0.7, dashArray: "8 6" }).addTo(m);
      m.fitBounds(L.latLngBounds(valid).pad(0.2));
    } else if (valid.length === 1) {
      m.setView(valid[0], 11);
    }
    setStatus(valid.length > 0 ? `${valid.length} étape(s) affichée(s)` : "Aucun lieu trouvé");
  }, [ready, days]);

  useEffect(() => { refreshMap(); }, [locKey, ready]);

  const handleRefresh = () => setLocKey((k) => k + 1);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={handleRefresh} style={{ background: "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit" }}>
          🔄 Actualiser la carte
        </button>
        {status && <span style={{ fontSize: 13, color: "#52b788" }}>{status}</span>}
      </div>
      <div style={{ position: "relative" }}>
        <div ref={mapRef} style={{ width: "100%", height: 420, borderRadius: 14, overflow: "hidden", border: "2px solid #d8f3dc", background: "#e8f5e9" }} />
        {days.filter((d) => d.location && d.location.trim()).length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.85)", borderRadius: 14, zIndex: 1000 }}>
            <div style={{ textAlign: "center", color: "#95d5b2" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>🗺️</div>
              <div>Renseignez les lieux dans le journal<br/>puis cliquez "Actualiser la carte"</div>
            </div>
          </div>
        )}
      </div>
      {days.filter((d) => d.location && d.location.trim()).length > 0 && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {days.filter((d) => d.location && d.location.trim()).map((d) => (
            <div key={d.id} style={{ background: "#fff", borderRadius: 8, padding: "5px 12px", fontSize: 13, border: "1px solid #d8f3dc", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ background: "#2d6a4f", color: "#fff", borderRadius: "50%", width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{d.id}</span>
              <span style={{ color: "#2d6a4f", fontWeight: 500 }}>{d.location}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PhotoThumbnail({ src, onRemove }) {
  return (
    <div style={{ position: "relative", width: 110, height: 110, borderRadius: 10, overflow: "hidden", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}>
      <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <button onClick={onRemove} style={{ position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.55)", color: "#fff", border: "none", borderRadius: "50%", width: 22, height: 22, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
    </div>
  );
}

function DayCard({ day, updateDay, removeDay }) {
  const fileRef = useRef();
  const [expanded, setExpanded] = useState(true);
  const [loadingAI, setLoadingAI] = useState(false);
  const [aiError, setAiError] = useState("");

  const handlePhotos = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const reader = new FileReader();
      const dataUrl = await new Promise((res) => { reader.onload = (ev) => res(ev.target.result); reader.readAsDataURL(file); });
      const thumb = await resizeImage(dataUrl, 300);
      const compressed = await resizeImage(dataUrl, 800);
      updateDay(day.id, { photos: [...day.photos, { id: Date.now() + Math.random(), src: dataUrl, thumb, compressed }] });
    }
    e.target.value = "";
  };

  const removePhoto = (pid) => updateDay(day.id, { photos: day.photos.filter((p) => p.id !== pid) });

  const generateSummary = async () => {
    if (day.photos.length === 0) return;
    setLoadingAI(true);
    setAiError("");
    try {
      const imgs = [];
      for (const p of day.photos.slice(0, 5)) {
        const small = p.compressed || await resizeImage(p.src, 600);
        const base64 = small.split(",")[1];
        const mt = small.match(/data:(.*?);/)?.[1] || "image/jpeg";
        imgs.push({ type: "image", source: { type: "base64", media_type: mt, data: base64 } });
      }
      const lh = day.location ? `Lieu prévu : ${day.location}.` : "";
      const dh = day.date ? `Date : ${day.date}.` : "";
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: [
              ...imgs,
              { type: "text", text: `Tu es un assistant de carnet de voyage. Analyse ces photos prises lors d'un voyage en Irlande. ${dh} ${lh}\nRédige un résumé vivant et chaleureux de la journée en français (environ 120 mots). Décris les lieux visités, l'ambiance, la météo si visible, les activités. Utilise un ton personnel et enthousiaste, comme un journal intime de voyage. Si tu reconnais des lieux célèbres irlandais, mentionne-les.` }
            ]
          }]
        })
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`API ${resp.status}: ${errText.slice(0, 200)}`);
      }
      const data = await resp.json();
      const summary = data.content?.map((c) => c.text || "").filter(Boolean).join("") || "Aucun résumé généré.";
      updateDay(day.id, { aiSummary: summary });
    } catch (err) {
      console.error("AI error:", err);
      setAiError(`Erreur : ${err.message}`);
      updateDay(day.id, { aiSummary: "" });
    }
    setLoadingAI(false);
  };

  return (
    <div style={{ background: "#fff", borderRadius: 16, marginBottom: 20, boxShadow: "0 2px 16px rgba(45,106,79,0.10)", border: "1px solid #d8f3dc", overflow: "hidden" }}>
      <div onClick={() => setExpanded(!expanded)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px", cursor: "pointer", background: expanded ? "linear-gradient(135deg, #2d6a4f, #40916c)" : "#f7fdf9", transition: "background 0.3s" }}>
        <span style={{ fontSize: 22, color: expanded ? "#fff" : "#2d6a4f", fontWeight: 700 }}>Jour {day.id}</span>
        {day.location && <span style={{ color: expanded ? "#b7e4c7" : "#52b788", fontSize: 14, marginLeft: 4 }}>— {day.location}</span>}
        {day.date && <span style={{ color: expanded ? "#b7e4c7" : "#95d5b2", fontSize: 13, marginLeft: "auto" }}>{day.date}</span>}
        <span style={{ marginLeft: day.date ? 8 : "auto", color: expanded ? "#fff" : "#2d6a4f", fontSize: 18, transform: expanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}>▾</span>
      </div>
      {expanded && (
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            <input type="date" value={day.date} onChange={(e) => updateDay(day.id, { date: e.target.value })} style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
            <input type="text" placeholder="📍 Lieu (ex: Dublin, Cliffs of Moher...)" value={day.location} onChange={(e) => updateDay(day.id, { location: e.target.value })} style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1.5px solid #b7e4c7", fontSize: 14, outline: "none", fontFamily: "inherit" }} />
          </div>
          <textarea placeholder="Notes personnelles, anecdotes, ressentis..." value={day.notes} onChange={(e) => updateDay(day.id, { notes: e.target.value })} rows={3} style={{ width: "100%", padding: 12, borderRadius: 10, border: "1.5px solid #d8f3dc", fontSize: 14, resize: "vertical", fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontWeight: 600, color: "#2d6a4f" }}>📸 Photos</span>
              <button onClick={() => fileRef.current?.click()} style={{ background: "#d8f3dc", color: "#2d6a4f", border: "none", borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>+ Ajouter</button>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handlePhotos} style={{ display: "none" }} />
              <span style={{ fontSize: 12, color: "#95d5b2" }}>{day.photos.length} photo{day.photos.length !== 1 ? "s" : ""}</span>
            </div>
            {day.photos.length > 0 && (
              <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 8 }}>
                {day.photos.map((p) => <PhotoThumbnail key={p.id} src={p.thumb || p.src} onRemove={() => removePhoto(p.id)} />)}
              </div>
            )}
          </div>
          <div style={{ marginTop: 18, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={generateSummary} disabled={day.photos.length === 0 || loadingAI} style={{ background: day.photos.length === 0 ? "#ccc" : "linear-gradient(135deg, #40916c, #2d6a4f)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", cursor: day.photos.length === 0 ? "default" : "pointer", fontSize: 14, fontWeight: 600, opacity: loadingAI ? 0.7 : 1, display: "flex", alignItems: "center", gap: 8 }}>
              {loadingAI ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span> Analyse en cours...</> : <>✨ Générer le résumé IA</>}
            </button>
            {day.photos.length === 0 && <span style={{ fontSize: 12, color: "#999" }}>Ajoutez des photos pour activer l'IA</span>}
          </div>
          {aiError && (
            <div style={{ marginTop: 12, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 12, fontSize: 13, color: "#b91c1c" }}>
              ⚠️ {aiError}
            </div>
          )}
          {day.aiSummary && (
            <div style={{ marginTop: 16, background: "linear-gradient(135deg, #f0fdf4, #d8f3dc)", borderRadius: 12, padding: 16, borderLeft: "4px solid #40916c" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#2d6a4f", marginBottom: 6 }}>✨ Résumé IA de la journée</div>
              <div style={{ fontSize: 14, color: "#1b4332", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{day.aiSummary}</div>
            </div>
          )}
          {removeDay && <button onClick={() => removeDay(day.id)} style={{ marginTop: 14, background: "none", border: "1px solid #e0e0e0", borderRadius: 8, padding: "6px 14px", color: "#999", fontSize: 12, cursor: "pointer" }}>Supprimer ce jour</button>}
        </div>
      )}
    </div>
  );
}

function TripHeader({ tripName, setTripName, tripDates, setTripDates }) {
  return (
    <div style={{ textAlign: "center", padding: "40px 20px 30px", background: "linear-gradient(160deg, #1b4332 0%, #2d6a4f 50%, #40916c 100%)", color: "#fff", borderRadius: "0 0 30px 30px", marginBottom: 24, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: 10, left: 20, opacity: 0.15, fontSize: 80 }}>☘️</div>
      <div style={{ position: "absolute", bottom: -10, right: 20, opacity: 0.10, fontSize: 120 }}>🏰</div>
      <div style={{ fontSize: 14, letterSpacing: 3, textTransform: "uppercase", color: "#b7e4c7", marginBottom: 8 }}>Carnet de Voyage</div>
      <input value={tripName} onChange={(e) => setTripName(e.target.value)} style={{ background: "transparent", border: "none", borderBottom: "2px dashed rgba(255,255,255,0.3)", color: "#fff", fontSize: 32, fontWeight: 800, textAlign: "center", outline: "none", width: "80%", fontFamily: "inherit" }} placeholder="Mon voyage en Irlande" />
      <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 10, alignItems: "center" }}>
        <input type="date" value={tripDates.start} onChange={(e) => setTripDates({ ...tripDates, start: e.target.value })} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "6px 10px", borderRadius: 8, fontSize: 13, fontFamily: "inherit" }} />
        <span>→</span>
        <input type="date" value={tripDates.end} onChange={(e) => setTripDates({ ...tripDates, end: e.target.value })} style={{ background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.3)", color: "#fff", padding: "6px 10px", borderRadius: 8, fontSize: 13, fontFamily: "inherit" }} />
      </div>
    </div>
  );
}

function StatsBar({ days }) {
  const totalPhotos = days.reduce((s, d) => s + d.photos.length, 0);
  const summaries = days.filter((d) => d.aiSummary).length;
  const locations = days.filter((d) => d.location).length;
  const items = [
    { icon: "📅", label: "Jours", value: days.length },
    { icon: "📸", label: "Photos", value: totalPhotos },
    { icon: "📍", label: "Lieux", value: locations },
    { icon: "✨", label: "Résumés", value: summaries },
  ];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
      {items.map((it) => (
        <div key={it.label} style={{ background: "#fff", borderRadius: 12, padding: "12px 20px", boxShadow: "0 2px 8px rgba(45,106,79,0.08)", textAlign: "center", minWidth: 70, border: "1px solid #d8f3dc" }}>
          <div style={{ fontSize: 22 }}>{it.icon}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2d6a4f" }}>{it.value}</div>
          <div style={{ fontSize: 11, color: "#95d5b2" }}>{it.label}</div>
        </div>
      ))}
    </div>
  );
}

function TabBar({ tab, setTab }) {
  const tabs = [
    { id: "journal", label: "📖 Journal" },
    { id: "map", label: "🗺️ Carte" },
    { id: "gallery", label: "🖼️ Galerie" },
    { id: "summary", label: "📝 Résumé" },
  ];
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "10px 18px", borderRadius: 10, border: tab === t.id ? "2px solid #2d6a4f" : "1.5px solid #d8f3dc", background: tab === t.id ? "#2d6a4f" : "#fff", color: tab === t.id ? "#fff" : "#2d6a4f", fontWeight: 600, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}>{t.label}</button>
      ))}
    </div>
  );
}

function Gallery({ days }) {
  const all = days.flatMap((d) => d.photos.map((p) => ({ ...p, day: d.id, location: d.location })));
  if (all.length === 0) return <div style={{ textAlign: "center", padding: 40, color: "#95d5b2" }}>Aucune photo. Ajoutez-en dans le journal !</div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {all.map((p) => (
        <div key={p.id} style={{ borderRadius: 12, overflow: "hidden", position: "relative", aspectRatio: "1", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
          <img src={p.thumb || p.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(transparent, rgba(0,0,0,0.6))", padding: "20px 8px 8px", color: "#fff", fontSize: 11 }}>
            <div style={{ fontWeight: 600 }}>Jour {p.day}</div>
            {p.location && <div>{p.location}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function FullSummary({ days }) {
  const s = days.filter((d) => d.aiSummary);
  if (s.length === 0) return <div style={{ textAlign: "center", padding: 40, color: "#95d5b2" }}>Aucun résumé IA. Générez-en dans le journal !</div>;
  return (
    <div>
      {s.map((d) => (
        <div key={d.id} style={{ marginBottom: 20, background: "#fff", borderRadius: 14, padding: 20, boxShadow: "0 2px 10px rgba(45,106,79,0.08)", border: "1px solid #d8f3dc" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "#2d6a4f" }}>Jour {d.id}</span>
            {d.location && <span style={{ color: "#52b788", fontSize: 14 }}>📍 {d.location}</span>}
            {d.date && <span style={{ color: "#95d5b2", fontSize: 13, marginLeft: "auto" }}>{d.date}</span>}
          </div>
          <div style={{ color: "#1b4332", lineHeight: 1.65, fontSize: 14, whiteSpace: "pre-wrap" }}>{d.aiSummary}</div>
          {d.photos.length > 0 && (
            <div style={{ display: "flex", gap: 6, marginTop: 12, overflowX: "auto" }}>
              {d.photos.slice(0, 4).map((p) => <img key={p.id} src={p.thumb || p.src} alt="" style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 8 }} />)}
              {d.photos.length > 4 && <div style={{ width: 60, height: 60, borderRadius: 8, background: "#d8f3dc", display: "flex", alignItems: "center", justifyContent: "center", color: "#2d6a4f", fontWeight: 700, fontSize: 13 }}>+{d.photos.length - 4}</div>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [tripName, setTripName] = useState("Irlande été 2026 ☘️");
  const [tripDates, setTripDates] = useState({ start: "2026-07-01", end: "2026-07-14" });
  const [days, setDays] = useState([{ id: 1, date: "", location: "", notes: "", photos: [], aiSummary: "" }]);
  const [tab, setTab] = useState("journal");

  const updateDay = useCallback((id, patch) => {
    setDays((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }, []);

  const addDay = () => {
    const nextId = days.length > 0 ? Math.max(...days.map((d) => d.id)) + 1 : 1;
    setDays([...days, { id: nextId, date: "", location: "", notes: "", photos: [], aiSummary: "" }]);
  };

  const removeDay = (id) => {
    if (days.length <= 1) return;
    setDays(days.filter((d) => d.id !== id));
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg, #f0fdf4 0%, #e8f5e9 100%)", fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .leaflet-container { font-family: inherit; }`}</style>
      <TripHeader tripName={tripName} setTripName={setTripName} tripDates={tripDates} setTripDates={setTripDates} />
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 16px 40px" }}>
        <StatsBar days={days} />
        <TabBar tab={tab} setTab={setTab} />

        {tab === "journal" && (
          <>
            {days.map((d) => <DayCard key={d.id} day={d} updateDay={updateDay} removeDay={days.length > 1 ? removeDay : null} />)}
            <button onClick={addDay} style={{ width: "100%", padding: 14, borderRadius: 12, border: "2px dashed #95d5b2", background: "transparent", color: "#2d6a4f", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>+ Ajouter un jour</button>
          </>
        )}
        {tab === "map" && <TripMap days={days} />}
        {tab === "gallery" && <Gallery days={days} />}
        {tab === "summary" && <FullSummary days={days} />}
      </div>
    </div>
  );
}