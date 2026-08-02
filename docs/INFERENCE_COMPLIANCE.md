# Inference compliance — which credential may serve whose request

**Status: load-bearing. Read before changing anything in the inference path.**
Verified against Anthropic's live documentation on **2 August 2026**
(<https://code.claude.com/docs/en/legal-and-compliance>). The policy landscape
here changed repeatedly through 2025–26 — **re-verify before acting on this
document.**

## The rule, verbatim

From Claude Code's *Legal and compliance* page, § Authentication and credential use:

> **OAuth authentication** is intended exclusively for purchasers of Claude
> Free, Pro, Max, Team, and Enterprise subscription plans and is designed to
> support ordinary use of Claude Code and other native Anthropic applications.
>
> **Developers** building products or services that interact with Claude's
> capabilities, including those using the Agent SDK, should use API key
> authentication through Claude Console or a supported cloud provider.
> **Anthropic does not permit third-party developers to offer Claude.ai login
> or to route requests through Free, Pro, or Max plan credentials on behalf of
> their users.**
>
> Anthropic reserves the right to take measures to enforce these restrictions
> and may do so without prior notice.

And from § Acceptable use:

> Advertised usage limits for Pro and Max plans assume **ordinary, individual
> usage** of Claude Code and the Agent SDK.

## The line that matters

The rule is not "OAuth bad." It is about **whose request is being served by
whose credential**:

| Pattern | Credential | Whose request | Verdict |
|---|---|---|---|
| Operator runs wavex-os on their own machine, their own subscription | their OAuth | their own | Ordinary use — the intended case |
| Operator's subscription serves another person's inference | their OAuth | someone else's | **Prohibited** — "on behalf of their users" |
| Customer's own machine, customer's own subscription (BYOC) | their OAuth | their own | Ordinary use |
| Platform bills customers, calls Anthropic with a Console key | API key | anyone's | Sanctioned — the Agent SDK path |

Two secondary strains exist even in the "ordinary use" row, and both get worse
the more autonomous the runtime becomes: unattended loops sit awkwardly against
"ordinary, individual usage," and the Consumer Terms separately address
automated access outside an API key. A run-cycle that wakes on a schedule and
drives inference unattended for hours is not what a subscription seat describes.

## Where this repo stands

**Already corrected.** `routes/pillar-suggest-pool-b.ts` moved Pool B to BYOC —
the customer's own local `claude` CLI, billed to their own subscription. Its
header records the reason, and it is the right instinct: *"streaming our Claude
Max to the customer's machine … created a wide-open … inference-reuse window."*

**Still exposed.** `docs/CONSOLE_INTEGRATION.md` routes the free tier to the
operator's subscription:

```
free tier OR no device paired → local Pool A (operator's Claude Max OAuth
                                 via inference-server :8787)
```

`docs/INFERENCE_AUTH.md` states the intent directly — *"how do we authenticate
CUSTOMER requests to the Mac mini such that we can confidently serve their
inference via the Max OAuth?"* — and names the motive: *"Margin arbitrage = the
entire business model."*

That is the prohibited pattern in the operator's own words: a third party
routing its users' requests through a Max plan credential. The exposure is not
only to the platform — enforcement has reached the credential holder, and the
subscription being drawn on here is a person's individual account.

**The arbitrage is also gone.** The economic case for Pool A was that a flat
Max plan is cheaper than metered API rates. Every announced route for bringing
subscription entitlements to third-party software meters them at standard API
rates. There is no longer a discount to arbitrage — only the risk.

## The compliant paths

1. **Platform API key (recommended default).** Console key held by the
   platform, Agent SDK, billed through our own pricing. This is the explicitly
   sanctioned path for customer-facing products. Cost control is engineering —
   prompt caching, model tiering, batching, hard budgets — not credential
   choice. Branding: "Powered by Claude" is permitted; "Claude Code" is not.
2. **BYOC / BYOK.** The customer's own subscription on their own machine (what
   Pool B already does), or the customer's own Console key. Zero token cost to
   us, and the credential serves only its own purchaser.
3. **Prior approval.** The rule says "unless previously approved," and approved
   integrations do exist. It routes through Anthropic sales, it is
   discretionary, and it cannot be assumed in advance of an answer.
4. **Localhost, single operator.** wavex-os run by one person on their own
   machine against their own subscription stays ordinary use. This is the
   open-source distribution's story and it needs no change — but it is a
   *different product* from a hosted tier with paying customers, and the two
   must not share an inference path.

## Rules of engagement for this repo

- An OAuth credential may serve **only its own purchaser's** requests. If a
  request arrives over the network from someone else, it may not be served by
  a subscription credential — no exceptions, no tiers, no "free tier only."
- Anything customer-facing and metered goes through an **API key** path.
- `WAVEX_INFERENCE_MODE=oauth` is for a local operator. Server processes warn
  at boot when it is set (see `packages/inference-adapter/src/config.ts`),
  because the mode is invisible otherwise and the failure is silent.
- Unattended, scheduled, or looping execution should prefer the API-key path
  even for a single operator — that is the pattern subscription limits
  explicitly do not describe.
