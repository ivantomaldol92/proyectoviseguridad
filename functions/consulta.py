import base64
import json
import os

import requests
from bs4 import BeautifulSoup


BASE_URL = "https://mi.nosis.com"


def respuesta(status_code, payload):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
        },
        "body": json.dumps(payload, ensure_ascii=False),
    }


def handler(event, context):
    try:
        body = json.loads(event.get("body") or "{}")
    except (TypeError, ValueError):
        return respuesta(400, {"ok": False, "error": "El cuerpo no es JSON válido."})

    documento = str(body.get("documento") or body.get("query") or "").strip()
    documento = documento.replace(" ", "").replace("-", "")

    if not documento:
        return respuesta(400, {"ok": False, "error": "Ingresá un DNI o CUIT."})

    session_id = os.environ.get("ASP_NET_SESSION_ID")
    nstk = os.environ.get("NSTK")

    if not session_id or not nstk:
        return respuesta(500, {
            "ok": False,
            "error": "Faltan las variables de entorno de la sesión.",
        })

    session = requests.Session()
    session.cookies.set(
        "ASP.NET_SessionId",
        session_id,
        domain="mi.nosis.com",
        path="/",
    )
    session.cookies.set("nstk", nstk, domain=".nosis.com", path="/")

    headers_busqueda = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": BASE_URL,
        "Referer": f"{BASE_URL}/InformeTerceros",
    }

    try:
        response = session.post(
            f"{BASE_URL}/InformeTerceros/RealizarBusqueda",
            headers=headers_busqueda,
            json={"query": documento},
            timeout=30,
        )
        response.raise_for_status()
        resultado = response.json()
    except (requests.RequestException, ValueError) as error:
        return respuesta(502, {
            "ok": False,
            "error": f"No se pudo consultar Nosis: {error}",
        })

    if resultado.get("Error"):
        return respuesta(502, {"ok": False, "error": str(resultado["Error"])})

    if not resultado.get("BusquedaRealizada"):
        return respuesta(404, {"ok": False, "error": "La búsqueda no fue realizada."})

    html = resultado.get("HtmlTabla", "")
    if not html:
        return respuesta(404, {"ok": False, "error": "Nosis no devolvió resultados."})

    soup = BeautifulSoup(html, "html.parser")
    resultados = []

    for bloque in soup.select(".content-datos-resultados"):
        elemento_nombre = bloque.select_one(".resultados-razon-social span")
        elemento_documento = bloque.select_one("#Documento")
        nombre = (
            elemento_nombre.get_text(" ", strip=True)
            if elemento_nombre
            else "-"
        )
        documento_resultado = (
            elemento_documento.get("value", "").strip()
            if elemento_documento
            else ""
        )
        direcciones = []

        for elemento_direccion in bloque.select(
            ".resultados-lugar .content-direccion .direccion"
        ):
            texto = " ".join(elemento_direccion.get_text(" ", strip=True).split())
            if texto:
                direcciones.append(texto)

        provincia = "-"
        localidad = "-"
        if direcciones:
            partes = [
                parte.strip()
                for parte in direcciones[0].split("-")
                if parte.strip()
            ]
            if partes:
                provincia = partes[0]
            if len(partes) >= 2:
                localidad = partes[1]

        resultados.append({
            "nombre": nombre,
            "documento": documento_resultado,
            "provincia": provincia,
            "localidad": localidad,
            "direcciones": direcciones,
        })

    if not resultados:
        return respuesta(404, {"ok": False, "error": "No se encontraron resultados."})

    seleccionado = resultados[0]
    documento_seleccionado = seleccionado["documento"]
    if not documento_seleccionado:
        return respuesta(502, {
            "ok": False,
            "error": "No se encontró el documento interno del resultado.",
        })

    fecha_nacimiento = "-"
    try:
        response_fecha = requests.get(
            "https://clientes.credicuotas.com.ar/"
            f"v1/onboarding/resolvecustomers/{documento_seleccionado}",
            timeout=30,
        )
        response_fecha.raise_for_status()
        datos_fecha = response_fecha.json()
        if isinstance(datos_fecha, list) and datos_fecha:
            fecha_nacimiento = datos_fecha[0].get("fechanacimiento", "-")
    except (requests.RequestException, ValueError):
        pass

    headers_informe = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        "Origin": BASE_URL,
        "Referer": f"{BASE_URL}/InformeTerceros",
    }

    try:
        response_informe = session.post(
            f"{BASE_URL}/Informes/DescargarInforme",
            headers=headers_informe,
            data={"documento": documento_seleccionado},
            timeout=60,
        )
        response_informe.raise_for_status()
        pdf = (
            "data:application/pdf;base64,"
            + base64.b64encode(response_informe.content).decode("ascii")
        )
    except requests.RequestException:
        pdf = None

    return respuesta(200, {
        "ok": True,
        "nombre": seleccionado["nombre"],
        "documento": documento_seleccionado,
        "cuit": documento_seleccionado,
        "fechaNacimiento": fecha_nacimiento,
        "provincia": seleccionado["provincia"],
        "localidad": seleccionado["localidad"],
        "direccion": "\n".join(seleccionado["direcciones"]) or "-",
        "pdf": pdf,
        "pdfNombre": f"informe-{documento_seleccionado}.pdf",
    })