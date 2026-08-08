/** Read-tracking — the dependency graph, observed rather than declared.
 *
 *  Every planning decision depends on some subset of what the system believes.
 *  Knowing that subset is what makes three things possible: recompiling only
 *  the part a new observation invalidated, computing whether a question would
 *  change anything, and telling the operator WHY a department exists.
 *
 *  The obvious way to get it is to declare it — a table saying "customer
 *  success depends on customer count, support volume, retention goal". That is
 *  the wrong way, and this codebase has already paid for it twice: a manifest
 *  goal read as `goal.metric` when the field is `kpiId`, and a schema field
 *  `inference_confirmed` documented as driving low-confidence flags that no
 *  code implements. **A declaration drifts from the code that reads it, and
 *  the compiler cannot see the drift.**
 *
 *  So don't declare it — observe it. Wrap the inputs in a recording proxy and
 *  let the computation say what it touched. The dependency set is then exact
 *  by construction, always current, and impossible to forget to update.
 *
 *  This is the same trick reactive systems use for signal dependencies. It
 *  works here for one specific reason: the planner is already PURE. That was
 *  done for idempotency — "threaded in rather than read from disk so this
 *  stays a pure function of its inputs, which is what makes re-derivation
 *  reproduce the same checklist" — and it turns out to be the precondition for
 *  every interesting thing in this architecture. */

/** A dotted path into the input object, e.g. `pillar_3.product_state`. */
export type BeliefKey = string;

export interface TrackedRun<T> {
  result: T;
  /** Every path the computation actually read, in first-touch order.
   *  Deduplicated; parent paths are dropped when a child was read, because
   *  `pillar_3` being touched only to reach `product_state` is not a
   *  dependency on the whole pillar. */
  reads: BeliefKey[];
}

/** Wrap a plain object so every property read is recorded, at any depth.
 *
 *  Only plain objects and arrays are proxied. Dates, Maps, Sets and class
 *  instances are returned untouched — proxying them breaks internal-slot
 *  access, and none of the planner's inputs are of those kinds. */
function proxy<T>(value: T, path: string, seen: Set<string>): T {
  if (value === null || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return value;

  return new Proxy(value as object, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      const child = path ? `${path}.${String(prop)}` : String(prop);
      // Array length and iteration are structural, not belief reads — a
      // computation that maps over lead_sources depends on the array, not on
      // `lead_sources.length` as a separate fact.
      if (Array.isArray(target) && (prop === "length" || !Number.isNaN(Number(prop)))) {
        return proxy(Reflect.get(target, prop, receiver), path, seen);
      }
      seen.add(child);
      return proxy(Reflect.get(target, prop, receiver), child, seen);
    },
    // The planner is pure; a write means somebody broke that, and finding out
    // loudly is better than a dependency graph that quietly lies.
    set(_t, prop) {
      throw new Error(`read-tracker: the planner wrote to ${path}.${String(prop)} — it must stay pure`);
    },
  }) as T;
}

/** Drop `a.b` when `a.b.c` was also read. The leaf is the real dependency. */
function leavesOnly(reads: Set<string>): BeliefKey[] {
  const all = [...reads];
  return all.filter((r) => !all.some((other) => other !== r && other.startsWith(`${r}.`)));
}

/** Run `fn` against `input`, recording what it read.
 *
 *  ```ts
 *  const { result, reads } = track(sources, (s) => deriveDepartments(s));
 *  // reads === ["pillar_4.sales_motion", "pillar_3.product_state"]
 *  ```
 */
export function track<I extends object, T>(input: I, fn: (tracked: I) => T): TrackedRun<T> {
  const seen = new Set<string>();
  const result = fn(proxy(input, "", seen));
  return { result, reads: leavesOnly(seen) };
}

/** Which of `reads` a set of changed keys invalidates.
 *
 *  A change to `pillar_4` invalidates a dependency on
 *  `pillar_4.sales_motion`, and a change to `pillar_4.sales_motion`
 *  invalidates a dependency on `pillar_4` — containment runs both ways,
 *  because either direction means the value the computation saw may differ. */
export function invalidatedBy(reads: BeliefKey[], changed: BeliefKey[]): BeliefKey[] {
  return reads.filter((r) =>
    changed.some((c) => r === c || r.startsWith(`${c}.`) || c.startsWith(`${r}.`)));
}

/** The paths at which two input objects differ. The other half of
 *  invalidation: given an old and a new belief state, what moved. */
export function diffKeys(a: unknown, b: unknown, path = ""): BeliefKey[] {
  if (a === b) return [];
  const bothObjects = a !== null && b !== null && typeof a === "object" && typeof b === "object"
    && !Array.isArray(a) && !Array.isArray(b);
  if (!bothObjects) {
    return JSON.stringify(a) === JSON.stringify(b) ? [] : [path || "(root)"];
  }
  const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
  const out: BeliefKey[] = [];
  for (const k of keys) {
    out.push(...diffKeys(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
      path ? `${path}.${k}` : k,
    ));
  }
  return out;
}
