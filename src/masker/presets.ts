/**
 * Preset masking instructions for common log patterns.
 *
 * These instructions are NOT auto-loaded — users opt in by importing the
 * presets they need and passing them to `TemplateMinerConfig` or
 * `LogMasker` directly.
 *
 * All patterns are ported 1:1 from the official Drain3 README examples
 * and extended with additional patterns commonly needed in practice.
 *
 * @module presets
 */

import { MaskingInstruction } from "./MaskingInstruction.js";

/**
 * IPv4 address pattern.
 *
 * Matches standalone IPv4 addresses (e.g. 192.168.1.1, 10.0.0.255).
 * Uses lookbehind/lookahead to avoid matching IP-like substrings within
 * larger tokens (e.g. "v1.2.3.4-beta" won't match).
 *
 * Ported from Drain3 README:
 * `((?<=[^A-Za-z0-9])|^)(\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})((?=[^A-Za-z0-9])|$)`
 */
export const IP_MASK = new MaskingInstruction(
  String.raw`((?<=[^A-Za-z0-9])|^)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})((?=[^A-Za-z0-9])|$)`,
  "IP",
);

/**
 * Integer pattern (signed and unsigned).
 *
 * Matches positive and negative integers as standalone tokens.
 * Does NOT match numbers embedded in alphanumeric strings (e.g. "abc123").
 *
 * Ported from Drain3 README:
 * `((?<=[^A-Za-z0-9])|^)([\\-\\+]?\\d+)((?=[^A-Za-z0-9])|$)`
 */
export const NUM_MASK = new MaskingInstruction(
  String.raw`((?<=[^A-Za-z0-9])|^)([\-\+]?\d+)((?=[^A-Za-z0-9])|$)`,
  "NUM",
);

/**
 * Hexadecimal literal pattern.
 *
 * Matches hex numbers with 0x/0X prefix (e.g. 0xDEADBEEF, 0xFF).
 */
export const HEX_MASK = new MaskingInstruction(
  String.raw`((?<=[^A-Za-z0-9])|^)(0[xX][0-9a-fA-F]+)((?=[^A-Za-z0-9])|$)`,
  "HEX",
);

/**
 * UUID pattern (all versions, with or without hyphens).
 *
 * Matches UUIDs like 550e8400-e29b-41d4-a716-446655440000
 * and compact forms like 550e8400e29b41d4a716446655440000.
 */
export const UUID_MASK = new MaskingInstruction(
  String.raw`((?<=[^A-Za-z0-9])|^)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[0-9a-fA-F]{32})((?=[^A-Za-z0-9])|$)`,
  "UUID",
);

/**
 * Email address pattern.
 *
 * Matches standard email addresses (e.g. user@example.com).
 */
export const EMAIL_MASK = new MaskingInstruction(
  String.raw`((?<=[^A-Za-z0-9])|^)([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})((?=[^A-Za-z0-9])|$)`,
  "EMAIL",
);

// ============================================================
// Convenience collections
// ============================================================

/** Minimal preset set: IP and numeric patterns (matches Drain3 README examples). */
export const DEFAULT_MASKING_INSTRUCTIONS: readonly MaskingInstruction[] =
  Object.freeze([IP_MASK, NUM_MASK]);

/** Extended preset set: IP, NUM, HEX, UUID, and EMAIL. */
export const EXTENDED_MASKING_INSTRUCTIONS: readonly MaskingInstruction[] =
  Object.freeze([IP_MASK, NUM_MASK, HEX_MASK, UUID_MASK, EMAIL_MASK]);

/** All available presets as a flat array. */
export const ALL_MASKING_INSTRUCTIONS: readonly MaskingInstruction[] =
  EXTENDED_MASKING_INSTRUCTIONS;
