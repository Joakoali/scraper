# Lead Finder — leads de verdad para Flexora

Fecha: 2026-11-17
Estado: pendiente de aprobación

## 1. Intención

El Lead Finder (`index.html` + `api/proxy.js`, deployado en Vercel) busca negocios en Google Maps, mide su web y exporta un CSV que después alimenta la skill de outreach. Joako lo usa para conseguir clientes para **Flexora** (desarrollo web, marketing y ads, branding e identidad).

Problema: "a veces me tira leads medios malos". No hay ejemplos guardados, así que la definición de lead bueno sale del código y de dónde falla. Joako la aprobó:

1. **Negocio chico o mediano e independiente.** Nada de cadenas, franquicias ni marcas con muchos locales.
2. **Abierto y con movimiento.** No figura como cerrado y tiene reseñas.
3. **Contactable.** Email de su propio dominio o, como mínimo, teléfono. Sin emails de la agencia que le hizo la web ni basura (`logo@2x.png`, placeholders de plantilla).
4. **Tiene un problema que Flexora resuelve y que se puede mostrar.**
   - Sin web, o su "web" es una red social o un Linktree.
   - Web caída, sin HTTPS, que no se adapta al celular, desactualizada o lenta.
   - Sin publicidad online (ni píxel de Meta ni Google Ads): abre la venta de marketing, no solo de web.

El orden por PageSpeed se reemplaza por una **nota combinada** de esos cuatro puntos.

Es **afinar la herramienta actual**, no rehacerla.

## 2. Objetivos, no objetivos y anti-objetivos

**Objetivos**

- Descartar cadenas, negocios cerrados, ruido y negocios sin forma de contacto, mostrando el motivo.
- Emails mejores: buscar también en contacto y aviso legal, decodificar los ofuscados, descartar basura y clasificar cada email (propio, gratuito, otro dominio).
- Detectar problemas vendibles: web, móvil, HTTPS, antigüedad, velocidad y publicidad.
- Ordenar por nota y dejar ver solo los buenos.
- Compensar el filtrado con búsqueda por zonas, mostrando cuántas consultas a Google va a costar.
- Cerrar el proxy abierto.
- Arreglar la paginación de Google Places.

**No objetivos (fuera de esta etapa)**

- Recordar a quién ya contactaste o llevar un historial entre búsquedas.
- Actualizar la skill de outreach (sigue firmando como Ixtal y no conoce los nuevos ángulos). Es el paso siguiente, aparte.
- Leer el texto o la fecha de las reseñas: requiere un SKU más caro de Google (Enterprise + Atmosphere).
- Guardar la API key en el navegador.
- Rediseñar visualmente la herramienta.
- Sacar datos de LinkedIn o de redes.

**Anti-objetivos (sería un fracaso aunque funcione)**

- Que descarte negocios buenos sin que Joako se entere. Por eso los descartados quedan visibles con su motivo.
- Que el gasto en Google se dispare sin aviso. Por eso se muestra la estimación de consultas y las zonas son a elección.
- Que en el CSV aparezcan emails de plantilla, de la agencia o de servicios técnicos como si fueran del negocio.
- Que el proxy siga sirviendo para descargar cualquier URL a pedido de cualquiera.

## 3. Restricciones

- **Places API (New), Text Search** (verificado en la documentación de Google el 2026-11-17):
  - Máximo **60 resultados por consulta**, en páginas de hasta 20 (`pageSize`; `maxResultCount` está deprecado).
  - La página siguiente se pide con `pageToken`, manteniendo los demás parámetros iguales.
  - El patrón documentado incluye `nextPageToken` en el `X-Goog-FieldMask`. El código actual no lo incluye, así que **casi seguro que hoy nunca pagina** y llegan como mucho 20 resultados.
  - `locationRestriction` solo acepta **rectángulo**: `{ "rectangle": { "low": {lat,lng SW}, "high": {lat,lng NE} } }`. No se combina con `locationBias`.
  - `websiteUri`, `nationalPhoneNumber`, `rating` y `userRatingCount` ya cobran como **Text Search Enterprise**. Sumar `businessStatus`, `types`, `primaryType` y `googleMapsUri` (Pro) no cambia el precio.
  - Enterprise: **1.000 consultas gratis al mes** por cuenta de facturación; después, unos **35 USD cada 1.000**.
  - Cada página es una consulta aparte (inferido de la documentación, no dicho explícitamente).
