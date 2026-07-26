/**
 * Browser-compatible test bundle for drain-ts core algorithm.
 *
 * Pure runtime: no Node.js APIs. Exports constructors and test functions
 * to `globalThis` for Playwright assertion.
 */
import { Drain } from "./core/Drain.js";
import { JaccardDrain } from "./core/JaccardDrain.js";
import { LogMasker } from "./masker/LogMasker.js";
import { DEFAULT_MASKING_INSTRUCTIONS } from "./masker/presets.js";
import { LRUCache } from "./LRUCache.js";
import { ChangeType, MatchStrategy } from "./core/types.js";

const g = globalThis as Record<string, unknown>;
g["Drain"] = Drain;
g["JaccardDrain"] = JaccardDrain;
g["LogMasker"] = LogMasker;
g["DEFAULT_MASKING_INSTRUCTIONS"] = DEFAULT_MASKING_INSTRUCTIONS;
g["LRUCache"] = LRUCache;
g["ChangeType"] = ChangeType;
g["MatchStrategy"] = MatchStrategy;

function drainBasic(): boolean {
  const d = new Drain({ depth: 4, simTh: 0.4 });
  d.addLogMessage("user alice in");
  d.addLogMessage("user bob in");
  const r3 = d.addLogMessage("user carol in");
  return r3.cluster.getTemplate() === "user <*> in" && d.idToCluster.size === 1;
}

function jaccardDrain(): boolean {
  const d = new JaccardDrain({ depth: 4 });
  d.addLogMessage("session opened for user alice by (uid=0)");
  d.addLogMessage("session closed for user alice");
  return d.idToCluster.size >= 1;
}

function masking(): boolean {
  const m = new LogMasker(DEFAULT_MASKING_INSTRUCTIONS, "<", ">");
  return m.mask("connection from 192.168.1.1 port 8080").includes("<IP>");
}

function lruCache(): boolean {
  const c = new LRUCache<string, string>(2);
  c.set("a", "1"); c.set("b", "2"); c.set("c", "3");
  return c.get("a") === undefined && c.get("c") === "3";
}

function matchInference(): boolean {
  const d = new Drain();
  d.addLogMessage("hello world one");
  d.addLogMessage("hello world two");
  d.addLogMessage("goodbye world");
  return d.match("hello world three", MatchStrategy.Never)?.clusterId === 1;
}

function runAll(): Record<string, boolean> {
  return {
    drainBasic: drainBasic(),
    jaccardDrain: jaccardDrain(),
    masking: masking(),
    lruCache: lruCache(),
    matchInference: matchInference(),
  };
}

g["__drainBrowserTests"] = { runAll, drainBasic, jaccardDrain, masking, lruCache, matchInference };
