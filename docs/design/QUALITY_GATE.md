# Quality Gate

Every UI change passes this gate before it merges. The gate is what keeps the
surface from drifting back into generic SaaS. Two halves: judgment questions
(answer honestly in the PR) and mechanical gates (run them; they must pass).

## Judgment — answer all six

1. Does this improve understanding of organizational state? If no, delete it.
2. Does this reduce cognitive load? If no, delete it.
3. Is there exactly ONE primary focus on every affected screen?
4. Does it preserve spatial continuity (arrives from somewhere, leaves toward
   somewhere, zoom not page-change)?
5. Does it fit the density budget of its level (L0–L3), or does it belong one
   level deeper?
6. Is every number counted from store state, every status word printed beside
   its color, every empty state honest (operational empties render;
   accumulated records silent at zero; nominal is silence)?

## Mechanical — must all come back EMPTY

**Scope note.** These greps used to cover `src/canvas/` only, which is how a
`position: fixed` modal with its own `overflow: auto` shipped in
`src/wavex-os/pricing/` and went unnoticed through two design passes. They now
cover every surface that renders operator-facing UI. `src/wavex-os/` still
contains the legacy dark wizard, so a few checks stay canvas-scoped where the
legacy idiom is knowingly different — each says so.

```bash
# 1. No ad hoc shadows — elevation tokens only
grep -rn 'boxShadow: "0 ' packages/onboarding-ui/src/canvas/ | grep -v '0 0 0'

# 2. Mono is for verbatim machine output only (the deliverable <pre>)
grep -rn 'font-mono' packages/onboarding-ui/src/canvas/*.tsx | grep -v '<pre' | grep -v 'WorkPanel.tsx'

# 3. No new font stacks
grep -rn 'fontFamily' packages/onboarding-ui/src/canvas/*.tsx | grep -v 'var(--font-mono)'

# 4. No raw hex status colors in components — tokens only
grep -rnE '#(2\5?57A4A|96781F|8E3A38|2A737A|605F96)' packages/onboarding-ui/src/canvas/*.tsx

# 5. The fit law (Rev 10): only the two named records may scroll.
#    Widened past src/canvas/ — this is what the pricing modal evaded.
#    Hits are CANDIDATES, not verdicts: className often sits on a different
#    line from the style, so confirm each element carries cv-thread or
#    cv-record before calling it a violation. -B3 makes that readable.
grep -rn -B3 'overflowY: "auto"\|overflow: "auto"' \
  packages/onboarding-ui/src/canvas/*.tsx packages/onboarding-ui/src/build/**/*.tsx \
  packages/onboarding-ui/src/wavex-os/pricing/*.tsx \
  | grep -v 'cv-thread' | grep -v 'cv-record'

# 6. No new hardcoded caps — rows are budgeted by fitRows(), not by a constant
grep -rn '\.slice(0, *[0-9]' \
  packages/onboarding-ui/src/canvas/*.tsx packages/onboarding-ui/src/build/**/*.tsx \
  | grep -v 'cells.tsx'          # cell renderers cap their OWN data, not layout rows

# 7. No modals. Interaction rule 5 bans them; rule 2 permits exactly one
#    overlay in the product (the Runtime tray), and it is not in these paths.
grep -rn 'position: "fixed", inset: 0\|position: "fixed", top: 0' \
  packages/onboarding-ui/src/build/**/*.tsx packages/onboarding-ui/src/wavex-os/pricing/*.tsx

# 8. Agents are an implementation detail (EXECUTION_MODEL.md): an agent slot
#    may be a grouping key or a tooltip, never rendered copy.
#    SCOPE: the Work lens and the build surface. Desk.tsx and RuntimeTray.tsx
#    are knowingly excluded — they render an agent NODE you walked into, and
#    resolving that is part of the dynamic-orchestrator program, not this gate.
grep -rn 'assigneeSlot' \
  packages/onboarding-ui/src/canvas/WorkPanel.tsx packages/onboarding-ui/src/build/**/*.tsx \
  | grep -v 'categoryOf\|categoryLabel\|title=\|split(' 
```

(Any hit needs an explicit justification in the PR, or the change doesn't ship.)

## Verification

- `pnpm --filter @wavex-os/onboarding-ui build` clean.
- `pnpm --filter @wavex-os/wavex-os-server test` green.
- `WAVEX_E2E_FIXTURE_ENGINE=1 pnpm exec playwright test e2e/canvas.spec.ts
  e2e/work.spec.ts e2e/no-scroll.spec.ts` green — `no-scroll` is the fit law's
  gate and runs down to the 1024×700 floor.
- A screenshot of every affected view, eyeballed against `DESIGN_TOKENS.md`
  and `COMPONENT_RULES.md` before commit.
