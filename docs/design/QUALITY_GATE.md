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

```bash
# 1. No ad hoc shadows — elevation tokens only
grep -rn 'boxShadow: "0 ' packages/onboarding-ui/src/canvas/ | grep -v '0 0 0'

# 2. Mono is for verbatim machine output only (the deliverable <pre>)
grep -rn 'font-mono' packages/onboarding-ui/src/canvas/*.tsx | grep -v '<pre' | grep -v 'WorkPanel.tsx'

# 3. No new font stacks
grep -rn 'fontFamily' packages/onboarding-ui/src/canvas/*.tsx | grep -v 'var(--font-mono)'

# 4. No raw hex status colors in components — tokens only
grep -rnE '#(2\5?57A4A|96781F|8E3A38|2A737A|605F96)' packages/onboarding-ui/src/canvas/*.tsx
```

(Any hit needs an explicit justification in the PR, or the change doesn't ship.)

## Verification

- `pnpm --filter @wavex-os/onboarding-ui build` clean.
- `pnpm --filter @wavex-os/wavex-os-server test` green.
- `WAVEX_E2E_FIXTURE_ENGINE=1 pnpm exec playwright test e2e/canvas.spec.ts
  e2e/work.spec.ts` green.
- A screenshot of every affected view, eyeballed against `DESIGN_TOKENS.md`
  and `COMPONENT_RULES.md` before commit.
