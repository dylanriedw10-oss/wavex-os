/** The hardened URL reader — the honesty ladder Path B depends on.
 *  Network is stubbed: each fixture drives one status outcome. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPage, htmlToText, isSafePublicUrl } from "../src/lib/url-prefetch.js";

function htmlResponse(body: string, init?: { status?: number; contentType?: string }): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: { "content-type": init?.contentType ?? "text/html; charset=utf-8" },
  });
}

const REAL_PAGE = `<html><head><meta name="description" content="Acme ships robots"></head><body>
  <h1>Acme Robotics</h1>
  <p>${"We build industrial robot arms for mid-size manufacturers. ".repeat(8)}</p>
</body></html>`;

afterEach(() => vi.unstubAllGlobals());

describe("isSafePublicUrl", () => {
  it("blocks private hosts and non-http schemes", () => {
    for (const bad of ["http://localhost/x", "http://127.0.0.1/", "http://10.1.2.3/", "http://192.168.1.5/", "http://172.16.0.1/", "file:///etc/passwd", "ftp://example.com"]) {
      expect(isSafePublicUrl(bad)).toBeNull();
    }
    expect(isSafePublicUrl("https://example.com/page")).not.toBeNull();
  });
});

describe("htmlToText", () => {
  it("drops scripts, keeps meta description, keeps body text", () => {
    const t = htmlToText(REAL_PAGE.replace("<h1>", "<script>evil()</script><h1>"));
    expect(t).toContain("[META] Acme ships robots");
    expect(t).toContain("Acme Robotics");
    expect(t).not.toContain("evil()");
  });
});

describe("fetchPage status ladder", () => {
  it("unsafe_url — never touches the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await fetchPage("http://localhost:3000");
    expect(r.status).toBe("unsafe_url");
    expect(spy).not.toHaveBeenCalled();
  });

  it("ok — real content comes back extracted, bare domains get https", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(REAL_PAGE)));
    const r = await fetchPage("acme-robotics.com");
    expect(r.url).toBe("https://acme-robotics.com/");
    expect(r.status).toBe("ok");
    expect(r.body).toContain("Acme Robotics");
    expect(r.reason).toBeNull();
  });

  it("parked — fingerprinted parking pages are named, not summarized", async () => {
    const parked = `<html><body><h1>This domain is for sale!</h1><p>buy this domain today ${"filler text ".repeat(30)}</p></body></html>`;
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(parked)));
    const r = await fetchPage("https://parked-domain.com");
    expect(r.status).toBe("parked");
  });

  it("thin — a JS-only shell is failed honestly, not hallucinated from", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("<html><body><div id=root></div></body></html>")));
    const r = await fetchPage("https://spa-only.com");
    expect(r.status).toBe("thin");
  });

  it("unreachable — HTTP errors carry the status code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("gone", { status: 404 })));
    const r = await fetchPage("https://dead.example.com");
    expect(r.status).toBe("unreachable");
    expect(r.reason).toContain("404");
  });

  it("follows one meta-refresh hop to the real page", async () => {
    const stub = `<html><head><meta http-equiv="refresh" content="0;url=https://real-site.example.com/home"></head><body>redirecting</body></html>`;
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      return u.includes("real-site") ? htmlResponse(REAL_PAGE) : htmlResponse(stub);
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPage("https://redirector.example.com");
    expect(r.status).toBe("ok");
    expect(r.body).toContain("Acme Robotics");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a meta-refresh hop to a PRIVATE host is refused — the first page stands", async () => {
    const stub = `<html><head><meta http-equiv="refresh" content="0;url=http://169.254.169.254/latest/meta-data"></head><body>tiny</body></html>`;
    const fetchMock = vi.fn(async () => htmlResponse(stub));
    vi.stubGlobal("fetch", fetchMock);
    const r = await fetchPage("https://ssrf-attempt.example.com");
    expect(fetchMock).toHaveBeenCalledTimes(1);   // never followed the hop
    expect(r.status).toBe("thin");                // the stub itself has no content
  });
});
