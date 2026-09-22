# Dealflow Intelligence Graph (Phase 1)

The competitive-intelligence graph seeded by dealflow. Separate from the dealflow
web app at runtime (not imported by `server/`); lives here for version control.
Design doc: the "Dealflow Intelligence Graph — Design" doc.

## Cosmos DB (provisioned)

| | |
| --- | --- |
| Account | `hc-dealflow-graph` (Cosmos DB, **Gremlin API**, **serverless**) |
| Region | swedencentral (EU residency) |
| Resource group | `Dealflow` |
| Gremlin database | `intel` |
| Graph | `graph` |
| Partition key | `/pk` |
| Gremlin endpoint | `hc-dealflow-graph.gremlin.cosmos.azure.com:443` |
| Gremlin username | `/dbs/intel/colls/graph` |

Serverless = no idle cost; billed per request unit consumed.

## Schema

`schema.ts` is the **locked logical contract** (v1). Cosmos Gremlin is schemaless,
so loaders must honour it in code: create only the defined vertex/edge labels and
properties, use the canonical-ID scheme as each vertex id, set `/pk` to the graph
slice (seed disease canonical id, e.g. `MONDO_0005180`), and stamp the provenance
block (`source`, `url`, `retrievedAt`, `trustTier`) on every element. Any change
bumps `SCHEMA_VERSION`.

## Auth / secrets

The Gremlin password is the Cosmos **account key** — a secret, never committed.
Retrieve for local use with:

```bash
az cosmosdb keys list -n hc-dealflow-graph -g Dealflow --query primaryMasterKey -o tsv
```

For deployed loaders, prefer the App Service managed identity with a Cosmos DB
data-plane role assignment, or store the key as an app setting (`GRAPH_KEY`) —
same pattern as the SQL/DocuSign secrets. Do not put it in this repo.
