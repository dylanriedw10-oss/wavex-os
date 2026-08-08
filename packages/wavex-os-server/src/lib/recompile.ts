/** Recompilation — what makes "onboarding never ends" safe rather than noisy.
 *
 *  The continuous loop is only shippable because of one thing: a new
 *  observation invalidates a BOUNDED subtree, not everything. Without that,
 *  re-onboarding means regenerating the whole plan on every change, the plan
 *  is never stable, and the operator can never trust it — you have built a
 *  system that changes its mind constantly and cannot explain why.
 *
 *  With it, every change is a diff with a cause:
 *
 *      Stripe now says your average deal is $400, not $4,000.
 *      That changes sales motion, which changes two capabilities
 *      and removes one workflow. Here is the difference.
 *
 *  That is the same before/after/reason structure the product already uses for
 *  every other change, applied to the organization's beliefs.
 *
 *  This module is a pure function of (before, after). It triggers nothing and
 *  writes nothing; the caller decides whether to act. */

import { buildCapabilityGraph, type CapabilitySources, type CapabilityGraph, type CapabilityId } from "./capability-model.js";
import { compileTransformation, type Transformation } from "./transformation.js";
import { diffGraphs, type CapabilityDiff } from "./counterfactual.js";
import { diffKeys, type BeliefKey } from "./read-tracker.js";

export interface Recompilation {
  /** The belief paths that actually moved. Empty means nothing to do — and
   *  returning early on that is what stops the loop from churning. */
  changedBeliefs: BeliefKey[];
  /** Capabilities whose presence changed as a result. */
  changedCapabilities: CapabilityDiff[];
  /** Capabilities that CLOSED — moved to present. These are the events worth
   *  celebrating on the canvas and the trigger the runtime watches. */
  closed: CapabilityId[];
  /** Capabilities that REGRESSED — a real event, and one a system that only
   *  looks for progress would silently miss. */
  regressed: CapabilityId[];
  /** How the route to the goal changed. */
  transformation: { before: Transformation; after: Transformation };
  /** Whether the binding constraint moved — the single most important
   *  question after any change, because it decides what the org works on. */
  constraintMoved: boolean;
  /** One sentence, in the product's own idiom. Null when nothing changed. */
  narration: string | null;
}

export function recompile(
  companyId: string,
  before: CapabilitySources,
  after: CapabilitySources,
  goal: { kpiId: string; days: number } | null,
): Recompilation {
  const changedBeliefs = diffKeys(before, after);
  const gBefore = buildCapabilityGraph(companyId, before);
  const gAfter = buildCapabilityGraph(companyId, after);
  const changedCapabilities = diffGraphs(gBefore, gAfter);

  const tBefore = compileTransformation(gBefore, goal);
  const tAfter = compileTransformation(gAfter, goal);

  const closed = changedCapabilities.filter((d) => d.to === "present").map((d) => d.id);
  const regressed = changedCapabilities.filter((d) => d.from === "present" && d.to !== "present").map((d) => d.id);
  const constraintMoved = tBefore.bindingConstraint !== tAfter.bindingConstraint;

  return {
    changedBeliefs, changedCapabilities, closed, regressed,
    transformation: { before: tBefore, after: tAfter },
    constraintMoved,
    narration: narrate(changedCapabilities, closed, regressed, tBefore, tAfter),
  };
}

const human = (id: string) => id.replace(/_/g, " ");

function narrate(
  changes: CapabilityDiff[], closed: CapabilityId[], regressed: CapabilityId[],
  before: Transformation, after: Transformation,
): string | null {
  if (changes.length === 0) return null;
  const parts: string[] = [];

  if (closed.length > 0) {
    parts.push(`${closed.map(human).join(", ")} ${closed.length === 1 ? "is" : "are"} now in place.`);
  }
  // Regression is named first-class. A loop that only reports progress is a
  // loop that hides the one thing worth acting on.
  if (regressed.length > 0) {
    parts.push(`${regressed.map(human).join(", ")} no longer holds.`);
  }
  const learned = changes.filter((d) => d.from === "unknown" && d.to !== "unknown" && d.to !== "present");
  if (learned.length > 0) {
    parts.push(`${learned.map((d) => human(d.id)).join(", ")} turned out to be missing.`);
  }

  if (before.bindingConstraint !== after.bindingConstraint) {
    parts.push(after.bindingConstraint
      ? `The thing most in the way is now ${human(after.bindingConstraint)}.`
      : "Nothing known is blocking the goal any more.");
  }
  const shrank = before.gap.length - after.gap.length;
  if (shrank > 0) parts.push(`${shrank} fewer ${shrank === 1 ? "capability" : "capabilities"} between here and the goal.`);

  return parts.join(" ") || null;
}

/** Should the plan be rebuilt?
 *
 *  Deliberately conservative. Recompiling on every observation would churn;
 *  recompiling on nothing is a model that lies. The rule: rebuild when a
 *  CAPABILITY moved or the constraint moved — a belief that changed without
 *  moving a capability changed nothing the plan depends on, which is exactly
 *  what the read-tracked dependency graph is for. */
export function shouldRebuild(r: Recompilation): boolean {
  return r.changedCapabilities.length > 0 || r.constraintMoved;
}
