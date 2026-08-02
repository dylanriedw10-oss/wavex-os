# Inference Auth — Mac mini as the WaveX inference provider

> [!WARNING]
> **The Pool A decision on this page is superseded — see
> [`INFERENCE_COMPLIANCE.md`](./INFERENCE_COMPLIANCE.md).**
>
> This document decides to serve *customer* inference from the operator's
> Claude Max OAuth, and names that arbitrage as the business model. Anthropic's
> Legal and compliance page states that Anthropic "does not permit third-party
> developers to offer Claude.ai login or to route requests through Free, Pro, or
> Max plan credentials on behalf of their users" — which is this design. The
> cost case has also lapsed: subscription entitlements brought to third-party
> software meter at standard API rates, so there is no discount left to
> arbitrage. Pool B already moved to BYOC for a closely related reason.
>
> The auth mechanics below (install attestation, ed25519 manifest signing,
> Turnstile, per-email caps) remain sound and carry over unchanged to an
> API-key-backed pool. It is the *credential* that has to change, not the
> gatekeeping.

How a customer's `wavex-os` instance authenticates to the Mac mini's inference server such that:

1. Only legitimate `wavex-os` installs can call Pool A (free onboarding inference)
2. Only paid subscribers can call Pool C (Expert Agent injection generation)
3. The Mac mini serves Anthropic via OAuth (your Claude Max 20× — flat $200/mo) rather than the metered API
4. Bad actors can't spam our endpoint to drain quota or generate junk
5. Auth can't be forged by someone running a hostile fork

## Decision: do NOT use `claude setup-key`

`claude setup-key` generates an Anthropic API key tied to a specific account. Using it means:
- Every call is metered against API rates ($3/M in, $15/M out for Sonnet 4.6)
- 1,000 customers × ~50K tokens/day = ~$2,250/mo just for Pool A
- Margin compresses fast

**Use the Claude Max OAuth that's already in your macOS Keychain.** It's a flat $200/mo for ~3.84M tokens / 5h. Margin arbitrage = the entire business model. Capture C §3 already decided this.

The question is: how do we authenticate CUSTOMER requests to the Mac mini such that we can confidently serve their inference via the Max OAuth?

## Three layers of auth, one per pool

### Pool A (free onboarding, anonymous) — install-attestation + Turnstile + per-email caps

Customer just cloned the repo and is running the wizard. They have no subscription, no account, nothing.

What we DO have:
1. They generated an `install_id` (random UUID) at first wizard load, stored in `~/.wavex-os/install.json`
2. They typed an email at Pillar 1 (collected by the wizard for board signals)
3. Their Pillar 1 manifest is signed locally with an ed25519 keypair they generated at first run (the same `signed.manifest.sig` that the wizard already produces)
4. They came through a real browser (Cloudflare Turnstile bot challenge)

**The auth flow:**

```
Customer's wavex-os instance:
  1. Generates per-install ed25519 keypair at first wizard load
  2. Pillar 1 completion produces a signed manifest_hash + signature
  3. POST /v1/onboarding/session to Mac mini with:
     {
       email,
       install_id,
       manifest_hash,         // sha256 of the V2 template bundle as proof they have OUR code
       install_pubkey_b64,    // their per-install ed25519 public
       turnstile_token        // Cloudflare invisible captcha
     }

Mac mini (api.wavex-os.com):
  4. Verify Turnstile token (free, blocks scripted abuse)
  5. Verify manifest_hash matches a known-good wavex-os release hash (rejects forks)
  6. Per-email rate limit: 3 install_ids per email per 30d
  7. Per-install_id rate limit: 20 calls lifetime, 5/hour
  8. Per-IP/24 rate limit: 200/hour
  9. Issue HS256 session token bound to (install_id, email), 30-min TTL
  10. Customer attaches token on subsequent /v1/onboarding/t2 calls
```

This is essentially what's already in `packages/inference-server/src/routes/onboarding.ts` — the **only addition is step 5** (manifest_hash whitelist check).