- **PageSpeed Insights:**
  - Sin key, la cuota compartida es muy baja y muchas webs quedan "Sin datos".
  - Con key funciona bien, pero en el proyecto de Google Cloud de esa key hay que habilitar la **PageSpeed Insights API**.
  - Tarda entre 10 y 30 s por web.
- **Webs que bloquean bots** (Cloudflare y similares) devuelven 403/503 o una página de desafío. Hay que tratarlas como "no se pudo revisar", no como web caída.
- **Vercel:**
  - Proyecto `scraper`, conectado a `github.com/Joakoali/scraper`. El CLI no está instalado en esta máquina.
  - Los cambios de la v3.0 (`index.html` en la raíz y el rewrite nuevo en `vercel.json`) no están commiteados. Hay que verificar en un deploy que `/` y los archivos estáticos nuevos se sirven bien: el `vercel.json` commiteado reescribía todo a `/public/`.
- **Compatibilidad:** las 8 columnas actuales del CSV, en su orden, las usa la skill de outreach. No se tocan; solo se agregan columnas al final.
- **Legal (no cambia la herramienta):** en España la LSSI (art. 21) prohíbe las comunicaciones comerciales por email u otro medio electrónico (WhatsApp incluido) no solicitadas, también a empresas, y la AEPD sanciona. Por eso la herramienta no promueve WhatsApp como canal frío.

## 4. Enfoques considerados

1. **Afinar la herramienta actual (elegido).** Misma página y misma función de Vercel. La función analiza cada web en profundidad; el navegador filtra, puntúa y ordena; se suma la búsqueda por zonas. Ventaja: es lo que se pidió y no cambia la forma de trabajar. Contra: el tope de 60 resultados por consulta sigue, lo compensan las zonas.
2. **Script local por terminal.** Recorre muchos sectores y ciudades, recuerda contactados y deja el CSV. Más volumen, pero se pierde la pantalla y es rehacer casi todo. Descartado.
3. **Comprar una base de datos de empresas** (Apollo y similares). Caro y flojo para negocios locales en España. Descartado.

## 5. Diseño

### 5.1 Flujo

```
Buscar (todas las zonas, deduplicar por place id)
  → Filtros duros sin red (cerrado, cadena, ruido, sin actividad, sin contacto posible)
  → Análisis de web en Vercel (solo los que siguen y tienen web propia)
  → PageSpeed (solo los que siguen y tienen web propia que respondió)
  → Nota, ángulo y orden
  → Pantalla: buenos / todos / descartados con motivo → CSV
```

Lo barato va primero y lo caro (PageSpeed) al final, solo para los que sobreviven.

### 5.2 Búsqueda

- **Field mask:** `places.id, places.displayName, places.formattedAddress, places.rating, places.userRatingCount, places.websiteUri, places.nationalPhoneNumber, places.businessStatus, places.types, places.primaryType, places.googleMapsUri, nextPageToken`.
- `pageSize: 20`. Hasta 3 páginas por zona mientras haya `nextPageToken`.
- **Zonas** (selector nuevo que reemplaza "Resultados máx."): 1, 4 (2×2) o 9 (3×3).
  - Se arma un cuadrado centrado en las coordenadas de la ciudad, con medio lado igual al radio elegido (grados de latitud = m / 111.320; de longitud = m / (111.320 · cos lat)).
  - Se divide en N×N rectángulos y cada zona se consulta con `locationRestriction` y `textQuery` = la query del sector, sin el nombre de la ciudad.
  - Con 1 zona también se usa `locationRestriction` sobre el cuadrado completo.
- Bajo el selector se muestra la estimación: "Hasta X consultas a Google (1.000 gratis al mes, después ~35 USD cada 1.000)", con X = zonas × 3.
- Se deduplica por `place.id` entre zonas.
- La pausa de 1,5 s entre páginas era de la API vieja; puede quitarse.

### 5.3 Filtros duros (descartan, con motivo visible)

