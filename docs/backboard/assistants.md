# TwinTO assistants (consolidated roster)

TwinTO uses exactly **16** named Backboard assistants (`rosterVersion:
consolidated-16`, manifest schemaVersion 3). The previous 54-specialist roster
was architectural over-fragmentation: responsibilities were consolidated, not
removed. Backboard features (tools, RAG, memory modes, streaming, model
routing, structured outputs) remain fully in use.

## Why 16

Specialist micro-roles made every run look like dozens of agents were
required, even for simple map questions. The consolidated roster keeps clear
ownership (City Copilot, Planning Orchestrator, Final Policy Judge, etc.)
while dynamic intent bundles activate only the specialists needed.

## Canonical keys

See `TWINTO_ASSISTANT_KEYS` in `src/lib/backboard/assistants.ts`.

## Dynamic activation

Intents: `SIMPLE_MAP_NAVIGATION`, `SIMPLE_EXPLANATION`, `NEW_STATION_LOCATION`,
`SCHEDULE_CHANGE`, `EVENT_RESPONSE`, `COMPARE_EXISTING_CANDIDATES`.

Simple navigation activates three assistants. Full planning questions activate
the larger analysis/validation set. Events are added only when relevant.

## Bootstrap and cleanup

```bash
npm run backboard:bootstrap
npm run backboard:smoke
npm run backboard:consolidate-roster              # dry run
npm run backboard:consolidate-roster -- --confirm
```

Do not rename old 54-agent specialists in place: create the clean 16, verify
smoke, then delete obsolete TwinTO and GridTwin assistants with confirmation.
Unknown assistants are never deleted.
