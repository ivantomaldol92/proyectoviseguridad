import { createHmac, timingSafeEqual } from "node:crypto";
import { cambiarBloqueo, ipBloqueada, listarEventos, registrarEvento } from "./security.mjs";
import { sesionValida } from "./login.mjs";

const ADMIN_COOKIE = "radar_admin";
const ADMIN_SECONDS = 60 * 60;

function response(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function firma(expira, secreto) {
  return createHmac("sha256", secreto).update(`admin:${expira}`).digest("hex");
}

function adminValido(request) {
  const secreto = process.env.AUTH_SECRET;
  const cookie = (request.headers.get("cookie") || "").split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${ADMIN_COOKIE}=`))
    ?.slice(ADMIN_COOKIE.length + 1);
  if (!secreto || !cookie) return false;
  const [expira, valor] = cookie.split(".");
  if (!/^\d+$/.test(expira) || !/^[a-f0-9]{64}$/.test(valor)) return false;
  const expected = Buffer.from(firma(expira, secreto));
  const received = Buffer.from(valor);
  return Number(expira) > Date.now()
    && expected.length === received.length
    && timingSafeEqual(expected, received);
}

export default async function handler(request) {
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return response(400, { ok: false, error: "Solicitud inválida." }); }
    if (body.action === "login") {
      if (body.password !== process.env.ADMIN_PASSWORD) {
        await registrarEvento(request, { type: "admin_login_failed", outcome: "denied" });
        return response(401, { ok: false, error: "Acceso administrativo rechazado." });
      }
      const expira = String(Date.now() + ADMIN_SECONDS * 1000);
      await registrarEvento(request, { type: "admin_login", outcome: "success" });
      return response(200, { ok: true }, {
        "Set-Cookie": `${ADMIN_COOKIE}=${expira}.${firma(expira, process.env.AUTH_SECRET)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${ADMIN_SECONDS}`,
      });
    }
    if (!adminValido(request)) return response(401, { ok: false, error: "Panel administrativo bloqueado." });
    if (body.action === "block" || body.action === "unblock") {
      const ip = String(body.ip || "").trim();
      if (!ip || ip.length > 80) return response(400, { ok: false, error: "IP inválida." });
      await cambiarBloqueo(ip, body.action === "block");
      await registrarEvento(request, { type: body.action === "block" ? "ip_blocked" : "ip_unblocked", outcome: "success", targetIp: ip });
      return response(200, { ok: true });
    }
  }

  if (!adminValido(request)) return response(401, { ok: false, error: "Panel administrativo bloqueado." });
  const events = await listarEventos(100);
  return response(200, { ok: true, events });
}
