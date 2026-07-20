/**
 * Preset masking instruction tests.
 *
 * Validates each preset regex against known-good inputs.
 */

import { describe, it, expect } from "vitest";
import {
  IP_MASK,
  NUM_MASK,
  HEX_MASK,
  UUID_MASK,
  EMAIL_MASK,
  DEFAULT_MASKING_INSTRUCTIONS,
  EXTENDED_MASKING_INSTRUCTIONS,
  ALL_MASKING_INSTRUCTIONS,
} from "../../src/masker/presets.js";
import { LogMasker } from "../../src/masker/LogMasker.js";

describe("IP_MASK", () => {
  it("should mask standard IPv4 addresses", () => {
    const masker = new LogMasker([IP_MASK], "<", ">");
    expect(masker.mask("from 192.168.1.1")).toBe("from <IP>");
    expect(masker.mask("0.0.0.0 port")).toBe("<IP> port");
    expect(masker.mask("255.255.255.255")).toBe("<IP>");
  });

  it("should not mask invalid IP-like strings", () => {
    const masker = new LogMasker([IP_MASK], "<", ">");
    // Non-numeric or out-of-range patterns should not match
    expect(masker.mask("v1.2.3.4-beta")).toBe("v1.2.3.4-beta");
  });
});

describe("NUM_MASK", () => {
  it("should mask integers", () => {
    const masker = new LogMasker([NUM_MASK], "<", ">");
    expect(masker.mask("count 42 items")).toBe("count <NUM> items");
    expect(masker.mask("-5 degrees")).toBe("<NUM> degrees");
    expect(masker.mask("+100")).toBe("<NUM>");
  });

  it("should not mask alphanumeric tokens with digits", () => {
    const masker = new LogMasker([NUM_MASK], "<", ">");
    expect(masker.mask("D9 test")).toBe("D9 test");
    expect(masker.mask("1A ccc")).toBe("1A ccc");
  });
});

describe("HEX_MASK", () => {
  it("should mask hexadecimal literals", () => {
    const masker = new LogMasker([HEX_MASK], "<", ">");
    expect(masker.mask("Hex number 0xDEADBEEF")).toBe("Hex number <HEX>");
    expect(masker.mask("0xFF")).toBe("<HEX>");
    expect(masker.mask("0Xa1B2")).toBe("<HEX>");
  });
});

describe("UUID_MASK", () => {
  it("should mask hyphenated UUIDs", () => {
    const masker = new LogMasker([UUID_MASK], "<", ">");
    expect(masker.mask("id 550e8400-e29b-41d4-a716-446655440000")).toBe(
      "id <UUID>",
    );
  });

  it("should mask compact UUIDs", () => {
    const masker = new LogMasker([UUID_MASK], "<", ">");
    expect(
      masker.mask("id 550e8400e29b41d4a716446655440000"),
    ).toBe("id <UUID>");
  });
});

describe("EMAIL_MASK", () => {
  it("should mask email addresses", () => {
    const masker = new LogMasker([EMAIL_MASK], "<", ">");
    expect(masker.mask("contact user@example.com")).toBe("contact <EMAIL>");
    expect(masker.mask("admin@sub.domain.co.uk")).toBe("<EMAIL>");
  });
});

describe("Convenience collections", () => {
  it("should provide DEFAULT_MASKING_INSTRUCTIONS with IP and NUM", () => {
    expect(DEFAULT_MASKING_INSTRUCTIONS.length).toBe(2);
    expect(DEFAULT_MASKING_INSTRUCTIONS[0]!.maskName).toBe("IP");
    expect(DEFAULT_MASKING_INSTRUCTIONS[1]!.maskName).toBe("NUM");
  });

  it("should provide EXTENDED_MASKING_INSTRUCTIONS with 5 presets", () => {
    expect(EXTENDED_MASKING_INSTRUCTIONS.length).toBe(5);
  });

  it("should freeze all collections for immutability", () => {
    expect(Object.isFrozen(DEFAULT_MASKING_INSTRUCTIONS)).toBe(true);
    expect(Object.isFrozen(EXTENDED_MASKING_INSTRUCTIONS)).toBe(true);
    expect(Object.isFrozen(ALL_MASKING_INSTRUCTIONS)).toBe(true);
  });
});
