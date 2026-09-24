"use client";
import { useState, useEffect, useMemo, useCallback } from "react";

// ── Config ─────────────────────────────────────────────────────────────
const REPO = "fixmylifedesigns/valencia-home";
const DATA_URL = `https://raw.githubusercontent.com/${REPO}/main/data/listings.json`;
const EDIT_URL = `https://github.com/${REPO}/edit/main/data/listings.json`;
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const POLL_MS = 5 * 60 * 1000;
const PLACES_TTL = 60 * 60 * 1000;

const AREAS = {
  "Sant Francesc": { safety: 3, note: "The very centre around Plaça de l'Ajuntament. Walkable to everything, but busy and touristy; pickpocketing is the main thing to watch." },
  "El Mercat": { safety: 3, note: "Historic streets by the Central Market. Charming and lively; some streets get loud at night." },
  "Russafa": { safety: 4, note: "Trendy area full of cafés and terraces, lots of dogs around. Generally safe; weekend nights can be noisy." },
  "Gran Vía": { safety: 5, note: "Elegant, quiet and one of the calmest central areas. Right by the Turia gardens, ideal for dog walks." },
  "Arrancapins": { safety: 4, note: "Local, residential and good value, just west of the centre near Estació del Nord. Quieter streets." },
};
const areaInfo = (a) => AREAS[a] || { safety: 3, note: "" };

const CATS = [
  { key: "japanese", label: "Japanese", emoji: "🍣" },
  { key: "dominican", label: "Dominican & Caribbean", emoji: "🇩🇴" },
  { key: "supermarket", label: "Supermarkets", emoji: "🛒" },
];

// ── Small helpers ──────────────────────────────────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function metres(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const mapsUrl = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
const addressOf = (f) => `${f.street || f.area}, ${f.area}, València`;
// Direct link when we have it; otherwise a search that lands on the matching idealista listing.
const listingUrl = (f) =>
  f.url ||
  "https://www.google.com/search?q=" +
    encodeURIComponent(`site:idealista.com alquiler ${f.street ? `"${f.street.split(",")[0]}"` : f.area} València ${f.price}`);

function tileFor(lat, lng, z = 16) {
  const n = 2 ** z;
  const xf = ((lng + 180) / 360) * n;
  const r = (lat * Math.PI) / 180;
  const yf = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
  const x = Math.floor(xf), y = Math.floor(yf);
  return { url: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, fx: xf - x, fy: yf - y };
}

// Nominatim allows ~1 request/second, so geocoding runs through a queue.
let geoQueue = Promise.resolve();
function geocode(f) {
  const key = "geo:" + addressOf(f);
  const hit = store.get(key, null);
  if (hit) return Promise.resolve(hit);
  geoQueue = geoQueue.then(async () => {
    const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(addressOf(f) + ", Spain");
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const [r] = await res.json();
    await sleep(1100);
    if (!r) return null;
    const pt = { lat: +r.lat, lng: +r.lon };
    store.set(key, pt);
    return pt;
  }).catch(() => null);
  return geoQueue;
}

