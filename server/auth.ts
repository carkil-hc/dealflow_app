import { Router } from 'express';

export const authRouter = Router();

// GET /api/me — returns the logged-in user's display name and email from Easy Auth headers.
// Returns { name: null, email: null } when running locally without Easy Auth.
authRouter.get('/api/me', (req, res) => {
  const principal = req.headers['x-ms-client-principal'];
  if (!principal || typeof principal !== 'string') {
    res.json({ name: null, email: null });
    return;
  }
  try {
    const decoded = JSON.parse(Buffer.from(principal, 'base64').toString('utf8'));
    const claims: Array<{ typ: string; val: string }> = decoded.claims ?? [];
    const find = (...types: string[]) => claims.find(c => types.includes(c.typ))?.val ?? null;
    const name = find(
      'name',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    );
    const email = find(
      'preferred_username',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    );
    res.json({ name, email });
  } catch {
    res.json({ name: null, email: null });
  }
});
