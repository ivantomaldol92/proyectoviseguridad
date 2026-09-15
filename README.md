# Proyecto de seguridad y exposición de datos

## Historial del proyecto

Los puntos anteriores al 9 no están registrados en este archivo. A partir del punto 9, el desarrollo quedó así:

### 9. Script local de consulta

Se creó `nosis.py` para consultar información desde Nosis mediante una sesión autenticada. El script permite:

- Ingresar un DNI, CUIT o nombre.
- Buscar coincidencias.
- Seleccionar un resultado.
- Mostrar nombre, documento, fecha de nacimiento, provincia, localidad y dirección.
- Solicitar el informe disponible.

**Finalidad:** probar el flujo de consulta de forma local antes de convertirlo en una herramienta web.

### 10. Interfaz web inicial

Se creó `index.html` como pantalla para que una persona pueda ingresar un DNI, CUIT o nombre desde el navegador.

La interfaz se comunica con la ruta:

```text
/.netlify/functions/consulta
```

**Finalidad:** separar la pantalla pública de las credenciales y evitar que el navegador consulte directamente al servicio externo.

### 11. Función de backend para Netlify

Se creó `functions/consulta.mjs` para ejecutar la consulta en el servidor de Netlify. La función:

- Recibe el dato enviado por el formulario.
- Valida la entrada.
- Consulta Nosis desde el backend.
- Procesa el HTML de resultados con `cheerio`.
- Consulta opcionalmente la fecha de nacimiento.
- Intenta obtener el informe PDF.
- Devuelve una respuesta JSON al frontend.

**Finalidad:** mantener las cookies de sesión fuera del código que se ejecuta en el navegador y centralizar la comunicación con los servicios externos.

### 12. Configuración del despliegue

Se agregó `netlify.toml` con esta configuración:

- Directorio público: la raíz del proyecto.
- Directorio de funciones: `functions`.

También se agregó `package.json` con el modo de módulos ES y la dependencia `cheerio`.

**Finalidad:** permitir que Netlify publique la interfaz y detecte automáticamente la función `consulta`.

### 13. Variables de entorno para las cookies

En Netlify se configuraron estas variables como secretos:

```text
ASP_NET_SESSION_ID
NSTK
```

Ambas quedaron con:

- `All scopes`.
- `Same value for all deploy contexts`.

**Finalidad:** entregar las cookies de sesión al backend sin escribirlas en `index.html` ni enviarlas desde el navegador.

La opción de usar valores diferentes por contexto requiere un plan superior de Netlify, pero no es necesaria para este proyecto.

### 14. Corrección de lectura de variables en Netlify

La función inicialmente intentaba leer los secretos con `Netlify.env.get(...)`. Se corrigió para usar el acceso compatible con las funciones Node:

```js
const sessionId = process.env.ASP_NET_SESSION_ID;
const nstk = process.env.NSTK;
```

**Finalidad:** evitar el mensaje `Faltan las variables de entorno de la sesión` cuando las variables sí existen en Netlify.

### 15. Eliminación de función duplicada

Se detectó que existían dos implementaciones con el mismo nombre:

- `functions/consulta.py`
- `functions/consulta.mjs`

Se eliminó `consulta.py` para que Netlify ejecute una sola función `consulta`, la implementación JavaScript.

**Finalidad:** evitar conflictos de detección o ejecución entre runtimes y mantener un único backend de producción.

### 16. Rediseño visual de la interfaz

Se actualizó `index.html` con una identidad visual futurista y oscura:

- Tema oscuro en lugar de fondo blanco.
- Tipografías `Space Grotesk` y `Syne`.
- Colores cian y verde ácido para transmitir tecnología y monitoreo.
- Encabezado `Radar de exposición`.
- Título orientado a la pregunta: `¿Qué datos tuyos están expuestos?`.
- Panel `Por qué importa`.
- Estados visuales para consulta, errores y descarga del PDF.
- Diseño responsive para escritorio y celular.

**Finalidad:** dejar claro que la herramienta es un proyecto de seguridad y concientización sobre la exposición de datos, no solamente un formulario de consulta.

### 17. Uso responsable y privacidad

La pantalla incluye un aviso para utilizar la herramienta únicamente sobre datos propios o con autorización. También se advierte que no se deben compartir resultados personales ni utilizarlos para hostigar, discriminar o tomar decisiones sobre terceros.

**Finalidad:** establecer el contexto educativo y responsable del proyecto.

### 18. Hallazgo: exposición de datos mediante sesiones autenticadas

Durante el análisis se observó que una sesión autenticada de Nosis, representada por cookies de sesión, permite acceder a una cantidad importante de información personal después de iniciar sesión. El riesgo principal no está en consultar un dato propio, sino en que una sesión válida pueda ser reutilizada para consultar información de otras personas sin un control suficiente de autorización, consentimiento, finalidad o cantidad de consultas.

También se detectó una consulta hacia un servicio de Credicuotas que puede devolver información adicional asociada a una persona, como la fecha de nacimiento. Esto amplía el impacto potencial cuando se combinan datos provenientes de distintos servicios.

**Riesgos identificados:**

- Reutilización de cookies de sesión por terceros.
- Acceso automatizado o masivo a datos personales.
- Correlación de nombre, documento, domicilio y fecha de nacimiento.
- Suplantación de identidad, fraude, hostigamiento o discriminación.
- Exposición de credenciales si las cookies se publican en un repositorio.

**Alcance responsable del proyecto:** este hallazgo se documenta para concientización y evaluación defensiva. No se deben realizar consultas sobre terceros sin autorización, automatizar búsquedas masivas, compartir resultados ni publicar cookies, tokens, documentos o respuestas reales.

**Medidas recomendadas:**

- Revocar y renovar inmediatamente las cookies que hayan sido expuestas.
- Informar el hallazgo a Nosis y Credicuotas por sus canales oficiales de seguridad o privacidad.
- Solicitar controles de autorización, expiración y rotación de sesiones.
- Aplicar límites de frecuencia, monitoreo y detección de automatización.
- Evitar que endpoints de datos sensibles respondan únicamente con un identificador.
- Usar datos ficticios o anonimizados en pruebas y demostraciones.
- Retirar las credenciales del código y conservarlas solo como secretos del entorno.

## Estado actual

- La interfaz web está en `index.html`.
- La función activa está en `functions/consulta.mjs`.
- Netlify publica la raíz del proyecto y busca funciones en `functions`.
- Las variables `ASP_NET_SESSION_ID` y `NSTK` deben existir en Netlify.
- La función JavaScript pasa la comprobación de sintaxis.
- La interfaz fue comprobada en escritorio y móvil.

## Seguridad pendiente

Las cookies que aparecen actualmente en `nosis.py` son credenciales de sesión y quedaron expuestas en el repositorio. Deben renovarse desde Nosis y retirarse del código fuente. Para producción, las credenciales deben mantenerse únicamente como variables de entorno de Netlify.

## 19. Acceso autenticado

Se agregó Netlify Identity para impedir que una persona use la herramienta solo por conocer el enlace.

- La interfaz mantiene oculto el módulo de consulta hasta iniciar sesión.
- El frontend envía el token de sesión en la cabecera `Authorization`.
- `functions/consulta.mjs` valida el token antes de consultar Nosis.
- La sesión puede cerrarse desde la pantalla.

En Netlify se debe habilitar Identity y configurar el registro como **Invite only**. Luego se deben invitar únicamente usuarios autorizados. La autenticación visual del frontend no es suficiente por sí sola: la validación del backend es la que protege realmente la función.