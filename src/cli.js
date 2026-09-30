#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { aggregateBoards, comparePlans, createInspectionPlan, evaluateInspection, reportMarkdown, reviewAnalytics } from './index.js';
const raw = process.argv.slice(2); const [command, first, second] = raw; const option = (name) => { const index = raw.indexOf(`--${name}`); return index < 0 ? undefined : raw[index + 1]; }; const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const emit = async (value) => { const text = `${JSON.stringify(value, null, 2)}\n`; if (option('output')) await writeFile(option('output'), text); else process.stdout.write(text); };
try {
  if (!command || command === 'help') process.stdout.write('Usage: aoi-inspection-engine <plan assembly.json|evaluate plan.json observations.json|analytics result.json reviews.json|aggregate results.json|compare before.json after.json> [--rules file] [--output file] [--markdown file] [--strict]\n');
  else if (command === 'plan' && first) await emit(createInspectionPlan(await load(first), option('rules') ? await load(option('rules')) : {}));
  else if (command === 'evaluate' && first && second) { const result = evaluateInspection(await load(first), await load(second), { warningsAsErrors: raw.includes('--strict') }); await emit(result); if (option('markdown')) await writeFile(option('markdown'), reportMarkdown(result)); if (!result.valid) process.exitCode = 2; }
  else if (command === 'analytics' && first && second) await emit(reviewAnalytics(await load(first), await load(second)));
  else if (command === 'aggregate' && first) await emit(aggregateBoards(await load(first)));
  else if (command === 'compare' && first && second) await emit(comparePlans(await load(first), await load(second)));
  else throw new Error('invalid command or arguments');
} catch (error) { process.stderr.write(`aoi-inspection-engine: ${error.message}\n`); process.exitCode = 1; }
