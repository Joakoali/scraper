# BCN Lead Finder

Herramienta para encontrar leads comerciales en Barcelona con potencial de mejora web. Usa Google Places API para descubrir negocios y PageSpeed para evaluar la calidad de sus sitios.

## Cómo funciona

1. Ingresás tu Google Places API Key
2. Seleccionás el sector (restaurantes, dentistas, peluquerías, etc.)
3. La herramienta busca negocios en un radio de 12km alrededor de Barcelona
4. Para cada negocio analiza su web con PageSpeed mobile
5. Ordena los leads por oportunidad: **sin web primero**, luego por peor score

## Criterios de prioridad

| Indicador | Significado |
|-----------|-------------|
| Sin web | Alta oportunidad — negocio sin presencia digital |
| Score < 40 | Web con carga lenta, mala UX mobile, posible penalización SEO |
| Score 40–70 | Web mejorable |
| Score > 70 | Web en buen estado |

## Deploy

Deployado en Vercel. El archivo `api/proxy.js` actúa como proxy para las llamadas a Google Places API.

## Requisitos

- Google Places API Key con acceso a **Places API (New)**
- La API de PageSpeed es pública y no requiere key

## Sectores disponibles

Restaurantes, peluquerías, gimnasios, abogados, dentistas, inmobiliarias, fontaneros, electricistas, contables/gestorías, talleres, tiendas de ropa, centros de estética, fisioterapeutas, veterinarias.