| Motivo | Regla |
|---|---|
| Cerrado | `businessStatus` distinto de `OPERATIONAL` |
| Cadena | Cualquiera de estas: (a) el mismo dominio registrable de `websiteUri` aparece en 2 o más lugares del resultado (excluyendo dominios de redes sociales); (b) el mismo nombre normalizado aparece 2 o más veces (minúsculas, sin acentos, cortando lo que va después de " - " o "\|"); (c) el nombre coincide con la lista corta de cadenas conocidas; (d) `websiteUri` apunta a una ficha de localizador (ruta con 2 o más segmentos y una palabra tipo `tiendas`, `clinicas`, `centros`, `locales`, `oficinas`, `gimnasios`, `salones`, `store(s)`, o el nombre de la ciudad) |
| No es del sector | `NOISE_KEYWORDS` actuales |
| Sin actividad visible | `userRatingCount` 0 o ausente |
| Sin contacto posible | Sin teléfono y sin email. Para los que tienen web propia se evalúa **después** del análisis (5.5); para los que no tienen web propia, antes. Un link a red social no cuenta como contacto. Si la web no se pudo revisar y no hay teléfono, el motivo es "sin contacto (web no se pudo revisar)" |

**Lista de cadenas conocidas:** un array editable en el código, con unas 30 entradas de arranque (Vitaldent, Sanitas, Adeslas, Caser, Llongueras, Marco Aldany, Jean Louis David, Provost, Basic-Fit, McFit, Anytime Fitness, Holmes Place, DiR, Go Fit, Synergym, VivaGym, Altafit, Tecnocasa, Century 21, RE/MAX, Engel & Völkers, Lucas Fox, Solvia, Servihabitat, Donpiso, Midas, Norauto, Feu Vert, Euromaster, Carglass, Kiwoko, Tiendanimal…).

Los muy grandes (más de 1.500 reseñas) **no se descartan**: bajan en la nota. Un restaurante independiente puede tener miles.

### 5.4 "Sin web propia"

Si `websiteUri` apunta a uno de estos dominios, el lead cuenta como **sin web propia** y no se analiza: `facebook.com`, `fb.com`, `instagram.com`, `linktr.ee`, `linkin.bio`, `beacons.ai`, `taplink.cc`, `wa.me`, `api.whatsapp.com`, `tiktok.com`, `business.site`, `sites.google.com`, `g.page`, `maps.google.*`, `goo.gl`, `maps.app.goo.gl`.

Los sitios `business.site` de Google se cerraron en 2024, así que esos negocios en la práctica no tienen web. El link se muestra igual en la tarjeta.

### 5.5 Análisis de web (función de Vercel, `?analyze=<url>`)

Reemplaza a `?scrape=`. Por cada web:

1. **Descarga la portada** con fetch seguro (5.8), siguiendo redirecciones.
2. **Busca links internos** del mismo host en la portada: primero contacto (`contacto`, `contact`, `contactar`), después aviso legal (`aviso-legal`, `aviso legal`, `legal`, `privacidad`), y como último recurso `quienes-somos`. Descarga como máximo 2 más, o sea 3 páginas en total.
3. **Devuelve:**
   ```json
   {
     "reachable": true,            // respondió 2xx en alguna variante
     "blocked": false,             // 403/503 o página de desafío anti-bot → "no se pudo revisar"
     "parked": false,              // dominio en venta, página por defecto del hosting, "en construcción", "próximamente", "Index of /"
     "finalUrl": "https://…",
     "https": true,                // la URL final es https
     "sslBroken": false,           // https falla y http responde
     "viewport": true,             // existe <meta name="viewport">
     "copyrightYear": 2019,        // año más alto en "©" o "copyright"; null si no hay
     "generator": "WordPress 6.4", // <meta name="generator">, solo informativo
     "metaPixel": false,           // fbevents.js o fbq('init'
     "googleAds": false,           // AW-xxxxxx, googleadservices.com o googleads.g.doubleclick.net
     "gtm": true,                  // googletagmanager.com/gtm.js o GTM-XXXX
     "emails": [{ "email": "info@negocio.es", "kind": "propio" }],
     "instagram": "https://instagram.com/negocio"
   }
   ```
4. **HTTPS:**
   - Si la URL final es `http://`, se prueba `https://<host>/` con un timeout corto. Si no responde, el lead queda como "sin HTTPS".
   - Si `https://` falla por certificado y `http://` responde, queda como "SSL roto".
