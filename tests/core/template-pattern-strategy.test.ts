/**
 * Comprehensive tests for TemplatePatternStrategy module.
 *
 * Test coverage targets:
 * - Line coverage: ≥95%
 * - Branch coverage: ≥95%
 * - Function coverage: 100%
 *
 * Test categories:
 * 1. Strategy interface compliance
 * 2. Individual strategy behavior
 * 3. Strategy chain priority and fallback
 * 4. Factory functions
 * 5. Edge cases and error conditions
 * 6. Integration with Drain.createTemplate
 */

import { describe, it, expect } from "vitest";
import {
  TemplatePatternStrategyChain,
  ExactMatchStrategy,
  FullTokenParameterizationStrategy,
  AffixPreservingStrategy,
  RegexParameterizationStrategy,
  createDefaultStrategyChain,
  createExtendedStrategyChain,
  createCustomStrategyChain,
  type TemplatePatternStrategy,
  type ParameterizationResult,
} from "../../src/core/TemplatePatternStrategy.js";
import { Drain } from "../../src/core/Drain.js";

// ============================================================
// Test Utilities
// ============================================================

function createMockStrategy(
  name: string,
  result: ParameterizationResult | null,
): TemplatePatternStrategy {
  return {
    name,
    tryParameterize: () => result,
    validate: () => true,
  };
}

// ============================================================
// 1. ExactMatchStrategy Tests
// ============================================================

describe("ExactMatchStrategy", () => {
  const strategy = new ExactMatchStrategy();

  it("should return token when tokens are identical", () => {
    const result = strategy.tryParameterize("hello", "hello", "<*>");
    expect(result).not.toBeNull();
    expect(result!.templateToken).toBe("hello");
    expect(result!.extractedParams).toEqual([]);
    expect(result!.confidence).toBe(1.0);
    expect(result!.strategyName).toBe("exact");
  });

  it("should return null when tokens differ", () => {
    const result = strategy.tryParameterize("hello", "world", "<*>");
    expect(result).toBeNull();
  });

  it("should validate exact matches", () => {
    expect(strategy.validate("hello", "hello", "<*>")).toBe(true);
    expect(strategy.validate("hello", "world", "<*>")).toBe(false);
  });

  it("should handle empty strings", () => {
    const result = strategy.tryParameterize("", "", "<*>");
    expect(result).not.toBeNull();
    expect(result!.templateToken).toBe("");
  });

  it("should handle special characters", () => {
    const result = strategy.tryParameterize(
      "user@example.com",
      "user@example.com",
      "<*>",
    );
    expect(result).not.toBeNull();
    expect(result!.templateToken).toBe("user@example.com");
  });
});

// ============================================================
// 2. FullTokenParameterizationStrategy Tests
// ============================================================

describe("FullTokenParameterizationStrategy", () => {
  const strategy = new FullTokenParameterizationStrategy();

  it("should return paramStr when tokens differ", () => {
    const result = strategy.tryParameterize("hello", "world", "<*>");
    expect(result).not.toBeNull();
    expect(result!.templateToken).toBe("<*>");
    expect(result!.extractedParams).toEqual(["hello", "world"]);
    expect(result!.confidence).toBe(0.5);
    expect(result!.strategyName).toBe("full-token");
  });

  it("should return null when tokens are identical", () => {
    const result = strategy.tryParameterize("hello", "hello", "<*>");
    expect(result).toBeNull();
  });

  it("should validate paramStr templates", () => {
    expect(strategy.validate("<*>", "anything", "<*>")).toBe(true);
    expect(strategy.validate("hello", "world", "<*>")).toBe(false);
  });

  it("should use custom paramStr", () => {
    const result = strategy.tryParameterize("a", "b", ":*:");
    expect(result!.templateToken).toBe(":*:");
  });
});

// ============================================================
// 3. AffixPreservingStrategy Tests
// ============================================================

