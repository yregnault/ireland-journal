// Fichier : api/storage.js
// Relaye les requêtes du site (HTTPS) vers Free (HTTP) côté serveur

const FREE_BASE = "http://jwi051.free.fr";

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const { action } = req.query; // load, save, upload

  if (action === 'load') {
    try {
      const r = await fetch(FREE_BASE + "/api/load.php");
      const data = await r.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'save' && req.method === 'POST') {
    try {
      const r = await fetch(FREE_BASE + "/api/save.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body)
      });
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (action === 'upload' && req.method === 'POST') {
    try {
      const r = await fetch(FREE_BASE + "/api/upload.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body)
      });
      const data = await r.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: "Action inconnue. Utilise ?action=load|save|upload" });
}