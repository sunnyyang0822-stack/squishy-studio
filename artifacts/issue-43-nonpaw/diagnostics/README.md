# Historical diagnostics, not final acceptance

These three early runs used a fixture that recomputed normals unconditionally and used a fixed pressure direction. They do not exactly reproduce the current host normal-delta transport or pyramid/world transforms. They are retained as raw diagnostic history, not as evidence that the final product fails or passes. Increasing the iteration budget alone did not solve those cases. The final host-matched fixture and complete surface contact selection must be validated independently.

compact-initial: node --test tests/thick-wax-nonpaw-geometry.test.cjs with THICK_NONPAW_STYLE=donut; exit 1, clay pass/MM and slow fail (3 tests).
40-initial: same command and selection; exit 1, clay pass/MM and slow fail (3 tests).
160-initial: same command with THICK_NONPAW_STYLE=donut and THICK_NONPAW_FEEL=slow-rebound; exit 1 (1 test).

Exact product parameters and final results are recorded separately after validation. No existing assertion was skipped or removed to produce a pass.
