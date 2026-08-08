/** Every operator-facing string on the Build Your Organization surface.
 *
 *  One file so the naming rule is auditable: the operator is BUILDING
 *  something — "onboarding", "setup", and "configuration" never appear in
 *  the product's own voice. (Wire routes keep /wavex-os/onboarding/* —
 *  wire names are not operator copy.) */

export const COPY = {
  productName: "Build Your Organization",
  wordmark: "WaveX",

  phaseLabel: {
    understand_you: "Understanding you",
    strategy: "Where you're going",
    connectors: "Understanding reality",
    build_plan: "Building the plan",
    /** The plan's closing beat. It is not a phase, but it IS a different
     *  thing to be doing, and the eyebrow names what the operator is doing. */
    build_plan_review: "Review",
    pricing: "Choose your plan",
    birth: "Bringing it to life",
    born: "Alive",
  } as Record<string, string>,

  welcome: {
    title: "Build your organization.",
    sub: "Describe your company — or paste your product's URL — and watch the organization construct itself around the plan.",
    placeholder: "Describe your company, or paste its URL…",
  },

  composerPlaceholder: {
    understand_you: "Answer here, or ask a question…",
    strategy: "Answer here — a number, or ask what I mean…",
    connectors: "Ask about a connector, or say what to change…",
    build_plan: "The plan is assembling — ask about any piece…",
    build_plan_review: "Ask about the proposed organization…",
    birth: "Ask about the work in flight…",
  } as Record<string, string>,

  adopt: {
    chip: "Adopt an existing product",
    prompt: "Paste your product's URL",
    reading: (url: string) => `Reading ${url}…`,
    ok: "Read it. Here's what your product told me — adjust anything that's off.",
    fallback: {
      parked: "That domain looks parked — there's no live product there to read. Tell me about the product instead.",
      thin: "I couldn't read enough from that site (it may render entirely in the browser). Tell me about the product instead.",
      unreachable: "I couldn't reach that site. Check the URL, or tell me about the product instead.",
      unsafe_url: "That's not a public web address I can read. Paste the product's public URL, or describe it instead.",
      timeout: "That site took too long to answer. Try again, or tell me about the product instead.",
      ok: "I read the site but couldn't extract product signals from it. Tell me about the product instead.",
    } as Record<string, string>,
  },

  phase1: {
    reading: "Got it — reading your site. This usually takes 60–90 seconds.",
    describing: "Working with what you described…",
    inferred: "Here's what I inferred — adjust if anything's off.",
    p3: "Now, where the product stands.",
    p4: "How you sell.",
    p5: "How the board reaches you.",
    done: "That's reality mapped. Now the plan.",
  },

  /** Strategy — the ONLY place intent enters the system.
   *
   *  Every other question here can eventually be inferred, discovered, or
   *  learned. This one cannot: a goal is a decision, and nothing that reads
   *  a website or a connector can make it. It used to be synthesized from a
   *  revenue bracket, which meant the plan critiqued its own work against a
   *  number nobody chose. */
  strategy: {
    intro: "Before I plan anything: what are you actually trying to move?",
    kpi: "Pick the one number that tells you the company is working.",
    current: (kpi: string) => `Where is ${kpi} today?`,
    target: (kpi: string) => `And where does ${kpi} need to be — by when?`,
    bottleneck: "Last one: what's in the way? Say it plainly.",
    bottleneckHint: "This is your read, not the site's. It anchors what the plan attacks first.",
    skip: "I'd rather not say",
    skipped: "Noted — I'll use a stage band and label it as a guess wherever it shows.",
    done: (kpi: string, current: string, target: string, days: number) =>
      `Locked: ${kpi} from ${current} to ${target} in ${days} days. Everything below is measured against that.`,
  },

  connectors: {
    intro: "Now let's wire your organization into reality — these are the systems the plan expects to read.",
    condensed: (wired: number, deferred: number) =>
      `Connectors · complete — ${wired} wired${deferred > 0 ? ` · ${deferred} deferred` : ""}`,
    manage: "Manage connections",
  },

  plan: {
    intro: "Building the operating plan. Watch the canvas — every piece lands as it's determined.",
    /** The two acts, named. The eyebrow prints the CURRENT one only: no
     *  breadcrumb, no "stage 1 of 2" — research's history is the findings and
     *  the plan's history is the plan. */
    stage: { research: "Researching", plan: "Planning" } as Record<string, string>,
    research: {
      opening: "Reading your market, your connectors, and what your stage implies",
      panelTitle: "What I read",
      /** Two counts, because they are two different facts.
       *
       *  This used to take the RAW finding total and assert the plan would
       *  use all of them. It cannot: most findings are advisory by design
       *  (`delta: null`), at most 3 deltas can ever apply, and for an
       *  `operating` company there is no build chain to attach one to, so
       *  `applied` is permanently empty — the sentence claimed adoption of N
       *  findings while the honest number was always zero. The per-row
       *  "used by the plan" tag was already correct; only this aggregate,
       *  which appears on two surfaces, disagreed with it. */
      settled: (n: number, used: number) =>
        used > 0
          ? `Read — ${n} finding${n === 1 ? "" : "s"}; ${used} changed the plan.`
          : `Read — ${n} finding${n === 1 ? "" : "s"}. None changed the plan — they're advisory.`,
      none: "Nothing newly possible turned up beyond what you told me — the plan below uses your answers.",
      unavailable: "I couldn't research beyond what you told me — the plan below uses your answers alone.",
      applied: "used by the plan",
      recordTitle: "Everything I read",
      recordBack: "Back to the plan",
    },
    trace: {
      roadmap: "Deriving the goal and the working checklist",
      kpis: "Fixing the KPI benchmarks and their owners",
      departments: "Sizing the organization to the plan",
      dependencies: "Wiring the cross-team workflows",
    } as Record<string, string>,
    settled: "The plan is built. Review it when you're ready.",
    /** The two halves of the same sentence, split on provenance. The first is
     *  the hardest commitment the flow makes; saying it over a stage band is
     *  the one thing every `stated` consumer exists to prevent. */
    goalFixed: "The goal and KPIs are fixed at approval; the checklist is the part that revises.",
    goalEstimated: "Estimated — a stage band stood in for the goal you skipped. The checklist revises; this number still needs confirming.",
  },

  review: {
    title: "The proposed organization",
    confirm: "Approve the organization",
    nothingYet: "— nothing yet",
    /** Said ONCE at genesis instead of five times in a column of its own. */
    genesis: "Nothing exists yet — every line below is net-new.",
    more: (n: number) => `+${n} more →`,
    recordTitle: "Every deliverable in the plan",
    recordBack: "Back to the proposal",
    kinds: { mvp: "MVP build", operating: "operating", bundle: "cycle" } as Record<string, string>,
  },

  birth: {
    mvpTitle: "Build the MVP",
    /** The agent actor is gone; the subscription fact stays, because it is
     *  load-bearing — the operator is about to spend their own inference. */
    mvpSub: "Your organization's first real work: the build checklist, running on your own Claude subscription. Review each deliverable — approving moves it forward, requesting changes sends it back with your feedback.",
    accept: "Accept the MVP — bring the organization to life",
    /** Subject is the ORGANIZATION, never its agents. */
    motion: "Your organization is waking up…",
    /** True at the `petals` stage: the petals are carrying real cycles by
     *  then, so this describes what is on screen rather than narrating over
     *  it. Nothing here claims an agent did anything. */
    workflows: "The operating cycles are in place.",
  },
} as const;
