# Approved medium wax save — 2026-11-05

Local branch `codex/issue-41-medium-wax`, prior commit `a591495`, original delivered thin-wax baseline `0406a4ac8e92c078b3da5ccd4299d6acdf9817f2`.
This saves the user-approved candidate locally. No push, PR, merge, repository visibility change or issue closure is included. Remote main has later work; this branch must be integrated and revalidated before publication.

## Formal source checks

Working directory: `D:\squishy-studio\.worktrees\issue-41-medium-wax`.

| Command | Result | Output |
| --- | --- | --- |
| `npm run build:orb` | exit 0 | `save-build-validation.txt` |
| `node --test --test-concurrency=1 tests/medium-wax.test.cjs tests/medium-wax-regions.test.cjs tests/medium-wax-core-flow.test.cjs tests/medium-wax-query-refit.test.cjs tests/detail-state.test.cjs tests/orb-presets.test.cjs tests/orb-deformation.test.cjs tests/thin-wax.test.cjs tests/wax-collision-query.test.cjs tests/wax-feature-normals.test.cjs tests/medium-wax-optimization.test.cjs tests/medium-wax-style-geometry.test.cjs` | 76/76, exit 0 | `save-regression-validation.txt` |
| `node --test tests/medium-wax.test.cjs` | 7/7, exit 0, after final preset assertions | `save-final-preset-validation.txt` |
| `node --test --test-concurrency=1 tests/medium-wax-performance.test.cjs` | 12/12, exit 0 | `save-performance-validation.txt` |
| `node --test --test-concurrency=1 tests/medium-wax-core-browser.test.cjs tests/medium-wax-browser.test.cjs tests/medium-wax-style-mobile.test.cjs` | 14/14, exit 0 | `save-browser-validation.txt` |
| `git diff --cached --check` | exit 0 | reviewed before local commit |

Formal bundle SHA256: `015daedbbb91a3bfae927b272ded99aa3ea7170c48d921fe9a04cbc89497456a`.
The 12 optimized/reference comparisons have maximum position/normal error 0, identical damage state, and zero exhaustive attached/detached geometry violations. CPU diagnostics are observations, not enforced performance thresholds; browser work overlapped the end of this run. Use the dedicated historical A/B recordings below for performance assessment.

The formal browser run covered matched orb-clay thin/medium on desktop/mobile emulation and day/night; rapid thickness switching/disposal; 24 non-paw marshmallow/slow-rebound combinations; both excluded paw combinations; and eight clay shapes on mobile emulation in both themes. `formal-core-browser-summary.json` records the 24 combinations. Two `review-media/formal-*.png` screenshots come from this run. Trusted short-input events, release timing and observed frame intervals are retained in the full log. Some intervals still exceed 16.7ms; passing here certifies tested behavior/geometry, not a frame-rate guarantee. Early orb comparisons overlapped the tail of the CPU equivalence run.

An earlier combined geometry command ran core-cache (18), core-styles (12) and orb-cores (4) successfully, then lost its session before an aggregate result/exit code was captured. Its unedited output is `save-geometry-interrupted.txt`; it is **not** reported as a completed 46-test pass. The remaining performance file was rerun separately above.
An initial unit run failed an outdated supported-core expectation; `save-unit-initial-failure.txt` preserves it. The expectation was updated to the approved scope and the final runs above passed.
Only trailing spaces on two blank lines in that archived failure log were removed for Git whitespace validation; the original remains under `.tmp/issue-41/save-unit-validation.txt`.

## Measurements and historical approved-candidate evidence

Thickness is 0.028 model units versus thin 0.014 (2x), with unchanged 0.004 gap and 0.5-second dwell. Orb uses 96 angular seeds, other non-paw shapes 96 surface seeds, clay paw 128 surface seeds. Measurements in `orb-core-area-measurements.json` and `styles-core-area-measurements.json` are source-surface areas, not display scaling.

`styles-perf-final-representative-ab.json`, `styles-perf-final-broad-ab.json`, `styles-perf-cylinder-repeat-ab.json` retain all measured intervals, including regressions. `styles-perf-measurement-summary.json` summarizes the dedicated no-recording A/B runs. Candidate bundle SHA256 was `a29d917631c9526d2c4623f9bc85cb5febc883c51b77e6bac92ac291e11df49f`; these are historical candidate measurements, not the formal bundle's benchmark.

`candidate-browser-summary.json` records 24 historical candidate combinations: six complex shapes, marshmallow/slow rebound, desktop day/mobile-emulation night. Representative historical candidate recordings are in `review-media/cloud-marshmallow-desktop-day.webm` and `review-media/donut-butter-mobile-night.webm`. The eight `desktop/mobile-day/night-thin/medium.webm` files are historical matched orb-clay comparisons; they do not certify current complex-shape geometry.

No physical phone or Safari verification was performed. No claim of universal 60fps or elimination of all stalls is made. Paw is excluded for marshmallow/slow rebound and from the new complex-shape optimization. Final play retains the existing supported scope; making-preview support does not imply new final-play support.

## Rollback

Revert the local save commit and rebuild with `npm run build:orb`. To disable only the optimization, turn off medium-wax `performanceOptimizations` and the host's slow-rebound `cacheSafety`; retain thickness, seeds, timing and feel parameters. No data migration is required.
