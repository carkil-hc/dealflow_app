// Idempotent upsert helper for the Cosmos Gremlin graph. Enforces the locked
// schema (graph/schema.ts): only defined labels, required props present, and the
// provenance block stamped on every vertex and edge.
//
// Auth: Cosmos Gremlin uses the account key as the SASL password (username
// /dbs/intel/colls/graph). Provide it as GRAPH_KEY (never commit it). See README.
import gremlin from 'gremlin';
import { GRAPH, VERTICES, EDGES, PROVENANCE_PROPS } from './schema.js';

type Props = Record<string, unknown>;
const KEY_RE = /^[A-Za-z0-9_]+$/;              // property keys are inlined, so validate them
const coerce = (v: unknown) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

// Build a `.property('k', pN)` chain with bound values; skips empty values.
function propChain(props: Props) {
  const parts: string[] = [];
  const bindings: Record<string, unknown> = {};
  let i = 0;
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === '') continue;
    if (!KEY_RE.test(k)) throw new Error(`illegal property key: ${k}`);
    const bk = 'p' + i++;
    parts.push(`.property('${k}', ${bk})`);
    bindings[bk] = coerce(v);
  }
  return { chain: parts.join(''), bindings };
}

function requireProvenance(props: Props, where: string) {
  for (const p of PROVENANCE_PROPS) {
    if (props[p] == null || props[p] === '') throw new Error(`${where}: missing provenance '${p}'`);
  }
}

export class GraphClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private client: any) {}
  async close() { await this.client.close(); }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(query: string, bindings: Record<string, unknown> = {}): Promise<any[]> {
    const rs = await this.client.submit(query, bindings);
    return rs.toArray();
  }

  // Create the vertex if absent (by canonical id + partition key), then set props.
  async upsertVertex(label: string, id: string, pk: string, props: Props): Promise<string> {
    const def = VERTICES[label];
    if (!def) throw new Error(`unknown vertex label: ${label}`);
    if (!id || !pk) throw new Error(`${label}: id and pk are required`);
    for (const r of def.required) if (props[r] == null || props[r] === '') throw new Error(`${label} ${id}: missing required '${r}'`);
    requireProvenance(props, `${label} ${id}`);
    const { chain, bindings } = propChain(props);
    const q = `g.V(vid).fold().coalesce(unfold(), addV('${label}').property('id', vid).property('pk', pk))${chain}`;
    await this.client.submit(q, { vid: id, pk, ...bindings });
    return id;
  }

  // Create the edge if absent between two existing vertices, then set props.
  async upsertEdge(label: string, fromId: string, toId: string, props: Props = {}): Promise<void> {
    if (!EDGES.some(e => e.label === label)) throw new Error(`unknown edge label: ${label}`);
    requireProvenance(props, `edge ${label}`);
    const { chain, bindings } = propChain(props);
    const q = `g.V(fromId).coalesce(`
      + `__.outE('${label}').where(__.inV().has('id', toId)),`
      + `__.addE('${label}').to(__.V(toId)))${chain}`;
    await this.client.submit(q, { fromId, toId, ...bindings });
  }

  async count(): Promise<{ vertices: number; edges: number }> {
    const [v] = await this.run('g.V().count()');
    const [e] = await this.run('g.E().count()');
    return { vertices: v, edges: e };
  }
}

export function openGraph(): GraphClient {
  const key = process.env.GRAPH_KEY;
  if (!key) throw new Error('GRAPH_KEY not set (Cosmos account key — see graph/README.md)');
  const authenticator = new gremlin.driver.auth.PlainTextSaslAuthenticator(GRAPH.username, key);
  const client = new gremlin.driver.Client(`wss://${GRAPH.gremlinEndpoint}:${GRAPH.port}/gremlin`, {
    authenticator,
    traversalsource: 'g',
    rejectUnauthorized: true,
    mimeType: 'application/vnd.gremlin-v2.0+json', // Cosmos requires GraphSON 2.0
  });
  return new GraphClient(client);
}
