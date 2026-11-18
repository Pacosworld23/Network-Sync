import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const WORKSPACE_DIR = ".network-icp";
export const WORKSPACE_FILE = "workspace.json";
export const HICAP_ICP = `Hicap sells a shared AI control layer: per-key budgets, rate limits, model allow-lists, exportable audit trails, and per-call cost attribution. Prioritize established fintech, insurtech, enterprise SaaS, and vertical software companies serving non-technical industries. Look for companies retrofitting AI across multiple teams or providers, with an accountable owner, a specific unresolved budget, access, audit, or attribution problem, and evidence of buying external infrastructure instead of building everything internally. AI-native builders are a negative prior, not an automatic exclusion. Unknown is not false. Never infer purchase intent from industry alone.`;

export function workspacePath(root = process.cwd()) {
  return path.join(root, WORKSPACE_DIR, WORKSPACE_FILE);
}

export function emptyWorkspace() {
  return { version: 1, icp: "", companies: [], people: [], matches: [] };
}

export function withHicapDefaults(workspace) {
  if (!workspace.icp.trim()) workspace.icp = HICAP_ICP;
  workspace.context = workspace.context || "Hicap GTM network-to-ICP workspace";
  return workspace;
}

export async function loadWorkspace(root = process.cwd()) {
  try {
    return JSON.parse(await readFile(workspacePath(root), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return emptyWorkspace();
    throw error;
  }
}

export async function saveWorkspace(workspace, root = process.cwd()) {
  const file = workspacePath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  return file;
}

export function parseCsv(input) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  input = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Unclosed quote in CSV");
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headerIndex = rows.findIndex((candidate) => candidate.some((value) => /^(company|company name|name|first name|domain)$/i.test(value)));
  if (headerIndex < 0) throw new Error("CSV needs Company, Name, First Name, or Domain headers.");
  const headers = rows[headerIndex].map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return rows.slice(headerIndex + 1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

export function normalizeDomain(value = "") {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch { return ""; }
}

export function companyKey(value = "") {
  return value.toLowerCase().replace(/\b(inc|llc|ltd|limited|corp|corporation)\b/g, "").replace(/[^a-z0-9]/g, "");
}

function idFor(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function field(row, ...names) {
  return names.map((name) => row[name] || "").find(Boolean) || "";
}

export function importRows(workspace, rows, { kind, owner = "unknown" }) {
  let imported = 0;
  for (const row of rows) {
    if (kind === "company") {
      const name = field(row, "company", "companyname", "name", "domain");
      if (!name) continue;
      const domain = normalizeDomain(field(row, "domain", "website", "url"));
      const key = domain || companyKey(name);
      const id = idFor("company", key);
      const existing = workspace.companies.find((item) => item.id === id);
      const next = { ...(existing || {}), id, name, domain, description: field(row, "description", "evidence", "notes"), source: field(row, "source") || "CSV", updatedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, next);
      else workspace.companies.push(next);
    } else {
      const name = field(row, "name") || [field(row, "firstname"), field(row, "lastname")].filter(Boolean).join(" ");
      if (!name) continue;
      const linkedin = field(row, "url", "linkedin", "linkedinurl", "profileurl");
      const company = field(row, "company", "companyname");
      const id = idFor("person", linkedin || `${name}:${company}`.toLowerCase());
      const existing = workspace.people.find((item) => item.id === id);
      const owners = Array.from(new Set([...(existing?.owners || []), owner]));
      const next = { ...(existing || {}), id, name, company, domain: normalizeDomain(field(row, "domain")), title: field(row, "position", "title", "jobtitle"), linkedin, owners, source: field(row, "source") || "LinkedIn export", updatedAt: new Date().toISOString() };
      if (existing) Object.assign(existing, next);
      else workspace.people.push(next);
    }
    imported += 1;
  }
  return imported;
}

export function matchWorkspace(workspace) {
  const tokens = new Set((workspace.icp.toLowerCase().match(/[a-z0-9]{4,}/g) || []).filter((token) => !new Set(["with", "that", "this", "from", "into", "have", "your", "they", "their", "will", "must", "company", "companies"]).has(token)));
  const matches = [];
  for (const person of workspace.people) {
    const company = workspace.companies.find((candidate) => (person.domain && candidate.domain === person.domain) || companyKey(person.company) === companyKey(candidate.name));
    if (!company) continue;
    const text = `${company.name} ${company.description} ${person.title}`.toLowerCase();
    const overlap = [...tokens].filter((token) => text.includes(token)).length;
    const roleBoost = /cto|cio|ciso|chief|vp|vice president|head|director|platform|security|infrastructure|finops|ai|ml/i.test(person.title) ? 0.2 : 0;
    const score = Math.min(0.99, Math.max(0.05, 0.35 + overlap * 0.08 + roleBoost));
    matches.push({ personId: person.id, person: person.name, companyId: company.id, company: company.name, title: person.title, owners: person.owners, score: Math.round(score * 100) / 100, evidence: overlap ? `${overlap} ICP terms matched in company/profile text` : "Company match only" });
  }
  workspace.matches = matches.sort((a, b) => b.score - a.score);
  return workspace.matches;
}

export function report(workspace) {
  return { companies: workspace.companies.length, people: workspace.people.length, matches: workspace.matches.length, topMatches: workspace.matches.slice(0, 25), icpConfigured: Boolean(workspace.icp.trim()) };
}
