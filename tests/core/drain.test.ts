/**
 * Drain core algorithm tests.
 *
 * Ported 1:1 from Python test_drain.py tests:
 * - test_add_shorter_than_depth_message
 * - test_add_log_message
 * - test_add_log_message_sim_75
 * - test_max_clusters
 * - test_max_clusters_lru_multiple_leaf_nodes
 * - test_max_clusters_lru_single_leaf_node
 * - test_match_only
 * - test_create_template
 *
 * Plus additional tests for edge cases and invariants unique to TS.
 */

import { describe, it, expect } from "vitest";
import { Drain } from "../../src/core/Drain.js";
import { ChangeType } from "../../src/core/types.js";

// ============================================================
// Utility: Build a Drain instance with common defaults
// ============================================================

function makeDrain(overrides: Record<string, unknown> = {}): Drain {
  return new Drain({
    depth: 4,
    simTh: 0.4,
    maxChildren: 100,
    ...overrides,
  });
}

// ============================================================
// Ported tests from test_drain.py
// ============================================================

describe("Drain (ported from test_drain.py)", () => {
  // T1.1: test_add_shorter_than_depth_message
  it("should handle messages shorter than tree depth", () => {
    const model = makeDrain({ depth: 4 });
    const res1 = model.addLogMessage("hello");
    expect(res1.changeType).toBe(ChangeType.ClusterCreated);

    const res2 = model.addLogMessage("hello");
    expect(res2.changeType).toBe(ChangeType.None);

    const res3 = model.addLogMessage("otherword");
    expect(res3.changeType).toBe(ChangeType.ClusterCreated);

    expect(model.idToCluster.size).toBe(2);
  });

  // T1.2: test_add_log_message
  it("should cluster SSH log messages correctly", () => {
    const model = makeDrain();
    const entries = [
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 09:12:35 LabSZ sshd[24492]: Failed password for invalid user pi from 0.0.0.0 port 49289 ssh2",
      "Dec 10 09:12:44 LabSZ sshd[24501]: Failed password for invalid user ftpuser from 0.0.0.0 port 60836 ssh2",
      "Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]",
    ];

    const expected = [
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 <*> LabSZ <*> input_userauth_request: invalid user <*> [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 <*> LabSZ <*> input_userauth_request: invalid user <*> [preauth]",
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const { cluster } = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    // 6 log messages → 2 clusters (sizes 3+3 = 6)
    expect(model.getTotalClusterSize()).toBe(6);
  });

  // T1.3: test_add_log_message_sim_75
  it("should respect higher similarity threshold (simTh=0.75)", () => {
    const model = makeDrain({ depth: 4, simTh: 0.75, maxChildren: 100 });

    const entries = [
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 09:12:35 LabSZ sshd[24492]: Failed password for invalid user pi from 0.0.0.0 port 49289 ssh2",
      "Dec 10 09:12:44 LabSZ sshd[24501]: Failed password for invalid user ftpuser from 0.0.0.0 port 60836 ssh2",
      "Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]",
    ];

    const expected = [
      "Dec 10 07:07:38 LabSZ sshd[24206]: input_userauth_request: invalid user test9 [preauth]",
      "Dec 10 07:08:28 LabSZ sshd[24208]: input_userauth_request: invalid user webmaster [preauth]",
      "Dec 10 09:12:32 LabSZ sshd[24490]: Failed password for invalid user ftpuser from 0.0.0.0 port 62891 ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 <*> LabSZ <*> Failed password for invalid user <*> from 0.0.0.0 port <*> ssh2",
      "Dec 10 07:28:03 LabSZ sshd[24245]: input_userauth_request: invalid user pgadmin [preauth]",
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const { cluster } = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    // 6 messages → 3 unique clusters, sizes 1 + 1 + 1 + 1 + 1 + 1 = 6
    expect(model.getTotalClusterSize()).toBe(6);
  });

  // T1.4: test_max_clusters
  it("should enforce max_clusters limit", () => {
    const model = makeDrain({ maxClusters: 1 });

    const entries = [
      "A format 1",
      "A format 2",
      "B format 1",
      "B format 2",
      "A format 3",
    ];

    const expected = [
      "A format 1",
      "A format <*>",
      "B format 1",
      "B format <*>",
      "A format 3",
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const { cluster } = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    expect(model.getTotalClusterSize()).toBe(1);
  });

  // T1.5: test_max_clusters_lru_multiple_leaf_nodes
  it("should apply LRU eviction with multiple leaf nodes", () => {
    const model = makeDrain({ maxClusters: 2, depth: 4, paramStr: "*" });

    const entries = [
      "A A A",
      "A A B",
      "B A A",
      "B A B",
      "C A A",
      "C A B",
      "B A A",
      "A A A",
    ];

    const expected = [
      "A A A",    // lru: []
      "A A *",    // lru: ["A A A"]
      "B A A",    // lru: ["B A A", "A A *"]
      "B A *",    // lru: ["B A *", "A A *"]
      "C A A",    // lru: ["C A A", "B A *"]
      "C A *",    // lru: ["C A *", "B A *"]
      "B A *",    // lru: ["B A *", "C A *"] — "B A A" matched existing template
      "A A A",    // lru: ["A A A", "C A *"] — "A A *" was evicted, "A A A" recreated
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const { cluster } = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    expect(model.getTotalClusterSize()).toBe(4);
  });

  // T1.6: test_max_clusters_lru_single_leaf_node
  it("should apply LRU eviction with single leaf node", () => {
    const model = makeDrain({ maxClusters: 2, depth: 4, paramStr: "*" });

    const entries = [
      "A A A",
      "A A B",
      "A B A",
      "A B B",
      "A C A",
      "A C B",
      "A B A",
      "A A A",
    ];

    const expected = [
      "A A A",    // lru: []
      "A A *",    // lru: ["A A A"]
      "A B A",    // lru: ["A B A", "A A *"]
      "A B *",    // lru: ["A B *", "A A *"]
      "A C A",    // lru: ["A C A", "A B *"]
      "A C *",    // lru: ["A C *", "A B *"]
      "A B *",    // lru: ["A B *", "A C *"] — "A B A" matched existing template
      "A A A",    // lru: ["A A A", "A C *"] — "A A *" was evicted
    ];

    const actual: string[] = [];
    for (const entry of entries) {
      const { cluster } = model.addLogMessage(entry);
      actual.push(cluster.getTemplate());
    }

    expect(actual).toEqual(expected);
    // Total cluster size = number of messages consumed by clusters still in cache = 4
    // (The evicted clusters' sizes don't count — Python test only checks correctness
    //  of template sequence, and the original Python test had get_total_cluster_size
    //  commented out. We test the template sequence alignment.)
  });

  // T1.7: test_match_only
  it("should match logs against existing clusters (inference mode)", () => {
    const model = makeDrain();

    model.addLogMessage("aa aa aa");
    model.addLogMessage("aa aa bb");
    model.addLogMessage("aa aa cc");
    model.addLogMessage("xx yy zz");

    // Should match the "aa aa <*>" cluster (cluster_id=1)
    const c1 = model.match("aa aa tt");
    expect(c1).not.toBeNull();
    expect(c1!.clusterId).toBe(1);

    // Should match the "xx yy zz" cluster (cluster_id=2)
    const c2 = model.match("xx yy zz");
    expect(c2).not.toBeNull();
    expect(c2!.clusterId).toBe(2);

    // No cluster for different token length or content
    const c3 = model.match("xx yy rr");
    expect(c3).toBeNull();

    const c4 = model.match("nothing");
    expect(c4).toBeNull();
  });

  // T1.8: test_create_template
  it("should create correct templates from two sequences", () => {
    const model = makeDrain({ paramStr: "*" });

    const seq1 = ["aa", "bb", "dd"];
    const seq2 = ["aa", "bb", "cc"];

    // Different last token → replace with paramStr
    const template1 = model.createTemplate(seq1, seq2);
    expect([...template1]).toEqual(["aa", "bb", "*"]);

    // Same sequences → no changes
    const template2 = model.createTemplate(seq1, seq1);
    expect([...template2]).toEqual(seq1);

    // Different lengths should throw
    expect(() => model.createTemplate(seq1, ["aa"])).toThrow();
  });
});

// ============================================================
// Additional tests (TS-specific edge cases and invariants)
// ============================================================

describe("Drain (additional edge cases)", () => {
  // T1.9: Empty log message
  it("should handle empty log messages", () => {
    const model = makeDrain();
    const res = model.addLogMessage("");
    expect(res.changeType).toBe(ChangeType.ClusterCreated);
    expect(res.cluster.clusterId).toBe(1);
    expect(res.cluster.getTemplate()).toBe("");

    const res2 = model.addLogMessage("");
    expect(res2.changeType).toBe(ChangeType.None);
    expect(res2.cluster.clusterId).toBe(1);
  });

  // T1.10: Single token log
  it("should handle single-token log messages", () => {
    const model = makeDrain({ depth: 4 });
    const res1 = model.addLogMessage("single");
    expect(res1.changeType).toBe(ChangeType.ClusterCreated);

    const res2 = model.addLogMessage("different");
    expect(res2.changeType).toBe(ChangeType.ClusterCreated);
    expect(model.idToCluster.size).toBe(2);
  });

  // T1.11: Very long log message
  it("should handle very long log messages", () => {
    const model = makeDrain();
    const tokens = Array.from({ length: 100 }, (_, i) => `token${i}`);
    const longMsg = tokens.join(" ");

    const res = model.addLogMessage(longMsg);
    expect(res.changeType).toBe(ChangeType.ClusterCreated);
    expect(res.cluster.getTemplate()).toBe(longMsg);
  });

  // T1.12: Numeric token parameterization
  it("should parameterize numeric tokens when enabled", () => {
    const model = makeDrain({ parametrizeNumericTokens: true, paramStr: "<*>" });
    model.addLogMessage("error code 42 occurred");
    const res = model.addLogMessage("error code 99 occurred");

    expect(res.changeType).toBe(ChangeType.ClusterTemplateChanged);
    expect(res.cluster.getTemplate()).toBe("error code <*> occurred");
  });

  // T1.13: Extra delimiters
  it("should tokenize with extra delimiters", () => {
    const model = makeDrain({ extraDelimiters: ["_", ":"] });
    const res = model.addLogMessage("host_port:value_test");
    expect(res.changeType).toBe(ChangeType.ClusterCreated);
    // Should split into: "host", "port", "value", "test"
    expect(res.cluster.logTemplateTokens).toEqual(["host", "port", "value", "test"]);
  });

  // T1.14: max_children limit
  it("should enforce max_children limit and create wildcard nodes", () => {
    const model = makeDrain({ maxChildren: 2, depth: 4 });

    // Feed 3 different prefixes to force wildcard node creation
    model.addLogMessage("A X X");
    model.addLogMessage("B X X");
    model.addLogMessage("C X X"); // Should go through <*> due to maxChildren=2

    // All three should share the <*> path, clustering together
    const match = model.match("D X X");
    expect(match).not.toBeNull();
  });

  // T1.15: change_type sequence correctness
  it("should produce correct change_type sequence", () => {
    const model = makeDrain();

    const types: string[] = [];

    // First message: new cluster
    types.push(model.addLogMessage("user alice logged in").changeType);
    // Second message: same pattern → template may change
    types.push(model.addLogMessage("user bob logged in").changeType);
    // Third message: same pattern → no change
    types.push(model.addLogMessage("user carol logged in").changeType);
    // Different message: new cluster
    types.push(model.addLogMessage("system restarted").changeType);

    expect(types[0]).toBe(ChangeType.ClusterCreated);       // "user alice logged in"
    expect(types[1]).toBe(ChangeType.ClusterTemplateChanged); // bob → param
    expect(types[2]).toBe(ChangeType.None);                 // carol → matched
    expect(types[3]).toBe(ChangeType.ClusterCreated);       // different token count
  });

  // T1.16: cluster_id monotonicity
  it("should maintain monotonically increasing cluster IDs", () => {
    const model = makeDrain();

    const ids: number[] = [];
    for (const msg of ["a", "b", "c", "d", "e"]) {
      const { cluster } = model.addLogMessage(msg);
      ids.push(cluster.clusterId);
    }

    // IDs should be 1,2,3,4,5 — strictly increasing
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]!).toBeGreaterThan(ids[i - 1]!);
    }
  });
});
