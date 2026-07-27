/**
 * Reproduction test for Spark/Thunderbird evaluateCompact failure.
 * Creates 16M synthetic entries simulating the Spark dataset structure.
 */
import { evaluateCompact } from "../../benchmark/evaluator.js";
import { describe, it } from "vitest";

describe("evaluateCompact 16M stress test", () => {
  it("should handle 16M messages without error", { timeout: 120_000 }, () => {
    const n = 16_000_000;
    const gtIds = new Array<number>(n);
    const cIds = new Array<number>(n);
    const gtMap = new Map<number, string[]>();
    const pMap = new Map<number, string[]>();

    // Simulate Spark-like data: 200+ GT templates, hundreds of parser clusters
    for (let i = 0; i < 300; i++) {
      gtMap.set(i, ["token" + i, "<*>", "param"]);
      pMap.set(i, ["token" + i, "<*>", "param"]);
    }

    for (let i = 0; i < n; i++) {
      gtIds[i] = i % 300;
      cIds[i] = i % 250;
    }

    console.error(`[test] Starting evaluateCompact with ${n} entries...`);
    const start = Date.now();
    const r = evaluateCompact({
      gtTemplateIds: gtIds,
      clusterIds: cIds,
      gtTemplateTokens: gtMap,
      parsedTemplateTokens: pMap,
      totalMessages: n,
    });
    console.error(`[test] Done in ${Date.now() - start}ms: GA=${r.groupAccuracy.toFixed(4)}`);
  });
});
