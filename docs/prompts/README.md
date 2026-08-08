# WaveX OS Infrastructure Prompts

A library of operator-facing prompts the wizard, the runtime, and the platform-level launchd jobs use to bootstrap, repair, and operate a fresh WaveX OS instance.

These are **not** customer-facing UI copy. They're the prompts that wavex-os itself uses when it needs an LLM call for a system operation — distinct from the agents' own SKILL files (which are read by agents at heartbeat time).

## Two kinds of prompts in here

| Kind | Audience | Examples |
|---|---|---|
| **Bootstrap prompts** | The wizard, during onboarding | `pillar-1-enrichment.md`, `pillar-2-claude-probe.md`, `swarm-roster-generation.md` |
| **Runtime ops prompts** | Platform-level workers (resource sweep, ignition, error recovery, board escalation) | `ignition-kickoff.md`, `resource-sweep-report.md`, `error-recovery-triage.md`, `board-escalation-classifier.md` |

The Pool C (subscription) prompts that the System Optimizer generates against customer fleets live separately at `docs/prompts/optimizer/` and are not exposed to free-tier instances.

## Conventions

Every prompt file follows this shape:

```markdown
# <prompt name>

**Purpose:** one-line statement of what this prompt produces.
**Caller:** the file/module that invokes this prompt.
**Pool:** A (onboarding) | B (customer fleet) | platform (no Pool — runs locally with deterministic logic + small T1 calls).
**Model:** suggested model + reasoning.

## Inputs

| Variable | Description | Source |
|---|---|---|
| `{{X}}` | ... | ... |

## Output schema

JSON schema or markdown structure the response must match.

## Prompt body

The actual text passed to the model. `{{X}}` substitution happens caller-side.

## Failure mode + fallback

What happens when the LLM call fails or returns malformed output.
```

## Index

- [`pillar-1-enrichment.md`](./pillar-1-enrichment.md) — Pool A, infers 10 company-context fields from operator's raw input
- [`pillar-2-claude-probe.md`](./pillar-2-claude-probe.md) — platform, verifies operator's Claude CLI + plan tier
- [`plan-research.md`](./plan-research.md) — T2, discovers what is newly possible for this company before any plan exists (execution engine phase 1, prototyped in onboarding Phase 3)
- [`swarm-roster-generation.md`](./swarm-roster-generation.md) — Pool A, picks the right C-Suite shape from 165 templates given the pillar answers
- [`ignition-kickoff.md`](./ignition-kickoff.md) — platform, generates the CEO's first directive after activate
- [`resource-sweep-report.md`](./resource-sweep-report.md) — platform, formats the 15min resource sweep snapshot into a Telegram-ready alert when threshold trips
- [`error-recovery-triage.md`](./error-recovery-triage.md) — Pool C (Growth+ tier), classifies fleet errors as same-agent-same-category (adapter drift) vs cross-agent-same-category (harness regression) per capture B
- [`board-escalation-classifier.md`](./board-escalation-classifier.md) — platform, decides whether a Telegram message from the operator is a directive/question/noise
- [`fleet-health-summary.md`](./fleet-health-summary.md) — platform, one-paragraph fleet-health digest for the Meta Mission Control dashboard

## Why these are in the repo

These prompts are part of the product surface. Customer instances pull them from the wavex-os release (either via `npx wavex-os init` or the wizard's bundle). Versioning them in the repo means:

1. Prompt regressions are catchable in PR review.
2. Operators can fork and tune locally.
3. A/B tests on prompt variants can ship as branches.
4. The release manifest in `vendor/wavex-os/onboarding/test/differential-equation-suite/prompts/` is the format ground truth; these are platform-side analogs.
