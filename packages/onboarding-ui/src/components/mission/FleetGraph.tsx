/** Mission Control fleet visualization — fetches the activated fleet from
 *  the DB-backed /api/agents endpoint and hands it to the shared OrgGraph. */

import { useEffect, useState } from "react";
import { useCompany } from "../../wavex-os/lib/CompanyContext";
import { OrgGraph, type OrgAgent } from "../OrgGraph";

interface AgentRecord {
  agentId: string;
  slot: string;
  templateId: string;
  reportsToSlot?: string;
  ownedKpiIds?: string[];
  status: "pending" | "spawning" | "ready" | "failed";
  spawnedAt?: string;
}

export function FleetGraph() {
  const { companyId } = useCompany();
  const [agents, setAgents] = useState<AgentRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setAgents(null);
      return;
    }
    let alive = true;
    async function load() {
      try {
        const url = `/api/agents?companyId=${encodeURIComponent(companyId!)}`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`agents fetch ${resp.status}`);
        const json = await resp.json();
        if (alive) setAgents(json.agents ?? []);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    load();
    const id = setInterval(load, 8_000);
    return () => { alive = false; clearInterval(id); };
  }, [companyId]);

  if (error) {
    return (
      <div className="card" style={{ borderColor: "var(--warning)", color: "var(--warning)" }}>
        Failed to load fleet: {error}. Is mock-core running?
      </div>
    );
  }

  // "Loading" is a claim that a request is in flight. With no company
  // selected the effect above returns before fetching anything, so `agents`
  // stayed null and this card said "Loading fleet…" forever — about a
  // request that was never made and never would be. An empty state has to
  // say what the system is waiting for, and here it is waiting on the
  // operator, not on the network.
  if (!companyId) {
    return (
      <div className="card text-dim">
        No company selected — pick one above to see its fleet.
      </div>
    );
  }

  if (agents === null) {
    return <div className="card text-dim">Loading fleet…</div>;
  }

  if (agents.length === 0) {
    return (
      <div className="card">
        <h3 style={{ marginTop: 0 }}>No agents yet</h3>
        <p className="text-dim" style={{ margin: 0 }}>
          Run onboarding to spawn your fleet, or POST <code>/api/paperclip/spawn</code> directly.
        </p>
      </div>
    );
  }

  const orgAgents: OrgAgent[] = agents.map((a) => ({
    id: a.agentId,
    slot: a.slot,
    templateId: a.templateId,
    reportsToSlot: a.reportsToSlot,
    status: a.status,
  }));

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ margin: 0, fontSize: 16, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Fleet · {agents.length} agents
        </h2>
        <span className="text-dim" style={{ fontSize: 11 }}>
          {agents.filter((a) => a.status === "ready").length} ready ·{" "}
          {agents.filter((a) => a.status === "spawning").length} spawning ·{" "}
          {agents.filter((a) => a.status === "failed").length} failed
        </span>
      </div>
      <OrgGraph agents={orgAgents} />
    </div>
  );
}
