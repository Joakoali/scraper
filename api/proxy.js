export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Goog-Api-Key, X-Goog-FieldMask');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint, scrape } = req.query;

  // --- Modo scraping: extrae emails de una URL arbitraria ---
  if (scrape) {
    try {
      const targetUrl = decodeURIComponent(scrape);
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) return res.status(200).json({ emails: [] });

      const html = await response.text();

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

    if (req.method === 'POST' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
