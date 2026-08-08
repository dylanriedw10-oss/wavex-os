/** The capability read-model — what this organization can do, derived.
 *
 *  A pure projection over artifacts that already exist. It writes nothing,
 *  migrates nothing, and stores nothing: capabilities are ALWAYS derived, the
 *  way fragility and quality are. Delete this file and no information is lost.
 *
 *  ── Why a read-model first ──────────────────────────────────────────────
 *  Before any of the reasoning architecture is built, one question has to be
 *  answered cheaply: do these eighteen predicates actually DISCRIMINATE
 *  between real organizations, or does everyone come out the same shape? This
 *  file answers that against the worst inputs it will ever have. If the
 *  ontology is wrong, the cost of learning so is deleting one module.
 *
 *  ── The three laws this file exists to obey ─────────────────────────────
 *  L1  PROVENANCE, NEVER CONFIDENCE. Every verdict carries what it read and
 *      what kind of evidence that was. No verdict carries a score.
 *  L2  THREE VALUES, NEVER TWO. `absent` means "we know it isn't so".
 *      `unknown` means "nothing has told us". Collapsing them is the bug that
 *      produced `stated: false` being indistinguishable from a real value, and
 *      it is the single most common mistake available here — most of these
 *      predicates can NEVER be absent, and say so.
 *  L3  LABELS ARE WRITE-ONLY. Nothing in this file reads a stage, a mode, or a
 *      maturity name. `GOALS_BY_STAGE` and `CHAIN_BY_PLACEMENT` are the two
 *      existing violations in this repo; both produced identical plans for
 *      materially different companies.
 *
 *  ── Traps, each verified on disk rather than assumed ────────────────────
 *  Six fields look like signal and are not. Reading any of them would
 *  reintroduce a bug this codebase has already shipped:
 *
 *   1. `pillar_3.kpi_snapshot_initial.*` — every value is a literal row from a
 *      stage lookup table, and its `ai_estimated` flag is hardcoded `true` on
 *      every path and read by no conditional anywhere. The one company on disk
 *      carries numbers byte-identical to the table's `more_than_1m_mrr` row.
 *   2. `workflow_manifest.bundle_workflows[*].kpis_moved` and `.owner` — static
 *      constants copied verbatim from a template for every company. "Does this
 *      company move NRR?" is true for 100% of them and means nothing. Only
 *      `participating_agents` is per-company.
 *   3. `t2_patches[*].pillar_signal` — advertised as machine-parseable, but
 *      every value on disk names a field path that does not exist
 *      (`pillar_2.primary_acquisition` when the real field is
 *      `pillar_1.primary_acquisition_channel`). Prose, not signal.
 *   4. `pillar_1.business_model_hint` — a website inference either way, and
 *      records written before `routes/pillars.ts` stopped coercing absence
 *      to `"subscription"` still carry that invented value on disk.
 *   5. `connector_manifest` buckets — the decision matrix's OPINION about what
 *      should be wired. Only the vault knows what IS wired.
 *   6. `pillar_1.has_product` — defaults to `true` in every producer, including
 *      the enrichment prompt's own instruction. Never present on its own.
 *
 *  ── One honesty note that outranks the rest ─────────────────────────────
 *  `product_state` is the load-bearing input for six predicates, and the card
 *  that collects it AUTO-PRESELECTS the model's suggestion so the operator can
 *  confirm with one click. Nothing records whether a chip was actually clicked.
 *  So `operator-claimed` here means "claimed by the operator OR inferred and
 *  never contradicted", and the two are indistinguishable after the fact. That
 *  is worth fixing upstream; until it is, this file must not overstate it. */

import { whatWouldMeasure } from "./connector-reads.js";

/* ── Vocabulary ───────────────────────────────────────────────────────── */

/** L2. Never a boolean, anywhere, for any reason. */
export type Presence = "present" | "absent" | "unknown";

/** L1. What KIND of thing supports the verdict — not how sure we are.
 *  Ordered weakest to strongest; the ordering is meaningful and used. */
export type EvidenceKind = "none" | "website-inferred" | "operator-claimed" | "system-observed";

export type CapabilityGroup =
  | "offer" | "demand" | "conversion" | "money" | "retention" | "sensing" | "organizational";

