// Fichier : api/summary.js
// Ce fichier sert de relais entre ton site et l'API Anthropic.
// Il tourne côté serveur sur Vercel, donc pas de problème CORS.

export default async function handler(req, res) {
  // N'accepter que les requêtes POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // Récupérer la clé API depuis les variables d'environnement Vercel
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Clé API Anthropic non configurée" });
  }

  try {
    // Transmet la requête à l'API Anthropic
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Erreur serveur : " + error.message });
  }
}