/**
 * Parameter extraction tests.
 *
 * Tests the extractParameters() method on TemplateMiner:
 * - Exact matching with specific mask instructions
 * - Inexact matching
 * - Regex caching
 * - Edge cases (empty template, no params)
 */

import { describe, it, expect } from "vitest";
import { TemplateMiner } from "../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../src/TemplateMinerConfig.js";
import { MaskingInstruction } from "../src/masker/MaskingInstruction.js";
import {
  IP_MASK,
  NUM_MASK,
} from "../src/masker/presets.js";

function makeMiner(maskingInstructions = [IP_MASK, NUM_MASK]): TemplateMiner {
  return new TemplateMiner({
    config: TemplateMinerConfig.from({ maskingInstructions }),
  });
}

describe("extractParameters (exact matching)", () => {
  it("should extract IP and NUM parameters", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "connection from <IP> port <NUM>",
      "connection from 192.168.1.1 port 8080",
      true,
    );

    expect(params).toEqual([
      { value: "192.168.1.1", maskName: "IP" },
      { value: "8080", maskName: "NUM" },
    ]);
  });

  it("should extract a single parameter", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "error code <NUM> occurred",
      "error code 42 occurred",
      true,
    );

    expect(params).toEqual([{ value: "42", maskName: "NUM" }]);
  });

  it("should handle multiple IPs in one log line", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "route from <IP> to <IP>",
      "route from 10.0.0.1 to 192.168.1.1",
      true,
    );

    expect(params).toEqual([
      { value: "10.0.0.1", maskName: "IP" },
      { value: "192.168.1.1", maskName: "IP" },
    ]);
  });
});

describe("extractParameters (inexact matching)", () => {
  it("should extract with .+? (inexact) matching for unknown masks", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "user <*> logged in",
      "user alice logged in",
      false,
    );

    expect(params).toEqual([{ value: "alice", maskName: "*" }]);
  });

  it("should handle multi-word parameters with inexact matching", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "message: <*>",
      "message: hello world",
      false,
    );

    expect(params).toEqual([{ value: "hello world", maskName: "*" }]);
  });
});

describe("extractParameters (edge cases)", () => {
  it("should return empty array for template with no params", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "static message",
      "static message",
      true,
    );
    expect(params).toEqual([]);
  });

  it("should return empty array when template does not match message", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "error <NUM>",
      "completely different",
      true,
    );
    expect(params).toEqual([]);
  });

  it("should handle template with multiple spaces in message", () => {
    const miner = makeMiner();
    const params = miner.extractParameters(
      "a <NUM> b",
      "a   42   b",
      true,
    );
    expect(params).toEqual([{ value: "42", maskName: "NUM" }]);
  });
});

describe("extractParameters (caching)", () => {
  it("should cache regexes for repeated templates", () => {
    const miner = makeMiner();

    // First call — build and cache
    const p1 = miner.extractParameters(
      "error <NUM>",
      "error 42",
      true,
    );
    expect(p1).toEqual([{ value: "42", maskName: "NUM" }]);

    // Second call with same template — use cache
    const p2 = miner.extractParameters(
      "error <NUM>",
      "error 99",
      true,
    );
    expect(p2).toEqual([{ value: "99", maskName: "NUM" }]);

    // Different exactMatching → different cache key
    const p3 = miner.extractParameters(
      "error <NUM>",
      "error 99",
      false,
    );
    expect(p3).toEqual([{ value: "99", maskName: "NUM" }]);
  });
});

describe("extractParameters (with extra delimiters)", () => {
  it("should handle extra delimiters in log message", () => {
    const customMask = new MaskingInstruction(
      String.raw`((?<=[^A-Za-z0-9])|^)([\-\+]?\d+)((?=[^A-Za-z0-9])|$)`,
      "NUM",
    );
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({
        maskingInstructions: [customMask],
        drainExtraDelimiters: ["_", ":"],
      }),
    });

    const params = miner.extractParameters(
      "code <NUM> value <NUM>",
      "code_42:value_99",
      true,
    );
    expect(params).toEqual([
      { value: "42", maskName: "NUM" },
      { value: "99", maskName: "NUM" },
    ]);
  });
});

describe("extractParameters (custom mask names)", () => {
  it("should work with custom mask instructions", () => {
    const customMask = new MaskingInstruction(
      String.raw`\b[a-z]+@[a-z]+\.com\b`,
      "EMAIL",
    );
    const miner = new TemplateMiner({
      config: TemplateMinerConfig.from({
        maskingInstructions: [customMask],
      }),
    });

    const params = miner.extractParameters(
      "contact <EMAIL> for help",
      "contact admin@test.com for help",
      true,
    );
    expect(params).toEqual([{ value: "admin@test.com", maskName: "EMAIL" }]);
  });
});
