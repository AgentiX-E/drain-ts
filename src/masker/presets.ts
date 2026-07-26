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

/**
 * Hostname:port pattern.
 *
 * Matches patterns like `proxy.example.com:5070`, `10.0.0.1:8080`,
 * `localhost:3000`. Uses word boundaries to avoid matching
 * non-hostname strings like `com.android.server:3407`.
 *
 * Common in: Proxifier, HDFS, Zookeeper, Spark.
 */
export const HOST_PORT_MASK = new MaskingInstruction(
  String.raw`((?<=[^A-Za-z0-9])|^)([\w][\w.-]*\.[\w.-]+:\d+)((?=[^A-Za-z0-9])|$)`,
  "HOST_PORT",
);

/**
 * Block ID pattern (HDFS-specific).
 *
 * Matches block references like `blk_38865049064139660`,
 * `blk_-6952295868487656571`.
 *
 * Common in: HDFS (58.5% of messages).
 */
export const BLOCK_ID_MASK = new MaskingInstruction(
  String.raw`\b(blk_[-\d]+)\b`,
  "BLOCK_ID",
);

/**
 * Unix/POSIX file path pattern.
 *
 * Matches file paths like `/var/log/syslog`, `/user/root/data.txt`,
 * `/v2/servers/detail`. Uses word boundaries to avoid matching
 * partial paths embedded in longer tokens.
 *
 * Common in: OpenStack, HDFS, Apache, Mac, Spark.
 */
export const PATH_MASK = new MaskingInstruction(
  String.raw`\b(/[\w.\-~%+/]+)+/?\b`,
  "PATH",
);

/**
 * Syslog numeric suffix pattern.
 *
 * Matches numbers preceded by underscore in syslog-style messages.
 * Example: `pam_unix(cron:session): session closed for user root_1234`
 * → `pam_unix(cron:session): session closed for user root_<SYSLOG_NUM>`
 *
 * This approximates Drain3's `syslog_` mode.
 */
export const SYSLOG_NUM_MASK = new MaskingInstruction(
  String.raw`(?<=_)\d+\b`,
  "SYSLOG_NUM",
);

// ============================================================
// Convenience collections
// ============================================================

/** Minimal preset set: IP and numeric patterns (matches Drain3 README examples). */
export const DEFAULT_MASKING_INSTRUCTIONS: readonly MaskingInstruction[] =
  Object.freeze([IP_MASK, NUM_MASK]);

/** Extended preset set: IP, NUM, HEX, UUID, EMAIL, HOST_PORT, PATH, BLOCK_ID, SYSLOG_NUM. */
export const EXTENDED_MASKING_INSTRUCTIONS: readonly MaskingInstruction[] =
  Object.freeze([
    IP_MASK,
    NUM_MASK,
    HEX_MASK,
    UUID_MASK,
    EMAIL_MASK,
    HOST_PORT_MASK,
    PATH_MASK,
    BLOCK_ID_MASK,
    SYSLOG_NUM_MASK,
  ]);

/** All available presets as a flat array. */
export const ALL_MASKING_INSTRUCTIONS: readonly MaskingInstruction[] =
  EXTENDED_MASKING_INSTRUCTIONS;
