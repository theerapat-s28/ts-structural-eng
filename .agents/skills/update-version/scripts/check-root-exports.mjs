#!/usr/bin/env node
// Lists every name (values and types) exported by a module barrel under src/
// that the package root barrel src/index.ts does not re-export.
//
// Run from the repository root:
//   node .agents/skills/update-version/scripts/check-root-exports.mjs
//
// Exit codes: 0 root re-exports everything · 1 names missing · 2 setup error

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const configPath = path.join(root, "tsconfig.json");
if (!existsSync(configPath) || !existsSync(path.join(root, "src/index.ts"))) {
  console.error("Run this from the repository root (tsconfig.json and src/index.ts not found).");
  process.exit(2);
}

const { config } = ts.readConfigFile(configPath, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);

// Every top-level module barrel: src/<module>/index.ts
const barrels = readdirSync(path.join(root, "src"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(root, "src", entry.name, "index.ts"))
  .filter((file) => existsSync(file));
const rootBarrel = path.join(root, "src/index.ts");

const program = ts.createProgram([rootBarrel, ...barrels], parsed.options);
const checker = program.getTypeChecker();

function exportNames(file) {
  const source = program.getSourceFile(file);
  const symbol = source && checker.getSymbolAtLocation(source);
  return new Set(symbol ? checker.getExportsOfModule(symbol).map((s) => s.getName()) : []);
}

const rootNames = exportNames(rootBarrel);
let missingCount = 0;
for (const barrel of barrels) {
  const missing = [...exportNames(barrel)].filter((name) => !rootNames.has(name)).sort();
  const label = path.relative(root, barrel);
  if (missing.length === 0) {
    console.log(`ok       ${label}`);
  } else {
    missingCount += missing.length;
    console.log(`missing  ${label}: ${missing.join(", ")}`);
  }
}

if (missingCount > 0) {
  console.log(`\n${missingCount} export(s) not re-exported from src/index.ts.`);
  process.exit(1);
}
console.log("\nsrc/index.ts re-exports every module barrel export.");
