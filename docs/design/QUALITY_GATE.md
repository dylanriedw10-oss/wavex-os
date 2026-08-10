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

**A gate that errors is not a gate that passes.** Three of the checks below
could not do their job and were silently reporting clean. Each had a live
violation sitting behind it — see the notes on 1, 4 and 5. Re-read the exit
code, not just the absence of output: `grep` exits 0 on a hit, 1 on none, and
**2 on a broken pattern**, and only 1 means the check passed.

```bash
# 1. No ad hoc shadows — elevation tokens only.
#    Was `boxShadow: "0 ` — anchored to values starting with a zero, so it
#    could not see `boxShadow: "inset ...`, and the ONE genuine ad-hoc shadow
#    in the tree (the Medallion bevel) was the one shape it was blind to.
#    Now: any inline value that is not a token and not a 0-0-0 ring.
#    Excludes any TOKEN (`var(--…)`), an explicit `"none"`, and 0-0-0 rings.
grep -rn 'boxShadow: "' packages/onboarding-ui/src/canvas/ \
  | grep -v 'var(--' | grep -v '"none"' | grep -v '"0 0 0'

# 2. Mono is for verbatim machine output only (the deliverable <pre>)
grep -rn 'font-mono' packages/onboarding-ui/src/canvas/*.tsx | grep -v '<pre' | grep -v 'WorkPanel.tsx'

# 3. No new font stacks
grep -rn 'fontFamily' packages/onboarding-ui/src/canvas/*.tsx | grep -v 'var(--font-mono)'

# 4. No raw hex status colors in components — tokens only.
#    The pattern used to read `#(2\5?57A4A|…)`. `\5` is not a valid escape,
#    so grep exited 2 with "invalid escape" and printed nothing — which reads
#    exactly like a pass. This check had therefore NEVER run, and a raw
#    `#605F96` (that is `--mind`, verbatim) had shipped in OrgFlywheel behind
#    it. Case-insensitive, because a lowercase hex is the same colour.
grep -rniE '#(257A4A|96781F|8E3A38|2A737A|605F96)' packages/onboarding-ui/src/canvas/*.tsx

# 5. The fit law (Rev 10): only the two named records may scroll.
#    Widened past src/canvas/ — this is what the pricing modal evaded.
#    Hits are CANDIDATES, not verdicts: className often sits on a different
#    line from the style, so confirm each element carries cv-thread or
#    cv-record before calling it a violation.
#    `grep -B3 … | grep -v cv-record` could never work: the filter is
#    LINE-scoped, so it deletes the className line from the output and leaves
#    the `overflow` line behind it. Both of the tree's two legal scrollers
#    were therefore reported as violations on every run, forever — and a check
#    that always cries wolf is a check people learn to skip.
#    This version scopes the exemption to the BLOCK: for each hit, look back
#    8 lines for the class, and print only if it is genuinely absent.
grep -rn 'overflowY: "auto"\|overflow: "auto"' \
  packages/onboarding-ui/src/canvas/*.tsx packages/onboarding-ui/src/build/**/*.tsx \
  packages/onboarding-ui/src/wavex-os/pricing/*.tsx \
| while IFS=: read -r f l _; do
    start=$(( l > 8 ? l - 8 : 1 ))
    sed -n "${start},${l}p" "$f" | grep -q 'cv-thread\|cv-record' || echo "$f:$l"
  done

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
