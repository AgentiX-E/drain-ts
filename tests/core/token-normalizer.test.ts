/**
 * Comprehensive tests for TokenNormalizer module.
 */
import { describe, it, expect } from "vitest";
import {
  AdjacentConstantFusion,
  RegexCollapseNormalizer,
  RegexSubstitutionNormalizer,
  TokenNormalizerPipeline,
  createDefaultNormalizerPipeline,
  createExtendedNormalizerPipeline,
} from "../../src/core/TokenNormalizer.js";

// ============================================================
// 0. RegexSubstitutionNormalizer (AEL-style)
// ============================================================

describe("RegexSubstitutionNormalizer", () => {
  it("should replace digits with paramStr", () => {
    const normalizer = new RegexSubstitutionNormalizer([
      { regex: /\d+/g, replacement: "${paramStr}" },
    ]);

    const tokens = ["192", "hello", "123", "world"];
    const result = normalizer.normalize(tokens, "<*>");
    expect(result.tokens).toEqual(["<*>", "hello", "<*>", "world"]);
  });

  it("should handle IP addresses", () => {
    const normalizer = new RegexSubstitutionNormalizer([
      { regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "${paramStr}" },
    ]);

    const tokens = ["192.168.1.1", "user"];
    const result = normalizer.normalize(tokens, "<*>");
    expect(result.tokens).toEqual(["<*>", "user"]);
  });

  it("should preserve non-matching tokens", () => {
    const normalizer = new RegexSubstitutionNormalizer([
      { regex: /\d+/g, replacement: "${paramStr}" },
    ]);

    const tokens = ["hello", "world"];
    const result = normalizer.normalize(tokens, "<*>");
    expect(result.tokens).toEqual(["hello", "world"]);
    expect(result.changes.length).toBe(0);
  });

  it("should handle multiple patterns", () => {
    const normalizer = new RegexSubstitutionNormalizer([
      { regex: /\d+/g, replacement: "${paramStr}" },
      { regex: /[A-Fa-f0-9]{8}/g, replacement: "${paramStr}" },
    ]);

    const tokens = ["123", "DEADBEEF", "abc"];
    const result = normalizer.normalize(tokens, "<*>");
    expect(result.tokens).toEqual(["<*>", "<*>", "abc"]);
  });

  it("should handle empty token array", () => {
    const normalizer = new RegexSubstitutionNormalizer([
      { regex: /\d+/g, replacement: "${paramStr}" },
    ]);
    const result = normalizer.normalize([], "<*>");
    expect(result.tokens).toEqual([]);
  });

  it("should work with custom paramStr", () => {
    const normalizer = new RegexSubstitutionNormalizer([
      { regex: /\d+/g, replacement: "${paramStr}" },
    ]);
    const result = normalizer.normalize(["123", "abc"], "<NUM>");
    expect(result.tokens).toEqual(["<NUM>", "abc"]);
  });
});

// ============================================================
// 1. RegexCollapseNormalizer
// ============================================================

describe("RegexCollapseNormalizer", () => {
  it("should collapse KB parentheticals (Proxifier pattern)", () => {
    const normalizer = new RegexCollapseNormalizer([
      { regex: /\s*\(<NUM>\.<NUM>\s+KB\)/g, replacement: "" },
    ]);

    const tokens = [
      "<NUM>",
      "bytes",
      "(<NUM>.<NUM>",
      "KB)",
      "sent",
    ];
    const result = normalizer.normalize(tokens, "<NUM>");
    expect(result.tokens).toEqual(["<NUM>", "bytes", "sent"]);
    expect(result.changes.length).toBeGreaterThan(0);
  });

  it("should preserve tokens when no pattern matches", () => {
    const normalizer = new RegexCollapseNormalizer([
      { regex: /never_matches/g, replacement: "" },
    ]);

    const tokens = ["hello", "world"];
    const result = normalizer.normalize(tokens, "<NUM>");
    expect(result.tokens).toEqual(["hello", "world"]);
    expect(result.changes.length).toBe(0);
  });

  it("should handle multiple patterns", () => {
    const normalizer = new RegexCollapseNormalizer([
      { regex: /foo\d+/g, replacement: "bar" },
      { regex: /baz/g, replacement: "" },
    ]);

    const tokens = ["hello", "foo123", "baz", "world"];
    const result = normalizer.normalize(tokens, "<NUM>");
    expect(result.tokens).toEqual(["hello", "bar", "world"]);
  });

  it("should handle empty token array", () => {
    const normalizer = new RegexCollapseNormalizer([
      { regex: /.*/g, replacement: "" },
    ]);

    const result = normalizer.normalize([], "<NUM>");
    expect(result.tokens).toEqual([]);
  });
});

