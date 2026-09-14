import * as cheerio from "cheerio";

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

function pdfDataUri(bytes) {
  if (bytes.length >= 4 && Buffer.from(bytes.subarray(0, 4)).toString() === "%PDF") {
    return `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}`;
  }

  return null;
}

function findPdfString(value) {
  if (typeof value === "string") {
    const encoded = value.startsWith("data:application/pdf;base64,")
      ? value.split(",", 2)[1]
      : value;
    try {
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.subarray(0, 4).toString() === "%PDF") {
        return `data:application/pdf;base64,${bytes.toString("base64")}`;
      }
    } catch {
      return null;
    }
  }

  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      const pdf = findPdfString(child);
      if (pdf) {
        return pdf;
      }
    }
  }

  return null;
}

export default async function handler(request) {
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
    return jsonResponse(400, { ok: false, error: "Ingresá un DNI o CUIT." });
  }

  const sessionId = Netlify.env.get("ASP_NET_SESSION_ID");
  const nstk = Netlify.env.get("NSTK");

  if (!sessionId || !nstk) {
    return jsonResponse(500, {
      ok: false,
      error: "Faltan las variables de entorno de la sesión.",
    });
  }

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
      `https://clientes.credicuotas.com.ar/v1/onboarding/resolvecustomers/${seleccionado.documento}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (responseFecha.ok) {
      const datosFecha = await responseFecha.json();
      if (Array.isArray(datosFecha) && datosFecha.length > 0) {
        fechaNacimiento = datosFecha[0].fechanacimiento || "-";
      }
    }
  } catch {
    // La fecha es opcional; la consulta principal puede continuar.
  }

  let pdf = null;
  let pdfError = null;
  try {
    const responseInforme = await fetch(
      `${BASE_URL}/Informes/DescargarInforme`,
      {
        method: "POST",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Origin: BASE_URL,
          Referer: `${BASE_URL}/InformeTerceros`,
          Cookie: cookie,
        },
        body: new URLSearchParams({ documento: seleccionado.documento }),
        signal: AbortSignal.timeout(60000),
      },
    );

    if (responseInforme.ok) {
      const bytes = Buffer.from(await responseInforme.arrayBuffer());
      pdf = pdfDataUri(bytes);

      if (!pdf) {
        const mensaje = new TextDecoder().decode(bytes);
        try {
          const resultadoInforme = JSON.parse(mensaje);
          pdf = findPdfString(resultadoInforme);
          if (!pdf && resultadoInforme.Error) {
            pdfError = String(resultadoInforme.Error);
          }
        } catch {
          pdfError = "Nosis no devolvió un PDF válido.";
        }
      }
    }
  } catch {
    pdfError = "No se pudo obtener el informe PDF.";
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
    })),
    nombre: seleccionado.nombre,
    documento: seleccionado.documento,
    cuit: seleccionado.documento,
    fechaNacimiento,
    provincia: seleccionado.provincia,
    localidad: seleccionado.localidad,
    direccion: seleccionado.direcciones.join("\n") || "-",
    pdf,
    pdfError,
    pdfNombre: `informe-${seleccionado.documento}.pdf`,
  });
}
