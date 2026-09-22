// Dealflow Intelligence Graph — LOCKED SCHEMA (v1)
//
// Cosmos DB Gremlin is schemaless, so this file is the enforced contract: every
// loader must create vertices/edges only with the labels and properties defined
// here, and stamp the provenance block on all of them. Change = bump SCHEMA_VERSION.
//
// Physical:
//   account   hc-dealflow-graph  (serverless, swedencentral, EU residency)
//   database  intel
//   graph     graph
//   partition key path  /pk
//
// Partition strategy: pk = the graph "slice" a node belongs to = the seed disease
// canonical id (e.g. "MONDO_0005180" for the Parkinson's pilot). A slice's nodes
// co-locate, so within-slice traversals are single-partition. Reference nodes shared
// across slices are written once per slice they appear in. Revisit at multi-slice scale.

export const SCHEMA_VERSION = 3; // v3: Person gains recentWorks/leadWorks (KOL leadership ranking)

export const GRAPH = {
  account: 'hc-dealflow-graph',
  gremlinEndpoint: 'hc-dealflow-graph.gremlin.cosmos.azure.com',
  port: 443,
  database: 'intel',
  graph: 'graph',
  partitionKeyPath: '/pk',
  // Gremlin username; password = account key (secret, never stored here — see README).
  username: '/dbs/intel/colls/graph',
} as const;

// Trust tier on every element: a structured API fact vs an LLM-derived inference.
export type TrustTier = 'structured' | 'inferred';

// Provenance block required on EVERY vertex and edge.
export const PROVENANCE_PROPS = ['source', 'url', 'retrievedAt', 'trustTier'] as const;

// ── Vertices ──────────────────────────────────────────────────────────────────
// canonicalId: the scheme the vertex id must use (so the same entity resolves to
// one node). required/optional: domain properties beyond id + pk + provenance.
export interface VertexDef { canonicalId: string; required: string[]; optional: string[]; }

export const VERTICES: Record<string, VertexDef> = {
  DealflowCompany: { canonicalId: 'dealflow company id', required: ['name'], optional: ['modality', 'seedDisease', 'seedTarget'] },
  Company:         { canonicalId: 'normalised company key (LEI when known)', required: ['name'], optional: ['aliases', 'country'] },
  Program:         { canonicalId: 'ChEMBL / DrugBank / UNII, else sponsor+name key', required: ['name'], optional: ['modality', 'mechanismOfAction', 'developmentStage', 'status', 'clinicalDataSummary'] },
  Target:          { canonicalId: 'HGNC / UniProt / ChEMBL', required: ['symbol'], optional: ['name'] },
  Disease:         { canonicalId: 'MONDO / EFO', required: ['name'], optional: ['mesh', 'efo', 'mondo'] },
  Modality:        { canonicalId: 'controlled-vocabulary slug', required: ['name'], optional: [] },
  ClinicalTrial:   { canonicalId: 'NCT number', required: ['title', 'status'], optional: ['phase', 'sponsor', 'enrollment', 'endpoints', 'resultsSummary', 'startDate', 'completionDate'] },
  Financing:       { canonicalId: 'financing id', required: ['roundType'], optional: ['amountRaised', 'currency', 'date', 'preMoneyValuation', 'postMoneyValuation'] },
  Deal:            { canonicalId: 'deal id', required: ['dealType'], optional: ['value', 'currency', 'date'] },
  Investor:        { canonicalId: 'normalised investor key', required: ['name'], optional: ['type'] },
  Person:          { canonicalId: 'ORCID, else OpenAlex author id', required: ['name'], optional: ['orcid', 'openAlexId', 'country', 'recentWorks', 'leadWorks'] },
  Institution:     { canonicalId: 'ROR, else OpenAlex institution id', required: ['name'], optional: ['country', 'type'] },
  Publication:     { canonicalId: 'DOI, else PMID, else OpenAlex work id', required: ['title'], optional: ['year', 'venue', 'findingsSummary'] },
  Patent:          { canonicalId: 'Lens id, else publication number', required: ['title'], optional: ['date'] },
};

// ── Edges ─────────────────────────────────────────────────────────────────────
// Direction is how the relationship is asserted; traversals run either way.
export interface EdgeDef { label: string; from: string; to: string; props?: string[]; }

export const EDGES: EdgeDef[] = [
  { label: 'develops_for',      from: 'DealflowCompany', to: 'Disease' },
  { label: 'competes_with',     from: 'DealflowCompany', to: 'Company' },
  { label: 'develops',          from: 'Company',   to: 'Program' },
  { label: 'has_target',        from: 'Program',   to: 'Target' },
  { label: 'treats',            from: 'Program',   to: 'Disease' },
  { label: 'has_modality',      from: 'Program',   to: 'Modality' },
  { label: 'tested_in',         from: 'Program',   to: 'ClinicalTrial' },
  { label: 'sponsors',          from: 'Company',   to: 'ClinicalTrial' },
  { label: 'associated_with',   from: 'Target',    to: 'Disease' },
  { label: 'raised',            from: 'Company',   to: 'Financing' },
  { label: 'invested_in',       from: 'Investor',  to: 'Financing', props: ['lead'] },
  { label: 'party_to',          from: 'Company',   to: 'Deal', props: ['role'] },          // role: target | licensor
  { label: 'deal_counterparty', from: 'Deal',      to: 'Company', props: ['role'] },       // role: acquirer | licensee
  { label: 'deal_on',           from: 'Deal',      to: 'Target' },
  { label: 'authored',          from: 'Person',    to: 'Publication' },
  { label: 'about',             from: 'Publication', to: 'Disease' },
  { label: 'about_target',      from: 'Publication', to: 'Target' },
  { label: 'affiliated_with',   from: 'Person',    to: 'Institution' },
  { label: 'person_company',    from: 'Person',    to: 'Company', props: ['role'] },        // role: founder | advisor | employee | inventor | investigator
  { label: 'researches',        from: 'Person',    to: 'Disease' },
];
