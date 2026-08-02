/** The execution engine — a task brief run on the operator's OWN Claude
 *  subscription, through the exact stack the T2 composer uses:
 *  withTokenAccounting → tier-router → WAVEX_OS_CLAUDE_BIN (the operator's
 *  OAuth locally via wavex-claude-spawn.sh, API key in production). This is
 *  the "agents on your subscription" mechanism, local-first and compliant.
 *
 *  Honesty: the engine returns the model's text or an error — it NEVER
 *  fabricates output. Budget exhaustion is its own outcome so the cycle can
 *  stop without burning an attempt (running out of budget is not the
 *  agent's failure). */

import { route as tierRoute } from "@wavex-os/plugin-tier-router";
import { withTokenAccounting } from "../lib/token-accounting.js";
import { BudgetExhaustedError } from "../lib/token-budget.js";
import { readOrg } from "../org/store.js";
import { OUTPUT_CAP, type WorkTask } from "./store.js";

export type EngineResult =
  | { ok: true; output: string }
  | { ok: false; error: string; budgetExhausted?: boolean };

/** The compass (spec Rev 5 §10): identity categories feed every brief —
 *  the constitution is load-bearing, or it doesn't ship. Empty categories
 *  contribute nothing (honest no-op). */
async function compassLines(companyId: string): Promise<string> {
  const org = await readOrg(companyId);
  const line = (id: string) => org.constitution.find((c) => c.id === id)?.content.trim() || null;
  const mission = line("identity_mission");
  const priorities = line("optimization_priorities");
  const never = line("never_sacrifice");
  return [
    mission ? `Company mission: ${mission}` : null,
    priorities ? `Optimize for: ${priorities}` : null,
    never ? `Never sacrifice: ${never}` : null,
  ].filter(Boolean).join("\n");
}

function buildBrief(task: WorkTask, compass: string): string {
  const feedback = task.feedback.length
    ? `\n\nPrior review feedback to address (oldest first — the latest entries matter most):\n${task.feedback.map((f) => `- ${f}`).join("\n")}`
    : "";
  const sections = /^\s*Sections:/im.test(task.brief)
    ? "\nInclude every section named on the \"Sections:\" line as a heading."
    : "";
  return [
    `You are the "${task.assigneeSlot}" agent of this company, executing one task.`,
    compass,
    `\nTask: ${task.title}`,
    `Brief:\n${task.brief}`,
    feedback,
    `\nProduce the deliverable itself now — complete, self-contained text.`,
    `Do not describe what you would do; do the work.${sections}`,
  ].filter(Boolean).join("\n");
}

export async function executeBrief(companyId: string, task: WorkTask): Promise<EngineResult> {
  const compass = await compassLines(companyId);
  const prompt = buildBrief(task, compass);
  try {
    const output = await withTokenAccounting(companyId, "task_exec", async () => {
      const resp = await tierRoute({
        agent_id: `work.${task.assigneeSlot}`,
        prompt,
        task_metadata: {
          creativity_required: true, customer_facing: false,
          reasoning_depth: "deep", priority: "batch",
        },
        companyId,
        outputFormat: "text",
        timeout_ms: 120_000,
      });
      return resp.output.trim();
    });
    if (!output) return { ok: false, error: "engine returned empty output" };
    return { ok: true, output: output.slice(0, OUTPUT_CAP) };
  } catch (e) {
    if (e instanceof BudgetExhaustedError) {
      return { ok: false, error: "token budget exhausted", budgetExhausted: true };
    }
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "engine error" };
  }
}
