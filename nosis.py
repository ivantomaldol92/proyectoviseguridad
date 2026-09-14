import re
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://mi.nosis.com"

# ============================================================
# COOKIES DE TU SESIÓN ACTUAL
# ============================================================

ASP_NET_SESSION_ID = "npwapl3spwl3sklo4t0rqhj1"
NSTK = "xP17fPsmDskcMbClmQza3m+RlMpLZGpwk9tmVtlTNrkh5BlD8HmMuXhmqYV782LK5EfI2VCPeZlzrnLl7DgDRPpG07xgtttbikeNdvzuuJ90ivqnNBNhM5RAksByrdJYFa9JC1wj+H6irFbK01nVwURulg8JlMq8/q8rEDwmWWZqBB3ih62Kh4uP4lFdw8z3wWrr6ew5gcRFzawHx4y3ieexunNQW3GVP4fKAzOYbroms+ETMbOKGjobuoIN/Fh7vOnDQZavDi2rGxiaZqg2UhuLosMRq1qPdqe5BxMELWUVxNZOazSuIpAtsGXids6HjxrJvmLAVQMusJ8bVcwLCueK53tycntfSdWG214CqAXkVA+ppQ88Ex11DAwZwpWBvdkeeodosu3xJ35Q64tLTfDEe45Na7iervtsGSmZJWBM1otVZudQYB5mm01YTZ6jfR1ht44SU0GhWKCddhAqHZN5gdX+fk9wZHNC/0oE7udJQPVw3dmrAJwmZa7QTjlV"
# ============================================================
# CREAR SESIÓN
# ============================================================

session = requests.Session()

session.cookies.set(
    "ASP.NET_SessionId",
    ASP_NET_SESSION_ID,
    domain="mi.nosis.com",
    path="/"
)

session.cookies.set(
    "nstk",
    NSTK,
    domain=".nosis.com",
    path="/"
)

# ============================================================
# INGRESAR DNI
# ============================================================

dni = input("DNI / consulta: ").strip()

if not dni:
    raise SystemExit("No ingresaste ningún valor.")

# ============================================================
# REALIZAR BÚSQUEDA
# ============================================================

headers_busqueda = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/json; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/InformeTerceros",
}

print("\n[*] Realizando búsqueda...")

r1 = session.post(
    f"{BASE_URL}/InformeTerceros/RealizarBusqueda",
    headers=headers_busqueda,
    json={"query": dni},
    timeout=30
)

print("[+] HTTP:", r1.status_code)

r1.raise_for_status()

try:
    resultado = r1.json()
except ValueError:
    raise SystemExit("La respuesta de Nosis no es JSON.")

# ============================================================
# COMPROBAR RESULTADO
# ============================================================

if resultado.get("Error"):
    raise SystemExit(
        f"Error de Nosis: {resultado['Error']}"
    )

if not resultado.get("BusquedaRealizada"):
    raise SystemExit("La búsqueda no fue realizada.")

html = resultado.get("HtmlTabla", "")

if not html:
    raise SystemExit("Nosis no devolvió resultados.")

# ============================================================
# PARSEAR HTML
# ============================================================

soup = BeautifulSoup(html, "html.parser")

# ============================================================
# EXTRAER TODOS LOS RESULTADOS
# ============================================================

bloques = soup.select(".content-datos-resultados")
resultados = []

for bloque in bloques:

    elemento_nombre = bloque.select_one(
        ".resultados-razon-social span"
    )

    nombre = (
        elemento_nombre.get_text(" ", strip=True)
        if elemento_nombre
        else "-"
    )

    elemento_documento = bloque.select_one("#Documento")
    documento = (
        elemento_documento.get("value", "").strip()
        if elemento_documento
        else ""
    )

    direcciones = []

    for elemento_direccion in bloque.select(
        ".resultados-lugar .content-direccion .direccion"
    ):
        texto = elemento_direccion.get_text(" ", strip=True)
        texto = " ".join(texto.split())

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

        if len(partes) >= 1:
            provincia = partes[0]

        if len(partes) >= 2:
            localidad = partes[1]

    resultados.append({
        "nombre": nombre,
        "documento": documento,
        "provincia": provincia,
        "localidad": localidad,
        "direcciones": direcciones,
    })

if not resultados:
    raise SystemExit("No se encontraron resultados.")

print()
print("=" * 40)
print("RESULTADOS ENCONTRADOS")
print("=" * 40)

for i, resultado_item in enumerate(resultados, 1):
    print(f"{i}. {resultado_item['nombre']}")
    print(f"   {resultado_item['documento']}")

print("=" * 40)

while True:

    opcion = input(
        f"\nSeleccioná un resultado (1-{len(resultados)}): "
    ).strip()

    try:
        numero = int(opcion)
    except ValueError:
        print("[!] Ingresá un número válido.")
        continue

    if 1 <= numero <= len(resultados):
        break

    print("[!] Selección fuera de rango.")

seleccionado = resultados[numero - 1]

nombre = seleccionado["nombre"]
documento_seleccionado = seleccionado["documento"]
provincia = seleccionado["provincia"]
localidad = seleccionado["localidad"]
direcciones = seleccionado["direcciones"]

print("Resultado seleccionado:", nombre)
print("Documento seleccionado:", documento_seleccionado)

if not documento_seleccionado:
    raise SystemExit(
        "No se encontró el documento interno del resultado seleccionado."
    )

# ============================================================
# NUEVO: OBTENER FECHA DE NACIMIENTO
# ============================================================

fecha_nacimiento = "-"

url_nacimiento = (
    f"https://clientes.credicuotas.com.ar/"
    f"v1/onboarding/resolvecustomers/{documento_seleccionado}"
)

print("\n[*] Consultando fecha de nacimiento...")

try:

    r_fecha = requests.get(
        url_nacimiento,
        timeout=30
    )

    print("[+] HTTP nacimiento:", r_fecha.status_code)

    r_fecha.raise_for_status()

    datos_fecha = r_fecha.json()

    if isinstance(datos_fecha, list) and len(datos_fecha) > 0:

        fecha_nacimiento = datos_fecha[0].get(
            "fechanacimiento",
            "-"
        )

except (requests.RequestException, ValueError) as e:

    print(
        f"[!] No se pudo obtener la fecha de nacimiento: {e}"
    )

# ============================================================
# MOSTRAR RESULTADO
# ============================================================

print()
print("=" * 40)

print("Nombre")
print(nombre)

print()
print("CUIT / Documento")
print(documento_seleccionado)

print()
print("Fecha de nacimiento")
print(fecha_nacimiento)

print()
print("Provincia")
print(provincia)

print()
print("Localidad")
print(localidad)

print()
print("Dirección")

if direcciones:
    for i, direccion in enumerate(direcciones, 1):
        print(f"{i}. {direccion}")
else:
    print("-")

print("=" * 40)

# ============================================================
# DESCARGAR INFORME
# ============================================================

headers_informe = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/InformeTerceros",
}

print("\n[*] Solicitando informe...")

r2 = session.post(
    f"{BASE_URL}/Informes/DescargarInforme",
    headers=headers_informe,
    data={"documento": documento_seleccionado},
    timeout=60
)

print("[+] HTTP informe:", r2.status_code)

r2.raise_for_status()

print("[+] Informe recibido.")
