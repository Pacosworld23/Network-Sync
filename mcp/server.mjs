import readline from "node:readline";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { importRows, loadWorkspace, matchWorkspace, parseCsv, report, saveWorkspace, withHicapDefaults } from "../lib/workspace.mjs";

const tools = [
  { name: "workspace_status", description: "Show the current network-to-ICP workspace summary.", inputSchema: { type: "object", properties: {} } },
  { name: "initialize_hicap_workspace", description: "Load the shared Hicap ICP defaults into the local workspace.", inputSchema: { type: "object", properties: {} } },
  { name: "set_icp", description: "Set the workspace ICP from plain text or Markdown.", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "import_csv", description: "Import a company list or a user's LinkedIn connection export into the local workspace.", inputSchema: { type: "object", properties: { path: { type: "string" }, kind: { type: "string", enum: ["company", "person"] }, owner: { type: "string" } }, required: ["path", "kind"] } },
  { name: "match_network", description: "Match imported people to imported companies using the current ICP.", inputSchema: { type: "object", properties: {} } },
  { name: "get_matches", description: "Return the highest-ranked people and warm-path owners for the current ICP.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
];

function response(id, result) { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`); }
function error(id, code, message) { process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`); }

export async function serveMcp(root = process.cwd()) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (!message.id) continue;
    try {
      const workspace = await loadWorkspace(root);
      if (message.method === "initialize") response(message.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "network-to-icp", version: "0.1.0" } });
      else if (message.method === "tools/list") response(message.id, { tools });
      else if (message.method === "tools/call") {
        const name = message.params?.name;
        const args = message.params?.arguments || {};
        let value;
        if (name === "workspace_status") value = report(workspace);
        else if (name === "initialize_hicap_workspace") { withHicapDefaults(workspace); await saveWorkspace(workspace, root); value = { initialized: true, ...report(workspace) }; }
        else if (name === "set_icp") { workspace.icp = String(args.text || ""); await saveWorkspace(workspace, root); value = { icpConfigured: Boolean(workspace.icp.trim()) }; }
        else if (name === "import_csv") { const rows = parseCsv(await readFile(path.resolve(root, String(args.path)), "utf8")); const imported = importRows(workspace, rows, { kind: args.kind, owner: args.owner || "unknown" }); await saveWorkspace(workspace, root); value = { imported, ...report(workspace) }; }
        else if (name === "match_network") { if (!workspace.icp.trim()) throw new Error("Set an ICP before matching"); const matches = matchWorkspace(workspace); await saveWorkspace(workspace, root); value = { matches: matches.length }; }
        else if (name === "get_matches") value = { ...report(workspace), topMatches: workspace.matches.slice(0, Math.max(1, Number(args.limit) || 25)) };
        else throw new Error(`Unknown tool: ${name}`);
        response(message.id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
      } else error(message.id, -32601, `Unknown method: ${message.method}`);
    } catch (toolError) { error(message.id, -32000, toolError.message); }
  }
}