describe("AffixPreservingStrategy", () => {
  describe("with default minAffixLength=2", () => {
    const strategy = new AffixPreservingStrategy();

    it("should parameterize bytes<N>sent pattern", () => {
      const result = strategy.tryParameterize(
        "bytes0sent",
        "bytes403sent",
        "<*>",
      );
      expect(result).not.toBeNull();
      expect(result!.templateToken).toBe("bytes<*>sent");
      expect(result!.extractedParams).toEqual(["0", "403"]);
      expect(result!.confidence).toBeGreaterThan(0.6);
      expect(result!.strategyName).toBe("affix-preserving");
    });

    it("should parameterize prefix-only pattern", () => {
      const result = strategy.tryParameterize(
        "user123",
        "user456",
        "<*>",
      );
      expect(result).not.toBeNull();
      expect(result!.templateToken).toBe("user<*>");
      expect(result!.extractedParams).toEqual(["123", "456"]);
    });

    it("should parameterize suffix-only pattern", () => {
      const result = strategy.tryParameterize(
        "123end",
        "456end",
        "<*>",
      );
      expect(result).not.toBeNull();
      expect(result!.templateToken).toBe("<*>end");
      expect(result!.extractedParams).toEqual(["123", "456"]);
    });

    it("should return null for short affixes", () => {
      const result = strategy.tryParameterize("a1b", "a2b", "<*>");
      expect(result).toBeNull(); // affix length 1 < minAffixLength 2
    });

    it("should return null for identical tokens", () => {
      const result = strategy.tryParameterize("same", "same", "<*>");
      expect(result).toBeNull();
    });

    it("should return null for completely different tokens", () => {
      const result = strategy.tryParameterize("abc", "xyz", "<*>");
      expect(result).toBeNull();
    });

    it("should validate generated templates", () => {
      expect(strategy.validate("bytes<*>sent", "bytes123sent", "<*>")).toBe(
        true,
      );
      expect(strategy.validate("bytes<*>sent", "bytesent", "<*>")).toBe(false);
      expect(strategy.validate("user<*>", "user123", "<*>")).toBe(true);
    });

    it("should handle invalid regex in validate gracefully", () => {
      // Create a template that would produce invalid regex
      // This tests the try-catch in validate
      const result = strategy.validate("test[", "test[", "<*>");
      // Should not throw, returns boolean
      expect(typeof result).toBe("boolean");
    });
  });

  describe("with custom minAffixLength", () => {
    it("should respect minAffixLength=1", () => {
      const strategy = new AffixPreservingStrategy(1);
      const result = strategy.tryParameterize("a1b", "a2b", "<*>");
      expect(result).not.toBeNull();
      expect(result!.templateToken).toBe("a<*>b");
    });

    it("should respect minAffixLength=5", () => {
      const strategy = new AffixPreservingStrategy(5);
      const result = strategy.tryParameterize(
        "prefix123suffix",
        "prefix456suffix",
        "<*>",
      );
      expect(result).not.toBeNull();
      expect(result!.templateToken).toBe("prefix<*>suffix");
    });
  });

  describe("edge cases", () => {
    const strategy = new AffixPreservingStrategy();

    it("should handle empty middle part", () => {
      const result = strategy.tryParameterize("ab", "ab", "<*>");
      expect(result).toBeNull(); // identical tokens
    });

    it("should handle numbers in middle", () => {
      const result = strategy.tryParameterize(
        "id0001",
        "id9999",
        "<*>",
      );
      expect(result).not.toBeNull();
      expect(result!.templateToken).toBe("id<*>");
    });

    it("should handle special regex characters in affixes", () => {
      const result = strategy.tryParameterize(
        "file[1].log",
        "file[2].log",
        "<*>",
      );
      expect(result).not.toBeNull();
      expect(result!.templateToken).toBe("file[<*>].log");
    });

    it("should return null when confidence is below threshold", () => {
      // Create strategy with high minConfidence
      const strictStrategy = new AffixPreservingStrategy(2, 0.99);
      const result = strictStrategy.tryParameterize(
        "ab1cd",
        "ab2cd",
        "<*>",
      );
      // Confidence = 0.6 + (4/5) * 0.3 = 0.84 < 0.99
      expect(result).toBeNull();
    });

    it("should return null when middles are identical after affix extraction", () => {
      // This tests the edge case where prefix+suffix covers the entire token
      // and the extracted middles are the same
      const result = strategy.tryParameterize(
        "abc",
        "abc",
        "<*>",
      );
      expect(result).toBeNull(); // identical tokens, handled by exact match
    });
  });
});

