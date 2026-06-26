# HealthCap Dealflow — MCP Server

`server.mjs` is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives
Claude Desktop (and Claude Code) direct read/write access to the dealflow database.

## Tools exposed

| Tool | Purpose |
|------|---------|
| `list_companies`  | List all deals with key fields (optionally filter by stage / strategy) |
| `get_company`     | Full detail for one company by name (partial match) or id |
| `update_company`  | Update fields on a company |
| `add_note`        | Append a note to a company's timeline |

## Authentication

Uses `AzureCliCredential` — it reads the token from `az login`, so there are **no browser
pop-ups** and **no secrets in this repo**. You must be logged in with the Azure CLI and have
access to the SQL database:

```bash
az login
```

## Running it

It is launched by Claude Desktop, not manually. Add this to your Claude Desktop config
(`%AppData%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "healthcap-dealflow": {
      "command": "node",
      "args": ["<absolute-path>\\dealflow\\mcp\\server.mjs"],
      "env": {
        "AZURE_SQL_SERVER": "hc-server-1.database.windows.net",
        "AZURE_SQL_DATABASE": "hc_dealflow_db",
        "PATH": "C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin;C:\\Program Files\\nodejs;C:\\Windows\\system32"
      }
    }
  }
}
```

The `PATH` entry must include the Azure CLI `wbin` directory so the subprocess can find `az`.

To verify it runs locally:

```bash
AZURE_SQL_SERVER=hc-server-1.database.windows.net AZURE_SQL_DATABASE=hc_dealflow_db node mcp/server.mjs
# should print: HealthCap Dealflow MCP server running
```