export const CAPABILITY_IDS = [
  "has_something_to_sell", "can_deliver_repeatably",
  "can_reach_new_buyers", "reach_is_repeatable", "can_attribute_channel",
  "has_a_priced_offer", "can_convert", "converts_without_founder",
  "can_take_money", "revenue_repeats",
  "can_onboard_customers", "can_support_customers", "knows_why_customers_leave",
  "can_measure_the_goal_kpi", "has_a_system_of_record", "can_see_the_pipeline",
  "survives_one_person_leaving", "decisions_have_a_home",
] as const;
export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export interface CapabilityVerdict {
  id: CapabilityId;
  group: CapabilityGroup;
  presence: Presence;
  evidence: EvidenceKind;
  /** One sentence a human can read on the canvas. Always populated — a
   *  verdict that cannot explain itself must not be rendered. */
  because: string;
  /** The field paths actually consulted. This is the derivation's own
   *  provenance, and it is what makes the canvas an audit surface. */
  reads: string[];
  /** True when today's schema cannot express absence for this predicate. The
   *  canvas should render these differently: a permanent `unknown` is a hole
   *  in the ontology, not a fact about the company. */
  absenceUnreachable?: true;
  /** True when NO field on disk speaks to this at all. */
  noSignal?: true;
}

/* ── Inputs ───────────────────────────────────────────────────────────── */

/** Exactly what this model reads. Passed in rather than fetched so the
 *  derivation stays pure and testable — the route does the I/O.
 *
 *  `vault` is separate because wiring truth lives in PGlite, not in the
 *  onboarding files, and it is the ONLY system-observed input available. */
export interface CapabilitySources {
  pillars: PillarShape | null;
  manifest: ManifestShape | null;
  swarm: SwarmShape | null;
  workflow: WorkflowShape | null;
  strategy: StrategyShape | null;
  vault: VaultConnectorState[] | null;
}

interface PillarShape {
  pillar_1?: {
    has_product?: boolean; industry_hint?: string; business_model_hint?: string;
    primary_acquisition_channel?: string; revenue_model?: string; enrichment_status?: string;
  } | null;
  pillar_3?: { product_state?: string; product_state_other?: string } | null;
  pillar_4?: { lead_sources?: string[]; sales_motion?: string; gtm_profile_enum?: string } | null;
  pillar_5?: { comm_channel?: string } | null;
}
interface ManifestShape {
  goal?: { kpiId?: string; current?: number; target?: number; days?: number; stated?: boolean } | null;
}
interface SwarmShape {
  agents?: Record<string, { status?: string; department?: string; template_id?: string; unpark_condition?: string | null }>;
}
interface WorkflowShape {
  agent_workflows?: Record<string, { escalation?: Array<{ to?: string }> }>;
}
/** Mirrors `lib/strategy.ts`'s `Strategy`. `stated` is a SIBLING of `goal`,
 *  not a field inside it — the strategy route is `.strict()` and writes it at
 *  the top level, so reading `goal.stated` here yielded `undefined` for every
 *  operator who actually stated a goal, and reported their own number back to
 *  them as unconfirmed. */
interface StrategyShape {
  goal?: { kpiId?: string; current?: number } | null;
  stated?: boolean;
  bottleneck?: string | null;
}
/** The vault's own vocabulary. Only `vaulted_valid` means a probe answered. */
export interface VaultConnectorState {
  connectorId: string;
  status: "vaulted_valid" | "vaulted_unvalidated" | "skipped" | "pending";
}

/* ── Connector classes ────────────────────────────────────────────────── */

/** Reviewed constants, spelled with connector ids that exist. Deliberately
 *  NOT parsed out of the manifest's `rationale` prose, which is overwritten
 *  wholesale by the decision matrix and is English, not data. */
const ATTRIBUTION = new Set(["mixpanel", "segment", "posthog", "google-analytics", "meta-ads-api", "amplitude"]);
const SYSTEM_OF_RECORD = new Set(["hubspot", "salesforce", "supabase", "airtable", "notion", "postgres"]);
const PIPELINE = new Set(["hubspot", "salesforce", "pipedrive", "close"]);

