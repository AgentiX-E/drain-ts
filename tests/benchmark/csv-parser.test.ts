/**
 * RFC 4180 CSV Line Parser — Comprehensive Test Suite
 *
 * Tests are derived from Papa Parse's test-cases.js (the most comprehensive
 * RFC 4180 CSV test suite in the JavaScript ecosystem), adapted for our
 * line-by-line parser that operates on single CSV rows.
 *
 * RFC 4180 field grammar (ABNF):
 *   field = (escaped / non-escaped)
 *   escaped = DQUOTE *(TEXTDATA / COMMA / CR / LF / 2DQUOTE) DQUOTE
 *   non-escaped = *TEXTDATA
 *
 * Reference: Shafranovich, Y., RFC 4180, IETF, October 2005.
 */
import { describe, it, expect } from "vitest";

/**
 * Exact copy of parseCsvLine from benchmark/run.ts for test isolation.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let wasQuoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
          wasQuoted = true;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
      wasQuoted = false;
    } else if (ch === ",") {
      fields.push(wasQuoted ? field : field.trim());
      field = "";
      wasQuoted = false;
    } else if (ch === " " && (field === "" || wasQuoted)) {
      continue;
    } else {
      field += ch;
    }
  }

  fields.push(wasQuoted ? field : field.trim());
  return fields;
}

// ============================================================
// Basic parsing
// ============================================================

describe("RFC 4180: Basic field parsing", () => {
  it("should parse simple unquoted fields", () => {
    expect(parseCsvLine("aaa,bbb,ccc")).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("should parse a single field", () => {
    expect(parseCsvLine("aaa")).toEqual(["aaa"]);
  });

  it("should parse empty input as single empty field", () => {
    expect(parseCsvLine("")).toEqual([""]);
  });

  it("should parse input with just a delimiter as two empty fields", () => {
    expect(parseCsvLine(",")).toEqual(["", ""]);
  });

  it("should parse multiple consecutive delimiters as empty fields", () => {
    expect(parseCsvLine("a,,,b")).toEqual(["a", "", "", "b"]);
  });

  it("should parse trailing empty field", () => {
    expect(parseCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });

  it("should parse leading empty field", () => {
    expect(parseCsvLine(",b,c")).toEqual(["", "b", "c"]);
  });
});

// ============================================================
// Quoted fields
// ============================================================

describe("RFC 4180: Quoted fields", () => {
  it("should parse all-quoted fields", () => {
    expect(parseCsvLine('"aaa","bbb","ccc"')).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("should parse mixed quoted and unquoted", () => {
    expect(parseCsvLine('aaa,"bbb",ccc')).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("should preserve whitespace inside quoted fields", () => {
    expect(parseCsvLine('" aaa "," bbb "')).toEqual([" aaa ", " bbb "]);
  });

  it("should trim whitespace after closing quote before comma", () => {
    expect(parseCsvLine('"A" , "B" , "C"')).toEqual(["A", "B", "C"]);
  });

  it("should handle whitespace after closing quote before end-of-line", () => {
    expect(parseCsvLine('"A" , "B"  ')).toEqual(["A", "B"]);
  });
});

// ============================================================
// RFC 4180 §2.6: Commas within quoted fields
// ============================================================

describe("RFC 4180 §2.6: Embedded commas within quoted fields", () => {
  it("should preserve commas inside quoted fields", () => {
    expect(parseCsvLine('A,"B,B",C')).toEqual(["A", "B,B", "C"]);
  });

  it("should handle quoted fields with commas at row end", () => {
    expect(parseCsvLine('a,b,"c,c"')).toEqual(["a", "b", "c,c"]);
  });

  it("should handle quoted field with commas and spaces", () => {
    expect(parseCsvLine('"a,b c",d,e')).toEqual(["a,b c", "d", "e"]);
  });

  it("should handle Loghub-style Content with commas (Proxifier pattern)", () => {
    const line =
      'chrome.exe,"proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",E8';
    expect(parseCsvLine(line)).toEqual([
      "chrome.exe",
      "proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",
      "E8",
    ]);
  });

  it("should handle FULL Proxifier row with commas in both Content and EventTemplate", () => {
    const line =
      '4,10.30 16:49:07,chrome.exe,"proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",E8,"<*> close, <*> bytes<*>sent, <*> bytes<*>received, lifetime <*>"';
    expect(parseCsvLine(line)).toEqual([
      "4",
      "10.30 16:49:07",
      "chrome.exe",
      "proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",
      "E8",
      "<*> close, <*> bytes<*>sent, <*> bytes<*>received, lifetime <*>",
    ]);
  });
});

// ============================================================
// RFC 4180 §2.7: Escaped double quotes ("" → ")
// ============================================================

describe("RFC 4180 §2.7: Escaped double quotes", () => {
  it('should convert "" to a single quote inside fields', () => {
    expect(parseCsvLine('"a""b""c"')).toEqual(['a"b"c']);
  });

  it('should handle escaped quotes at field boundaries', () => {
    expect(parseCsvLine('"","""",""')).toEqual(["", '"', ""]);
  });

  it('should handle quoted field with commas AND escaped quotes', () => {
    expect(parseCsvLine('"a,""b"",c"')).toEqual(['a,"b",c']);
  });

  it("should handle 6 consecutive quotes in a field (escaped pair)", () => {
    // Build input programmatically to avoid string literal escape ambiguity:
    // "1","""""","2"  →  6 consecutive DQUOTEs form two escaped pairs → '""'
    const q = '"';
    const input = `${q}1${q},${q}${q}${q}${q}${q}${q},${q}2${q}`;
    const result = parseCsvLine(input);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("1");
    expect(result[1]).toBe(q + q); // two literal double-quote chars
    expect(result[2]).toBe("2");
  });

  it("should handle escaped quotes at start of field", () => {
    expect(parseCsvLine('"""B"""')).toEqual(['"B"']);
  });

  it("should handle escaped quotes in mid-field", () => {
    expect(parseCsvLine('A,"B""B""B",C')).toEqual(["A", 'B"B"B', "C"]);
  });
});

// ============================================================
// Empty quoted fields
// ============================================================

describe("RFC 4180: Empty quoted fields", () => {
  it('should parse "" as empty string', () => {
    expect(parseCsvLine('a,"",b')).toEqual(["a", "", "b"]);
  });

  it("should parse consecutive empty quoted fields", () => {
    expect(parseCsvLine('"","",""')).toEqual(["", "", ""]);
  });

  it("should handle empty quoted field at end of row", () => {
    expect(parseCsvLine('a,b,""')).toEqual(["a", "b", ""]);
  });
});

// ============================================================
// Loghub-specific patterns
// ============================================================

describe("Loghub dataset patterns", () => {
  it("should parse HDFS row (no quotes, no embedded commas)", () => {
    const line =
      "1,081109,203615,148,INFO,DataNode,PacketResponder 1 for block blk_123 terminating,E10,PacketResponder <*> for block blk_<*> terminating";
    const result = parseCsvLine(line);
    expect(result).toHaveLength(9);
    expect(result[8]).toBe("PacketResponder <*> for block blk_<*> terminating");
  });

  it("should parse Proxifier HTTPS row (no embedded commas)", () => {
    const line =
      "1,10.30 16:49:06,chrome.exe,proxy.cse.cuhk.edu.hk:5070 open through proxy proxy.cse.cuhk.edu.hk:5070 HTTPS,E2,<*>:<*> open through proxy <*>:<*> HTTPS";
    const result = parseCsvLine(line);
    expect(result).toHaveLength(6);
    expect(result[3]).toBe(
      "proxy.cse.cuhk.edu.hk:5070 open through proxy proxy.cse.cuhk.edu.hk:5070 HTTPS",
    );
  });

  it("should parse Proxifier close row (quoted Content and EventTemplate with commas)", () => {
    const line =
      '4,10.30 16:49:07,chrome.exe,"proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",E8,"<*> close, <*> bytes<*>sent, <*> bytes<*>received, lifetime <*>"';
    const result = parseCsvLine(line);
    expect(result).toHaveLength(6);
    expect(result[3]).toBe(
      "proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",
    );
    expect(result[4]).toBe("E8");
    expect(result[5]).toBe(
      "<*> close, <*> bytes<*>sent, <*> bytes<*>received, lifetime <*>",
    );
  });

  it("should parse Windows row with quoted Content", () => {
    const line =
      '1,2016-09-28,04:30:30,Info,CBS,"Loaded Servicing Stack v6.1.7601.23505 with Core: C:\\Windows\\winsxs\\cbscore.dll",E4,Loaded Servicing Stack <*> with Core: <*>\\cbscore.dll';
    const result = parseCsvLine(line);
    expect(result).toHaveLength(8);
    // Content is at index 5
    expect(result[5]).toBe(
      "Loaded Servicing Stack v6.1.7601.23505 with Core: C:\\Windows\\winsxs\\cbscore.dll",
    );
  });

  it("should detect Spark row with unquoted embedded commas", () => {
    const line =
      "1,17/06/09,20:10:40,INFO,executor.CoarseGrainedExecutorBackend,Registered signal handlers for [TERM, HUP, INT],E4,Registered signal handlers for [<*>]";
    const result = parseCsvLine(line);
    // 8 columns expected, but Content has unquoted commas → extra fields
    expect(result.length).toBeGreaterThan(8);
  });
});

// ============================================================
// Edge cases
// ============================================================

describe("RFC 4180: Edge cases", () => {
  it("should preserve non-ASCII characters", () => {
    expect(parseCsvLine("こんにちは,world,🌍")).toEqual([
      "こんにちは",
      "world",
      "🌍",
    ]);
  });

  it("should handle long fields", () => {
    const long = "x".repeat(10000);
    const result = parseCsvLine(`"${long}",b`);
    expect(result).toEqual([long, "b"]);
  });

  it("should handle many fields", () => {
    const fields = Array.from({ length: 100 }, (_, i) => `f${i}`).join(",");
    const result = parseCsvLine(fields);
    expect(result).toHaveLength(100);
    expect(result[0]).toBe("f0");
    expect(result[99]).toBe("f99");
  });
});

// ============================================================
// Smart Content Merge (parseCsvRow fallback)
// ============================================================

describe("Smart Content Merge (parseCsvRow fallback)", () => {
  function parseCsvRow(
    line: string,
    headerColCount: number,
    contentIdx: number,
  ): string[] {
    const fields = parseCsvLine(line);

    if (fields.length === headerColCount) return fields;

    if (fields.length < headerColCount) {
      const result = [...fields];
      while (result.length < headerColCount) {
        result.push("");
      }
      return result;
    }

    const trailingColCount = headerColCount - contentIdx - 1;
    const contentEndIdx = fields.length - trailingColCount;
    const contentFragments = fields.slice(contentIdx, contentEndIdx);
    const mergedContent = contentFragments.join(",");

    return [
      ...fields.slice(0, contentIdx),
      mergedContent,
      ...fields.slice(contentEndIdx),
    ];
  }

  it("should handle Spark row with unquoted commas in Content", () => {
    const headerCols = 8;
    const contentIdx = 5;
    const line =
      "1,17/06/09,20:10:40,INFO,executor.CoarseGrainedExecutorBackend,Registered signal handlers for [TERM, HUP, INT],E4,Registered signal handlers for [<*>]";
    const result = parseCsvRow(line, headerCols, contentIdx);

    expect(result).toHaveLength(8);
    // Content Merge joins unquoted fragments with "," (spaces from original
    // "TERM, HUP, INT" are stripped by unquoted-field trim — a known limitation
    // of the unquoted-comma fallback path; standard RFC 4180 quoting handles this correctly)
    expect(result[5]).toBe(
      "Registered signal handlers for [TERM,HUP,INT]",
    );
  });

  it("should NOT trigger merge on Proxifier (RFC parser handles it correctly)", () => {
    const headerCols = 6;
    const contentIdx = 3;
    const line =
      '4,10.30 16:49:07,chrome.exe,"proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",E8,"<*> close, <*> bytes<*>sent, <*> bytes<*>received, lifetime <*>"';
    const result = parseCsvRow(line, headerCols, contentIdx);

    expect(result).toHaveLength(6);
    expect(result[3]).toBe(
      "proxy.cse.cuhk.edu.hk:5070 close, 0 bytes sent, 0 bytes received, lifetime 00:01",
    );
    expect(result[5]).toBe(
      "<*> close, <*> bytes<*>sent, <*> bytes<*>received, lifetime <*>",
    );
  });

  it("should handle row with fewer columns than header (pad at end)", () => {
    const headerCols = 6;
    const contentIdx = 3;
    const line = "1,10.30,chrome.exe,simple content";
    const result = parseCsvRow(line, headerCols, contentIdx);

    expect(result).toHaveLength(6);
    expect(result[0]).toBe("1");
    expect(result[3]).toBe("simple content");
    expect(result[4]).toBe(""); // padded at end
    expect(result[5]).toBe(""); // padded at end
  });

  it("should correctly handle Windows CSV with quoted Content (pads correctly)", () => {
    const headerCols = 8;
    const contentIdx = 5;
    const line =
      '1,2016-09-28,04:30:30,Info,CBS,"Loaded Servicing Stack v6.1.7601.23505 with Core: C:\\Windows\\winsxs\\cbscore.dll",E4,Loaded Servicing Stack <*> with Core: <*>\\cbscore.dll';
    const result = parseCsvRow(line, headerCols, contentIdx);

    expect(result).toHaveLength(8);
    expect(result[5]).toBe(
      "Loaded Servicing Stack v6.1.7601.23505 with Core: C:\\Windows\\winsxs\\cbscore.dll",
    );
  });
});
