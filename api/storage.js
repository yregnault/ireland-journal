// Fichier : api/storage.js

const FREE_BASE = "http://jwi051.free.fr";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action;

  try {
    if (action === 'load') {
      const r = await fetch(FREE_BASE + "/api/load.php");
      const text = await r.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text || 'null');
    }

    if (action === 'save' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const r = await fetch(FREE_BASE + "/api/save.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body
      });
      const text = await r.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text);
    }

    if (action === 'upload' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const r = await fetch(FREE_BASE + "/api/upload.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body
      });
      const text = await r.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text);
    }

    return res.status(400).json({ error: "Action inconnue" });

  } catch (error) {
    console.error("Storage proxy error:", error);
    return res.status(500).json({
      error: "Erreur proxy vers Free",
      details: error.message
    });
  }
}