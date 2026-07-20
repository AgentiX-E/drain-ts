/**
 * Masking system tests.
 *
 * Ported 1:1 from Python test_masking.py:
 * - test_instructions_by_mask_name
 * - test_mask
 */

import { describe, it, expect } from "vitest";
import { MaskingInstruction } from "../../src/masker/MaskingInstruction.js";
import { LogMasker } from "../../src/masker/LogMasker.js";

// ============================================================
// Ported from test_masking.py
// ============================================================

describe("LogMasker (ported from test_masking.py)", () => {
  // T2.1: test_instructions_by_mask_name
  it("should group instructions by mask name", () => {
    const a = new MaskingInstruction("a", "1");
    const b = new MaskingInstruction("b", "1");
    const c = new MaskingInstruction("c", "2");
    const d = new MaskingInstruction("d", "3");
    const x = new MaskingInstruction("x", "something else");
    const y = new MaskingInstruction("y", "something else");

    const masker = new LogMasker([a, b, c, d, x, y], "", "");

    expect(new Set(masker.maskNames)).toEqual(
      new Set(["1", "2", "3", "something else"]),
    );
    expect(masker.instructionsByMaskName("1")).toEqual([a, b]);
    expect(masker.instructionsByMaskName("2")).toEqual([c]);
    expect(masker.instructionsByMaskName("3")).toEqual([d]);
    expect(masker.instructionsByMaskName("something else")).toEqual([x, y]);
  });

  // T2.2: test_mask
  it("should mask log content correctly", () => {
    const s = "D9 test 999 888 1A ccc 3";
    const mi = new MaskingInstruction(
      String.raw`((?<=[^A-Za-z0-9])|^)([\-\+]?\d+)((?=[^A-Za-z0-9])|$)`,
      "NUM",
    );
    const masker = new LogMasker([mi], "<!", "!>");
    const masked = masker.mask(s);
    expect(masked).toBe("D9 test <!NUM!> <!NUM!> 1A ccc <!NUM!>");
  });
});

// ============================================================
// Additional masking tests
// ============================================================

describe("LogMasker (additional)", () => {
  it("should mask with custom prefix/suffix", () => {
    const mi = new MaskingInstruction(String.raw`\d+`, "NUM");
    const masker = new LogMasker([mi], "[[", "]]");
    expect(masker.mask("error 42")).toBe("error [[NUM]]");
  });

  it("should handle multiple mask types in one message", () => {
    const ipMask = new MaskingInstruction(
      String.raw`((?<=[^A-Za-z0-9])|^)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})((?=[^A-Za-z0-9])|$)`,
      "IP",
    );
    const numMask = new MaskingInstruction(
      String.raw`((?<=[^A-Za-z0-9])|^)([\-\+]?\d+)((?=[^A-Za-z0-9])|$)`,
      "NUM",
    );
    const masker = new LogMasker([ipMask, numMask], "<", ">");
    const result = masker.mask("connection from 192.168.1.1 port 8080");
    expect(result).toBe("connection from <IP> port <NUM>");
  });

  it("should preserve non-matching parts of the message", () => {
    const mi = new MaskingInstruction(String.raw`\d+`, "NUM");
    const masker = new LogMasker([mi], "<", ">");
    // "abc" has no digits, should remain unchanged
    expect(masker.mask("abc def")).toBe("abc def");
  });

  it("should apply instructions in registration order", () => {
    // First instruction matches "42", second matches "error"
    const first = new MaskingInstruction(String.raw`\d+`, "NUM");
    const second = new MaskingInstruction(String.raw`error`, "SEVERITY");
    const masker = new LogMasker([first, second], "<", ">");
    // "42" should be masked first, then "error"
    expect(masker.mask("error 42")).toBe("<SEVERITY> <NUM>");
  });

  it("should return empty string for empty input", () => {
    const mi = new MaskingInstruction(String.raw`\d+`, "NUM");
    const masker = new LogMasker([mi], "<", ">");
    expect(masker.mask("")).toBe("");
  });

  it("should handle input with no matching patterns", () => {
    const mi = new MaskingInstruction(String.raw`\d+`, "NUM");
    const masker = new LogMasker([mi], "<", ">");
    expect(masker.mask("no digits here")).toBe("no digits here");
  });

  it("should return empty array for unknown mask name", () => {
    const masker = new LogMasker([], "<", ">");
    expect(masker.instructionsByMaskName("NONEXISTENT")).toEqual([]);
  });

  it("should handle empty instructions list", () => {
    const masker = new LogMasker([], "<", ">");
    expect(masker.mask("any text")).toBe("any text");
    expect(masker.maskNames).toEqual([]);
  });

  it("should freeze maskNames for immutability", () => {
    const masker = new LogMasker([], "<", ">");
    expect(Object.isFrozen(masker.maskNames)).toBe(true);
  });
});

describe("MaskingInstruction", () => {
  it("should create instruction with regexPattern and maskName", () => {
    const mi = new MaskingInstruction(String.raw`\d+`, "NUM");
    expect(mi.regexPattern).toBe(String.raw`\d+`);
    expect(mi.maskName).toBe("NUM");
    expect(mi.compiledRegex).toBeInstanceOf(RegExp);
    expect(mi.compiledRegex.flags).toBe("g");
  });

  it("should compile regex with global flag", () => {
    const mi = new MaskingInstruction("abc", "TEST");
    // Apply to a string with multiple matches
    const result = "abc abc abc".replace(mi.compiledRegex, "<TEST>");
    expect(result).toBe("<TEST> <TEST> <TEST>");
  });

  it("should throw on empty regexPattern", () => {
    expect(() => new MaskingInstruction("", "NAME")).toThrow(
      "regexPattern must be non-empty",
    );
  });

  it("should throw on empty maskName", () => {
    expect(() => new MaskingInstruction("abc", "")).toThrow(
      "maskName must be non-empty",
    );
  });
});
