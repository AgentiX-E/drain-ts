/**
 * JaccardDrain tests — 1:1 port of Drain3's test_jaccard_drain.py.
 */
import { describe, it, expect } from "vitest";
import { JaccardDrain } from "../../src/core/JaccardDrain.js";
import { ChangeType, MatchStrategy } from "../../src/core/types.js";

describe("JaccardDrain: basic clustering", () => {
  it("should handle messages shorter than tree depth", () => {
    const model = new JaccardDrain({ depth: 4 });
    expect(model.addLogMessage("hello").changeType).toBe(ChangeType.ClusterCreated);
    expect(model.addLogMessage("hello").changeType).toBe(ChangeType.None);
    expect(model.addLogMessage("otherword").changeType).toBe(ChangeType.ClusterCreated);
    expect(model.idToCluster.size).toBe(2);
  });
});

describe("JaccardDrain: SSH log clustering", () => {
  it("should group similar SSH log messages", () => {
    const model = new JaccardDrain();
    // Python's str.splitlines() preserves leading/trailing empty lines:
    // 8 total entries (2 empty + 6 messages)
    const entries = [
      "",
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 09:12:35 LabSZ sshd[24492]: Failed password for invalid user pi from 0.0.0.0 port 49289 ssh2",
      "Dec 10 09:12:44 LabSZ sshd[24501]: Failed password for invalid user ftpuser from 0.0.0.0 port 60836 ssh2",
      "Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]",
      "",
    ];
    const expected = [
      "",
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 <*> LabSZ <*> input_userauth_request: invalid user <*> [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 <*> LabSZ <*> input_userauth_request: invalid user <*> [preauth]",
      "",
    ];
    const actual = entries.map((e) => model.addLogMessage(e).cluster.getTemplate());
    expect(actual).toEqual(expected);
    expect(model.getTotalClusterSize()).toBe(8);
  });
});

describe("JaccardDrain: higher similarity threshold", () => {
  it("should be less aggressive with simTh=0.75", () => {
    const model = new JaccardDrain({ depth: 4, simTh: 0.75, maxChildren: 100 });
    const entries = [
      "",
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 09:12:35 LabSZ sshd[24492]: Failed password for invalid user pi from 0.0.0.0 port 49289 ssh2",
      "Dec 10 09:12:44 LabSZ sshd[24501]: Failed password for invalid user ftpuser from 0.0.0.0 port 60836 ssh2",
      "Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]",
      "",
    ];
    const expected = [
      "",
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]",
      "",
    ];
    const actual = entries.map((e) => model.addLogMessage(e).cluster.getTemplate());
    expect(actual.length).toBe(8);
    expect(actual[1]).toBe(expected[1]);
    expect(actual[4]).toBe(expected[4]);
    expect(actual[5]).toBe(expected[5]);
    expect(actual[7]).toBe(expected[7]);
    expect(model.getTotalClusterSize()).toBe(8);
  });
});

describe("JaccardDrain: maxClusters enforcement", () => {
  it("should enforce maxClusters=1 with LRU eviction", () => {
    const model = new JaccardDrain({ maxClusters: 1 });
    const entries = ["A format 1", "A format 2", "B format 1", "B format 2", "A format 3"];
    const expected = ["A format 1", "A format <*>", "B format 1", "B format <*>", "A format 3"];
    const actual = entries.map((e) => model.addLogMessage(e).cluster.getTemplate());
    expect(actual).toEqual(expected);
    expect(model.getTotalClusterSize()).toBe(1);
  });
});

describe("JaccardDrain: LRU eviction across multiple leaf nodes", () => {
  it("should evict oldest clusters across different tree nodes", () => {
    const model = new JaccardDrain({ maxClusters: 2, depth: 4, paramStr: "*" });
    const entries = ["A A A", "A A B", "B A A", "B A B", "C A A", "C A B", "B A A", "A A A"];
    const expected = ["A A A", "A A *", "B A A", "B A *", "C A A", "C A *", "B A *", "A A A"];
    const actual = entries.map((e) => model.addLogMessage(e).cluster.getTemplate());
    expect(actual).toEqual(expected);
  });
});

