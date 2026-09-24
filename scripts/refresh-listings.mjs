// Pulls fresh listings from the official idealista API and merges them into data/listings.json.
// Needs IDEALISTA_API_KEY and IDEALISTA_API_SECRET (request access at developers.idealista.com).
// Manual listings and your own fields (status, notes, images you added) are kept.
import fs from "node:fs";

const KEY = process.env.IDEALISTA_API_KEY;
const SECRET = process.env.IDEALISTA_API_SECRET;
const FILE = new URL("../data/listings.json", import.meta.url);

const SEARCH = {
  country: "es",
  operation: "rent",
  propertyType: "homes",
  center: "39.4699,-0.3763", // Plaça de l'Ajuntament
  distance: "2500",          // metres from the centre
  maxPrice: "1400",
  bedrooms: "2,3",
  maxItems: "50",
  numPage: "1",
  order: "price",
  sort: "asc",
  locale: "en",
};

if (!KEY || !SECRET) {
  console.log("No idealista API credentials set, keeping current listings.");
  process.exit(0);
}

const tokenRes = await fetch("https://api.idealista.com/oauth/token", {
  method: "POST",
  headers: {
    Authorization: "Basic " + Buffer.from(`${KEY}:${SECRET}`).toString("base64"),
    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
  },
  body: "grant_type=client_credentials&scope=read",
});
if (!tokenRes.ok) throw new Error(`idealista auth failed: ${tokenRes.status}`);
const { access_token } = await tokenRes.json();

const res = await fetch("https://api.idealista.com/3.5/es/search", {
  method: "POST",
  headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(SEARCH),
});
if (!res.ok) throw new Error(`idealista search failed: ${res.status}`);
const { elementList = [] } = await res.json();

const current = JSON.parse(fs.readFileSync(FILE, "utf8"));
const previous = new Map(current.listings.map((l) => [l.id, l]));
const PET = /mascota|pets?\b|perro|dog|animales/i;

const fromApi = elementList
  .filter((e) => e.rooms >= 2 && e.rooms <= 3)
  .map((e) => {
    const id = "i" + e.propertyCode;
    const old = previous.get(id) || {};
    const apiImages = [e.thumbnail, ...(e.multimedia?.images || []).map((i) => i.url)].filter(Boolean);
    return {
      id,
      source: "idealista-api",
      area: e.neighborhood || e.district || "València",
      district: e.district || "",
      street: e.address || "",
      price: e.price,
      size: e.size,
      bedrooms: e.rooms,
      bathrooms: e.bathrooms,
      petsAllowed: PET.test(e.description || "") || old.petsAllowed || false,
      url: e.url,
      images: [...new Set([...(old.images || []), ...apiImages])],
      lat: e.latitude,
      lng: e.longitude,
      status: old.status || "new",
      notes: old.notes || "",
    };
  });

const manual = current.listings.filter((l) => l.source !== "idealista-api");
const next = { updatedAt: new Date().toISOString(), source: "idealista-api + manual", listings: [...manual, ...fromApi] };
fs.writeFileSync(FILE, JSON.stringify(next, null, 2) + "\n");
console.log(`Saved ${manual.length} manual + ${fromApi.length} idealista listings.`);