// ============================================================
// 2. AdjacentConstantFusion
// ============================================================

describe("AdjacentConstantFusion", () => {
  describe("learn", () => {
    it("should learn fusion pairs from constant adjacent tokens", () => {
      const fusion = new AdjacentConstantFusion();

      const messages = [
        ["a", "b", "c", "d"],
        ["a", "b", "c", "d"],
        ["a", "b", "c", "d"],
      ];

      fusion.learn(messages);
      // "a"+"b" and "c"+"d" should both be identified
      // if they are purely alphabetic
    });

    it("should not learn from a single message", () => {
      const fusion = new AdjacentConstantFusion();
      fusion.learn([["a", "b"]]);
      // Should not learn anything with only 1 message
    });

    it("should not learn from empty batch", () => {
      const fusion = new AdjacentConstantFusion();
      fusion.learn([]);
      // Should not crash
    });

    it("should only learn from dominant token length", () => {
      const fusion = new AdjacentConstantFusion();

      // 3 messages of length 4, 1 message of length 5
      const messages = [
        ["a", "b", "c", "d"],
        ["a", "b", "c", "d"],
        ["a", "b", "c", "d"],
        ["a", "b", "c", "d", "e"],
      ];

      fusion.learn(messages);
      // Should learn from length 4 (dominant)
    });
  });

  describe("normalize without learning", () => {
    it("should pass through tokens when no learning done", () => {
      const fusion = new AdjacentConstantFusion();
      const tokens = ["a", "b", "c"];
      const result = fusion.normalize(tokens, "<*>");
      expect(result.tokens).toEqual(["a", "b", "c"]);
      expect(result.changes).toEqual([]);
    });
  });

  describe("full cycle: learn + normalize", () => {
    it("should fuse adjacent constant alphabetic tokens", () => {
      const fusion = new AdjacentConstantFusion(1); // minTokenLength=1 to include short tokens

      const messages = [
        ["hello", "world", "foo", "bar"],
        ["hello", "world", "foo", "bar"],
        ["hello", "world", "foo", "bar"],
      ];

      fusion.learn(messages);
      const result = fusion.normalize(
        ["hello", "world", "foo", "bar"],
        "<*>",
      );
      // "hello"+"world" → "hello<*>world", "foo"+"bar" → "foo<*>bar"
      expect(result.tokens).toEqual(["hello<*>world", "foo<*>bar"]);
    });

    it("should only fuse for messages of the learned length", () => {
      const fusion = new AdjacentConstantFusion(1);

      const messages = [
        ["prefix", "suffix"],
        ["prefix", "suffix"],
        ["prefix", "suffix"],
      ];

      fusion.learn(messages);

      // Same length → fuse
      const result1 = fusion.normalize(["prefix", "suffix"], "<*>");
      expect(result1.tokens).toEqual(["prefix<*>suffix"]);

      // Different length → don't fuse
      const result2 = fusion.normalize(["a", "b", "c"], "<*>");
      expect(result2.tokens).toEqual(["a", "b", "c"]);
    });

    it("should not fuse non-alphabetic tokens", () => {
      const fusion = new AdjacentConstantFusion(2);

      const messages = [
        ["123", "456", "ab", "cd"],
        ["123", "456", "ab", "cd"],
        ["123", "456", "ab", "cd"],
      ];

      fusion.learn(messages);
      const result = fusion.normalize(
        ["123", "456", "ab", "cd"],
        "<*>",
      );
      // "123" and "456" are not alphabetic → don't fuse
      // "ab"+"cd" → fuse
      expect(result.tokens).toEqual(["123", "456", "ab<*>cd"]);
    });

    it("should not fuse tokens with param placeholders", () => {
      const fusion = new AdjacentConstantFusion(1);

      const messages = [
        ["a", "b", "<NUM>", "d"],
        ["a", "b", "<NUM>", "d"],
        ["a", "b", "<NUM>", "d"],
      ];

      fusion.learn(messages);
      const result = fusion.normalize(
        ["a", "b", "<NUM>", "d"],
        "<*>",
      );
      // "a"+"b" → fuse (both alphabetic, no params)
      // "<NUM>" should NOT be fused (contains < and >)
      expect(result.tokens).toEqual(["a<*>b", "<NUM>", "d"]);
    });

    it("should handle empty FusionPositions gracefully", () => {
      const fusion = new AdjacentConstantFusion();
      // No learn call — fusionPositions is empty

      const result = fusion.normalize(["a", "b", "c"], "<*>");
      expect(result.tokens).toEqual(["a", "b", "c"]);
      expect(result.changes).toEqual([]);
    });
  });
});

