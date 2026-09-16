import * as cheerio from "cheerio";
import { sesionValida } from "./login.mjs";
import { ipBloqueada, limiteConsulta, ocultarConsulta, pausarConsultas, registrarEvento } from "./security.mjs";

const BASE_URL = "https://mi.nosis.com";

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function getCookieHeader(sessionId, nstk) {
  return `ASP.NET_SessionId=${sessionId}; nstk=${nstk}`;
}

export default async function handler(request) {
  const ip = request.headers.get("x-nf-client-connection-ip") || "unknown";
  if (await ipBloqueada(ip)) {
    await registrarEvento(request, { type: "blocked_request", outcome: "denied" });
    return jsonResponse(403, { ok: false, error: "Acceso bloqueado." });
  }

  if (!sesionValida(request)) {
    await registrarEvento(request, { type: "unauthorized_query", outcome: "denied" });
    return jsonResponse(401, {
      ok: false,
      error: "Iniciá sesión para usar esta herramienta.",
    });
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Método no permitido." });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "El cuerpo no es JSON válido." });
  }

  const entrada = String(body.documento || body.query || "").trim();
  const esNumerico = /^[\d\s-]+$/.test(entrada);
  const documento = esNumerico
    ? entrada.replace(/[\s-]/g, "")
    : entrada.replace(/\s+/g, " ");

  if (!documento) {
    await registrarEvento(request, { type: "invalid_query", outcome: "denied" });
    return jsonResponse(400, { ok: false, error: "Ingresá un DNI o CUIT." });
  }

  const sessionId = process.env.ASP_NET_SESSION_ID;
  const nstk = process.env.NSTK;

  if (!sessionId || !nstk) {
    return jsonResponse(500, {
      ok: false,
      error: "Faltan las variables de entorno de la sesión.",
    });
  }

  const limite = await limiteConsulta(ip);
  if (!limite.allowed) {
    await registrarEvento(request, { type: "query_limited", outcome: "denied", reason: limite.reason });
    return jsonResponse(429, {
      ok: false,
      error: limite.reason === "provider_pause"
        ? "Las consultas están pausadas temporalmente porque el proveedor aplicó un límite."
        : limite.reason === "daily_limit"
          ? "Se alcanzó el límite diario de consultas."
          : limite.reason === "storage_unavailable"
            ? "El control de seguridad no está disponible. Intentá más tarde."
          : "Esperá unos segundos antes de volver a consultar.",
      retryAt: limite.retryAt,
    });
  }

  await registrarEvento(request, {
    type: "query",
    outcome: "started",
    query: ocultarConsulta(documento),
    queryKind: esNumerico ? "documento" : "nombre",
  });

  const cookie = getCookieHeader(sessionId, nstk);
  const headersBusqueda = {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/json; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/InformeTerceros`,
    Cookie: cookie,
  };

  let resultado;
  try {
    const response = await fetch(`${BASE_URL}/InformeTerceros/RealizarBusqueda`, {
      method: "POST",
      headers: headersBusqueda,
      body: JSON.stringify({ query: documento }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        await pausarConsultas(ip);
        await registrarEvento(request, { type: "provider_limited", outcome: "paused", status: response.status });
      }
      throw new Error(`HTTP ${response.status}`);
    }

    resultado = await response.json();
  } catch (error) {
    return jsonResponse(502, {
      ok: false,
      error: `No se pudo consultar Nosis: ${error.message}`,
    });
  }

  if (resultado.Error) {
    return jsonResponse(502, { ok: false, error: String(resultado.Error) });
  }

  if (!resultado.BusquedaRealizada) {
    return jsonResponse(404, {
      ok: false,
      error: "La búsqueda no fue realizada.",
    });
  }

  if (!resultado.HtmlTabla) {
    return jsonResponse(404, {
      ok: false,
      error: "Nosis no devolvió resultados.",
    });
  }

  const $ = cheerio.load(resultado.HtmlTabla);
  const resultados = $(".content-datos-resultados")
    .map((_, bloque) => {
      const bloque$ = $(bloque);
      const nombre =
        bloque$.find(".resultados-razon-social span").first().text().trim() || "-";
      const documentoResultado =
        bloque$.find("#Documento").first().attr("value")?.trim() || "";
      const direcciones = bloque$
        .find(".resultados-lugar .content-direccion .direccion")
        .map((__, elemento) => $(elemento).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);

      let provincia = "-";
      let localidad = "-";
      if (direcciones.length > 0) {
        const partes = direcciones[0]
          .split("-")
          .map((parte) => parte.trim())
          .filter(Boolean);
        provincia = partes[0] || "-";
        localidad = partes[1] || "-";
      }

      return {
        nombre,
        documento: documentoResultado,
        provincia,
        localidad,
        direcciones,
      };
    })
    .get();

  if (resultados.length === 0) {
    return jsonResponse(404, {
      ok: false,
      error: "No se encontraron resultados.",
    });
  }

  const seleccionado = resultados[0];
  if (!seleccionado.documento) {
    return jsonResponse(502, {
      ok: false,
      error: "No se encontró el documento interno del resultado.",
    });
  }

  let fechaNacimiento = "-";
  try {
    const responseFecha = await fetch(
      `https://clientes.credicuotas.com.ar/v1/onboarding/resolvecustomers/${encodeURIComponent(seleccionado.documento)}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      },
    );
    if (responseFecha.ok) {
      const datosFecha = await responseFecha.json();
      const registro = Array.isArray(datosFecha)
        ? (datosFecha[0] || {})
        : (datosFecha || {});
      fechaNacimiento = registro.fechanacimiento
        || registro.fechaNacimiento
        || registro.fecha_nacimiento
        || registro.fechaNac
        || registro.birthDate
        || "-";
      if (fechaNacimiento === "-" && registro.customer) {
        fechaNacimiento = registro.customer.fechanacimiento
          || registro.customer.fechaNacimiento
          || "-";
      }
    }
  } catch {
    // La fecha es opcional; la consulta principal puede continuar.
  }

  return jsonResponse(200, {
    ok: true,
    resultados: resultados.map((persona) => ({
      nombre: persona.nombre,
      documento: persona.documento,
      cuit: persona.documento,
      provincia: persona.provincia,
      localidad: persona.localidad,
      direccion: persona.direcciones.join("\n") || "-",
      fechaNacimiento: persona === seleccionado ? fechaNacimiento : "-",
    })),
    nombre: seleccionado.nombre,
    documento: seleccionado.documento,
    cuit: seleccionado.documento,
    fechaNacimiento,
    provincia: seleccionado.provincia,
    localidad: seleccionado.localidad,
    direccion: seleccionado.direcciones.join("\n") || "-",
  });
}
