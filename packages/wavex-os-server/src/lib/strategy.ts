/** Strategy — the operator's STATED goal, and the only source of the
 *  self-prompting loop's fixed half.
 *
 *  Why this file exists at all: the loop is `fixed goal + fixed KPIs +
 *  revisable checklist`, and both fixed anchors used to be fabricated. The
 *  goal came from `GOALS_BY_STAGE` — a revenue BRACKET chip mapped to
 *  hardcoded numbers, always MRR, always 90 days. That invented figure then
 *  became the card the operator approved, the organization's own
 *  current-state line, a headline rendered where measurements go, the seeded
 *  work goal, and the fleet's founding directive. Two companies eight times
 *  apart in size picked the same bracket and received identical marching
 *  orders — and the loop's own benchmark was that number, so every revision
 *  it made was computed against something nobody chose.
 *
 *  A goal is intent. Nothing can infer it and nothing may invent it. This
 *  module is where the operator's own answer lives, and `stated` is the
 *  honesty bit that keeps a fallback distinguishable from a decision
 *  everywhere it renders.
 *
 *  Stored beside the other onboarding artifacts (`strategy.json`, atomic
 *  tmp+rename — the work.json discipline) rather than inside
 *  pillar_responses, because the pillar schema is vendored and frozen and
 *  this is a wavex-layer concern. */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { getOnboardingDir } from "../state-bridge.js";

export interface StatedGoal {
  /** The operator's own success metric. Canonical id — never defaulted to
   *  revenue, because a dev-tools company measuring weekly active repos and
   *  a marketplace measuring GMV are not both MRR businesses. */
  kpiId: string;
  /** Where the number is today. Zero is legitimate for a pre-product or
   *  informal company; it is NOT a stand-in for "unknown". */
  current: number;
  /** Where it needs to be — intent, with no inferable form now or ever. */
  target: number;
  /** The horizon the operator chose, not a constant 90. */
  days: number;
}

export interface Strategy {
  v: 1;
  goal: StatedGoal;
  /** Up to two more numbers the operator watches. Optional by design. */
  secondaryKpis: string[];
  /** The operator's OWN bottleneck, which is not what a website shows.
   *  Prefilled from the enrichment hypothesis, corrected by the person who
   *  actually knows. */
  bottleneck: string | null;
  /** False only where the operator explicitly declined to state a value and
   *  a fallback stood in. Carried into the goal so a synthesized number can
   *  never be mistaken for a chosen one. */
  stated: boolean;
  setAt: string;
}

function strategyPath(companyId: string): string {
  return join(getOnboardingDir(companyId), "strategy.json");
}

export async function readStrategy(companyId: string): Promise<Strategy | null> {
  try {
    const parsed = JSON.parse(await readFile(strategyPath(companyId), "utf8")) as Strategy;
    // A strategy missing its goal is not a strategy — treat it as absent
    // rather than letting a half-written file masquerade as intent.
    return parsed?.goal?.kpiId ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeStrategy(companyId: string, s: Strategy): Promise<void> {
  const path = strategyPath(companyId);
  await mkdir(getOnboardingDir(companyId), { recursive: true });
  const tmp = `${path}.tmp-${randomBytes(4).toString("hex")}`;
  await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
  await rename(tmp, path);
}