function wired(vault: VaultConnectorState[] | null, ids: Set<string>): "yes" | "skipped" | "none" | "unknown" {
  if (vault === null) return "unknown";
  const rows = vault.filter((v) => ids.has(v.connectorId));
  if (rows.some((v) => v.status === "vaulted_valid")) return "yes";
  if (rows.length > 0 && rows.every((v) => v.status === "skipped")) return "skipped";
  return rows.length > 0 ? "none" : "none";
}

/* ── Derivation ───────────────────────────────────────────────────────── */

const V = (
  id: CapabilityId, group: CapabilityGroup, presence: Presence,
  evidence: EvidenceKind, because: string, reads: string[],
  extra: Partial<Pick<CapabilityVerdict, "absenceUnreachable" | "noSignal">> = {},
): CapabilityVerdict => ({ id, group, presence, evidence, because, reads, ...extra });

/** Nothing on disk speaks to this. A permanent `unknown` — and the honest
 *  output of step 0, because it names a hole in the ontology rather than
 *  papering one over. */
const NO_SIGNAL = (id: CapabilityId, group: CapabilityGroup, why: string): CapabilityVerdict =>
  V(id, group, "unknown", "none", why, [], { noSignal: true, absenceUnreachable: true });

export function deriveCapabilities(s: CapabilitySources): CapabilityVerdict[] {
  const p1 = s.pillars?.pillar_1 ?? null;
  const p3 = s.pillars?.pillar_3 ?? null;
  const p4 = s.pillars?.pillar_4 ?? null;
  const ps = p3?.product_state;
  const out: CapabilityVerdict[] = [];

  /* ── Offer ──────────────────────────────────────────────────────────── */

  // `has_product` is never enough on its own: it defaults to true in every
  // producer, which is why placement.ts calls that branch a PRESUMPTION.
  out.push((() => {
    const r = ["pillar_3.product_state", "pillar_1.has_product"];
    if (ps === "live_paying_customers" || ps === "built_not_selling" || ps === "prototype_mvp") {
      return V("has_something_to_sell", "offer", "present", "operator-claimed",
        `Something exists to sell — the product is "${ps.replace(/_/g, " ")}".`, r);
    }
    if (ps === "idea_only") {
      return V("has_something_to_sell", "offer", "absent", "operator-claimed",
        "Nothing is built yet — the product is an idea.", r);
    }
    if (p1?.has_product === false) {
      return V("has_something_to_sell", "offer", "absent", "website-inferred",
        "Nothing indicated a product, and the pre-product marker was set explicitly.", r);
    }
    return V("has_something_to_sell", "offer", "unknown", ps === "other" ? "operator-claimed" : "none",
      ps === "other"
        ? `The operator described the product state in their own words ("${p3?.product_state_other ?? "…"}"), which carries no rung.`
        : "Where the product stands hasn't been answered yet.", r);
  })());

  out.push(NO_SIGNAL("can_deliver_repeatably", "offer",
    "Nothing on disk records whether delivery has happened more than once without bespoke work. Paying customers imply one delivery, never a repeatable one."));

  /* ── Demand ─────────────────────────────────────────────────────────── */

  out.push((() => {
    const r = ["pillar_4.lead_sources", "pillar_4.gtm_profile_enum"];
    const ls = p4?.lead_sources ?? null;
    if (p4?.gtm_profile_enum === "BOOTSTRAP_NO_GTM" || (ls && ls.length === 1 && ls[0] === "none_yet")) {
      return V("can_reach_new_buyers", "demand", "absent", "operator-claimed",
        "The operator said there is no acquisition channel yet.", r);
    }
    if (ls && ls.filter((x) => x !== "none_yet").length > 0) {
      return V("can_reach_new_buyers", "demand", "present", "operator-claimed",
        `New buyers arrive through ${ls.filter((x) => x !== "none_yet").length} named channel(s).`, r);
    }
    return V("can_reach_new_buyers", "demand", "unknown", "none",
      "How customers find the company hasn't been answered yet.", r);
  })());

  out.push(NO_SIGNAL("reach_is_repeatable", "demand",
    "No question or connector establishes whether acquisition repeats across periods or was a one-off push. A real hole in the ontology, not a gap in this company's answers."));

  out.push((() => {
    const w = wired(s.vault, ATTRIBUTION);
    const r = ["vault.credentials[attribution]"];
    if (w === "yes") {
      return V("can_attribute_channel", "demand", "present", "system-observed",
        "An analytics connector is wired and answered a live probe.", r);
    }
    // Never `absent`: skipping records a decision about WaveX's access, not
    // about whether the company can attribute a customer to a channel.
    return V("can_attribute_channel", "demand", "unknown", "none",
      w === "skipped"
        ? "An analytics connector was offered and skipped — that says nothing about whether attribution exists, only that we can't see it."
        : "No analytics system is connected, so channel attribution is unobservable from here.",
      r, { absenceUnreachable: true });
  })());

  /* ── Conversion ─────────────────────────────────────────────────────── */

  // There is NO price, ACV, ARPU or willingness-to-pay field anywhere in the
  // schema. Paying customers is the only evidence a price exists at all.
  out.push((() => {
    const r = ["pillar_3.product_state"];
    if (ps === "live_paying_customers") {
      return V("has_a_priced_offer", "conversion", "present", "operator-claimed",
        "Customers are paying, so a price exists — though no field records what it is.", r);
    }
    if (ps === "idea_only") {
      return V("has_a_priced_offer", "conversion", "absent", "operator-claimed",
        "Nothing is built, so there is nothing priced.", r);
    }
    return V("has_a_priced_offer", "conversion", "unknown", "none",
      "No field anywhere records a price, a tier, or a deal size.", r);
  })());

  out.push((() => {
    const r = ["pillar_3.product_state", "pillar_4.sales_motion"];
    if (ps === "live_paying_customers") {
      return V("can_convert", "conversion", "present", "operator-claimed",
        "Money has changed hands, so contacts have become customers.", r);
    }
    if (ps === "idea_only") {
      return V("can_convert", "conversion", "absent", "operator-claimed",
        "Nothing is built, so there is nothing to convert anyone to.", r);
    }
    if (p4?.sales_motion === "none_yet") {
      return V("can_convert", "conversion", "absent", "operator-claimed",
        "The operator said no sales motion exists yet.", r);
    }
    return V("can_convert", "conversion", "unknown", "none",
      "Nothing establishes whether contacts have become customers.", r);
  })());

  out.push((() => {
    const r = ["pillar_4.sales_motion"];
    const sm = p4?.sales_motion;
    if (sm === "self_serve_plg") {
      return V("converts_without_founder", "conversion", "present", "operator-claimed",
        "Sales are self-serve, so closing does not require a person.", r);
    }
    // "assisted_demo" and "high_touch_enterprise" establish that a HUMAN is in
    // the loop. They say nothing about WHICH human, so absence is unreachable.
    return V("converts_without_founder", "conversion", "unknown", sm ? "operator-claimed" : "none",
      sm
        ? `Closing involves a person ("${sm.replace(/_/g, " ")}"), but nothing records whether that person is the founder.`
        : "How deals close hasn't been answered yet.",
      r, { absenceUnreachable: true });
  })());

  /* ── Money ──────────────────────────────────────────────────────────── */

  out.push((() => {
    const r = ["pillar_3.product_state"];
    if (ps === "live_paying_customers") {
      return V("can_take_money", "money", "present", "operator-claimed",
        "Customers are paying, so a payment path exists.", r);
    }
    if (ps === "idea_only" || ps === "prototype_mvp" || ps === "built_not_selling") {
      return V("can_take_money", "money", "absent", "operator-claimed",
        "Nobody is paying yet.", r);
    }
    return V("can_take_money", "money", "unknown", "none",
      "Nothing establishes whether the company can take payment.", r);
  })());

  // `business_model_hint` is the only field carrying the concept, and it is a
  // website inference about how the company SELLS — not evidence that any
  // revenue actually recurred. Records written before the "subscription"
  // coercion was removed carry an invented value besides. Refusing to read it
  // is the point.
  out.push(NO_SIGNAL("revenue_repeats", "money",
    "The only field naming recurring revenue is a website inference about the business model, which says nothing about whether revenue has actually repeated."));

  /* ── Retention ──────────────────────────────────────────────────────── */

  // The whole pipeline asks five pillars and every one is PRE-sale: who you
  // are, your inference budget, your product stage, how you acquire, and how
  // the org reports to you. Nothing anywhere asks about a customer after the
  // money changes hands. Two of these three are structurally unanswerable.
  out.push((() => {
    const r = ["swarm.agents[cpo.growth].status"];
    const g = s.swarm?.agents?.["cpo.growth"];
    if (!g) return V("can_onboard_customers", "retention", "unknown", "none", "No plan has been built yet.", r);
    if (g.status === "active") {
      return V("can_onboard_customers", "retention", "present", "operator-claimed",
        "The activation cycle has an active owner in the plan.", r);
    }
    if (g.status === "parked" && g.unpark_condition === "operator_unpark_from_mission_control") {
      return V("can_onboard_customers", "retention", "absent", "operator-claimed",
        "The operator scoped this department out of the plan at review.", r);
    }
    return V("can_onboard_customers", "retention", "unknown", "none",
      `The activation owner is "${g.status ?? "unset"}" for reasons the plan doesn't attribute to the operator.`, r);
  })());

  out.push(NO_SIGNAL("can_support_customers", "retention",
    "Nothing asks about post-sale support. `comm_channel` is how the ORGANIZATION reports to the operator, not how customers reach the company."));

  out.push(NO_SIGNAL("knows_why_customers_leave", "retention",
    "No field anywhere names a churn reason, cancellation reason, or exit survey."));

  /* ── Sensing ────────────────────────────────────────────────────────── */

  // THE headline. Absent for everyone, and genuinely absent rather than
  // unknown: every credential read in the system is a liveness probe whose
  // result is written to an audit log and rendered as a UI badge. No probe
  // result gates work, seeds a KPI, or unlocks a data read. This is a
  // code-level impossibility, not missing data.
  out.push((() => {
    const kpiId = s.strategy?.goal?.kpiId ?? s.manifest?.goal?.kpiId ?? null;
    const r = ["strategy.goal.kpiId", "manifest.goal.kpiId", "vault.probes"];
    if (!kpiId) {
      return V("can_measure_the_goal_kpi", "sensing", "absent", "none",
        "No goal has been stated, and no connected system could return its value if there were one.", r);
    }
    // Two different absences, and telling the operator the wrong one is worse
    // than saying nothing: "connect Stripe" to somebody who already has is a
    // product that isn't listening.
    const providers = whatWouldMeasure(kpiId);
    const wiredIds = new Set((s.vault ?? []).filter((v) => v.status === "vaulted_valid").map((v) => v.connectorId));
    const connected = providers.filter((p) => wiredIds.has(p.connectorId));
    return V("can_measure_the_goal_kpi", "sensing", "absent", "none",
      connected.length > 0
        ? `${connected.map((c) => c.connectorId).join(", ")} ${connected.length === 1 ? "is" : "are"} connected, but WaveX cannot read ${kpiId.replace(/_/g, " ")} from ${connected.length === 1 ? "it" : "them"} yet — every credential read in the product today is a liveness probe.`
        : providers.length > 0
          ? `Connect ${providers.map((p) => p.connectorId).join(" or ")} and ${kpiId.replace(/_/g, " ")} becomes measurable. Today it is a number you typed.`
          : `Nothing in the connector registry can return ${kpiId.replace(/_/g, " ")}.`,
      r);
  })());

  out.push((() => {
    const w = wired(s.vault, SYSTEM_OF_RECORD);
    const r = ["vault.credentials[system-of-record]"];
    if (w === "yes") {
      return V("has_a_system_of_record", "sensing", "present", "system-observed",
        "A system of record is wired and answered a live probe.", r);
    }
    return V("has_a_system_of_record", "sensing", "unknown", "none",
      w === "skipped"
        ? "A system of record was offered and skipped — the company may well have one; we can't see it."
        : "No system of record is connected.",
      r, { absenceUnreachable: true });
  })());

  out.push((() => {
    const w = wired(s.vault, PIPELINE);
    return V("can_see_the_pipeline", "sensing", w === "yes" ? "present" : "unknown",
      w === "yes" ? "system-observed" : "none",
      w === "yes"
        ? "A CRM is wired and answered a live probe."
        : "No CRM is connected, so future revenue is invisible from here.",
      ["vault.credentials[crm]"], w === "yes" ? {} : { absenceUnreachable: true });
  })());

  /* ── Organizational ─────────────────────────────────────────────────── */

  // Fragility as the minimal cut — but honestly scoped. No field on disk
  // speaks to HUMAN key-person risk. What is computable is machine-side
  // single points of failure: a template resolved by exactly one active slot.
  out.push((() => {
    const agents = s.swarm?.agents ?? null;
    const r = ["swarm.agents[*].template_id", "swarm.agents[*].status"];
    if (!agents) return V("survives_one_person_leaving", "organizational", "unknown", "none", "No plan has been built yet.", r);
    const byTemplate = new Map<string, number>();
    for (const a of Object.values(agents)) {
      if (a.status !== "active" || !a.template_id) continue;
      byTemplate.set(a.template_id, (byTemplate.get(a.template_id) ?? 0) + 1);
    }
    const singles = [...byTemplate.values()].filter((n) => n === 1).length;
    if (byTemplate.size === 0) {
      return V("survives_one_person_leaving", "organizational", "unknown", "none", "No agent is active yet.", r);
    }
    return V("survives_one_person_leaving", "organizational", singles > 0 ? "absent" : "present", "system-observed",
      singles > 0
        ? `${singles} of ${byTemplate.size} active functions are held by a single slot — that is the machine-side cut, and nothing on disk speaks to human key-person risk at all.`
        : "Every active function is held by more than one slot.",
      r);
  })());

  // The constitution is the decision layer, and it is fourteen named
  // categories with no write path — read-only API, read-only capabilities, no
  // commit action. Escalation routes exist in the plan, which is a declared
  // home for what an agent cannot hold, not a home for the operator's choices.
  out.push((() => {
    const aw = s.workflow?.agent_workflows ?? null;
    const r = ["workflow.agent_workflows[*].escalation"];
    if (!aw) return V("decisions_have_a_home", "organizational", "unknown", "none", "No plan has been built yet.", r);
    const slots = Object.values(aw);
    const dangling = slots.filter((w) => !w.escalation || w.escalation.length === 0).length;
    return V("decisions_have_a_home", "organizational", dangling === 0 ? "present" : "absent", "operator-claimed",
      dangling === 0
        ? "Every agent in the plan has somewhere to escalate what it cannot decide."
        : `${dangling} agents have nowhere to escalate to.`,
      r);
  })());

  return out;
}

