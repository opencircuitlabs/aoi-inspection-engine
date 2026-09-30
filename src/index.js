const severityRank = { critical: 3, error: 2, warning: 1, info: 0 };
const round = (value, places = 4) => Number(value.toFixed(places));
const finding = (severity, code, reference, message, measured, limit) => ({ severity, code, reference, message, ...(measured !== undefined ? { measured } : {}), ...(limit !== undefined ? { limit } : {}) });
const circularDelta = (value) => { const normalized = ((value % 360) + 360) % 360; return Math.min(normalized, 360 - normalized); };

export function validateAssembly(assembly) {
  const issues = [];
  if (!Array.isArray(assembly?.components)) return { valid: false, issues: [{ path: 'components', message: 'must be an array' }] };
  const references = new Set();
  for (const [index, component] of assembly.components.entries()) {
    if (!component.reference) issues.push({ path: `components.${index}.reference`, message: 'is required' });
    if (references.has(component.reference)) issues.push({ path: `components.${index}.reference`, message: 'is duplicated' });
    references.add(component.reference);
    if (!component.dnp && !component.package) issues.push({ path: `components.${index}.package`, message: 'is required for fitted components' });
    if (!component.dnp && !(component.padCount >= 0)) issues.push({ path: `components.${index}.padCount`, message: 'must be non-negative' });
  }
  return { valid: issues.length === 0, issues };
}

function policyFor(component, rules) {
  const base = { maxOffset: 0.2, maxRotation: 5, minConfidence: 0.8, inspectSolder: true, ...(rules.defaults ?? {}) };
  return { ...base, ...(rules.types?.[component.type] ?? {}), ...(rules.packages?.[component.package] ?? {}), ...(component.inspection ?? {}) };
}

export function createInspectionPlan(assembly, rules = {}) {
  const validation = validateAssembly(assembly);
  if (!validation.valid) throw new Error(`Invalid assembly: ${validation.issues.map((entry) => `${entry.path} ${entry.message}`).join('; ')}`);
  const components = [];
  for (const component of assembly.components) {
    if (component.dnp && rules.inspectDnp !== true) continue;
    const policy = policyFor(component, rules);
    const checks = ['presence', 'offset', 'rotation'];
    if (component.polarized) checks.push('polarity');
    if (component.pin1Required) checks.push('pin1');
    if (policy.inspectSolder && component.padCount > 0) checks.push('solder');
    if (component.markingPattern) checks.push('marking');
    components.push({ reference: component.reference, package: component.package, type: component.type ?? 'unknown', critical: Boolean(component.critical), dnp: Boolean(component.dnp), padCount: component.padCount ?? 0, checks, policy, markingPattern: component.markingPattern ?? null });
  }
  components.sort((left, right) => left.reference.localeCompare(right.reference, undefined, { numeric: true }));
  return { schemaVersion: 1, name: assembly.name ?? 'assembly', components, summary: { componentCount: components.length, checkCount: components.reduce((sum, component) => sum + component.checks.length, 0), solderJointCount: components.reduce((sum, component) => sum + (component.checks.includes('solder') ? component.padCount : 0), 0), criticalCount: components.filter((component) => component.critical).length } };
}

function severity(component, normal = 'error') { return component.critical ? 'critical' : normal; }