// ============================================================
// 4. RegexParameterizationStrategy Tests
// ============================================================

describe("RegexParameterizationStrategy", () => {
  const datePattern = {
    regex: /^(\d{4})-(\d{2})-(\d{2})$/,
    template: "${paramStr}-${paramStr}-${paramStr}",
    confidence: 0.95,
  };

  const strategy = new RegexParameterizationStrategy([datePattern]);

  it("should parameterize date patterns", () => {
    const result = strategy.tryParameterize(
      "2024-01-15",
      "2024-12-31",
      "<*>",
    );
    expect(result).not.toBeNull();
    expect(result!.templateToken).toBe("<*>-<*>-<*>");
    expect(result!.extractedParams).toEqual([
      "2024",
      "01",
      "15",
      "2024",
      "12",
      "31",
    ]);
    expect(result!.confidence).toBe(0.95);
  });

  it("should return null for non-matching tokens", () => {
    const result = strategy.tryParameterize("hello", "world", "<*>");
    expect(result).toBeNull();
  });

  it("should return null when only one token matches", () => {
    const result = strategy.tryParameterize("2024-01-15", "hello", "<*>");
    expect(result).toBeNull();
  });

  it("should return null when captured groups are identical", () => {
    const result = strategy.tryParameterize(
      "2024-01-15",
      "2024-01-15",
      "<*>",
    );
    expect(result).toBeNull();
  });

  it("should validate matching tokens", () => {
    expect(strategy.validate("<*>-<*>-<*>", "2024-01-15", "<*>")).toBe(true);
    expect(strategy.validate("<*>-<*>-<*>", "not-a-date", "<*>")).toBe(false);
  });

  it("should handle multiple patterns", () => {
    const multiStrategy = new RegexParameterizationStrategy([
      datePattern,
      {
        regex: /^(\d+):(\d+):(\d+)$/,
        template: "${paramStr}:${paramStr}:${paramStr}",
        confidence: 0.9,
      },
    ]);

    const dateResult = multiStrategy.tryParameterize(
      "2024-01-15",
      "2024-12-31",
      "<*>",
    );
    expect(dateResult).not.toBeNull();

    const timeResult = multiStrategy.tryParameterize(
      "10:30:00",
      "15:45:30",
      "<*>",
    );
    expect(timeResult).not.toBeNull();
    expect(timeResult!.templateToken).toBe("<*>:<*>:<*>");
  });
});

// ============================================================
// 5. TemplatePatternStrategyChain Tests
// ============================================================

