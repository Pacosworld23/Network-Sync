#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";
import { importRows, loadWorkspace, matchWorkspace, parseCsv, report, saveWorkspace, withHicapDefaults } from "../lib/workspace.mjs";

function usage() {
  console.log(`network-icp\n\nCommands:\n  init [directory] [--template hicap]\n  onboard --workspace <directory> [--owner name] [--csv file]\n  import <file> --kind company|person [--owner name]\n  set-icp <file>\n  match\n  report\n  mcp\n\nOptions:\n  --workspace <directory>  Workspace directory (default: current directory)`);
}

function option(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

const args = process.argv.slice(2);
const command = args.shift() || "help";
const root = option(args, "--workspace", process.cwd());

if (command === "help" || command === "--help") { usage(); process.exit(0); }
if (command === "mcp") {
  const { serveMcp } = await import("../mcp/server.mjs");
  await serveMcp(root);
  process.exit(0);
}

const workspace = await loadWorkspace(root);
if (command === "init") {
  const target = args[0] ? path.resolve(args[0]) : root;
  const seeded = option(args, "--template") === "hicap";
  const file = await saveWorkspace(seeded ? withHicapDefaults(workspace) : workspace, target);
  console.log(JSON.stringify({ workspace: file, template: seeded ? "hicap" : "empty", icpConfigured: seeded }, null, 2));
} else if (command === "onboard") {
  const seeded = withHicapDefaults(workspace);
  console.log("Hicap network onboarding");
  console.log("Shared ICP loaded. Each teammate only needs to add their own connection export.\n");
  let owner = option(args, "--owner");
  let csvPath = option(args, "--csv");
  if (!owner || !csvPath) {
    const rl = readline.createInterface({ input, output });
    if (!owner) owner = (await rl.question("Your name (for relationship ownership): ")).trim() || "Teammate";
    if (!csvPath) csvPath = (await rl.question("Path to your LinkedIn connections CSV (leave blank to do this later): ")).trim();
    rl.close();
  }
  owner ||= "Teammate";
  let imported = 0;
  if (csvPath) {
    const rows = parseCsv(await readFile(path.resolve(csvPath), "utf8"));
    imported = importRows(seeded, rows, { kind: "person", owner });
  }
  await saveWorkspace(seeded, root);
  console.log(JSON.stringify({ owner, imported, ...report(seeded), next: "Run network-icp match, or connect this workspace to an MCP-capable agent." }, null, 2));
} else if (command === "import") {
  const file = args[0];
  const kind = option(args, "--kind");
  if (!file || !["company", "person"].includes(kind)) throw new Error("Import requires a file and --kind company|person");
  const rows = parseCsv(await readFile(path.resolve(file), "utf8"));
  const imported = importRows(workspace, rows, { kind, owner: option(args, "--owner", "unknown") });
  await saveWorkspace(workspace, root);
  console.log(JSON.stringify({ imported, companies: workspace.companies.length, people: workspace.people.length }, null, 2));
} else if (command === "set-icp") {
  const file = args[0];
  if (!file) throw new Error("set-icp requires a Markdown or text file");
  workspace.icp = await readFile(path.resolve(file), "utf8");
  await saveWorkspace(workspace, root);
  console.log(JSON.stringify({ icpConfigured: true }, null, 2));
} else if (command === "match") {
  if (!workspace.icp.trim()) throw new Error("Set an ICP before matching");
  const matches = matchWorkspace(workspace);
  await saveWorkspace(workspace, root);
  console.log(JSON.stringify({ matches: matches.length, topMatches: matches.slice(0, 10) }, null, 2));
} else if (command === "report") {
  console.log(JSON.stringify(report(workspace), null, 2));
} else throw new Error(`Unknown command: ${command}`);