**The manifest_hash whitelist:**

```ts
// Generated at each release tag (e.g. v0.3.0)
const ACCEPTED_MANIFEST_HASHES = new Set([
  "sha256-of-v0.3.0-template-bundle",
  "sha256-of-v0.2.0-template-bundle",  // grace period
]);
```

The "manifest" hashed here is the SHA-256 of the concatenated SKILL files + tools/ dirs in `packages/onboarding-ui/public/agent-templates/`. We bake the hash into each release; customers running stale forks fail step 5 cleanly.

This isn't unforgeable — anyone who clones the actual repo can compute the same hash. **That's intentional.** The protection is against trivial abuse (curl-script-from-someone-else's-laptop), not nation-state attackers. Step 4 (Turnstile) + step 6 (per-email) + step 7 (per-install) provide the actual rate limiting.

### Pool C (paid Expert Agents) — JWT bound to subscription + agent-scoped envelopes

Already designed in F.5. The Liaison presents a JWT issued at hire-time, bound to `subscription_id`. The Mac mini checks:

1. JWT signature valid (signed by our own private key)
2. JWT not expired (24h rotation; refresh via `refresh-subscription-jwt`)
3. Supabase `subscriptions.status` is `active` or `trialing`
4. Subscription's daily cap not yet exhausted

If all four pass, the request is served. No additional fingerprinting needed because the JWT itself is unforgeable — and the data the customer can read is bounded by what they encrypted to the per-catalog public keys (the privacy contract we proved this session).

### "Wavex-os instance proof" via the install ed25519 keypair

For Pool A, we want stronger evidence than "the IP looks human" that this is a real wavex-os install. Use the ed25519 keypair the wizard already generates for signing the company manifest:

```ts
// In packages/onboarding-ui/src/wavex-os/lib/install-identity.ts (NEW)
export function ensureInstallIdentity(): {
  install_id: string;
  pubkey_b64: string;
  privkey_b64: string;  // stays local; never sent
} {
  const path = `${homedir()}/.wavex-os/install.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));

  const kp = sodium.crypto_sign_keypair();
  const id = {
    install_id: crypto.randomUUID(),
    pubkey_b64: sodium.to_base64(kp.publicKey, sodium.base64_variants.ORIGINAL),
    privkey_b64: sodium.to_base64(kp.privateKey, sodium.base64_variants.ORIGINAL),
    created_at: new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(id, null, 2), { mode: 0o600 });
  return id;
}
```

At every Pool A inference call, the customer signs `(install_id, timestamp, prompt_sha256)` with their install private key. The Mac mini verifies using the public key it received at session creation. This binds the inference call to a specific install — replay attacks (someone steals a session token) fail because they don't have the install's private key.

This is **belt + suspenders.** A typical attacker has to: (a) get past Turnstile, (b) match a release manifest hash, (c) get a valid session token bound to email/install, (d) sign each call with the install's private key. Realistically: this isn't getting brute-forced.

## What you ship to make this work

| Component | Where | Status |
|---|---|---|
| Install ed25519 keypair + `install.json` | `packages/onboarding-ui/src/wavex-os/lib/install-identity.ts` | Spec'd; needs implementing |
| Per-call signature | Wizard's T2 call wrapper at `vendor/wavex-os/onboarding/src/*/enrichment.ts` | Lift current http POST → wrap with sign step |
| Mac mini `manifest_hash` whitelist | `packages/inference-server/src/routes/onboarding.ts` step 5 | One env var `WAVEX_ACCEPTED_MANIFEST_HASHES`, comma-separated |
| Mac mini install-signature verify | `packages/inference-server/src/routes/onboarding.ts` step 9.5 | New function `verifyInstallSignature(token, signature, install_pubkey)` |
| Release-build manifest hasher | `scripts/release/compute-manifest-hash.mjs` | One-shot script; output goes in release notes |
| Cloudflare Turnstile site key | `packages/onboarding-ui/.env` | `VITE_CLOUDFLARE_TURNSTILE_SITE_KEY` |
| Cloudflare Turnstile secret | Supabase secrets / inference-server env | `CLOUDFLARE_TURNSTILE_SECRET` |

Total work: ~2 days of focused engineering. Not blocking the 2-computer test (that test bypasses Pool A by seeding the customer directly).

## OAuth path on the Mac mini

For the inference server to actually call Anthropic using your Claude Max OAuth:

```bash
# The wrapper script that already exists for the agent fleet:
ls <your-checkout>/scripts/wrappers/claude-anthropic-direct.sh

# This script:
#   1. Reads the OAuth token from macOS Keychain (Claude Code-credentials)
#   2. Sets ANTHROPIC_AUTH_TOKEN env var
#   3. Execs the claude CLI which makes the API call via OAuth
```

For the inference-server to use OAuth instead of an API key, we need to wrap Anthropic's SDK to inject `Authorization: Bearer <OAuth token>` instead of `x-api-key`. The Anthropic JS SDK supports this via the `defaultHeaders` option:

```ts
// In packages/inference-server/src/lib/anthropic-oauth.ts (NEW)
import { execSync } from "node:child_process";

function getMaxOAuthToken(): string {
  // Same path the agent fleet's wrapper uses
  const json = execSync(
    "security find-generic-password -s 'Claude Code-credentials' -w",
    { encoding: "utf8" },
  ).trim();
  const parsed = JSON.parse(json);
  return parsed.claudeAiOauth.accessToken;
}

export function getAnthropicConfig() {
  if (process.env.INFERENCE_BACKEND === "apikey") {
    return { apiKey: process.env.ANTHROPIC_API_KEY };
  }
  // OAuth path
  return {
    apiKey: "dummy",  // SDK requires non-empty
    defaultHeaders: {
      "Authorization": `Bearer ${getMaxOAuthToken()}`,
      "x-api-key": "",  // remove the apikey header
    },
  };
}
```

The token can be refreshed via the existing healing layer's `oauth-refresh` package — same mechanism the agent fleet uses today.

**No new credential issuance needed on your side.** Your Claude Max account is the credential. The Mac mini reads it from Keychain on every inference call (the existing wrapper does this on every agent spawn — proven pattern).

## Concrete answer to your question

> "should i create the key using `claude setup-key` or expose an endpoint on this mac mini server and auth using a unique auth method that can only be produced by a wavex-os local instance"

**Neither alone. Both together:**

1. **For Pool A (free onboarding) and Pool C (Expert Agents):** the Mac mini calls Anthropic via your existing **Claude Max OAuth** (from Keychain, no new key needed). This is the "expose an endpoint on the Mac mini" option, BUT the Mac mini's outbound auth to Anthropic is the OAuth, not a fresh API key. `claude setup-key` doesn't apply here — that's for getting an API key for direct user CLI use, not for serving inference.

2. **For customer→Mac-mini auth:** install ed25519 signature + Cloudflare Turnstile + release-manifest-hash whitelist (Pool A) PLUS subscription JWT (Pool C). All three are forms of "auth that only a wavex-os local instance can produce" — but at different trust levels for different surfaces.

3. **Keep `INFERENCE_BACKEND=oauth|apikey` as a one-env-var flip** in case Anthropic objects to the OAuth-resell pattern (capture C §8 risk #1). You can pivot to a metered API key in 5 minutes without code changes.

## What this means for the 2-computer test

Nothing about the test changes. The test customer was seeded directly via SQL, bypassing all the auth layers. The Pool C side just needs `ANTHROPIC_API_KEY` (or `claude-anthropic-direct.sh` wrapped through to the Edge Function) to make the F.5 worker call real Anthropic. The auth on the customer→Mac-mini side is what gates open-source customers AFTER they install — for the seeded test that's all already pre-authorized.
