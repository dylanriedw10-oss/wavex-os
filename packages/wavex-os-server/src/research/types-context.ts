/** Context shapes the research prompt consumes.
 *
 *  Kept beside `types.ts` rather than inside it because these describe the
 *  INPUT to research (what the caller assembles), while `types.ts` describes
 *  its OUTPUT (what every consumer reads). The work runtime will assemble a
 *  different input for the same phase; only the output contract is shared. */

/** A connector as research needs to see it: which bucket the plan put it in,
 *  and whether it is actually wired. Both halves matter — a required
 *  connector that is still `pending` is a constraint, not a capability. */
export interface ConnectorEntry {
  id: string;
  bucket: "required" | "suggested" | "deferred";
  status: string;
}
