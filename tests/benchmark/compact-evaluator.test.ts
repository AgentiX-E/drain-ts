import { evaluateCompact } from "../../benchmark/evaluator.js";
import { describe, it, expect } from "vitest";

describe("evaluateCompact edge cases", () => {
  it("handles empty data", () => {
    const r = evaluateCompact({
      gtTemplateIds: [], clusterIds: [],
      gtTemplateTokens: new Map(), parsedTemplateTokens: new Map(),
      totalMessages: 0,
    });
    expect(r.groupAccuracy).toBe(1.0);
  });

  it("handles missing cluster tokens", () => {
    const r = evaluateCompact({
      gtTemplateIds: [1],
      clusterIds: [100],
      gtTemplateTokens: new Map([[1, ["a", "b"]]]),
      parsedTemplateTokens: new Map(), // cluster 100 has no tokens!
      totalMessages: 1,
    });
    expect(r.groupAccuracy).toBeDefined();
    expect(r.parserClusterCount).toBe(1); // cluster 100 counts even without tokens
  });

  it("handles 100k messages with mixed templates", () => {
    const n = 100_000;
    const gtIds = new Array<number>(n);
    const cIds = new Array<number>(n);
    const gtMap = new Map<number, string[]>();
    gtMap.set(1, ["a", "b", "c"]);
    gtMap.set(2, ["x", "y", "z"]);
    const parsedMap = new Map<number, string[]>();
    parsedMap.set(10, ["a", "<*>", "c"]);
    parsedMap.set(20, ["x", "y", "z"]);

    for (let i = 0; i < n; i++) {
      gtIds[i] = i < n / 2 ? 1 : 2;
      cIds[i] = i < n / 2 ? 10 : 20;
    }

    const r = evaluateCompact({
      gtTemplateIds: gtIds,
      clusterIds: cIds,
      gtTemplateTokens: gtMap,
      parsedTemplateTokens: parsedMap,
      totalMessages: n,
    });
    expect(r.groupAccuracy).toBeGreaterThan(0.9);
    expect(r.totalMessages).toBe(n);
  });
});
