import { isSameOrigin } from './_lib/origin.js';
import { safeFetch } from './_lib/safe-fetch.js';

export default async function handler(req, res) {
  if (!isSameOrigin(req.headers)) return res.status(403).json({ error: 'Forbidden' });

  const { endpoint, scrape } = req.query;

  // --- Modo scraping: extrae emails de una URL arbitraria ---
  if (scrape) {
    try {
      const targetUrl = decodeURIComponent(scrape);
      const { status, html } = await safeFetch(targetUrl);

      if (status < 200 || status >= 300) return res.status(200).json({ emails: [] });

      // Extraer emails del HTML
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const rawMatches = html.match(emailRegex) || [];

      // Filtrar emails genéricos / inútiles
      const BLOCKLIST = [
        'sentry', 'wix', 'wordpress', 'jquery', 'schema', 'example',
        'test', 'noreply', 'no-reply', 'bounce', 'mailer', 'cdn',
        'w3.org', 'googleapis', 'cloudflare', 'facebook', 'instagram',
        'twitter', 'tiktok', 'youtube', 'linkedin', 'google',
      ];
      const emails = [...new Set(
        rawMatches.filter(e => !BLOCKLIST.some(b => e.toLowerCase().includes(b)))
      )].slice(0, 5);

      return res.status(200).json({ emails });
    } catch {
      return res.status(200).json({ emails: [] });
    }
  }

  // --- Modo Places API ---
  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint or scrape param' });
  if (endpoint !== 'places:searchText') return res.status(400).json({ error: 'Endpoint not allowed' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = req.headers['x-goog-api-key'];
  const fieldMask = req.headers['x-goog-fieldmask'];
  const targetUrl = `https://places.googleapis.com/v1/${endpoint}`;

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-Goog-Api-Key': apiKey }),
        ...(fieldMask && { 'X-Goog-FieldMask': fieldMask }),
      },
    };

    if (req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
