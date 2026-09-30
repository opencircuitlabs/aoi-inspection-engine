# AOI Inspection Engine

`aoi-inspection-engine` creates package-aware automated optical inspection plans and evaluates board observations consistently. It covers component presence, vector placement offset, circular rotation error, polarity, pin-one orientation, markings, solder joints, confidence, DNP locations, critical parts, and production quality analytics.

## Capabilities

- Deterministic plans from assembly component data
- Layered default, component-type, package, and per-component tolerances
- DNP-aware planning and optional empty-location inspection
- Presence, position, rotation, polarity, pin-one, marking, and solder checks
- Per-pad missing-observation and solder-defect findings
- Critical-component severity escalation
- Confidence thresholds and strict warning policy
- First-pass yield and defect-code aggregation across boards
- Human-review analytics for confirmed calls, false calls, and escapes
- Plan revision comparison
- JSON and Markdown reporting
- Dependency-free Node.js 18+ implementation

## Quick start

```bash
npm install
npm test
node src/cli.js plan examples/assembly.json --rules examples/rules.json --output plan.json
node src/cli.js evaluate plan.json examples/observations.json --output result.json --markdown inspection-report.md
node src/cli.js analytics result.json reviews.json
node src/cli.js aggregate board-results.json
```

After global installation, use `aoi-inspection-engine` instead of `node src/cli.js`.

## Library API

```js
import { createInspectionPlan, evaluateInspection, aggregateBoards } from '@opencircuitlabs/aoi-inspection-engine';

const plan = createInspectionPlan(assembly, {
  defaults: { maxOffset: 0.2, maxRotation: 5, minConfidence: 0.8 },
  packages: { 'QFN-32': { maxOffset: 0.1, maxRotation: 3 } },
  types: { passive: { maxRotation: 8 } }
});

const result = evaluateInspection(plan, observations, { warningsAsErrors: false });
```

Offsets use the assembly model's coordinate unit and are evaluated by vector magnitude. Rotation errors wrap around 360 degrees. Solder observations identify pads by number and use statuses such as `good`, `bridge`, `open`, `insufficient`, or `excess`; any non-`good` status becomes a defect finding.

## Process scope

This engine normalizes AOI decisions and analytics; it does not perform machine vision. Camera calibration, lighting, board warp, library image quality, hidden joints, inspection coverage, review discipline, and measurement-system analysis remain production responsibilities. Validate generated plans on known-good and seeded-defect boards and monitor false-call and escape performance.

## License

MIT. See [LICENSE](LICENSE).
