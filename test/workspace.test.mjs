import test from "node:test";
import assert from "node:assert/strict";
import { HICAP_ICP, importRows, matchWorkspace, parseCsv, emptyWorkspace, withHicapDefaults } from "../lib/workspace.mjs";

test("Hicap defaults initialize an empty workspace", () => {
  const workspace = withHicapDefaults(emptyWorkspace());
  assert.equal(workspace.icp, HICAP_ICP);
  assert.equal(workspace.context, "Hicap GTM network-to-ICP workspace");
});

test("imports LinkedIn exports from a preamble and preserves owners", () => {
  const workspace = emptyWorkspace();
  const rows = parseCsv("Exported data\nFirst Name,Last Name,Company,Position,URL\nAda,Lovelace,Acme,VP Engineering,https://linkedin.com/in/ada");
  assert.equal(importRows(workspace, rows, { kind: "person", owner: "Patricio" }), 1);
  assert.deepEqual(workspace.people[0].owners, ["Patricio"]);
});

test("matches multiple teammates to the same ICP company", () => {
  const workspace = emptyWorkspace();
  workspace.icp = "fintech AI platform security infrastructure";
  importRows(workspace, [{ company: "Acme", domain: "acme.com", description: "Fintech AI platform" }], { kind: "company" });
  importRows(workspace, [{ name: "Ada", company: "Acme", title: "VP Engineering", url: "https://linkedin.com/in/ada" }], { kind: "person", owner: "Patricio" });
  importRows(workspace, [{ name: "Grace", company: "Acme", title: "CISO", url: "https://linkedin.com/in/grace" }], { kind: "person", owner: "Teammate" });
  const matches = matchWorkspace(workspace);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => match.owners), [["Patricio"], ["Teammate"]]);
});
