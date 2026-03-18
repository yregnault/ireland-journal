// api/auth.js — Authentification côté serveur
// Les mots de passe sont dans les variables d'environnement Vercel (jamais côté client)

import crypto from 'crypto';

function createToken(role) {
  const secret = process.env.SESSION_SECRET || 'default-secret';
  const payload = JSON.stringify({ role: role, exp: Date.now() + 7 * 24 * 3600 * 1000 }); // 7 jours
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const token = Buffer.from(payload).toString('base64') + '.' + hmac;
  return token;
}

export function verifyToken(token) {
  if (!token) return null;
  try {
    const secret = process.env.SESSION_SECRET || 'default-secret';
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = Buffer.from(parts[0], 'base64').toString();
    const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    if (hmac !== parts[1]) return null;
    const data = JSON.parse(payload);
    if (data.exp < Date.now()) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Mot de passe requis' });

  const adminPw = process.env.ADMIN_PASSWORD;
  const visitorPw = process.env.VISITOR_PASSWORD;

  if (password === adminPw) {
    return res.status(200).json({ role: 'admin', token: createToken('admin') });
  }
  if (password === visitorPw) {
    return res.status(200).json({ role: 'visitor', token: createToken('visitor') });
  }

  return res.status(401).json({ error: 'Mot de passe incorrect' });
}