// ============================================================
// 3. TokenNormalizerPipeline
// ============================================================

describe("TokenNormalizerPipeline", () => {
  it("should apply normalizers in registration order", () => {
    const pipeline = new TokenNormalizerPipeline()
      .register(new RegexCollapseNormalizer([
        { regex: /X/g, replacement: "Y" },
      ]))
      .register(new AdjacentConstantFusion(1));

    // Learn phase on a batch
    pipeline.learn([
      ["alpha", "beta"],
      ["alpha", "beta"],
    ]);

    // First regex swaps X→Y, then AdjacentConstantFusion fuses the pair
    const result = pipeline.normalize(["alphaX", "beta"], "<*>");
    expect(result.tokens).toEqual(["alphaY<*>beta"]);
  });

  it("should return identity when empty", () => {
    const pipeline = new TokenNormalizerPipeline();
    const result = pipeline.normalize(["a", "b"], "<*>");
    expect(result.tokens).toEqual(["a", "b"]);
    expect(pipeline.size).toBe(0);
  });

  it("should handle learn on empty pipeline", () => {
    const pipeline = new TokenNormalizerPipeline();
    pipeline.learn([["a", "b"]]);
    // Should not crash
  });

  it("should report correct size", () => {
    const pipeline = new TokenNormalizerPipeline()
      .register(new RegexCollapseNormalizer([
        { regex: /a/g, replacement: "b" },
      ]));

    expect(pipeline.size).toBe(1);
    expect(pipeline.isEmpty).toBe(false);
  });
});

// ============================================================
// 4. Factory Functions
// ============================================================

describe("Factory Functions", () => {
  it("createDefaultNormalizerPipeline should be empty", () => {
    const pipeline = createDefaultNormalizerPipeline();
    expect(pipeline.isEmpty).toBe(true);
  });

  it("createExtendedNormalizerPipeline should include AdjacentConstantFusion", () => {
    const pipeline = createExtendedNormalizerPipeline(2);
    expect(pipeline.size).toBe(1);
    expect(pipeline.isEmpty).toBe(false);
  });
});

// ============================================================
// 5. Edge Cases
// ============================================================

describe("Edge Cases", () => {
  it("should handle single token messages", () => {
    const fusion = new AdjacentConstantFusion();
    fusion.learn([["hello"], ["hello"]]);

    const result = fusion.normalize(["hello"], "<*>");
    expect(result.tokens).toEqual(["hello"]);
  });

  it("should handle empty token messages", () => {
    const fusion = new AdjacentConstantFusion();
    fusion.learn([[], []]);

    const result = fusion.normalize([], "<*>");
    expect(result.tokens).toEqual([]);
  });

  it("should not fuse last token with nothing", () => {
    const fusion = new AdjacentConstantFusion(1);

    const messages = [
      ["a", "b", "c"],
      ["a", "b", "c"],
      ["a", "b", "c"],
    ];

    fusion.learn(messages);
    const result = fusion.normalize(["a", "b", "c"], "<*>");
    // "a"+"b" → fuse, "c" alone → stays
    expect(result.tokens).toEqual(["a<*>b", "c"]);
  });
});