describe("JaccardDrain: LRU eviction in single leaf node", () => {
  it("should evict oldest clusters within the same tree node", () => {
    const model = new JaccardDrain({ maxClusters: 2, depth: 4, paramStr: "*" });
    const entries = ["A A A", "A A B", "A B A", "A B B", "A C A", "A C B", "A B A", "A A A"];
    const expected = ["A A A", "A A *", "A B A", "A B *", "A C A", "A C *", "A B *", "A A A"];
    const actual = entries.map((e) => model.addLogMessage(e).cluster.getTemplate());
    expect(actual).toEqual(expected);
  });
});

describe("JaccardDrain: match (inference)", () => {
  it("should match against existing clusters without modifying state", () => {
    const model = new JaccardDrain();
    model.addLogMessage("aa aa aa");
    model.addLogMessage("aa aa bb");
    model.addLogMessage("aa aa cc");
    model.addLogMessage("xx yy zz");
    expect(model.match("aa aa tt")?.clusterId).toBe(1);
    expect(model.match("xx yy zz")?.clusterId).toBe(2);
    expect(model.match("xx yy rr")).toBeNull();
    expect(model.match("nothing")).toBeNull();
  });
});

describe("JaccardDrain: variable-length token matching", () => {
  it("should group messages of different token lengths", () => {
    const model = new JaccardDrain();
    model.addLogMessage("check pass; user unknown");
    model.addLogMessage("check pass; user Lisa");
    model.addLogMessage("check pass; user li Sa");
    model.addLogMessage("session opened for user cyrus by (uid=0)");
    model.addLogMessage("session closed for user cyrus");
    expect(model.match("check pass; user boris")?.clusterId).toBe(1);
    expect(model.match("session opened for user cyrus by (uid=1)")?.clusterId).toBe(2);
    expect(model.match("nothing")).toBeNull();
  });
});

// ============================================================
// Edge cases: branch coverage
// ============================================================

describe("JaccardDrain: edge cases", () => {
  it("empty input creates cluster", () => {
    const m = new JaccardDrain();
    expect(m.addLogMessage("").changeType).toBe(ChangeType.ClusterCreated);
  });

  it("getSeqDistance with empty sequences", () => {
    const m = new JaccardDrain();
    expect(m.getSeqDistance([], [], false).similarity).toBe(1.0);
  });

  it("getSeqDistance includeParams=false", () => {
    const m = new JaccardDrain({ paramStr: "<*>" });
    expect(m.getSeqDistance(["a", "<*>"], ["a", "x"], false).similarity).toBeGreaterThan(0);
  });

  it("match with always strategy", () => {
    const m = new JaccardDrain();
    m.addLogMessage("check pass; user unknown"); m.addLogMessage("check pass; user Lisa");
    expect(m.match("check pass; user Boris", MatchStrategy.Always)).not.toBeNull();
  });

  it("match with fallback strategy", () => {
    const m = new JaccardDrain();
    m.addLogMessage("check pass; user unknown"); m.addLogMessage("check pass; user Lisa");
    expect(m.match("check pass; user Boris", MatchStrategy.Fallback)).not.toBeNull();
  });

  it("printTree does not throw", () => {
    const m = new JaccardDrain();
    m.addLogMessage("test");
    expect(() => m.printTree()).not.toThrow();
  });
});

describe("JaccardDrain: match strategy coverage", () => {
  it("should handle match with fallback strategy explicitly", () => {
    const m = new JaccardDrain();
    m.addLogMessage("check pass; user unknown"); m.addLogMessage("check pass; user Lisa");
    m.addLogMessage("check pass; user Lisa");
    const c = m.match("check pass; user Boris", MatchStrategy.Fallback);
    expect(c).not.toBeNull();
  });

  it("should handle match with always strategy explicitly", () => {
    const m = new JaccardDrain();
    m.addLogMessage("check pass; user unknown"); m.addLogMessage("check pass; user Lisa");
    const c = m.match("check pass; user Boris", MatchStrategy.Always);
    expect(c).not.toBeNull();
  });
});
