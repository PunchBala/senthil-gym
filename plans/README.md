# Workout prescriptions

`weeks-2-4.json` is the complete user-supplied prescription. Its source weeks 1–3 map to app weeks 2–4. The supplied `proposed` status is retained verbatim; the user explicitly requested implementation.

The app embeds this JSON as `suppliedPlan` in `index.html` for synchronous offline startup. Update both together; `test-new-plan.cjs` checks exact equality and all 15 sessions.

The existing top-level backup plan version remains compatible. `trainingBlockId` identifies this block. Before applying it, existing Week 2–4 records receive their old prescription snapshot; new sessions save their current prescription on first edit. Week 1 data is untouched. Snapshots and reps, RIR, shoulder sensation and notes are included in JSON backups. CSV includes actual tracking fields. Alternatives are shown with instructions; record the alternative used in the set note.

Validation: node test-new-plan.cjs; node test-original-plan.cjs; node test-session.cjs; node test-exercise-bests.cjs; node --experimental-vm-modules test-backup.mjs.

Publication includes the Weeks 2-4 update and its tests.