/* ── The graph ────────────────────────────────────────────────────────── */

export interface CapabilityGraph {
  companyId: string;
  capabilities: CapabilityVerdict[];
  /** Counts, not a completeness score. There is no honest denominator for
   *  "how much of an organization exists", and a percentage here would be the
   *  fifth costume of the number this architecture keeps refusing. */
  tally: { present: number; absent: number; unknown: number; noSignal: number };
  /** The goal's provenance, read STRICTLY. `stated` absent is UNKNOWN, not
   *  true — manifests signed before the flag existed carry numbers copied
   *  verbatim from the synthesis table, so the display layer's forgiving
   *  default would report a fabrication as a decision. */
  goalProvenance: "stated" | "fallback" | "unknown" | "none";
}

export function buildCapabilityGraph(companyId: string, s: CapabilitySources): CapabilityGraph {
  const capabilities = deriveCapabilities(s);
  const tally = { present: 0, absent: 0, unknown: 0, noSignal: 0 };
  for (const c of capabilities) {
    tally[c.presence] += 1;
    if (c.noSignal) tally.noSignal += 1;
  }
  // Read the flag from where it is WRITTEN. A strategy.json exists only
  // because the operator went through Strategy, so its `stated` is the
  // authority; the manifest's copy is the fallback for companies that
  // predate the file.
  const strat = s.strategy;
  const goal = strat?.goal ?? s.manifest?.goal ?? null;
  const stated = strat?.goal ? strat.stated : s.manifest?.goal?.stated;
  const goalProvenance: CapabilityGraph["goalProvenance"] =
    !goal ? "none" : stated === true ? "stated" : stated === false ? "fallback" : "unknown";
  return { companyId, capabilities, tally, goalProvenance };
}
