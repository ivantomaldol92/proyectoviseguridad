import { getStore } from "@netlify/blobs";

const store = getStore({ name: "radar-security", consistency: "strong" });
const LOG_PREFIX = "event:";
const BLOCK_PREFIX = "blocked:";

function header(request, name) {
  return request.headers.get(name) || request.headers.get(name.toLowerCase()) || "";
}

function geoData(request) {
  const raw = header(request, "x-nf-geo");
  if (!raw) return {};

  try {
    const geo = JSON.parse(raw);
    return {
      city: String(geo.city || "").slice(0, 100),
      region: String(geo.subdivision || geo.region || "").slice(0, 100),
      country: String(geo.country || geo.country_code || "").slice(0, 100),
      postalCode: String(geo.postalCode || geo.postal_code || "").slice(0, 30),
      timezone: String(geo.timezone || "").slice(0, 80),
      latitude: typeof geo.latitude === "number" ? geo.latitude : null,
      longitude: typeof geo.longitude === "number" ? geo.longitude : null,
    };
  } catch {
    return {};
  }
}

export function clientIp(request) {
  return (
    header(request, "x-nf-client-connection-ip")
    || header(request, "x-real-ip")
    || header(request, "x-forwarded-for").split(",")[0].trim()
    || "unknown"
  ).slice(0, 80);
}

export function clientDetails(request) {
  const userAgent = header(request, "user-agent").slice(0, 300) || "unknown";
  const lowerAgent = userAgent.toLowerCase();
  const device = /mobile|android|iphone|ipad/.test(lowerAgent)
    ? "móvil"
    : "escritorio";
  const browser = /edg\//.test(lowerAgent)
    ? "Edge"
    : /chrome\//.test(lowerAgent)
      ? "Chrome"
      : /firefox\//.test(lowerAgent)
        ? "Firefox"
        : /safari\//.test(lowerAgent)
          ? "Safari"
          : "otro";

  return { ip: clientIp(request), userAgent, browser, device, geo: geoData(request) };
}

export function ocultarConsulta(value) {
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) {
    return text.length > 4 ? `${"*".repeat(text.length - 4)}${text.slice(-4)}` : "****";
  }
  return text.slice(0, 2) ? `${text.slice(0, 2)}***` : "***";
}

export async function ipBloqueada(ip) {
  return Boolean(await store.get(`${BLOCK_PREFIX}${ip}`));
}

export async function registrarEvento(request, event) {
  const details = clientDetails(request);
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  await store.setJSON(`${LOG_PREFIX}${id}`, {
    id,
    timestamp: new Date().toISOString(),
    ...details,
    ...event,
  });
}

export async function listarEventos(limit = 100) {
  const listed = [];
  for await (const entry of store.list({ prefix: LOG_PREFIX })) {
    listed.push(entry.key);
  }

  const events = [];
  for (const key of listed.slice(-limit).reverse()) {
    const event = await store.get(key, { type: "json" });
    if (event) events.push(event);
  }
  return events;
}

export async function cambiarBloqueo(ip, blocked) {
  if (blocked) {
    await store.set(`${BLOCK_PREFIX}${ip}`, "blocked");
  } else {
    await store.delete(`${BLOCK_PREFIX}${ip}`);
  }
}