async function fetchNearby(pt) {
  const key = `places:${pt.lat.toFixed(4)},${pt.lng.toFixed(4)}`;
  const hit = store.get(key, null);
  if (hit && Date.now() - hit.at < PLACES_TTL) return hit;
  const A = (r) => `(around:${r},${pt.lat},${pt.lng})`;
  const q = `[out:json][timeout:25];(
    nwr${A(1200)}["cuisine"~"japanese|sushi|ramen|izakaya",i];
    nwr${A(1500)}["shop"]["name"~"jap[oó]n|japan|asia|oriental",i];
    nwr${A(2500)}["cuisine"~"dominican|caribbean|latin",i];
    nwr${A(2500)}["name"~"dominic|quisqueya|colmado|latin",i];
    nwr${A(700)}["shop"="supermarket"];
  );out center tags;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q) });
  if (!res.ok) throw new Error("Places service is busy. Try again in a minute.");
  const json = await res.json();
  const out = { at: Date.now(), japanese: [], dominican: [], supermarket: [] };
  const seen = new Set();
  for (const el of json.elements) {
    const t = el.tags || {};
    const name = t.name;
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
    if (!name || lat == null || seen.has(name + lat)) continue;
    seen.add(name + lat);
    const cuisine = (t.cuisine || "").toLowerCase();
    const item = { name, lat, lng, d: Math.round(metres(pt, { lat, lng })), kind: t.shop ? "shop" : t.amenity || "place" };
    if (/japanese|sushi|ramen|izakaya/.test(cuisine) || (t.shop && /jap[oó]n|japan|asia|oriental/i.test(name))) out.japanese.push(item);
    else if (/dominican|caribbean|latin/.test(cuisine) || /dominic|quisqueya|colmado|latin/i.test(name)) out.dominican.push(item);
    else if (t.shop === "supermarket") out.supermarket.push(item);
  }
  for (const c of CATS) out[c.key].sort((a, b) => a.d - b.d);
  store.set(key, out);
  return out;
}

// ── Component ──────────────────────────────────────────────────────────
export default function ValenciaHome() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [coords, setCoords] = useState({});
  const [area, setArea] = useState("All");
  const [sort, setSort] = useState("price");
  const [onlyLiked, setOnlyLiked] = useState(false);
  const [liked, setLiked] = useState([]);
  const [open, setOpen] = useState({});
  const [places, setPlaces] = useState({});
  const [photo, setPhoto] = useState({});

  useEffect(() => { setLiked(store.get("vlc-liked", [])); }, []);
  useEffect(() => { store.set("vlc-liked", liked); }, [liked]);

  const load = useCallback(async () => {
    for (const url of [DATA_URL + "?t=" + Date.now(), `${BASE}/listings.json`]) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        setData(await res.json());
        setError("");
        return;
      } catch {}
    }
    setError("Couldn't load listings. Check your connection and reload.");
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);

  // Fill in coordinates for listings that don't have them yet.
  useEffect(() => {
    if (!data) return;
    data.listings.forEach((f) => {
      if (f.lat && f.lng) { setCoords((c) => (c[f.id] ? c : { ...c, [f.id]: { lat: f.lat, lng: f.lng } })); return; }
      geocode(f).then((pt) => pt && setCoords((c) => ({ ...c, [f.id]: pt })));
    });
  }, [data]);

  const toggleNearby = async (f) => {
    const isOpen = !open[f.id];
    setOpen((o) => ({ ...o, [f.id]: isOpen }));
    if (!isOpen || places[f.id]?.at) return;
    const pt = coords[f.id] || (await geocode(f));
    if (!pt) { setPlaces((p) => ({ ...p, [f.id]: { error: "Couldn't find this address on the map." } })); return; }
    setPlaces((p) => ({ ...p, [f.id]: { loading: true } }));
    try { const r = await fetchNearby(pt); setPlaces((p) => ({ ...p, [f.id]: r })); }
    catch (e) { setPlaces((p) => ({ ...p, [f.id]: { error: e.message || "Couldn't load nearby places." } })); }
  };

  const listings = data?.listings || [];
  const areas = useMemo(() => [...new Set(listings.map((f) => f.area))], [listings]);
  const cheapestId = useMemo(() => listings.reduce((m, f) => (!m || f.price < m.price ? f : m), null)?.id, [listings]);

  const list = useMemo(() => {
    const key = {
      price: (f) => f.price,
      space: (f) => -f.size,
      value: (f) => f.price / f.size,
      safety: (f) => -areaInfo(f.area).safety,
    }[sort];
    return listings
      .filter((f) => f.status !== "rejected")
      .filter((f) => (area === "All" || f.area === area) && (!onlyLiked || liked.includes(f.id)))
      .sort((a, b) => key(a) - key(b));
  }, [listings, area, sort, onlyLiked, liked]);

  const toggleLike = (id) => setLiked((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const updated = data?.updatedAt ? new Date(data.updatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

  return (
    <div className="vlc">
      <style>{CSS}</style>
      <div className="tiles" aria-hidden="true" />
      <main className="wrap">
        <h1>Our next home in central Valencia</h1>
        <p className="lede">
          Our shared shortlist of dog-friendly rentals. Listings refresh on their own, and each flat can show
          the Japanese spots, Dominican spots and supermarkets within walking distance.
        </p>
        <ul className="brief">
          <li>🐕 Pets allowed</li><li>🛏️ 2–3 bedrooms</li><li>💶 Ideally under €1,000, max €1,400</li><li>📍 Near the centre</li>
        </ul>

        <div className="status" role="status">
          {error ? <span className="err">{error}</span> : data ? <>Listings updated {updated} · {listings.length} flats</> : "Loading listings…"}
          <button className="link" onClick={load}>Refresh now</button>
          <a className="link" href={EDIT_URL} target="_blank" rel="noopener noreferrer">Edit the list</a>
        </div>

        <div className="controls">
          <label htmlFor="area">Area</label>
          <select id="area" value={area} onChange={(e) => setArea(e.target.value)}>
            <option>All</option>
            {areas.map((a) => <option key={a}>{a}</option>)}
          </select>
          <label htmlFor="sort">Sort by</label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="price">Lowest price</option>
            <option value="space">Most space</option>
            <option value="value">Best €/m²</option>
            <option value="safety">Calmest area</option>
          </select>
          <div className="seg" role="group" aria-label="Show">
            <button aria-pressed={!onlyLiked} onClick={() => setOnlyLiked(false)}>All</button>
            <button aria-pressed={onlyLiked} onClick={() => setOnlyLiked(true)}>Liked {liked.length}</button>
          </div>
        </div>

        {data && list.length === 0 && (
          <div className="empty">
            {onlyLiked ? "No liked flats yet. Switch to All and tap a heart to shortlist one." : "No flats match. Pick another area."}
          </div>
        )}

        <div className="grid">
          {list.map((f) => {
            const info = areaInfo(f.area);
            const pt = coords[f.id];
            const imgs = f.images || [];
            const idx = photo[f.id] || 0;
            const tile = !imgs.length && pt ? tileFor(pt.lat, pt.lng) : null;
            const isLiked = liked.includes(f.id);
            const p = places[f.id];
            const tileP = tile ? Math.min(1, Math.max(0, (tile.fy - 0.375) / 0.25)) : 0;
            return (
              <article key={f.id} className={"flat" + (f.id === cheapestId ? " best" : "")}>
                <div className="media">
                  {imgs.length ? (
                    <>
                      <img src={imgs[idx]} alt={`Photo ${idx + 1} of the flat in ${f.area}`} loading="lazy" />
                      {imgs.length > 1 && (
                        <div className="pager">
                          <button aria-label="Previous photo" onClick={() => setPhoto((s) => ({ ...s, [f.id]: (idx - 1 + imgs.length) % imgs.length }))}>‹</button>
                          <span>{idx + 1}/{imgs.length}</span>
                          <button aria-label="Next photo" onClick={() => setPhoto((s) => ({ ...s, [f.id]: (idx + 1) % imgs.length }))}>›</button>
                        </div>
                      )}
                    </>
                  ) : tile ? (
                    <div className="tile" style={{ backgroundImage: `url(${tile.url})`, backgroundPosition: `0 ${tileP * 100}%` }}>
                      <span className="pin" style={{ left: `${tile.fx * 100}%`, top: `${((tile.fy - tileP * 0.25) / 0.75) * 100}%` }}>📍</span>
                      <span className="nophoto">No photos yet</span>
                    </div>
                  ) : (
                    <div className="tile blank"><span className="nophoto">Finding on the map…</span></div>
                  )}
                </div>

                {f.id === cheapestId && <span className="flag">Cheapest right now</span>}
                <div className="price">€{f.price.toLocaleString("en-GB")} <small>/month</small></div>
                <div className="where">{f.area}{f.district ? `, ${f.district}` : ""}</div>
                <div className="street">{f.street || "Street not listed"}</div>
                <div className="facts">
                  <span>{f.bedrooms} bed</span><span>{f.bathrooms} bath</span><span>{f.size} m²</span>
                  <span>€{(f.price / f.size).toFixed(1)}/m²</span>
                </div>
                {info.note && <p className="note">{info.note}</p>}
                <div className="safe">Calm &amp; safety: {"●".repeat(info.safety)}{"○".repeat(5 - info.safety)}</div>
                {f.notes && <p className="ournote">📝 {f.notes}</p>}

                <button className="nearbtn" aria-expanded={!!open[f.id]} onClick={() => toggleNearby(f)}>
                  {open[f.id] ? "Hide what's nearby" : "Show what's nearby"}
                </button>
                {open[f.id] && (
                  <div className="nearby">
                    {!p || p.loading ? <p className="muted">Looking around the block…</p>
                      : p.error ? <p className="err">{p.error}</p>
                      : CATS.map((c) => (
                        <div key={c.key} className="cat">
                          <div className="cathead">{c.emoji} {c.label} <span className="muted">({p[c.key].length})</span></div>
                          {p[c.key].length === 0 ? <div className="muted small">None within walking distance</div> : (
                            <ul>
                              {p[c.key].slice(0, 4).map((s) => (
                                <li key={s.name + s.lat}>
                                  <a href={mapsUrl(`${s.name}, València`)} target="_blank" rel="noopener noreferrer">{s.name}</a>
                                  <span className="muted"> {Math.max(1, Math.round(s.d / 80))} min walk</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                  </div>
                )}

                <div className="row">
                  <span className="links">
                    <a href={listingUrl(f)} target="_blank" rel="noopener noreferrer">{f.url ? "View listing" : "Find listing"}</a>
                    <a href={mapsUrl(addressOf(f))} target="_blank" rel="noopener noreferrer">Open in Maps</a>
                  </span>
                  <button className="heart" aria-pressed={isLiked} onClick={() => toggleLike(f.id)}>
                    {isLiked ? "♥ Liked" : "♡ Like"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <p className="foot">
          Listings come from idealista. "Pets allowed" comes from the listing filters, so confirm size or breed
          limits with the landlord. Nearby places come live from OpenStreetMap and may miss newer spots. Safety
          dots are a general neighbourhood impression, not official data. Map tiles © OpenStreetMap contributors.
        </p>
      </main>
    </div>
  );
}

const CSS = `
.vlc{--paper:#FAFAF6;--ink:#1A2330;--muted:#5B6573;--line:#DCDFE3;--tile:#2456A4;--tile-soft:#E6EDF8;--citrus:#F2A541;--turia:#4F7A4A;--card:#FFFFFF;--err:#B3261E;
  min-height:100vh;background:var(--paper);color:var(--ink);font-family:"Bricolage Grotesque",system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;
  padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){.vlc{--paper:#12161D;--ink:#EEF1F5;--muted:#A3ADBA;--line:#2A313C;--tile:#7FA6E8;--tile-soft:#1B2536;--citrus:#F5B55E;--turia:#8FBE88;--card:#181E27;--err:#F2B8B5}}
.vlc *,.vlc *::before,.vlc *::after{box-sizing:border-box}
.vlc .tiles{height:44px;background-color:var(--paper);background-image:radial-gradient(circle at 50% 50%,var(--tile) 0 5px,transparent 6px),conic-gradient(from 45deg at 50% 50%,var(--tile-soft) 0 25%,transparent 0 50%,var(--tile-soft) 0 75%,transparent 0),radial-gradient(circle at 0 0,var(--tile) 0 9px,transparent 10px),radial-gradient(circle at 100% 0,var(--tile) 0 9px,transparent 10px),radial-gradient(circle at 0 100%,var(--tile) 0 9px,transparent 10px),radial-gradient(circle at 100% 100%,var(--tile) 0 9px,transparent 10px);background-size:44px 44px;border-bottom:3px solid var(--tile)}
.vlc .wrap{max-width:1080px;margin:0 auto;padding:28px 20px 60px}
.vlc h1{font-size:clamp(2rem,6vw,3.4rem);line-height:1.05;font-weight:800;letter-spacing:-.02em;margin:8px 0 12px;max-width:16ch}
.vlc .lede{color:var(--muted);max-width:62ch;margin:0 0 20px;font-size:1.05rem}
.vlc .brief{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 18px;padding:0;list-style:none}
.vlc .brief li{border:1.5px solid var(--line);border-radius:999px;padding:4px 12px;font-size:.9rem}
.vlc .status{display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:.9rem;color:var(--muted);margin-bottom:18px}
.vlc .link{background:none;border:0;padding:0;color:var(--tile);font-weight:600;cursor:pointer;text-decoration:none;font:inherit;font-weight:600}
.vlc .controls{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:22px}
.vlc .controls label{font-size:.9rem;color:var(--muted)}
.vlc select,.vlc button{font:inherit;color:var(--ink)}
.vlc select{background:var(--card);border:1.5px solid var(--line);border-radius:10px;padding:7px 10px}
.vlc .seg{display:inline-flex;border:1.5px solid var(--line);border-radius:10px;overflow:hidden}
.vlc .seg button{background:var(--card);border:0;padding:7px 12px;cursor:pointer}
.vlc .seg button[aria-pressed="true"]{background:var(--tile);color:var(--paper)}
.vlc button:focus-visible,.vlc select:focus-visible,.vlc a:focus-visible{outline:3px solid var(--citrus);outline-offset:2px}
.vlc .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.vlc .flat{background:var(--card);border:1.5px solid var(--line);border-radius:6px;padding:0 18px 16px;display:flex;flex-direction:column;gap:10px;overflow:hidden}
.vlc .flat.best{border-color:var(--citrus);border-width:2.5px}
.vlc .media{margin:0 -18px 4px;aspect-ratio:4/3;position:relative;background:var(--tile-soft)}
.vlc .media img{width:100%;height:100%;object-fit:cover;display:block}
.vlc .tile{position:absolute;inset:0;background-size:100% auto;background-repeat:no-repeat;filter:saturate(.8)}
.vlc .tile.blank{display:grid;place-items:center}
.vlc .pin{position:absolute;transform:translate(-50%,-90%);font-size:1.8rem;line-height:1}
.vlc .nophoto{position:absolute;left:10px;bottom:10px;background:var(--card);color:var(--muted);font-size:.8rem;padding:2px 8px;border-radius:4px}
.vlc .tile.blank .nophoto{position:static}
.vlc .pager{position:absolute;right:10px;bottom:10px;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.55);color:#fff;border-radius:999px;padding:2px 6px;font-size:.85rem}
.vlc .pager button{background:none;border:0;color:#fff;font-size:1.3rem;line-height:1;cursor:pointer;padding:2px 6px}
.vlc .flag{align-self:flex-start;background:var(--citrus);color:#1A2330;font-weight:600;font-size:.8rem;border-radius:4px;padding:2px 8px}
.vlc .price{font-size:2.2rem;font-weight:800;line-height:1;letter-spacing:-.02em}
.vlc .price small{font-size:.95rem;font-weight:400;color:var(--muted)}
.vlc .where{font-weight:600;font-size:1.05rem}
.vlc .street{color:var(--muted);font-size:.92rem;margin-top:-6px}
.vlc .facts{display:flex;gap:14px;flex-wrap:wrap;font-size:.95rem;border-top:1px dashed var(--line);border-bottom:1px dashed var(--line);padding:8px 0}
.vlc .note,.vlc .ournote{font-size:.92rem;color:var(--muted);margin:0}
.vlc .ournote{color:var(--ink)}
.vlc .safe{font-size:.85rem;color:var(--turia);font-weight:600}
.vlc .nearbtn{align-self:flex-start;background:var(--tile-soft);border:0;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:600;color:var(--tile)}
.vlc .nearby{border-left:3px solid var(--tile);padding-left:12px;display:flex;flex-direction:column;gap:10px}
.vlc .cathead{font-weight:600;font-size:.95rem}
.vlc .nearby ul{margin:4px 0 0;padding-left:18px;font-size:.9rem}
.vlc .nearby a{color:var(--ink)}
.vlc .muted{color:var(--muted);font-weight:400}
.vlc .small{font-size:.85rem}
.vlc .err{color:var(--err)}
.vlc .row{display:flex;justify-content:space-between;align-items:center;margin-top:auto;gap:8px;padding-top:4px}
.vlc .links{display:flex;gap:14px;flex-wrap:wrap}
.vlc .row a{color:var(--tile);font-weight:600;text-decoration:none}
.vlc .row a:hover{text-decoration:underline}
.vlc .heart{background:none;border:1.5px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer}
.vlc .heart[aria-pressed="true"]{border-color:var(--citrus);background:var(--citrus);color:#1A2330}
.vlc .foot{margin-top:36px;color:var(--muted);font-size:.88rem;max-width:70ch}
.vlc .empty{padding:30px;border:1.5px dashed var(--line);border-radius:6px;color:var(--muted);margin-bottom:18px}
`;
