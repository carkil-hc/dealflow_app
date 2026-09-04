import { DefaultAzureCredential } from '@azure/identity';

// Reuse the App Service managed identity (same one used for SQL) to get a
// Microsoft Graph app-only token. Requires the identity to have the Graph
// Sites.Selected permission and write access granted to the target site.
const credential = new DefaultAzureCredential();
let token = '';
let tokenExpiresAt = 0;

async function graphToken(): Promise<string> {
  const now = Date.now();
  if (token && now < tokenExpiresAt - 5 * 60 * 1000) return token;
  const t = await credential.getToken('https://graph.microsoft.com/.default');
  token = t.token;
  tokenExpiresAt = t.expiresOnTimestamp ?? now + 55 * 60 * 1000;
  return token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function graph(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await graphToken()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${init.method ?? 'GET'} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

// Graph "encode sharing URL" scheme (u! + base64url, no padding).
function encodeShareUrl(url: string): string {
  const b64 = Buffer.from(url).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
  return `u!${b64}`;
}

// SharePoint/OneDrive disallow these characters in item names.
function safeName(name: string): string {
  return name.replace(/["*:<>?/\\|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
}

// Resolve the target folder to its drive + driveItem id.
//
// Preferred path (least-privilege): the app is granted item-scoped access
// (ListItems.SelectedOperations.Selected) to one folder, identified by
// site/list/item ids. We map that list item to its driveItem so uploads use the
// drive API. Falls back to a sharing URL when the ids aren't configured.
async function resolveParentFolder(): Promise<{ driveId: string; itemId: string }> {
  const siteId = process.env.SHAREPOINT_SITE_ID;
  const listId = process.env.SHAREPOINT_LIST_ID;
  const itemId = process.env.SHAREPOINT_ITEM_ID;
  if (siteId && listId && itemId) {
    const li = await graph(`/sites/${siteId}/lists/${listId}/items/${itemId}?$expand=driveItem`);
    const di = li?.driveItem;
    const driveId = di?.parentReference?.driveId;
    if (!driveId || !di?.id) throw new Error('Could not map the granted list item to a driveItem');
    return { driveId, itemId: di.id };
  }
  const shareUrl = process.env.SHAREPOINT_PROPOSALS_FOLDER_URL;
  if (!shareUrl) throw new Error('SharePoint not configured (set SHAREPOINT_SITE_ID/LIST_ID/ITEM_ID)');
  const item = await graph(`/shares/${encodeShareUrl(shareUrl)}/driveItem?$select=id,parentReference`);
  const driveId = item?.parentReference?.driveId;
  if (!driveId || !item?.id) throw new Error('Could not resolve the SharePoint folder from the configured share URL');
  return { driveId, itemId: item.id };
}

// Find or create a subfolder by name under a parent folder.
async function ensureSubfolder(driveId: string, parentId: string, name: string): Promise<string> {
  const kids = await graph(`/drives/${driveId}/items/${parentId}/children?$select=id,name,folder&$top=999`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (kids?.value ?? []).find((c: any) => c.folder && c.name === name);
  if (existing) return existing.id;
  const created = await graph(`/drives/${driveId}/items/${parentId}/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });
  return created.id;
}

// Upload (or replace) a file into a folder; returns its SharePoint web URL.
async function uploadFile(driveId: string, folderId: string, fileName: string, bytes: Buffer, contentType: string): Promise<string> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`,
    { method: 'PUT', headers: { Authorization: `Bearer ${await graphToken()}`, 'Content-Type': contentType }, body: new Uint8Array(bytes) },
  );
  if (!res.ok) throw new Error(`Graph upload → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const item = await res.json();
  return item.webUrl as string;
}

export function sharePointConfigured(): boolean {
  const { SHAREPOINT_SITE_ID, SHAREPOINT_LIST_ID, SHAREPOINT_ITEM_ID, SHAREPOINT_PROPOSALS_FOLDER_URL } = process.env;
  return !!((SHAREPOINT_SITE_ID && SHAREPOINT_LIST_ID && SHAREPOINT_ITEM_ID) || SHAREPOINT_PROPOSALS_FOLDER_URL);
}

// Fetch the most recent "… Investment Proposal.docx" for a company from its
// SharePoint subfolder. Returns null if none is found.
export async function getProposalFromSharePoint(companyName: string): Promise<{ name: string; base64: string } | null> {
  if (!sharePointConfigured()) throw new Error('SharePoint not configured');
  const { driveId, itemId } = await resolveParentFolder();
  const kids = await graph(`/drives/${driveId}/items/${itemId}/children?$select=id,name,folder&$top=999`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const folder = (kids?.value ?? []).find((c: any) => c.folder && c.name === safeName(companyName));
  if (!folder) return null;
  const files = await graph(`/drives/${driveId}/items/${folder.id}/children?$select=id,name,file,lastModifiedDateTime&$top=999`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proposals = (files?.value ?? []).filter((f: any) => f.file && /Investment Proposal.*\.docx$/i.test(f.name));
  if (proposals.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proposals.sort((a: any, b: any) => String(b.lastModifiedDateTime).localeCompare(String(a.lastModifiedDateTime)));
  const item = proposals[0];
  const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${item.id}/content`, {
    headers: { Authorization: `Bearer ${await graphToken()}` },
  });
  if (!res.ok) throw new Error(`Graph download → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { name: item.name, base64: buf.toString('base64') };
}

// Save a generated document to `<configured folder>/<company>/<fileName>` in
// SharePoint. Returns the web URL. Throws on any Graph/permission error.
export async function saveToSharePoint(companyName: string, fileName: string, base64: string, contentType: string): Promise<string> {
  if (!sharePointConfigured()) throw new Error('SharePoint not configured (SHAREPOINT_SITE_ID/LIST_ID/ITEM_ID unset)');
  const { driveId, itemId } = await resolveParentFolder();
  const companyFolderId = await ensureSubfolder(driveId, itemId, safeName(companyName));
  return uploadFile(driveId, companyFolderId, fileName, Buffer.from(base64, 'base64'), contentType);
}
