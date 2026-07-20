/**
 * Persistence handler tests.
 *
 * Tests FilePersistence, MemoryPersistence, and snapshot round-trips
 * through TemplateMiner.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FilePersistence } from "../../src/persistence/FilePersistence.js";
import { MemoryPersistence } from "../../src/persistence/MemoryPersistence.js";
import { TemplateMiner } from "../../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../../src/TemplateMinerConfig.js";

describe("FilePersistence", () => {
  let tmpDir: string;
  let testFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drain-ts-test-"));
    testFile = path.join(tmpDir, "snapshot.json");
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should save and load state", () => {
    const handler = new FilePersistence(testFile);
    const state = new TextEncoder().encode(JSON.stringify({ test: true }));
    handler.saveState(state);

    const loaded = handler.loadState();
    expect(loaded).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(loaded!))).toEqual({
      test: true,
    });
  });

  it("should return null when file does not exist", () => {
    const handler = new FilePersistence(testFile);
    expect(handler.loadState()).toBeNull();
  });

  it("should create parent directories on save", () => {
    const deepFile = path.join(tmpDir, "a", "b", "c", "snapshot.json");
    const handler = new FilePersistence(deepFile);
    const state = new TextEncoder().encode("test");
    handler.saveState(state);

    expect(fs.existsSync(deepFile)).toBe(true);
    const loaded = handler.loadState();
    expect(loaded).not.toBeNull();
  });
});

describe("MemoryPersistence", () => {
  it("should save and load state", () => {
    const handler = new MemoryPersistence();
    const state = new TextEncoder().encode(JSON.stringify({ key: "value" }));
    handler.saveState(state);

    const loaded = handler.loadState();
    expect(loaded).not.toBeNull();
    expect(JSON.parse(new TextDecoder().decode(loaded!))).toEqual({
      key: "value",
    });
  });

  it("should return null when nothing saved", () => {
    const handler = new MemoryPersistence();
    expect(handler.loadState()).toBeNull();
  });

  it("should overwrite previous state on save", () => {
    const handler = new MemoryPersistence();
    handler.saveState(new TextEncoder().encode("first"));
    handler.saveState(new TextEncoder().encode("second"));

    const loaded = handler.loadState();
    expect(new TextDecoder().decode(loaded!)).toBe("second");
  });
});

describe("TemplateMiner persistence integration", () => {
  it("should save and restore clusters via MemoryPersistence", () => {
    const handler = new MemoryPersistence();

    // Train
    const minerA = new TemplateMiner({ persistenceHandler: handler });
    minerA.addLogMessage("user alice logged in");
    minerA.addLogMessage("user bob logged in");
    expect(minerA.drain.clustersCounter).toBe(1);

    // Restore
    const minerB = new TemplateMiner({ persistenceHandler: handler });
    expect(minerB.drain.clustersCounter).toBe(1);
    expect(minerB.drain.idToCluster.size).toBe(1);

    // Inference on restored model
    const result = minerB.match("user carol logged in");
    expect(result).not.toBeNull();
  });

  it("should save and restore via FilePersistence", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drain-ts-fp-"));
    const testFile = path.join(tmpDir, "snapshot.json");
    const handler = new FilePersistence(testFile);

    try {
      const minerA = new TemplateMiner({ persistenceHandler: handler });
      minerA.addLogMessage("error 42 occurred");
      minerA.addLogMessage("error 99 occurred");
      expect(minerA.drain.clustersCounter).toBe(1);

      const minerB = new TemplateMiner({ persistenceHandler: handler });
      expect(minerB.drain.clustersCounter).toBe(1);
      expect(minerB.drain.idToCluster.size).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should handle missing state gracefully (no crash)", () => {
    const handler = new MemoryPersistence();
    // Don't save anything — handler starts empty

    const miner = new TemplateMiner({ persistenceHandler: handler });
    expect(miner.drain.clustersCounter).toBe(0);
    expect(miner.drain.idToCluster.size).toBe(0);

    // Still functional even without loaded state
    miner.addLogMessage("hello world");
    expect(miner.drain.clustersCounter).toBe(1);
  });

  it("should load empty Uint8Array gracefully", () => {
    const handler = new MemoryPersistence();
    handler.saveState(new Uint8Array(0));

    const miner = new TemplateMiner({ persistenceHandler: handler });
    // Empty buffer should be treated as "no state"
    expect(miner.drain.clustersCounter).toBe(0);
  });
});

describe("FilePersistence error handling", () => {
  it("should return null when path is a directory (EISDIR triggers catch)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "drain-ts-dir-"));
    try {
      // Point loadState to a directory → fs.readFileSync throws EISDIR → caught → null
      const handler = new FilePersistence(tmpDir);
      const result = handler.loadState();
      expect(result).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should throw on invalid save path (caller responsibility)", () => {
    const handler = new FilePersistence("/dev/null/invalid/path/to/nowhere");
    // On some systems /dev/null is a special file; trying to mkdirSync its parent fails
    // This test verifies that the error propagates to the caller
    expect(() => handler.saveState(new TextEncoder().encode("data"))).toThrow();
  });
});

describe("Snapshot compression", () => {
  it("should compress and decompress snapshot state", () => {
    const handler = new MemoryPersistence();
    const config = TemplateMinerConfig.from({ snapshotCompressState: true });
    
    const minerA = new TemplateMiner({ config, persistenceHandler: handler });
    minerA.addLogMessage("message one");
    minerA.addLogMessage("message two");
    
    // Load into miner B — should decompress correctly
    const minerB = new TemplateMiner({ config, persistenceHandler: handler });
    expect(minerB.drain.clustersCounter).toBe(1);
  });
});
