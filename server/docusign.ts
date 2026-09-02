import jwt from 'jsonwebtoken';

// ── Signer allowlist (extend here as needed) ─────────────────────────────────
export interface Signer { name: string; email: string; }
export const SIGNERS: Signer[] = [
  { name: 'Mårten Steen', email: 'marten.steen@healthcap.eu' },
  { name: 'Kristina Ekberg', email: 'kristina.ekberg@healthcap.eu' },
];

// ── Config (secrets from env; account/base pre-filled from discovery) ────────
const cfg = {
  integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY ?? '',
  userId: process.env.DOCUSIGN_USER_ID ?? '00f121e0-5f59-4298-abac-4290132ba2d2',
  accountId: process.env.DOCUSIGN_ACCOUNT_ID ?? 'af5edf73-1e6c-4e73-9793-94f0956fc405',
  baseUri: process.env.DOCUSIGN_BASE_URI ?? 'https://eu.docusign.net',
  oauthHost: process.env.DOCUSIGN_OAUTH_HOST ?? 'account.docusign.com',
  // App settings store PEM newlines escaped as \n; restore them.
  privateKey: (process.env.DOCUSIGN_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
};

export function docusignConfigured(): boolean {
  return !!(cfg.integrationKey && cfg.privateKey);
}

// ── JWT auth ─────────────────────────────────────────────────────────────────
let accessToken = '';
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (accessToken && now < tokenExpiresAt - 5 * 60 * 1000) return accessToken;
  const assertion = jwt.sign(
    { iss: cfg.integrationKey, sub: cfg.userId, aud: cfg.oauthHost, scope: 'signature impersonation' },
    cfg.privateKey,
    { algorithm: 'RS256', expiresIn: '1h' },
  );
  const res = await fetch(`https://${cfg.oauthHost}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) {
    const body = await res.text();
    // "consent_required" means the impersonated user hasn't granted JWT consent yet.
    throw new Error(`DocuSign token → ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  accessToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000;
  return accessToken;
}

// Diagnostic: perform only the JWT token exchange to confirm the key/consent
// are correct, without needing a document. Never returns the token itself.
export async function docusignHealth(): Promise<{ ok: boolean; accountId?: string; baseUri?: string; error?: string }> {
  if (!docusignConfigured()) return { ok: false, error: 'Not configured: DOCUSIGN_INTEGRATION_KEY and/or DOCUSIGN_PRIVATE_KEY are missing.' };
  try {
    await getAccessToken();
    return { ok: true, accountId: cfg.accountId, baseUri: cfg.baseUri };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Send an envelope ─────────────────────────────────────────────────────────
// The document should contain the invisible anchors {{sig1}} / {{sig2}} so
// DocuSign places each signer's signature block automatically.
export async function sendForSignature(opts: {
  documentBase64: string;
  documentName: string;   // e.g. "Company — Investment Proposal.docx"
  emailSubject: string;
  signers: Signer[];
}): Promise<{ envelopeId: string }> {
  const token = await getAccessToken();
  const envelope = {
    emailSubject: opts.emailSubject,
    documents: [{ documentBase64: opts.documentBase64, name: opts.documentName, fileExtension: 'docx', documentId: '1' }],
    recipients: {
      signers: opts.signers.map((s, i) => ({
        email: s.email,
        name: s.name,
        recipientId: String(i + 1),
        routingOrder: String(i + 1),
        tabs: {
          signHereTabs: [{
            anchorString: `{{sig${i + 1}}}`,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            anchorYOffset: '0',
            anchorIgnoreIfNotPresent: 'false',
          }],
        },
      })),
    },
    status: 'sent',
  };

  const res = await fetch(`${cfg.baseUri}/restapi/v2.1/accounts/${cfg.accountId}/envelopes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  if (!res.ok) throw new Error(`DocuSign envelope → ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const data = await res.json();
  return { envelopeId: data.envelopeId };
}
