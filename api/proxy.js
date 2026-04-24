export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Goog-Api-Key, X-Goog-FieldMask');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint } = req.query;
  const apiKey = req.headers['x-goog-api-key'];
  const fieldMask = req.headers['x-goog-fieldmask'];

  if (!endpoint) return res.status(400).json({ error: 'Missing endpoint' });

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
