// Fichier : api/storage.js

// Augmenter la limite de taille du body (par défaut 4.5MB)
export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};

const FREE_BASE = "http://jwi051.free.fr";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action;
  console.log("Storage request:", req.method, "action:", action);

  try {
    if (action === 'load') {
      const r = await fetch(FREE_BASE + "/api/load.php");
      const text = await r.text();
      console.log("Load response status:", r.status, "length:", text.length);
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text || 'null');
    }

    if (action === 'save') {
      if (req.method !== 'POST') return res.status(405).json({ error: "POST requis" });
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      console.log("Save body length:", body.length);
      const r = await fetch(FREE_BASE + "/api/save.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body
      });
      console.log("Free save response status:", r.status);
      const text = await r.text();
      console.log("Free save response:", text.slice(0, 200));
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text || '{"ok":true}');
    }

    if (action === 'upload') {
      if (req.method !== 'POST') return res.status(405).json({ error: "POST requis" });
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      console.log("Upload body length:", body.length);
      const r = await fetch(FREE_BASE + "/api/upload.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body
      });
      console.log("Free upload response status:", r.status);
      const text = await r.text();
      console.log("Free upload response:", text.slice(0, 200));
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text);
    }

    if (action === 'photo') {
      const file = req.query.file;
      if (!file) return res.status(400).json({ error: "Paramètre file requis" });
      const r = await fetch(FREE_BASE + "/photos/" + encodeURIComponent(file));
      if (!r.ok) return res.status(404).json({ error: "Photo introuvable" });
      const buffer = await r.arrayBuffer();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.status(200).send(Buffer.from(buffer));
    }

    return res.status(400).json({ error: "Action inconnue: " + action });

  } catch (error) {
    console.error("ERREUR PROXY:", error.message, error.stack);
    return res.status(500).json({
      error: error.message,
      action: action,
      method: req.method
    });
  }
}