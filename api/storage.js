// api/storage.js — Stockage sécurisé via Supabase
// Toutes les clés sont côté serveur, jamais exposées au client

import { createClient } from '@supabase/supabase-js';
import { verifyToken } from './auth.js';

export const config = { api: { bodyParser: { sizeLimit: '10mb' } } };

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
}

function getToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = req.query.action;

  // Geocode doesn't need auth (public map data)
  if (action === 'geocode') {
    var q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Param q requis' });
    try {
      var r = await fetch('https://nominatim.openstreetmap.org/search?format=json&q=' + encodeURIComponent(q) + '&limit=1', {
        headers: { 'User-Agent': 'TravelJournal/1.0' }
      });
      var text = await r.text();
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(text);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // All other actions require authentication
  const token = getToken(req);
  const session = verifyToken(token);
  if (!session) return res.status(401).json({ error: 'Non authentifié' });

  const supabase = getSupabase();

  try {
    // ── Load journal data ──
    if (action === 'load') {
      const { data, error } = await supabase
        .from('journal')
        .select('data')
        .eq('id', 'main')
        .single();

      if (error || !data) return res.status(200).json(null);
      return res.status(200).json(data.data);
    }

    // ── Save journal data (admin only) ──
    if (action === 'save') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Admin requis' });
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST requis' });

      const { error } = await supabase
        .from('journal')
        .upsert({
          id: 'main',
          data: req.body,
          updated_at: new Date().toISOString()
        });

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ ok: true });
    }

    // ── Upload photo (admin only) ──
    if (action === 'upload') {
      if (session.role !== 'admin') return res.status(403).json({ error: 'Admin requis' });
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST requis' });

      const { base64, filename } = req.body;
      if (!base64 || !filename) return res.status(400).json({ error: 'base64 et filename requis' });

      const buffer = Buffer.from(base64, 'base64');
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '');
      const path = 'journal/' + safeName;

      const { error } = await supabase.storage
        .from('photos')
        .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });

      if (error) return res.status(500).json({ error: error.message });

      return res.status(200).json({ ok: true, url: '/api/storage?action=photo&file=' + encodeURIComponent(safeName) });
    }

    // ── Get photo (authenticated) ──
    if (action === 'photo') {
      const file = req.query.file;
      if (!file) return res.status(400).json({ error: 'Param file requis' });

      const safeName = file.replace(/[^a-zA-Z0-9._-]/g, '');
      const { data, error } = await supabase.storage
        .from('photos')
        .download('journal/' + safeName);

      if (error || !data) return res.status(404).json({ error: 'Photo introuvable' });

      const buffer = Buffer.from(await data.arrayBuffer());
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.status(200).send(buffer);
    }

    return res.status(400).json({ error: 'Action inconnue: ' + action });

  } catch (error) {
    console.error('Storage error:', error);
    return res.status(500).json({ error: error.message });
  }
}