export function evaluateInspection(plan, observations, options = {}) {
  const byReference = new Map(observations.map((observation) => [observation.reference, observation]));
  const findings = [];
  const inspected = [];
  for (const component of plan.components) {
    const observation = byReference.get(component.reference);
    if (!observation) { findings.push(finding(severity(component), 'missing-observation', component.reference, 'no AOI observation was supplied')); inspected.push({ reference: component.reference, passed: false, findingCount: 1 }); continue; }
    const componentFindings = [];
    if ((observation.confidence ?? 1) < component.policy.minConfidence) componentFindings.push(finding('warning', 'low-confidence', component.reference, 'observation confidence is below threshold', observation.confidence, component.policy.minConfidence));
    if (component.dnp) {
      if (observation.present) componentFindings.push(finding(severity(component), 'unexpected-component', component.reference, 'component is present on a DNP location'));
    } else if (observation.present === false) componentFindings.push(finding(severity(component), 'missing-component', component.reference, 'fitted component is absent'));
    if (observation.present !== false && !component.dnp) {
      const offset = Math.hypot(observation.offsetX ?? 0, observation.offsetY ?? 0);
      if (offset > component.policy.maxOffset) componentFindings.push(finding(severity(component), 'placement-offset', component.reference, 'placement offset exceeds tolerance', round(offset), component.policy.maxOffset));
      const rotation = circularDelta(observation.rotationDelta ?? 0);
      if (rotation > component.policy.maxRotation) componentFindings.push(finding(severity(component), 'rotation-offset', component.reference, 'rotation error exceeds tolerance', round(rotation), component.policy.maxRotation));
      if (component.checks.includes('polarity') && observation.polarityCorrect !== true) componentFindings.push(finding(severity(component), 'polarity-error', component.reference, 'polarity could not be confirmed correct'));
      if (component.checks.includes('pin1') && observation.pin1Correct !== true) componentFindings.push(finding(severity(component), 'pin1-error', component.reference, 'pin 1 orientation could not be confirmed correct'));
      if (component.checks.includes('marking') && !(new RegExp(component.markingPattern).test(observation.marking ?? ''))) componentFindings.push(finding('warning', 'marking-mismatch', component.reference, 'component marking does not match expected pattern'));
      if (component.checks.includes('solder')) {
        const joints = observation.solderJoints ?? [];
        const jointMap = new Map(joints.map((joint) => [String(joint.pad), joint]));
        for (let pad = 1; pad <= component.padCount; pad += 1) {
          const joint = jointMap.get(String(pad));
          if (!joint) componentFindings.push(finding('warning', 'uninspected-joint', component.reference, `pad ${pad} has no solder observation`));
          else if (joint.status !== 'good') componentFindings.push(finding(severity(component), `solder-${joint.status}`, component.reference, `pad ${pad} solder status is ${joint.status}`, joint.score));
        }
      }
    }
    findings.push(...componentFindings);
    inspected.push({ reference: component.reference, passed: !componentFindings.some((entry) => severityRank[entry.severity] >= severityRank.error), findingCount: componentFindings.length });
    byReference.delete(component.reference);
  }
  for (const reference of byReference.keys()) findings.push(finding('warning', 'unknown-reference', reference, 'observation is not present in the inspection plan'));
  findings.sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || left.reference.localeCompare(right.reference, undefined, { numeric: true }) || left.code.localeCompare(right.code));
  const errors = findings.filter((entry) => severityRank[entry.severity] >= severityRank.error).length;
  const warnings = findings.filter((entry) => entry.severity === 'warning').length;
  return { valid: errors === 0 && (!options.warningsAsErrors || warnings === 0), errors, warnings, findings, inspected, summary: { plannedComponents: plan.components.length, observedComponents: observations.length, passedComponents: inspected.filter((entry) => entry.passed).length, failedComponents: inspected.filter((entry) => !entry.passed).length, firstPassYield: plan.components.length ? round(inspected.filter((entry) => entry.passed).length / plan.components.length * 100) : 100 } };
}

export function reviewAnalytics(result, reviews = []) {
  const findingKeys = new Set(result.findings.map((entry) => `${entry.reference}|${entry.code}`));
  let confirmed = 0; let falseCalls = 0; let escapes = 0;
  for (const review of reviews) {
    const flagged = findingKeys.has(`${review.reference}|${review.code}`);
    if (review.disposition === 'confirmed' && flagged) confirmed += 1;
    if (review.disposition === 'false-call' && flagged) falseCalls += 1;
    if (review.disposition === 'missed-defect' && !flagged) escapes += 1;
  }
  const totalCalls = confirmed + falseCalls;
  return { confirmed, falseCalls, escapes, positivePredictiveValue: totalCalls ? round(confirmed / totalCalls * 100) : null, falseCallRate: totalCalls ? round(falseCalls / totalCalls * 100) : null, escapeCount: escapes };
}

export function aggregateBoards(results) {
  if (!results.length) return { boardCount: 0, firstPassYield: null, defectsPerBoard: null, byCode: {} };
  const passed = results.filter((result) => result.valid).length;
  const findings = results.flatMap((result) => result.findings);
  const byCode = Object.fromEntries([...new Set(findings.map((entry) => entry.code))].sort().map((code) => [code, findings.filter((entry) => entry.code === code).length]));
  return { boardCount: results.length, passedBoards: passed, failedBoards: results.length - passed, firstPassYield: round(passed / results.length * 100), defectsPerBoard: round(findings.filter((entry) => severityRank[entry.severity] >= severityRank.error).length / results.length), byCode };
}

export function comparePlans(before, after) {
  const old = new Map(before.components.map((component) => [component.reference, component])); const changes = [];
  for (const component of after.components) {
    const previous = old.get(component.reference);
    if (!previous) changes.push({ reference: component.reference, kind: 'added' });
    else if (JSON.stringify(previous) !== JSON.stringify(component)) changes.push({ reference: component.reference, kind: 'changed', checksBefore: previous.checks, checksAfter: component.checks });
    old.delete(component.reference);
  }
  for (const reference of old.keys()) changes.push({ reference, kind: 'removed' });
  changes.sort((left, right) => left.reference.localeCompare(right.reference, undefined, { numeric: true }));
  return { changes, changed: changes.length > 0 };
}

export function reportMarkdown(result) {
  const lines = ['# AOI inspection report', '', `Valid: ${result.valid} | Errors: ${result.errors} | Warnings: ${result.warnings} | First-pass yield: ${result.summary.firstPassYield}%`, '', '| Severity | Code | Reference | Message |', '| --- | --- | --- | --- |'];
  for (const entry of result.findings) lines.push(`| ${entry.severity} | ${entry.code} | ${entry.reference} | ${entry.message} |`);
  return `${lines.join('\n')}\n`;
}
