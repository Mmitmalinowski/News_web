// Simple local CORS proxy for fetching RSS feeds
// Usage: http://localhost:3000/proxy?url=https://example.com/feed

const express = require('express');
const fetch = require('node-fetch'); // node-fetch v2
const app = express();
const PORT = process.env.PORT || 3000;

// handle preflight
app.options('/proxy', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Content-Type', 'text/xml; charset=utf-8');
  if (!url) return res.status(400).send('url query parameter is required');
  try {
    const response = await fetch(url, { timeout: 15000 });
    const text = await response.text();
    res.status(200).send(text);
  } catch (err) {
    res.status(502).send('fetch error: ' + (err && err.message));
  }
});

app.listen(PORT, () => console.log(`Proxy running on http://localhost:${PORT}/proxy?url=`));
