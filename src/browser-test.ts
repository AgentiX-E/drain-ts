/**
 * Browser-compatible test bundle for drain-ts core algorithm.
 *
 * Exercises Drain, JaccardDrain, LogCluster, masking, and LRU cache
 * in a pure browser environment (no Node.js APIs).
 *
 * This script is bundled by tsup and served to Playwright for testing.
 */
import { Drain } from "./core/Drain.js";
import { JaccardDrain } from "./core/JaccardDrain.js";
import { LogCluster } from "./core/LogCluster.js";
import { LogMasker } from "./masker/LogMasker.js";
import { MaskingInstruction } from "./masker/MaskingInstruction.js";
import { DEFAULT_MASKING_INSTRUCTIONS } from "./masker/presets.js";
import { LRUCache } from "./LRUCache.js";
import { ChangeType, MatchStrategy } from "./core/types.js";

// Expose test API to window for Playwright assertions
declare global {
  interface Window {
    __drainBrowserTests: {
      runAll: () => Record<string, boolean>;
      drainBasic: () => boolean;
      jaccardDrain: () => boolean;
      masking: () => boolean;
      lruCache: () => boolean;
      matchInference: () => boolean;
    };
  }
}

function drainBasic(): boolean {
  const drain = new Drain({ depth: 4, simTh: 0.4 });
  const r1 = drain.addLogMessage("user alice logged in");
  const r2 = drain.addLogMessage("user bob logged in");
  const r3 = drain.addLogMessage("user carol logged in");

  return (
    r1.changeType === ChangeType.ClusterCreated &&
    r2.changeType === ChangeType.ClusterTemplateChanged &&
    r3.changeType === ChangeType.None &&
    r3.cluster.getTemplate() === "user <*> logged in" &&
    drain.idToCluster.size === 1
  );
}

function jaccardDrain(): boolean {
  const d = new JaccardDrain({ depth: 4 });
  d.addLogMessage("session opened for user alice by (uid=0)");
  d.addLogMessage("session closed for user alice");
  // JaccardDrain handles variable-length sequences
  return d.idToCluster.size >= 1;
}

function masking(): boolean {
  const masker = new LogMasker(DEFAULT_MASKING_INSTRUCTIONS, "<", ">");
  const result = masker.mask("connection from 192.168.1.1 port 8080");
  return result.includes("<IP>") && result.includes("<NUM>");
}

function lruCache(): boolean {
  const cache = new LRUCache<string, string>(2);
  cache.set("a", "1");
  cache.set("b", "2");
  cache.set("c", "3"); // evicts "a"
  return cache.get("a") === undefined && cache.get("c") === "3";
}

function matchInference(): boolean {
  const drain = new Drain();
  drain.addLogMessage("hello world one");
  drain.addLogMessage("hello world two");
  drain.addLogMessage("goodbye world");

  const match = drain.match("hello world three", MatchStrategy.Never);
  return match !== null && match.clusterId === 1;
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

window.__drainBrowserTests = {
  runAll,
  drainBasic,
  jaccardDrain,
  masking,
  lruCache,
  matchInference,
};

// Also expose constructors for direct Playwright testing
const g = globalThis as any;
g.Drain = Drain;
g.JaccardDrain = JaccardDrain;
g.LogCluster = LogCluster;
g.LogMasker = LogMasker;
g.MaskingInstruction = MaskingInstruction;
g.DEFAULT_MASKING_INSTRUCTIONS = DEFAULT_MASKING_INSTRUCTIONS;
g.LRUCache = LRUCache;
g.ChangeType = ChangeType;
g.MatchStrategy = MatchStrategy;
