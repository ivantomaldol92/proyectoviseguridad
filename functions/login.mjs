import { createHmac, timingSafeEqual } from "node:crypto";
import { ipBloqueada, registrarEvento } from "./security.mjs";

const COOKIE_NAME = "radar_session";
const SESSION_SECONDS = 8 * 60 * 60;

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function firmaSesion(expira, secreto) {
  return createHmac("sha256", secreto)
    .update(`radar:${expira}`)
    .digest("hex");
}

function cookieSesion(expira, secreto) {
  return `${expira}.${firmaSesion(expira, secreto)}`;
}

function compararSecretos(real, recibido) {
  const realBytes = Buffer.from(real, "utf8");
  const recibidoBytes = Buffer.from(recibido, "utf8");
  return realBytes.length === recibidoBytes.length && timingSafeEqual(realBytes, recibidoBytes);
}

export function sesionValida(request) {
  const secreto = process.env.AUTH_SECRET;
  const cookies = request.headers.get("cookie") || "";
  const valor = cookies
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!secreto || !valor) {
    return false;
  }

  const [expira, firma] = valor.split(".");
  if (!/^\d+$/.test(expira) || !/^[a-f0-9]{64}$/.test(firma)) {
    return false;
  }

  const expiraNumero = Number(expira);
  if (!Number.isSafeInteger(expiraNumero) || expiraNumero < Date.now()) {
    return false;
  }

  return compararSecretos(firmaSesion(expira, secreto), firma);
}

export default async function handler(request) {
  const ip = request.headers.get("x-nf-client-connection-ip") || "unknown";
  if (await ipBloqueada(ip)) {
    await registrarEvento(request, { type: "blocked_request", outcome: "denied" });
    return jsonResponse(403, { ok: false, error: "Acceso bloqueado." });
  }

  if (request.method === "GET") {
    return jsonResponse(200, { ok: sesionValida(request) });
  }

  if (request.method === "DELETE") {
    return jsonResponse(200, { ok: true }, {
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Método no permitido." });
  }

  const passwordCorrecta = process.env.APP_PASSWORD;
  const secreto = process.env.AUTH_SECRET;
  if (!passwordCorrecta || !secreto) {
    return jsonResponse(500, { ok: false, error: "El acceso no está configurado." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Solicitud inválida." });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!compararSecretos(passwordCorrecta, password)) {
    await registrarEvento(request, { type: "login_failed", outcome: "denied" });
    return jsonResponse(401, { ok: false, error: "Contraseña incorrecta." });
  }

  const expira = String(Date.now() + SESSION_SECONDS * 1000);
  await registrarEvento(request, { type: "login", outcome: "success" });
  return jsonResponse(200, { ok: true }, {
    "Set-Cookie": `${COOKIE_NAME}=${cookieSesion(expira, secreto)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
  });
}
