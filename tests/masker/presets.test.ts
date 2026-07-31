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
  HOST_PORT_MASK,
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

  it("should provide EXTENDED_MASKING_INSTRUCTIONS with 8 presets", () => {
    expect(EXTENDED_MASKING_INSTRUCTIONS.length).toBe(9);
  });

  it("should freeze all collections for immutability", () => {
    expect(Object.isFrozen(DEFAULT_MASKING_INSTRUCTIONS)).toBe(true);
    expect(Object.isFrozen(EXTENDED_MASKING_INSTRUCTIONS)).toBe(true);
    expect(Object.isFrozen(ALL_MASKING_INSTRUCTIONS)).toBe(true);
  });
});

// ============================================================
// HOST_PORT_MASK tests
// ============================================================

describe("HOST_PORT_MASK", () => {
  it("should mask hostname:port patterns", () => {
    const masker = new LogMasker([HOST_PORT_MASK], "<", ">");
    expect(masker.mask("proxy.example.com:5070")).toBe("<HOST_PORT>");
    expect(masker.mask("from proxy.example.com:5070")).toBe(
      "from <HOST_PORT>",
    );
    expect(masker.mask("10.0.0.1:8080 connection")).toBe(
      "<HOST_PORT> connection",
    );
  });

  it("should mask hostname:port with multiple subdomains", () => {
    const masker = new LogMasker([HOST_PORT_MASK], "<", ">");
    // 5-component hostname common in Proxifier
    expect(
      masker.mask("proxy.cse.cuhk.edu.hk:5070 close"),
    ).toBe("<HOST_PORT> close");
    expect(
      masker.mask("101.0.12.7.0.rst8.r.skype.net:12350"),
    ).toBe("<HOST_PORT>");
  });

  it("should mask IPv4:port when IP_MASK is absent", () => {
    const masker = new LogMasker([HOST_PORT_MASK], "<", ">");
    expect(masker.mask("192.168.1.1:8080")).toBe("<HOST_PORT>");
  });

  it("should handle consecutive hostname:port in one message", () => {
    const masker = new LogMasker([HOST_PORT_MASK], "<", ">");
    expect(
      masker.mask("proxy.a.com:5070 open through proxy proxy.b.com:8080 HTTPS"),
    ).toBe("<HOST_PORT> open through proxy <HOST_PORT> HTTPS");
  });

  it("should not mask hostname without port", () => {
    const masker = new LogMasker([HOST_PORT_MASK], "<", ">");
    expect(masker.mask("proxy.example.com")).toBe("proxy.example.com");
    expect(masker.mask("localhost")).toBe("localhost");
  });

  it("should mask dot-containing Java-style identifiers with port", () => {
    const masker = new LogMasker([HOST_PORT_MASK], "<", ">");
    // The regex is greedy: dot-separated word sequences with a port suffix
    // will match even if they are not traditional hostnames.
    expect(masker.mask("com.android.server:3407")).toBe("<HOST_PORT>");
  });

  it("should mask hostname:port in a real Proxifier log message", () => {
    const masker = new LogMasker([HOST_PORT_MASK], "<", ">");
    const msg =
      "proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime <1 sec";
    expect(masker.mask(msg)).toBe(
      "<HOST_PORT> close, 0 bytes sent, 0 bytes received, lifetime <1 sec",
    );
  });
});

// ============================================================
// Masking instruction order tests
// ============================================================

describe("Masking instruction order", () => {
  it("should apply HOST_PORT before NUM so hostname:port is not split", () => {
    // BUG: when NUM runs before HOST_PORT, :5070 → :<NUM> and
    // HOST_PORT regex (expecting :\\d+) silently fails.
    // The hostname portion stays unmasked, causing cluster explosion.
    const masker = new LogMasker(
      [HOST_PORT_MASK, NUM_MASK],
      "<",
      ">",
    );
    const msg =
      "proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received";
    const result = masker.mask(msg);
    // Hostname:port should be masked as a single HOST_PORT token
    expect(result).toBe(
      "<HOST_PORT> close, <NUM> bytes sent, <NUM> bytes received",
    );
    // The hostname MUST NOT be left unmasked
    expect(result).not.toContain("proxy.cse.cuhk.edu.hk");
  });

  it("EXTENDED_MASKING_INSTRUCTIONS: HOST_PORT should precede NUM", () => {
    const hostPortIdx = EXTENDED_MASKING_INSTRUCTIONS.findIndex(
      (inst) => inst.maskName === "HOST_PORT",
    );
    const numIdx = EXTENDED_MASKING_INSTRUCTIONS.findIndex(
      (inst) => inst.maskName === "NUM",
    );
    expect(hostPortIdx).toBeLessThan(numIdx);
  });

  it("EXTENDED_MASKING_INSTRUCTIONS: should mask Proxifier message correctly", () => {
    const masker = new LogMasker(
      [...EXTENDED_MASKING_INSTRUCTIONS],
      "<",
      ">",
    );
    const msg =
      "proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime <1 sec";
    const result = masker.mask(msg);
    // The full hostname:port must be masked
    expect(result).toContain("<HOST_PORT>");
    // No unmasked hostname fragments should remain
    expect(result).not.toContain("proxy.cse.cuhk.edu.hk");
    expect(result).not.toContain("cuhk.edu.hk");
  });

  it("should not regress IP masking when HOST_PORT precedes NUM", () => {
    const masker = new LogMasker(
      [IP_MASK, HOST_PORT_MASK, NUM_MASK],
      "<",
      ">",
    );
    // IP should still be masked before HOST_PORT sees it
    expect(masker.mask("from 192.168.1.1 port 8080")).toBe(
      "from <IP> port <NUM>",
    );
  });

  it("should correctly mask IPv4:port combinations", () => {
    // IP_MASK matches 192.168.1.1 standalone. With IP_MASK first,
    // it captures the IP portion of 192.168.1.1:8080 (colon is non-alnum
    // so the lookahead matches). HOST_PORT then runs on <IP>:8080 but
    // the mask prefix "<" is not [\\w], so HOST_PORT cannot match.
    // NUM handles the remaining 8080. Result: <IP>:<NUM>.
    const masker = new LogMasker(
      [IP_MASK, HOST_PORT_MASK, NUM_MASK],
      "<",
      ">",
    );
    expect(masker.mask("192.168.1.1:8080 connection")).toBe(
      "<IP>:<NUM> connection",
    );
    // Standalone IP still masked by IP
    expect(masker.mask("from 192.168.1.1")).toBe("from <IP>");
    // Hostname:port (non-IP) handled by HOST_PORT
    expect(masker.mask("proxy.example.com:5070")).toBe("<HOST_PORT>");
  });

  it("should handle messages with multiple hostname:port and IP patterns", () => {
    const masker = new LogMasker(
      [IP_MASK, HOST_PORT_MASK, NUM_MASK],
      "<",
      ">",
    );
    const msg =
      "10.0.0.1 connected to proxy.example.com:5070 and proxy2.example.com:8080";
    expect(masker.mask(msg)).toBe(
      "<IP> connected to <HOST_PORT> and <HOST_PORT>",
    );
  });
});
