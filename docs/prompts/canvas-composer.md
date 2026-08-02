# Canvas composer — one question → one workspace layout

**Purpose:** classify one operator utterance and compose a workspace of typed, endpoint-bound cells — the model chooses views and arrangement, never data.
**Caller:** `packages/wavex-os-server/src/canvas/composer-t2.ts` (tier b of the composition ladder; tiers a/c are memory and the deterministic stub in `composer.ts`).
**Pool:** A (runs against the operator's own instance).
**Model:** T2 shallow/batch. Closed output vocabulary; the cheapest tier that emits valid JSON.

## Inputs

| Variable | Description | Source |
|---|---|---|
| `{{MESSAGE}}` | The operator's raw utterance | POST `/api/instance/:id/canvas` body |
| `{{BINDINGS}}` | Catalog keys → cell types each supports | `canvas/catalog.ts` `READ_BINDINGS` |
| `{{KNOWN_WORKSPACES}}` | Up to 20 `{signature, label}` pairs | `canvas.json → layouts` |

## Output schema

Raw JSON, no fences. Either a composition:

```json
{"intent":{"kind":"query","topic":"spend","window":"30d"},
 "reply":"plain text under 300 chars",
 "layout":{"title":"...","cells":[{"id":"...","type":"metric","source":{"api":"token-usage","params":{}},"drill":[{"label":"...","prompt":"..."}]}]}}
```

or a reuse of a known workspace: `{"reuse":"cv1:<hash>","reply":"..."}` — the paraphrase-convergence
trick: matching against a closed signature list is a model task with a checkable answer, where
hoping two generations hash identically is not.

## Prompt body

See `buildPrompt()` in `composer-t2.ts` — kept in code rather than duplicated here because the
binding list and cell vocabulary are generated from the catalog and must never drift from it.

## Failure mode + fallback

| Failure | Behaviour |
|---|---|
| No JSON / unparseable | Deterministic stub composition + `"composed deterministically"` warning on the turn |
| Layout invalid | Cells dropped per `validateLayout`; nothing survives → stub |
| `claude` bin missing / timeout | Stub, fast (spawn ENOENT) |
| Budget exhausted | Stub — **stub composition is never budget-gated**; a capped company still gets layouts |
| Propose-intent messages | Never reach T2 at all — mutations are classified and composed deterministically |

The stub is the permanent floor, not scaffolding: composition never fails, it only gets less clever.
