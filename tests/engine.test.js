import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateBoards, comparePlans, createInspectionPlan, evaluateInspection, reportMarkdown, reviewAnalytics, validateAssembly } from '../src/index.js';

const component = (reference, extras = {}) => ({ reference, package: '0603', type: 'passive', padCount: 2, ...extras });
const assembly = (...components) => ({ name: 'board', components: components.length ? components : [component('R1')] });
const goodObservation = (reference = 'R1', extras = {}) => ({ reference, present: true, offsetX: 0, offsetY: 0, rotationDelta: 0, confidence: 1, solderJoints: [{ pad: 1, status: 'good' }, { pad: 2, status: 'good' }], ...extras });

test('validates assembly identities and fitted metadata', () => assert.equal(validateAssembly(assembly()).valid, true));
test('detects duplicate references and missing package/pad count', () => {
  const result = validateAssembly(assembly(component('R1'), { reference: 'R1' })); assert.equal(result.issues.length, 3);
});
test('generates package-aware inspection checks', () => {
  const plan = createInspectionPlan(assembly(component('D1', { type: 'diode', polarized: true }), component('U1', { type: 'ic', pin1Required: true, markingPattern: '^ABC' })));
  assert.ok(plan.components[0].checks.includes('polarity')); assert.ok(plan.components[1].checks.includes('pin1')); assert.ok(plan.components[1].checks.includes('marking'));
});
test('applies default, type, package, and component policy precedence', () => {
  const plan = createInspectionPlan(assembly(component('U1', { type: 'ic', package: 'QFN', inspection: { maxOffset: 0.05 } })), { defaults: { maxOffset: 0.3 }, types: { ic: { maxOffset: 0.2 } }, packages: { QFN: { maxOffset: 0.1 } } });
  assert.equal(plan.components[0].policy.maxOffset, 0.05);
});
test('excludes DNP locations unless explicitly inspected', () => {
  const value = assembly(component('R1', { dnp: true })); assert.equal(createInspectionPlan(value).components.length, 0); assert.equal(createInspectionPlan(value, { inspectDnp: true }).components.length, 1);
});
test('accepts a clean inspection result', () => {
  const result = evaluateInspection(createInspectionPlan(assembly()), [goodObservation()]); assert.equal(result.valid, true); assert.equal(result.summary.firstPassYield, 100);
});
test('reports missing AOI observations as failures', () => {
  const result = evaluateInspection(createInspectionPlan(assembly()), []); assert.equal(result.findings[0].code, 'missing-observation'); assert.equal(result.summary.failedComponents, 1);
});
test('detects absent fitted and present DNP components', () => {
  const fitted = evaluateInspection(createInspectionPlan(assembly()), [goodObservation('R1', { present: false })]); assert.ok(fitted.findings.some((entry) => entry.code === 'missing-component'));
  const dnpPlan = createInspectionPlan(assembly(component('R1', { dnp: true })), { inspectDnp: true }); const dnp = evaluateInspection(dnpPlan, [goodObservation()]); assert.ok(dnp.findings.some((entry) => entry.code === 'unexpected-component'));
});
test('uses vector magnitude for placement offset', () => {
  const result = evaluateInspection(createInspectionPlan(assembly(), { defaults: { maxOffset: 0.1 } }), [goodObservation('R1', { offsetX: 0.08, offsetY: 0.08 })]); assert.ok(result.findings.some((entry) => entry.code === 'placement-offset'));
});
test('normalizes circular rotation error', () => {
  const plan = createInspectionPlan(assembly(), { defaults: { maxRotation: 5 } }); assert.equal(evaluateInspection(plan, [goodObservation('R1', { rotationDelta: 358 })]).valid, true); assert.ok(evaluateInspection(plan, [goodObservation('R1', { rotationDelta: 10 })]).findings.some((entry) => entry.code === 'rotation-offset'));
});
test('checks polarity and pin-one orientation', () => {
  const plan = createInspectionPlan(assembly(component('U1', { polarized: true, pin1Required: true })));
  const codes = evaluateInspection(plan, [goodObservation('U1', { polarityCorrect: false, pin1Correct: false })]).findings.map((entry) => entry.code); assert.ok(codes.includes('polarity-error')); assert.ok(codes.includes('pin1-error'));
});
test('checks marking patterns', () => {
  const plan = createInspectionPlan(assembly(component('U1', { markingPattern: '^STM32' }))); assert.ok(evaluateInspection(plan, [goodObservation('U1', { marking: 'FAKE' })]).findings.some((entry) => entry.code === 'marking-mismatch'));
});
test('reports low-confidence observations', () => {
  const plan = createInspectionPlan(assembly(), { defaults: { minConfidence: 0.9 } }); assert.ok(evaluateInspection(plan, [goodObservation('R1', { confidence: 0.5 })]).findings.some((entry) => entry.code === 'low-confidence'));
});
test('checks defective and uninspected solder joints', () => {
  const result = evaluateInspection(createInspectionPlan(assembly()), [goodObservation('R1', { solderJoints: [{ pad: 1, status: 'bridge' }] })]); const codes = result.findings.map((entry) => entry.code); assert.ok(codes.includes('solder-bridge')); assert.ok(codes.includes('uninspected-joint'));
});
test('elevates critical component defects', () => {
  const plan = createInspectionPlan(assembly(component('U1', { critical: true }))); const result = evaluateInspection(plan, [goodObservation('U1', { present: false })]); assert.equal(result.findings[0].severity, 'critical');
});
test('warns about observations outside the plan', () => {
  const result = evaluateInspection(createInspectionPlan(assembly()), [goodObservation(), goodObservation('X1')]); assert.ok(result.findings.some((entry) => entry.code === 'unknown-reference'));
});
test('strict mode fails warning-only results', () => {
  const result = evaluateInspection(createInspectionPlan(assembly()), [goodObservation('R1', { confidence: 0.1 })], { warningsAsErrors: true }); assert.equal(result.valid, false); assert.equal(result.errors, 0);
});
test('computes review false-call and escape analytics', () => {
  const result = evaluateInspection(createInspectionPlan(assembly()), [goodObservation('R1', { present: false })]); const analytics = reviewAnalytics(result, [{ reference: 'R1', code: 'missing-component', disposition: 'confirmed' }, { reference: 'R1', code: 'missing-component', disposition: 'false-call' }, { reference: 'U1', code: 'polarity-error', disposition: 'missed-defect' }]);
  assert.deepEqual(analytics, { confirmed: 1, falseCalls: 1, escapes: 1, positivePredictiveValue: 50, falseCallRate: 50, escapeCount: 1 });
});
test('aggregates first-pass yield and defects by code', () => {
  const plan = createInspectionPlan(assembly()); const pass = evaluateInspection(plan, [goodObservation()]); const fail = evaluateInspection(plan, [goodObservation('R1', { present: false })]); const aggregate = aggregateBoards([pass, fail]);
  assert.equal(aggregate.firstPassYield, 50); assert.equal(aggregate.defectsPerBoard, 0.5); assert.equal(aggregate.byCode['missing-component'], 1);
});
test('handles empty board aggregates', () => assert.deepEqual(aggregateBoards([]), { boardCount: 0, firstPassYield: null, defectsPerBoard: null, byCode: {} }));
test('compares added, removed, and changed plan entries', () => {
  const before = createInspectionPlan(assembly(component('R1'), component('C1'))); const after = createInspectionPlan(assembly(component('R1', { polarized: true }), component('U1'))); const kinds = comparePlans(before, after).changes.map((entry) => entry.kind).sort(); assert.deepEqual(kinds, ['added', 'changed', 'removed']);
});
test('renders a Markdown AOI report', () => {
  const result = evaluateInspection(createInspectionPlan(assembly()), [goodObservation('R1', { present: false })]); const markdown = reportMarkdown(result); assert.match(markdown, /AOI inspection report/); assert.match(markdown, /missing-component/);
});
