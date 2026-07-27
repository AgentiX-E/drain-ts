/**
 * Edge case coverage tests for I22 coverage hardening.
 */
import { describe, it, expect } from "vitest";
import { Drain } from "../../src/core/Drain.js";
import { JaccardDrain } from "../../src/core/JaccardDrain.js";
import { TemplateMinerConfig } from "../../src/TemplateMinerConfig.js";
import { LogCluster } from "../../src/core/LogCluster.js";

describe("Drain edge cases", () => {
  it("handles empty message with param binning", () => {
    const drain = new Drain({ enableParamBinning: true });
    const res = drain.addLogMessage("");
    expect(res.cluster.getTemplate()).toBe("");
  });

  it("handles single token with param binning", () => {
    const drain = new Drain({ enableParamBinning: true });
    drain.addLogMessage("hello");
    expect(drain.idToCluster.size).toBe(1);
  });

  it("getRootKey with param binning", () => {
    const drain = new Drain({ enableParamBinning: true });
    const res = drain.addLogMessage("user alice logged");
    const res2 = drain.addLogMessage("user bob logged");
    // Both are clustered with paramStr at position 1
    expect(res2.cluster.getTemplate()).toContain("<*>");
  });

  it("getRootKey without param binning", () => {
    const drain = new Drain({ enableParamBinning: false });
    drain.addLogMessage("a b c");
    expect(drain.idToCluster.size).toBe(1);
  });

  it("buildStrategyChain with custom strategies", () => {
    const drain = new Drain({
      templatePatternStrategies: [], // empty custom strategies
    });
    drain.addLogMessage("hello world");
    expect(drain.idToCluster.size).toBe(1);
  });

  it("buildStrategyChain with regex patterns", () => {
    const drain = new Drain({
      customRegexPatterns: [
        { regex: /^(\\d+)$/, template: "${paramStr}" },
      ],
    });
    drain.addLogMessage("123");
    expect(drain.idToCluster.size).toBe(1);
  });
});

describe("JaccardDrain edge cases", () => {
  it("handles empty messages", () => {
    const drain = new JaccardDrain();
    const res = drain.addLogMessage("");
    expect(res.cluster.getTemplate()).toBe("");
  });

  it("handles single token", () => {
    const drain = new JaccardDrain();
    drain.addLogMessage("hello");
    expect(drain.idToCluster.size).toBe(1);
  });

  it("match with fallback", () => {
    const drain = new JaccardDrain();
    drain.addLogMessage("a b c");
    const match = drain.match("a b c", "fallback" as any);
    expect(match).not.toBeNull();
  });

  it("match with always", () => {
    const drain = new JaccardDrain();
    drain.addLogMessage("x y z");
    const match = drain.match("x y z", "always" as any);
    expect(match).not.toBeNull();
  });
});

describe("TemplateMinerConfig edge cases", () => {
  it("fromIni parses enable_affix_preserving", () => {
    const ini = `[DRAIN]\nenable_affix_preserving = True\nmin_affix_length = 5`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.enableAffixPreserving).toBe(true);
    expect(config.minAffixLength).toBe(5);
  });

  it("fromIni parses engine field", () => {
    const ini = `[DRAIN]\nengine = JaccardDrain`;
    const config = TemplateMinerConfig.fromIni(ini);
    expect(config.engine).toBe("JaccardDrain");
  });

  it("from handles partial config correctly", () => {
    const config = TemplateMinerConfig.from({
      enableAdjacentFusion: true,
      minFusionTokenLength: 3,
    });
    expect(config.enableAdjacentFusion).toBe(true);
    expect(config.minFusionTokenLength).toBe(3);
    // Other fields stay default
    expect(config.depth).toBe(4);
  });

  it("buildStrategyChain returns proper chain", () => {
    const config = new TemplateMinerConfig();
    const chain = config.buildStrategyChain();
    // Default chain has 2 strategies (ExactMatch, FullToken)
    expect(chain.size).toBeGreaterThan(0);
  });

  it("buildStrategyChain with affix preserving", () => {
    const config = TemplateMinerConfig.from({ enableAffixPreserving: true });
    const chain = config.buildStrategyChain();
    expect(chain.size).toBeGreaterThan(2); // ExactMatch + AffixPreserving + FullToken
  });

  it("buildStrategyChain with regex patterns", () => {
    const config = TemplateMinerConfig.from({
      customRegexPatterns: [{ regex: /\d+/, template: "${paramStr}" }],
    });
    const chain = config.buildStrategyChain();
    expect(chain.size).toBeGreaterThan(2); // ExactMatch + Regex + FullToken
  });
});

describe("DrainBase.isMaskedParam", () => {
  it("returns true for masked tokens", () => {
    const drain = new Drain();
    expect(drain.isMaskedParam("<NUM>")).toBe(true);
    expect(drain.isMaskedParam("<IP>")).toBe(true);
  });

  it("returns false for non-masked tokens", () => {
    const drain = new Drain();
    expect(drain.isMaskedParam("hello")).toBe(false);
    expect(drain.isMaskedParam("<*>")).toBe(false); // paramStr itself
    expect(drain.isMaskedParam("<>")).toBe(false); // too short
  });
});

describe("Cluster edge cases", () => {
  it("LogCluster constructor and getTemplate", () => {
    const cluster = new LogCluster(["a", "b", "c"], 1);
    expect(cluster.clusterId).toBe(1);
    expect(cluster.getTemplate()).toBe("a b c");
    expect(cluster.size).toBe(1);
  });

  it("LogCluster token modification", () => {
    const cluster = new LogCluster(["a", "b"], 1);
    cluster.logTemplateTokens = ["x", "<*>"];
    expect(cluster.getTemplate()).toBe("x <*>");
  });

  it("Drain.getRootKey with empty tokens", () => {
    const drain = new Drain({ enableParamBinning: true });
    // @ts-expect-error accessing protected method
    const key = drain.getRootKey([]);
    expect(key).toBe("0#0");
  });
});
