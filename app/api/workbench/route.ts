import { env } from "cloudflare:workers";
import { and, eq, inArray } from "drizzle-orm";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { decisions, records } from "../../../db/schema";
import { ICP, batches, companyKey, csv, decisionRoleFallbacks, domain, questions, relationQuery, summary } from "../../../lib/core";

export const dynamic = "force-dynamic";
const json = (value: unknown, status = 200) => Response.json(value, { status });

async function context() {
  const user = await getChatGPTUser();
  if (!user) throw new Error("Sign in required");
  return { owner: user.userId, db: getDb() };
}

function linkedInProvider() {
  const runtime = env as unknown as Record<string, string>;
  return String(runtime.LINKEDIN_PROVIDER || (runtime.UNIPILE_API_KEY ? "unipile" : "csv")).toLowerCase();
}

function requireLiveLinkedIn() {
  const runtime = env as unknown as Record<string, string>;
  if (linkedInProvider() !== "unipile" || !runtime.UNIPILE_API_KEY) {
    throw new Error("Live LinkedIn sync is disabled. Import each user's LinkedIn connections CSV, or configure LINKEDIN_PROVIDER=unipile with your own server-side key.");
  }
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function inferredCompany(description = "") {
  const parts = description.split(/\s+(?:at|@)\s+/i);
  return parts.length > 1 ? parts.at(-1)?.trim() ?? "" : "";
}

function buyerLikelihood(person: Record<string, any>) {
  const text = String(person.description || person.headline || person.title || "").toLowerCase();
  if (/student|intern|recruit|talent|sales|marketing|investor|advisor/.test(text)) return 0.05;
  let score = 0.1;
  if (/\b(cto|cio|ciso|chief technology|chief information|chief security|chief ai|chief data)\b/.test(text)) score = 0.98;
  else if (/\b(vp|vice president)\b/.test(text)) score = 0.84;
  else if (/\b(head|director)\b/.test(text)) score = 0.7;
  if (/platform|infrastructure|security|governance|finops|cloud economics|machine learning|\bai\b|data/.test(text)) score += 0.12;
  else if (/engineering|technology|technical/.test(text)) score += 0.06;
  return Math.min(score, 1);
}

async function unipile(path: string) {
  const key = (env as unknown as Record<string, string>).UNIPILE_API_KEY;
  if (!key) throw new Error("Unipile is not connected in the Site runtime.");
  const response = await fetch(`https://api.unipile.com/v2${path}`, {
    headers: { "X-API-KEY": key, Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`LinkedIn sync failed (${response.status}).`);
  return body;
}

async function unipilePost(path: string, payload: Record<string, unknown>) {
  const key = (env as unknown as Record<string, string>).UNIPILE_API_KEY;
  if (!key) throw new Error("Unipile is not connected in the Site runtime.");
  const response = await fetch(`https://api.unipile.com/v2${path}`, {
    method: "POST",
    headers: { "X-API-KEY": key, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`LinkedIn search failed (${response.status}).`);
  return body;
}

async function searchBuyerCandidates(linkedIn: Record<string, unknown>, targetData: Record<string, any>) {
  const accountId = String(linkedIn.id || "");
  const networkOwner = String(linkedIn.name || linkedIn.display_name || "Hicap teammate");
  const companySearch = await unipilePost(`/${accountId}/linkedin/search/companies`, { keywords: targetData.name });
  const companies = ((companySearch.data ?? companySearch.items ?? []) as Array<Record<string, any>>);
  const wanted = companyKey(String(targetData.name || ""));
  const company = companies.find((item) => companyKey(String(item.name || item.display_name || "")) === wanted) ?? companies[0];
  if (!company?.id) return [];

  const searches = [
    { keywords: "CTO OR CIO OR CISO OR chief technology OR chief information OR chief security OR VP engineering OR platform engineering OR AI platform OR ML platform OR FinOps", mode: "target-role" },
    { keywords: "engineering OR technology OR platform OR infrastructure OR security OR data OR AI OR operations", mode: "fallback-ranked" },
    { keywords: "", mode: "company-ranked" },
  ];
  const people: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  for (const search of searches) {
    if (people.length >= 3) break;
    const payload: Record<string, unknown> = { current_company: [String(company.id)] };
    if (search.keywords) payload.keywords = search.keywords;
    const response = await unipilePost(`/${accountId}/linkedin/search/people`, payload);
    const candidates = ((response.data ?? response.items ?? []) as Array<Record<string, any>>)
      .map((person) => ({ ...person, buyerLikelihood: buyerLikelihood(person), buyerSearchMode: search.mode, networkOwner, networkOwnerAccountId: accountId }))
      .sort((a, b) => b.buyerLikelihood - a.buyerLikelihood);
    for (const person of candidates) {
      const id = String(person.id || person.provider_id || person.public_identifier || "");
      if (!id || seen.has(id)) continue;
      if (search.mode === "target-role" && person.buyerLikelihood < 0.65) continue;
      people.push(person);
      seen.add(id);
      if (people.length >= 3) break;
    }
  }
  return people;
}

export async function GET() {
  try {
    const { owner, db } = await context();
    const rows = await db.select().from(records).where(eq(records.owner, owner));
    const runtime = env as unknown as Record<string, string>;
    let linkedInAccounts: Array<Record<string, unknown>> = [];
    if (linkedInProvider() === "unipile" && runtime.UNIPILE_API_KEY) {
      try {
        const accounts = await unipile("/accounts?provider=linkedin&status=running");
        linkedInAccounts = ((accounts.data ?? []) as Array<Record<string, unknown>>).map((account) => ({ id: account.id, name: account.name, status: account.status, provider: account.provider }));
      } catch {}
    }
    return json({
      records: rows.map((row) => ({ ...JSON.parse(row.data), id: row.id, kind: row.kind })),
      integrations: {
        openai: Boolean(runtime.OPENAI_API_KEY),
        linkedin: linkedInProvider() === "unipile" && Boolean(runtime.UNIPILE_API_KEY),
        linkedinProvider: linkedInProvider(),
        linkedinAccounts: linkedInAccounts,
      },
    });
  } catch (error) {
    return json({ error: (error as Error).message }, 401);
  }
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return json({ error: "Invalid origin" }, 403);
    const { owner, db } = await context();
    const raw = await request.text();
    if (raw.length > 2_000_000) return json({ error: "Maximum upload is 2 MB" }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    const now = new Date().toISOString();

    async function save(id: string, kind: string, data: Record<string, unknown>) {
      await db.insert(records).values({ id, owner, kind, data: JSON.stringify(data), updated: now }).onConflictDoUpdate({
        target: records.id,
        set: { data: JSON.stringify(data), updated: now },
      });
    }

    if (body.action === "linkedin_link") {
      requireLiveLinkedIn();
      const redirectUri = `${new URL(request.url).origin}/api/linkedin/callback`;
      const expiresOn = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const auth = await unipilePost("/auth/link", {
        providers: "linkedin",
        expires_on: expiresOn,
        redirect_uri: redirectUri,
        config: { global: { wait_initial_sync: true }, linkedin: { allow_methods: ["credentials", "cookies"] } },
      });
      const link = String(auth.link || (auth.data as Record<string, unknown> | undefined)?.link || "");
      if (!link) throw new Error("Unipile did not return an account connection link.");
      return json({ link, message: "Opening secure LinkedIn connection…" });
    }

    if (body.action === "pipeline_stage") {
      const stage = String(body.stage || "");
      if (!["icp", "warm", "buyer", "outbound"].includes(stage)) throw new Error("Invalid pipeline stage");
      const row = (await db.select().from(records).where(and(eq(records.owner, owner), eq(records.id, String(body.id)))))[0];
      if (!row || row.kind !== "account") throw new Error("Account not found");
      await save(row.id, row.kind, { ...JSON.parse(row.data), pipelineStage: stage, pipelineUpdatedAt: now });
      return json({ message: `Moved account to ${stage === "outbound" ? "outbound campaign" : stage}.` });
    }

    if (body.action === "linkedin_sync") {
      requireLiveLinkedIn();
      const accounts = await unipile("/accounts?provider=linkedin&status=running");
      const linkedInAccounts = (accounts.data ?? []) as Array<Record<string, unknown>>;
      const requestedAccountId = typeof body.accountId === "string" ? body.accountId : "";
      const account = requestedAccountId
        ? linkedInAccounts.find((item) => String(item.id) === requestedAccountId)
        : linkedInAccounts.find((item) => item.provider === "linkedin");
      if (!account?.id) throw new Error("No operational LinkedIn account found in Unipile.");

      const cursor = typeof body.cursor === "string" ? body.cursor : "";
      const page = await unipile(`/${account.id}/users/me/relations?${relationQuery(cursor)}`);
      const relations = (page.data ?? []) as Array<Record<string, unknown>>;
      const existingContacts = await db.select().from(records).where(and(eq(records.owner, owner), eq(records.kind, "contact")));
      const existingById = new Map(existingContacts.map((row) => [row.id, JSON.parse(row.data)]));
      const pending = await Promise.all(relations.map(async (relation) => {
        const user = (relation.user ?? {}) as Record<string, unknown>;
        const name = String(user.display_name || [user.first_name, user.last_name].filter(Boolean).join(" ") || "Unknown connection");
        const linkedInId = String(user.id || user.public_identifier || relation.id || name);
        const id = await digest(`${owner}:linkedin:${account.id}:${linkedInId}`);
        const old = existingById.get(id) ?? {};
        const headline = String(user.description || "");
        return { id, data: {
          ...old,
          name,
          company: String(old.company || inferredCompany(headline)),
          title: headline,
          linkedin: String(user.profile_url || ""),
          linkedinId: linkedInId,
          connectionOwner: String(account.name || "LinkedIn owner"),
          connectionOwnerAccountId: String(account.id),
          connectedAt: String(relation.created_at || ""),
          source: "LinkedIn via Unipile",
          syncedAt: now,
        } };
      }));
      for (const batch of batches(pending, 20)) {
        await Promise.all(batch.map((item) => save(item.id, "contact", item.data)));
      }

      const nextCursor = typeof page.next_cursor === "string" ? page.next_cursor : null;
      return json({
        imported: pending.length,
        nextCursor,
        ownerName: String(account.name || "LinkedIn owner"),
        message: nextCursor
          ? `Synced ${pending.length} more LinkedIn connections.`
          : `LinkedIn sync complete. Synced ${pending.length} connections in the final page.`,
      });
    }

    if (body.action === "import") {
      if (!["account", "contact"].includes(String(body.kind)) || typeof body.csv !== "string") throw new Error("Choose account or contact CSV");
      const parsed = csv(body.csv);
      if (parsed.length > 500) throw new Error("Import at most 500 rows at a time");
      let added = 0;
      for (const item of parsed) {
        const kind = String(body.kind);
        const name = kind === "account" ? item.company || item.companyname || item.name || item.domain : [item.firstname, item.lastname].filter(Boolean).join(" ") || item.name;
        if (!name) continue;
        const normalizedDomain = domain(item.domain || item.website || "");
        const company = item.company || item.companyname || "";
        const key = kind === "account" ? normalizedDomain || companyKey(name) : item.url || item.linkedinurl || `${name}:${company}`;
        const id = await digest(`${owner}:${kind}:${key}`);
        const existing = await db.select().from(records).where(and(eq(records.id, id), eq(records.owner, owner)));
        const old = existing[0] ? JSON.parse(existing[0].data) : {};
        const evidence = item.evidence || item.notes || item.description || "";
        await save(id, kind, {
          ...old,
          name,
          domain: normalizedDomain || old.domain || "",
          company,
          title: item.position || item.title || item.jobtitle || old.title || "",
          linkedin: item.url || item.linkedinurl || old.linkedin || "",
          evidence: evidence || old.evidence || "",
          source: item.source || old.source || "User CSV",
          updated: now,
          analysis: undefined,
        });
        added += 1;
      }
      return json({ message: `Imported ${added} records. Matching records merged.` });
    }

    if (body.action === "intro_discover") {
      requireLiveLinkedIn();
      const target = (await db.select().from(records).where(and(eq(records.owner, owner), eq(records.id, String(body.id)))))[0];
      if (!target || target.kind !== "account") throw new Error("Target account not found");
      const targetData = JSON.parse(target.data);
      const priorIntroRows = await db.select().from(records).where(and(eq(records.owner, owner), eq(records.kind, "intro")));
      const priorIntroIds = priorIntroRows.filter((row) => JSON.parse(row.data).accountId === target.id).map((row) => row.id);
      if (priorIntroIds.length) await db.delete(records).where(and(eq(records.owner, owner), inArray(records.id, priorIntroIds)));
      const accounts = await unipile("/accounts?provider=linkedin&status=running");
      const linkedInAccounts = (accounts.data ?? []) as Array<Record<string, unknown>>;
      const linkedIn = linkedInAccounts.find((item) => item.provider === "linkedin");
      if (!linkedIn?.id) throw new Error("No operational LinkedIn account found in Unipile.");

      const searchedNetworks = await Promise.all(linkedInAccounts.map((account) => searchBuyerCandidates(account, targetData)));
      let people: Array<Record<string, any>> = searchedNetworks.flat();
      let fallbackUsed = people.some((person) => person.buyerSearchMode !== "target-role");
      if (!people.length) {
        people = decisionRoleFallbacks(targetData);
        fallbackUsed = true;
      }
      let found = 0;
      let warmFound = 0;
      for (const person of people) {
        const personId = String(person.id || person.provider_id || person.public_identifier || "");
        if (!personId) continue;
        const name = String(person.display_name || person.name || "Unknown LinkedIn member");
        const headline = String(person.description || person.headline || "");
        const specifics = (person.specifics ?? {}) as Record<string, any>;
        const shared = Number(person.shared_relations_count ?? person.shared_connections_count ?? specifics.shared_relations_count ?? specifics.shared_connections_count ?? 0) || 0;
        const distance = String(person.network_distance || person.distance || specifics.network_distance || specifics.distance || "UNKNOWN");
        if (distance === "DISTANCE_1" || shared > 0) warmFound += 1;
        const introId = await digest(`${owner}:intro:${target.id}:${String(person.networkOwnerAccountId || "role")}:${personId}`);
        await save(introId, "intro", {
          name,
          title: headline,
          linkedin: String(person.profile_url || person.public_profile_url || ""),
          linkedinId: personId,
          accountId: target.id,
          accountName: targetData.name,
          accountDomain: targetData.domain,
          sharedRelations: shared,
          networkDistance: distance,
          buyerLikelihood: Number(person.buyerLikelihood || 0),
          buyerSearchMode: String(person.buyerSearchMode || "target-role"),
          synthetic: Boolean(person.synthetic),
          decisionDerived: Boolean(person.decisionDerived),
          source: person.synthetic ? (person.decisionDerived ? "OpenAI Decisions role hypothesis" : "Hicap default buyer-role hypothesis") : "LinkedIn search via Unipile",
          networkOwner: String(person.networkOwner || ""),
          networkOwnerAccountId: String(person.networkOwnerAccountId || ""),
          discoveredAt: now,
        });
        found += 1;
      }
      const namedFound = people.filter((person) => !person.synthetic).length;
      await save(target.id, target.kind, { ...targetData, introScannedAt: now, introPolicyVersion: 5, introOutcome: warmFound ? "warm" : namedFound ? "buyer" : "hypothesis", introScanMessage: warmFound ? `${warmFound} warm paths found` : namedFound ? `${namedFound} named alternative buyers found${fallbackUsed ? " using broader company search" : ""}` : `${found} buyer role hypotheses created`, introNetworksSearched: linkedInAccounts.length });
      return json({ message: `Searched ${linkedInAccounts.length} Hicap network${linkedInAccounts.length === 1 ? "" : "s"} and found ${found} likely buyer path${found === 1 ? "" : "s"} at ${targetData.name}.`, found, fallbackUsed });
    }

    if (body.action === "seed") {
      for (const account of [
        { name: "Gusto", domain: "gusto.com", evidence: "Payroll, benefits and HR software. User supplied reference account.", source: "https://gusto.com" },
        { name: "Cline", domain: "cline.bot", evidence: "Open-source AI coding product. User supplied reference account; Hicap lists Cline among builders using Hicap.", source: "https://cline.bot" },
        { name: "Klay Vision", domain: "klay.vision", evidence: "Music technology company with AI licensing partnerships. User supplied reference account.", source: "https://klay.vision" },
      ]) await save(`${owner}:${account.domain}`, "account", { ...account, reference: true, updated: now });
      return json({ message: "Reference accounts added. No fit or buying intent assumed." });
    }

    const row = (await db.select().from(records).where(and(eq(records.owner, owner), eq(records.id, String(body.id)))))[0];
    if (!row) throw new Error("Record not found");
    const data = JSON.parse(row.data);

    if (body.action === "evidence") {
      if (typeof body.evidence !== "string" || body.evidence.length > 30_000) throw new Error("Evidence must be under 30,000 characters");
      await save(row.id, row.kind, { ...data, evidence: body.evidence, source: String(body.source || "User research").slice(0, 2_000), analysis: undefined, updated: now });
      return json({ message: "Evidence saved. Previous score invalidated." });
    }

    if (body.action === "score") {
      const key = (env as unknown as Record<string, string>).OPENAI_API_KEY;
      if (!key) return json({ error: "OpenAI is not connected in the Site runtime." }, 503);
      const assessmentQuestions = row.kind === "account" ? questions() : [
        { type: "predicate", name: "account_fit", instructions: `${ICP} Is there affirmative evidence that this person's current company is an established Hicap target account? Penalize universities, students, consultants, investors, tiny AI-native builders, and unknown employers. Missing company evidence must produce a low probability.` },
        { type: "predicate", name: "buyer", instructions: `${ICP} Is this person currently an accountable executive or senior leader who owns budget or policy for shared AI infrastructure, security, governance, platform engineering, or AI spend? Students, interns, individual contributors, advisors, investors, sales, marketing, and generic founders are not buyers without explicit ownership evidence. Job-title keywords alone are insufficient.` },
        { type: "predicate", name: "champion", instructions: `${ICP} Is this person currently a senior technical leader with enough organizational influence to champion a shared AI control layer? Require explicit responsibility for platform, infrastructure, security, governance, FinOps, ML platform, or enterprise architecture. Students and individual contributors are not champions merely because they mention AI, data, or engineering.` },
      ];
      const input = JSON.stringify({ name: data.name, company: data.company, domain: data.domain, title: data.title, evidence: data.evidence, source: data.source });
      const fingerprint = await digest(JSON.stringify({ input, questions: assessmentQuestions, model: "gpt-6-luna", version: 2 }));
      const cacheId = `${owner}:${fingerprint}`;
      const cached = (await db.select().from(decisions).where(and(eq(decisions.id, cacheId), eq(decisions.owner, owner))))[0];
      let result: Record<string, any>;
      if (cached) {
        result = JSON.parse(cached.data);
      } else {
        let response: Response | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          response = await fetch("https://api.openai.com/v1/decisions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-6-luna", input, questions: assessmentQuestions }),
            signal: AbortSignal.timeout(25_000),
          });
          if (response.ok || ![429, 500, 502, 503].includes(response.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
        }
        if (!response?.ok) throw new Error(`Decisions request failed (${response?.status}). No score saved.`);
        result = await response.json();
        if (!Array.isArray(result.answers) || !assessmentQuestions.every((question) => result.answers.some((answer: any) => answer.name === question.name && (answer.type === "refusal" || (answer.type === "predicate" && Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1))))) throw new Error("Invalid Decisions response");
        await db.insert(decisions).values({ id: cacheId, owner, data: JSON.stringify(result), created: now }).onConflictDoNothing();
      }
      await save(row.id, row.kind, {
        ...data,
        analysis: {
          ...(row.kind === "account" ? summary(result.answers) : {}),
          answers: result.answers,
          usage: result.usage,
          model: result.model,
          version: 2,
          at: now,
          cached: Boolean(cached),
        },
      });
      return json({ message: cached ? "Restored cached assessment." : "Assessment saved." });
    }

    throw new Error("Unknown action");
  } catch (error) {
    return json({ error: (error as Error).message }, 400);
  }
}
