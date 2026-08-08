/** Hardened URL reading for the wavex layer.
 *
 *  CANONICAL SOURCE: packages/inference-server/src/lib/url-prefetch.ts —
 *  the pure pieces (safe-host check, HTML→text, byte-capped fetch, one-hop
 *  meta-refresh follow, parked-domain fingerprints) are copied here rather
 *  than imported: wavex-os-server and inference-server deploy separately,
 *  and a runtime dependency between them for four pure functions would
 *  couple the two servers. Keep drift-fixes flowing FROM the hub copy.
 *  (Converging both into packages/shared is a named follow-up.)
 *
 *  What this layer adds over the hub copy: a STRUCTURED single-URL API
 *  (`fetchPage`) with an honest status vocabulary — parked / thin /
 *  unreachable / unsafe_url / timeout are first-class outcomes, because
 *  Path B ("adopt an existing product") must fall back to "tell me more"
 *  instead of letting the model hallucinate a company from a parking page. */

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 50 * 1024;
const MAX_EXTRACT_CHARS = 30 * 1024;
const UA = "WaveX-OS-Onboarding/1.0 (+https://github.com/aimerdoux/wavex-os)";
/** Below this much readable text the site is almost certainly parked, a
 *  redirect stub, or JS-rendered with no SSR. */
const MIN_CONTENT_CHARS = 120;
const META_REFRESH_REGEX = /<meta[^>]+http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i;
const PARKED_RE = /\b(este dominio ya|buy this domain|this domain (is|may be) for sale|domain is parked|parkingcrew|sedoparking|godaddy\.com\/domains|hugedomains|is registered with ionos|defaultsite|under construction|coming soon)\b/i;

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./,
  /^::1$/,
  /^fe80:/i,
  /^fc00:/i,
];

export function isSafePublicUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  for (const p of PRIVATE_HOST_PATTERNS) if (p.test(host)) return null;
  return u;
}

/** Strip HTML to plain text — hub copy, verbatim. Keeps block-boundary line
 *  breaks, drops script/style, prefixes og:/description meta as [META]. */
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  const metaMatches = s.match(/<meta[^>]+content="[^"]+"/gi) ?? [];
  const meta = metaMatches
    .filter((m) => /property="og:|name="(description|twitter:description|keywords)/i.test(m))
    .map((m) => {
      const c = m.match(/content="([^"]+)"/i);
      return c ? c[1] : "";
    })
    .filter(Boolean)
    .join(" | ");
  s = s.replace(/<\/(p|div|li|section|article|header|footer|h[1-6]|tr|br)[^>]*>/gi, "\n");
  s = s.replace(/<br[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/\s+\n/g, "\n").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  const prefix = meta ? `[META] ${meta}\n\n` : "";
  return (prefix + s).slice(0, MAX_EXTRACT_CHARS);
}

export type FetchStatus = "ok" | "parked" | "thin" | "unreachable" | "unsafe_url" | "timeout";

export interface PageFetchResult {
  url: string;
  status: FetchStatus;
  /** Present only when status === "ok" — the extracted plain text. */
  body?: string;
  /** Human-readable detail for every non-ok status. */
  reason: string | null;
}

async function fetchRawHtml(url: URL): Promise<{ ok: true; raw: string } | { ok: false; timeout: boolean; reason: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!resp.ok) return { ok: false, timeout: false, reason: `HTTP ${resp.status}` };
    const ct = resp.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) return { ok: false, timeout: false, reason: `non-html content-type: ${ct}` };
    const reader = resp.body?.getReader();
    if (!reader) {
      const txt = await resp.text();
      return { ok: true, raw: txt.slice(0, MAX_BYTES) };
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const concatLen = chunks.reduce((s, c) => s + c.length, 0);
    const merged = new Uint8Array(concatLen);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    return { ok: true, raw: new TextDecoder("utf-8", { fatal: false }).decode(merged.slice(0, MAX_BYTES)) };
  } catch (e) {
    const timedOut = (e as Error).name === "AbortError";
    return { ok: false, timeout: timedOut, reason: timedOut ? `timeout after ${FETCH_TIMEOUT_MS}ms` : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch one page with the full honesty ladder. Accepts bare domains
 *  ("acme.com") — https:// is assumed. */
export async function fetchPage(rawUrl: string): Promise<PageFetchResult> {
  const first = rawUrl.trim().split(/\s/)[0] ?? "";
  const normalized = /^https?:\/\//i.test(first) ? first : `https://${first}`;
  const url = isSafePublicUrl(normalized);
  if (!url) {
    return { url: normalized, status: "unsafe_url", reason: "not a public http(s) URL" };
  }

  const firstFetch = await fetchRawHtml(url);
  if (!firstFetch.ok) {
    return {
      url: url.toString(),
      status: firstFetch.timeout ? "timeout" : "unreachable",
      reason: firstFetch.reason,
    };
  }
  let raw = firstFetch.raw;

  // Follow ONE meta-refresh hop (parked domains + some real sites use it;
  // plain fetch() doesn't), validating the hop target is still public.
  const mr = raw.match(META_REFRESH_REGEX);
  if (mr) {
    try {
      const target = new URL(mr[1].replace(/&amp;/g, "&"), url);
      if (isSafePublicUrl(target.toString())) {
        const hop = await fetchRawHtml(target);
        if (hop.ok) raw = hop.raw;
      }
    } catch { /* keep the first page */ }
  }

  const body = htmlToText(raw);
  const textOnly = body.replace(/^\[META\][^\n]*\n+/, "").trim();
  if (PARKED_RE.test(body)) {
    return { url: url.toString(), status: "parked", reason: "domain appears parked / not a live site" };
  }
  if (textOnly.length < MIN_CONTENT_CHARS) {
    return { url: url.toString(), status: "thin", reason: "no readable content (site may be empty or JavaScript-rendered)" };
  }
  return { url: url.toString(), status: "ok", body, reason: null };
}