5. **Emails:**
   - **Fuentes:** `mailto:` (decodificado), Cloudflare `data-cfemail` (hex XOR), entidades HTML (`&#64;`, `&#x40;`) y regex sobre el texto.
   - **Descartar:**
     - extensiones de archivo (`.png`, `.jpg`, `.webp`, `.svg`, `.gif`, `.css`, `.js`) y `@2x`/`@3x`;
     - partes locales de servicio (`noreply`, `no-reply`, `donotreply`, `bounce`, `mailer-daemon`, `postmaster`);
     - dominios técnicos o de plataforma (sentry, wixpress, wix, wordpress, cloudflare, schema, w3.org, google, facebook…);
     - **placeholders de plantilla** (`example.com`, `domain.com`, `email.com`, `tudominio.com`, `tuempresa.com`, `yourdomain.com`, `test.com`…);
     - partes locales con pinta de hash (16 o más caracteres hex).
   - La blocklist se compara contra el **dominio**, no como substring de todo el email (hoy `test` o `cdn` pueden matchear de más).
   - **Clasificar** cada email:
     - `propio`: el dominio coincide con el dominio registrable de la web;
     - `gratuito`: gmail, hotmail, outlook, yahoo, icloud, live, msn, protonmail, telefonica.net;
     - `otro`: cualquier otro dominio; en la tarjeta se marca como "posible agencia".
   - Orden: propio, gratuito, otro. Máximo 5.
6. **Errores:** si no se pudo revisar la web, ningún dato suma ni resta. La tarjeta dice "no se pudo revisar".

### 5.6 PageSpeed

- Se llama desde el navegador, como hoy, pero solo para los leads que siguen y tienen web propia que respondió.
- Se usa la misma API key. Si Google responde que la API no está habilitada (403), se reintenta sin key y no se vuelve a usar la key en esa búsqueda. La pantalla avisa: "Habilitá PageSpeed Insights API en tu proyecto de Google Cloud para que no falle".
- Hay un toggle "Medir velocidad (más lento)", activado por defecto.
- Se corren pocas a la vez.

### 5.7 Nota (0–100), ángulo y orden

Constantes en un único lugar para poder ajustarlas.

**Necesidad (tope 60)**

| Señal | Puntos |
|---|---|
| Sin web propia (sin web, red social, web caída o en construcción) | 45 |
| Sin HTTPS o SSL roto | 20 |
| No se adapta al celular (sin viewport) | 20 |
| Desactualizada (© ≤ año actual − 3) | 10 |
| PageSpeed < 40 / 40–69 | 10 / 5 |
| Sin publicidad online (ni píxel, ni Ads, ni GTM) | 10 |

Si hay GTM pero no se ve píxel ni Ads, la publicidad queda como "no se sabe" y no suma (GTM puede cargarlos).

**Contacto (tope 25)**

| Señal | Puntos |
|---|---|
| Email propio / gratuito / solo de otro dominio | 20 / 15 / 5 |
| Teléfono | +5 |

**Tamaño y actividad (tope 15)**

| Reseñas | Puntos |
|---|---|
| 10–500 | 15 |
| 1–9 o 501–1.500 | 8 |
| Más de 1.500 | 0 |

- **Lead bueno:** nota ≥ 50. Referencias para calibrar: sin web + teléfono + 100 reseñas = 65; web correcta sin publicidad, PageSpeed 50, email propio y 100 reseñas = 50; web correcta con publicidad y email propio = 35.
- **Ángulo sugerido:** la señal de necesidad con más puntos que tenga el lead (Sin web, Red social como web, Web caída, Sin HTTPS, No se adapta al celular, Lenta, Desactualizada, Sin publicidad). Se usa para el pitch.
- **Orden:** por nota, de mayor a menor.

### 5.8 Seguridad del proxy

- Se quita `Access-Control-Allow-Origin: *`. La página y la API comparten origen, así que no hace falta CORS.
- Se rechazan los pedidos cuyo `Sec-Fetch-Site` exista y no sea `same-origin`, o cuyo `Origin` exista y no coincida con el host. Esto no frena a un cliente no navegador, pero sí a otros sitios y al abuso casual. Alcanza para esta herramienta.
- **Modo Places:** solo acepta `endpoint=places:searchText` (whitelist).
- **Modo analyze:**
  - solo `http`/`https`;
  - se resuelve el DNS y se rechazan IPs privadas, loopback, link-local o de metadata (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0.0.0.0, ::1, fc00::/7, fe80::/10);
  - las redirecciones se siguen a mano (máximo 5), revalidando cada salto;
  - el cuerpo se corta a 1,5 MB y cada página tiene un timeout de 8 s.

### 5.9 Pantalla