describe("TemplatePatternStrategyChain", () => {
  describe("registration and priority", () => {
    it("should register strategies in priority order", () => {
      const chain = new TemplatePatternStrategyChain()
        .register(new FullTokenParameterizationStrategy())
        .register(new ExactMatchStrategy())
        .register(new AffixPreservingStrategy());

      const strategies = chain.getStrategies();
      expect(strategies[0]!.name).toBe("exact");
      expect(strategies[1]!.name).toBe("affix-preserving");
      expect(strategies[2]!.name).toBe("full-token");
    });

    it("should register multiple strategies at once", () => {
      const chain = new TemplatePatternStrategyChain().registerAll([
        new ExactMatchStrategy(),
        new FullTokenParameterizationStrategy(),
      ]);

      expect(chain.size).toBe(2);
    });
  });

  describe("parameterize", () => {
    it("should use exact match for identical tokens", () => {
      const chain = createDefaultStrategyChain();
      const result = chain.parameterize("hello", "hello", "<*>");
      expect(result.templateToken).toBe("hello");
      expect(result.strategyName).toBe("exact");
    });

    it("should use affix-preserving for bytes<N>sent pattern", () => {
      const chain = createExtendedStrategyChain();
      const result = chain.parameterize("bytes0sent", "bytes403sent", "<*>");
      expect(result.templateToken).toBe("bytes<*>sent");
      expect(result.strategyName).toBe("affix-preserving");
    });

    it("should fall back to full-token for completely different tokens", () => {
      const chain = createExtendedStrategyChain();
      const result = chain.parameterize("abc", "xyz", "<*>");
      expect(result.templateToken).toBe("<*>");
      expect(result.strategyName).toBe("full-token");
    });

    it("should return fallback when no strategy matches", () => {
      const chain = new TemplatePatternStrategyChain();
      const result = chain.parameterize("a", "b", "<*>");
      expect(result.templateToken).toBe("<*>");
      expect(result.strategyName).toBe("fallback");
      expect(result.confidence).toBe(0.1);
    });
  });

  describe("validate", () => {
    it("should validate using registered strategies", () => {
      const chain = createExtendedStrategyChain();
      expect(chain.validate("hello", "hello", "<*>")).toBe(true);
      expect(chain.validate("bytes<*>sent", "bytes123sent", "<*>")).toBe(true);
      expect(chain.validate("<*>", "anything", "<*>")).toBe(true);
    });

    it("should fall back to paramStr validation", () => {
      const chain = new TemplatePatternStrategyChain();
      expect(chain.validate("<*>", "anything", "<*>")).toBe(true);
      expect(chain.validate("hello", "world", "<*>")).toBe(false);
    });
  });
});

// ============================================================
// 6. Factory Functions Tests
// ============================================================

describe("Factory Functions", () => {
  describe("createDefaultStrategyChain", () => {
    it("should create Drain3-compatible chain", () => {
      const chain = createDefaultStrategyChain();
      expect(chain.size).toBe(2);

      const strategies = chain.getStrategies();
      expect(strategies[0]!.name).toBe("exact");
      expect(strategies[1]!.name).toBe("full-token");
    });

    it("should behave like Drain3 createTemplate", () => {
      const chain = createDefaultStrategyChain();

      // Same tokens → keep
      expect(chain.parameterize("a", "a", "<*>").templateToken).toBe("a");

      // Different tokens → replace
      expect(chain.parameterize("a", "b", "<*>").templateToken).toBe("<*>");
    });
  });

  describe("createExtendedStrategyChain", () => {
    it("should create chain with affix-preserving", () => {
      const chain = createExtendedStrategyChain();
      expect(chain.size).toBe(3);

      const strategies = chain.getStrategies();
      expect(strategies.map((s) => s.name)).toEqual([
        "exact",
        "affix-preserving",
        "full-token",
      ]);
    });

    it("should respect custom minAffixLength", () => {
      const chain = createExtendedStrategyChain(5);
      // With minAffixLength=5, "abc" (3 chars) is too short, so falls back to full-token
      const result = chain.parameterize("abc123def", "abc456def", "<*>");
      expect(result.templateToken).toBe("<*>");

      // With minAffixLength=5, "prefix" (6 chars) is long enough
      const result2 = chain.parameterize(
        "prefix123suffix",
        "prefix456suffix",
        "<*>",
      );
      expect(result2.templateToken).toBe("prefix<*>suffix");
    });
  });

  describe("createCustomStrategyChain", () => {
    it("should create chain from custom strategies", () => {
      const mockStrategy = createMockStrategy("mock", {
        templateToken: "MOCK",
        extractedParams: [],
        confidence: 0.99,
        strategyName: "mock",
      });

      const chain = createCustomStrategyChain([mockStrategy]);
      expect(chain.size).toBe(1);

      const result = chain.parameterize("a", "b", "<*>");
      expect(result.templateToken).toBe("MOCK");
    });
  });
});

// ============================================================
// 7. Integration with Drain.createTemplate
// ============================================================

