import jwt from 'jsonwebtoken';

// ── Signer allowlist (extend here as needed) ─────────────────────────────────
export interface Signer { name: string; email: string; }
export const SIGNERS: Signer[] = [
  { name: 'Mårten Steen', email: 'marten.steen@healthcap.eu' },
  { name: 'Kristina Ekberg', email: 'kristina.ekberg@healthcap.eu' },
  { name: 'Carl Kilander', email: 'carl.kilander@healthcap.eu' },
  { name: 'Björn Odlander', email: 'bjorn.odlander@healthcap.eu' },
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
// are correct for the current (demo/production) config. Never returns the token.
export async function docusignHealth(): Promise<{ ok: boolean; accountId?: string; baseUri?: string; oauthHost?: string; error?: string }> {
  if (!docusignConfigured()) return { ok: false, error: 'Not configured (integration key and/or private key missing).' };
  try {
    await getAccessToken();
    return { ok: true, accountId: cfg.accountId, baseUri: cfg.baseUri, oauthHost: cfg.oauthHost };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), oauthHost: cfg.oauthHost };
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
}): Promise<{ envelopeId: string; tabDiagnostics: { name: string; signHereTabs: number }[] }> {
  const token = await getAccessToken();
  const envelope = {
    emailSubject: opts.emailSubject,
    documents: [{ documentBase64: opts.documentBase64, name: opts.documentName, fileExtension: 'docx', documentId: '1' }],
    recipients: {
      signers: opts.signers.map((s, i) => ({
        email: s.email,
        name: s.name,
        recipientId: String(i + 1),
        // Same routing order for all signers → they can sign in parallel and
        // every signer gets an immediate "action required" (sequential order
        // would make later signers wait, showing no action yet).
        routingOrder: '1',
        tabs: {
          signHereTabs: [{
            anchorString: `{{sig${i + 1}}}`,
            anchorUnits: 'pixels',
            anchorXOffset: '0',
            // Anchor sits at the start of the signature underline; raise the tab
            // so the signature rests on the line instead of dropping below it.
            anchorYOffset: '-22',
            // Fail loudly (send errors) if the anchor is not found, rather than
            // silently producing a signature-less envelope. The readback below
            // also reports the placed-tab count per signer.
            anchorIgnoreIfNotPresent: 'false',
            anchorCaseSensitive: 'false',
            anchorMatchWholeWord: 'false',
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
  const envelopeId = data.envelopeId as string;

  // Self-diagnose: read back the recipients' tabs so we can confirm each signer
  // actually got a signature field (i.e. the anchors were found).
  const tabDiagnostics: { name: string; signHereTabs: number }[] = [];
  try {
    const chk = await fetch(
      `${cfg.baseUri}/restapi/v2.1/accounts/${cfg.accountId}/envelopes/${envelopeId}/recipients?include_tabs=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (chk.ok) {
      const rc = await chk.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const s of (rc.signers ?? []) as any[]) {
        const n = s?.tabs?.signHereTabs?.length ?? 0;
        tabDiagnostics.push({ name: s.name, signHereTabs: n });
      }
      const missing = tabDiagnostics.filter(t => t.signHereTabs === 0).map(t => t.name);
      if (missing.length) {
        console.warn(`[docusign] envelope ${envelopeId}: NO signature field placed for ${missing.join(', ')} — anchor "{{sigN}}" not found in the document.`);
      }
    }
  } catch (e) {
    console.warn('[docusign] tab verification failed:', e instanceof Error ? e.message : e);
  }

  return { envelopeId, tabDiagnostics };
}