- **Config:** "Resultados máx." pasa a ser "Zonas" con la estimación de consultas. Se suma el toggle de PageSpeed.
- **Tarjeta:**
  - una píldora con la nota en lugar del score de PageSpeed;
  - el ángulo sugerido;
  - tags de problemas (reutilizando `tag-issue` y `tag-opp`);
  - los emails con su tipo (y "posible agencia" en los de otro dominio);
  - teléfono;
  - links a Instagram y a Google Maps.
- **Filtros:** toggle "Solo buenos", activado por defecto. Debajo, una sección plegable "Descartados (N)" con nombre y motivo.
- **Estado:** el progreso muestra cada fase (zonas consultadas, análisis de webs, PageSpeed).
- **Texto:** el aviso del encabezado y el título pasan a hablar de Flexora. La estética no cambia.

### 5.10 CSV

- Mismas 8 columnas en el mismo orden: Nombre, Dirección, Rating, Reseñas, Web, PageSpeed Mobile, Teléfono, Emails.
- Al final se agregan: **Nota, Ángulo, Problemas, Instagram, Google Maps, Tipo** (`primaryType` de Places).
- Se exporta lo que está visible: con "Solo buenos" activado, solo los buenos. Los descartados no se exportan.

### 5.11 Estructura del código

- `api/proxy.js`: router de `?endpoint=` (Places) y `?analyze=`, más los chequeos de origen.
- `api/_lib/safe-fetch.js`: fetch con validación de destino, redirecciones manuales, tope de tamaño y timeout. Como empieza con `_`, Vercel no lo expone como función.
- `api/_lib/analyze.js`: funciones puras que reciben HTML y URL base (`extractEmails`, `detectSignals`, `findInternalLinks`, `classifyEmail`) y la orquestación del análisis.
- `lib/leads.js`: módulo ES que se sirve estático y se importa desde `index.html`. Tiene la lógica pura del navegador: zonas, dominio registrable, detección de cadenas, sin web propia, filtros duros, nota, ángulo y filas del CSV.
- `index.html`: UI y orquestación. Al pasar a `<script type="module">`, los `onclick` inline necesitan `addEventListener` o exponer funciones en `window`.
- **Tests:** `node --test` (Node 24, sin dependencias) para las funciones puras de `api/_lib/analyze.js` y `lib/leads.js`, con fixtures de HTML como strings. `package.json` suma `"type": "module"` y `"test": "node --test"`. Hay que verificar en un deploy de preview que la función sigue andando con `type: module`.
- **README:** se actualiza con el flujo nuevo, las zonas y su costo, y cómo habilitar PageSpeed Insights API.

## 6. Orden de trabajo sugerido (de a una parte)

0. Commitear la v3.0 actual como base.
1. Seguridad del proxy y búsqueda: field mask completo con `nextPageToken`, `pageSize`, zonas y estimación. Verificable: con 1 zona deberían volver a llegar hasta 60 resultados.
2. Análisis de web en Vercel: emails, señales y sin web propia, con tests.
3. Filtros duros, cadenas, nota, ángulo y pantalla, con tests.
4. PageSpeed con key, CSV y README.

Cada parte se prueba con una búsqueda real en un deploy de preview antes de pasar a la siguiente.

## 7. Decisiones tomadas por Claude (Joako puede corregirlas)

- Pesos, umbrales y la nota mínima de 50 para "bueno".
- Descartar con 0 reseñas; los de más de 1.500 bajan en la nota pero no se descartan.
- La lista inicial de cadenas, las reglas de cadena y la lista de dominios "sin web propia".
- Analizar hasta 3 páginas por web (portada, contacto y aviso legal).
- Las zonas 1 / 4 / 9 reemplazan "Resultados máx.".
- Usar `locationRestriction` siempre, sin el nombre de la ciudad en la query.
- La protección del proxy por origen + SSRF, sin contraseña.
- PageSpeed con la misma key y fallback sin key.
- Estructura de archivos y tests con `node:test`.
- Exportar solo lo visible.

## 8. Lo que queda a criterio de quien lo construya

- Las regex exactas y los textos de los tags.
- La concurrencia del análisis (orientativo: 5) y de PageSpeed (orientativo: 2).
- El cálculo del dominio registrable: últimas 2 etiquetas, con excepción para sufijos de 2 niveles como `com.es`, `org.es`, `co.uk` o `com.ar`.
- Detalles de layout de la tarjeta y de la sección de descartados.