describe("Drain.createTemplate Integration", () => {
  it("should use default chain (Drain3 behavior)", () => {
    const drain = new Drain();
    const template = drain.createTemplate(
      ["user", "alice", "logged", "in"],
      ["user", "bob", "logged", "in"],
    );
    expect([...template]).toEqual(["user", "<*>", "logged", "in"]);
  });

  it("should use extended chain for affix-preserving", () => {
    const drain = new Drain({ enableAffixPreserving: true });
    const template = drain.createTemplate(
      ["bytes0sent", "received"],
      ["bytes403sent", "received"],
    );
    expect([...template]).toEqual(["bytes<*>sent", "received"]);
  });

  it("should handle Proxifier-style messages", () => {
    const drain = new Drain({ enableAffixPreserving: true });

    // Simulate Proxifier log processing
    const template1 = drain.createTemplate(
      ["proxy.cse.cuhk.edu.hk:5070", "close,", "0", "bytes", "sent,", "0", "bytes", "received,", "lifetime", "00:01"],
      ["proxy.cse.cuhk.edu.hk:5070", "close,", "403", "bytes", "sent,", "426", "bytes", "received,", "lifetime", "<1"],
    );

    // With affix-preserving, "bytes" + "sent," should become "bytes<*>sent,"
    // But since they're separate tokens, they become <*> <*>
    expect(template1.length).toBe(10);
  });

  it("should throw on length mismatch", () => {
    const drain = new Drain();
    expect(() =>
      drain.createTemplate(["a", "b"], ["a"]),
    ).toThrow("sequence length mismatch");
  });
});

// ============================================================
// 8. Edge Cases and Error Conditions
// ============================================================

describe("Edge Cases", () => {
  it("should handle empty token sequences", () => {
    const drain = new Drain();
    const template = drain.createTemplate([], []);
    expect([...template]).toEqual([]);
  });

  it("should handle single token sequences", () => {
    const drain = new Drain({ enableAffixPreserving: true });
    const template = drain.createTemplate(["bytes0sent"], ["bytes403sent"]);
    expect([...template]).toEqual(["bytes<*>sent"]);
  });

  it("should handle unicode characters", () => {
    const drain = new Drain({ enableAffixPreserving: true });
    const template = drain.createTemplate(
      ["用户123登录"],
      ["用户456登录"],
    );
    expect([...template]).toEqual(["用户<*>登录"]);
  });

  it("should handle very long tokens", () => {
    const longToken1 = "a".repeat(1000) + "123" + "b".repeat(1000);
    const longToken2 = "a".repeat(1000) + "456" + "b".repeat(1000);

    const drain = new Drain({ enableAffixPreserving: true });
    const template = drain.createTemplate([longToken1], [longToken2]);
    expect(template[0]).toBe("a".repeat(1000) + "<*>" + "b".repeat(1000));
  });

  it("should handle special regex characters in tokens", () => {
    const drain = new Drain({ enableAffixPreserving: true });
    const template = drain.createTemplate(
      ["file[1].log"],
      ["file[2].log"],
    );
    expect([...template]).toEqual(["file[<*>].log"]);
  });
});

// ============================================================
// 9. Regression Tests (Drain3 Compatibility)
// ============================================================

describe("Drain3 Compatibility Regression", () => {
  it("should match Drain3 createTemplate behavior exactly", () => {
    const drain = new Drain(); // default = Drain3 compatible

    const testCases: Array<[string[], string[], string[]]> = [
      // [seq1, seq2, expected]
      [["a", "b", "c"], ["a", "b", "c"], ["a", "b", "c"]],
      [["a", "b", "c"], ["a", "x", "c"], ["a", "<*>", "c"]],
      [["a", "b"], ["x", "y"], ["<*>", "<*>"]],
      [[], [], []],
      [["single"], ["single"], ["single"]],
      [["single"], ["other"], ["<*>"]],
    ];

    for (const [seq1, seq2, expected] of testCases) {
      const result = drain.createTemplate(seq1, seq2);
      expect([...result]).toEqual(expected);
    }
  });

  it("should preserve Drain3 behavior with enableAffixPreserving=false", () => {
    const drain = new Drain({ enableAffixPreserving: false });

    // Even with affix pattern, should use full-token replacement
    const result = drain.createTemplate(["bytes0sent"], ["bytes403sent"]);
    expect([...result]).toEqual(["<*>"]);
  });
});
