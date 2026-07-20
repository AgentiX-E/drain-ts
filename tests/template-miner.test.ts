/**
 * TemplateMiner integration tests.
 *
 * Tests the full pipeline: mask → drain.addLogMessage → result.
 */

import { describe, it, expect } from "vitest";
import { TemplateMiner, type PersistenceHandler } from "../src/TemplateMiner.js";
import { TemplateMinerConfig } from "../src/TemplateMinerConfig.js";
import { ChangeType } from "../src/core/types.js";
import {
  DEFAULT_MASKING_INSTRUCTIONS,
  IP_MASK,
} from "../src/masker/presets.js";
import { MaskingInstruction } from "../src/masker/MaskingInstruction.js";

function makeMiner(overrides: Partial<TemplateMinerConfig> = {}): TemplateMiner {
  return new TemplateMiner({
    config: TemplateMinerConfig.from(overrides),
  });
}

describe("TemplateMiner", () => {
  // ============================================================
  // Basic masking + clustering integration
  // ============================================================

  it("should mask and cluster log messages", () => {
    const miner = makeMiner({
      maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
    });

    const r1 = miner.addLogMessage("connection from 192.168.1.1 port 8080");
    expect(r1.changeType).toBe(ChangeType.ClusterCreated);
    expect(r1.templateMined).toBe("connection from <IP> port <NUM>");
    expect(r1.clusterId).toBe(1);
    expect(r1.clusterSize).toBe(1);
    expect(r1.clusterCount).toBe(1);
  });

  it("should cluster similar masked messages together", () => {
    const miner = makeMiner({
      maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
    });

    miner.addLogMessage("connection from 192.168.1.1 port 8080");
    const r2 = miner.addLogMessage("connection from 10.0.0.1 port 443");

    expect(r2.changeType).toBe(ChangeType.None);
    expect(r2.templateMined).toBe("connection from <IP> port <NUM>");
    expect(r2.clusterSize).toBe(2);
  });

  // ============================================================
  // match() inference mode
  // ============================================================

  it("should match log messages without modifying state", () => {
    const miner = makeMiner({
      maskingInstructions: DEFAULT_MASKING_INSTRUCTIONS,
    });

    miner.addLogMessage("user alice logged in from 192.168.1.1");
    miner.addLogMessage("user bob logged in from 10.0.0.1");

    const cluster = miner.match("user carol logged in from 172.16.0.1");
    expect(cluster).not.toBeNull();
    expect(cluster!.getTemplate()).toContain("<IP>");

    // State should not change — no new clusters created
    expect(miner.drain.clustersCounter).toBe(1);
  });

  it("should return null on match with no matching cluster", () => {
    const miner = makeMiner();
    miner.addLogMessage("hello world");

    const result = miner.match("completely different");
    expect(result).toBeNull();
  });

  // ============================================================
  // Config integration
  // ============================================================

  it("should apply custom config correctly", () => {
    const miner = makeMiner({
      simTh: 0.9,
      depth: 5,
      maxClusters: 10,
      maskPrefix: "<!--",
      maskSuffix: "-->",
      maskingInstructions: [IP_MASK],
    });

    // Verify config propagated to engine
    expect(miner.drain.simTh).toBe(0.9);
    expect(miner.drain.logClusterDepth).toBe(5);
    expect(miner.drain.maxClusters).toBe(10);

    // Verify masking with custom prefix/suffix
    const result = miner.addLogMessage("host 192.168.1.1 is up");
    expect(result.templateMined).toBe("host <!--IP--> is up");
  });

  it("should use default config when none provided", () => {
    const miner = new TemplateMiner();
    expect(miner.drain.simTh).toBe(0.4);
    expect(miner.drain.logClusterDepth).toBe(4);
    expect(miner.config.maxClusters).toBeNull();
    expect(miner.config.maskingInstructions).toEqual([]);
  });

  // ============================================================
  // Snapshot trigger logic
  // ============================================================

  it("should trigger snapshot on cluster_created", () => {
    const savedStates: string[] = [];
    const handler: PersistenceHandler = {
      saveState(state: Uint8Array): void {
        savedStates.push(new TextDecoder().decode(state));
      },
      loadState(): null {
        return null;
      },
    };

    const miner = new TemplateMiner({ persistenceHandler: handler });
    miner.addLogMessage("test message");

    // Should have triggered exactly one save
    expect(savedStates.length).toBe(1);
    const snapshot = JSON.parse(savedStates[0]!);
    expect(snapshot.clusters).toHaveLength(1);
    expect(snapshot.clusters[0]!.log_template_tokens).toEqual([
      "test",
      "message",
    ]);
  });

  it("should trigger snapshot on cluster_template_changed", () => {
    const savedStates: string[] = [];
    const handler: PersistenceHandler = {
      saveState(state: Uint8Array): void {
        savedStates.push(new TextDecoder().decode(state));
      },
      loadState(): null {
        return null;
      },
    };

    const miner = new TemplateMiner({ persistenceHandler: handler });
    miner.addLogMessage("user alice");
    miner.addLogMessage("user bob"); // template changes

    expect(savedStates.length).toBe(2); // cluster_created + cluster_template_changed
  });

  it("should not trigger snapshot on cluster_template_none", () => {
    const savedStates: string[] = [];
    const handler: PersistenceHandler = {
      saveState(state: Uint8Array): void {
        savedStates.push(new TextDecoder().decode(state));
      },
      loadState(): null {
        return null;
      },
    };

    const miner = new TemplateMiner({ persistenceHandler: handler });
    const r1 = miner.addLogMessage("user alice");
    expect(r1.changeType).toBe(ChangeType.ClusterCreated);

    const r2 = miner.addLogMessage("user bob");
    expect(r2.changeType).toBe(ChangeType.ClusterTemplateChanged);

    const saveCountBeforeThird = savedStates.length;
    const r3 = miner.addLogMessage("user carol");
    // Third message produces "none" → no snapshot save
    expect(r3.changeType).toBe(ChangeType.None);
    expect(savedStates.length).toBe(saveCountBeforeThird);
  });

  // ============================================================
  // State persistence round-trip
  // ============================================================

  it("should restore state from saved snapshot", () => {
    let savedBuffer: Uint8Array | null = null;

    const handler: PersistenceHandler = {
      saveState(state: Uint8Array): void {
        savedBuffer = state;
      },
      loadState(): Uint8Array | null {
        return savedBuffer;
      },
    };

    // Train on miner A
    const minerA = new TemplateMiner({ persistenceHandler: handler });
    minerA.addLogMessage("connection from 192.168.1.1 port 8080");
    minerA.addLogMessage("connection from 10.0.0.1 port 443");
    expect(minerA.drain.clustersCounter).toBe(1);

    // Load state in miner B
    const minerB = new TemplateMiner({ persistenceHandler: handler });
    expect(minerB.drain.clustersCounter).toBe(1);
    expect(minerB.drain.idToCluster.size).toBe(1);

    // Should be able to classify without training
    const result = minerB.match(
      "connection from 172.16.0.1 port 3000",
    );
    expect(result).not.toBeNull();
  });

  it("should handle missing state gracefully", () => {
    const handler: PersistenceHandler = {
      saveState(): void {},
      loadState(): null {
        return null;
      },
    };

    const miner = new TemplateMiner({ persistenceHandler: handler });
    expect(miner.drain.clustersCounter).toBe(0);
    expect(miner.drain.idToCluster.size).toBe(0);
  });

  it("should work without persistence handler", () => {
    const miner = new TemplateMiner();
    // Should not throw
    miner.addLogMessage("hello world");
    expect(miner.drain.clustersCounter).toBe(1);
  });
});

describe("TemplateMinerConfig", () => {
  it("should create with all defaults", () => {
    const config = new TemplateMinerConfig();
    expect(config.simTh).toBe(0.4);
    expect(config.depth).toBe(4);
    expect(config.maxChildren).toBe(100);
    expect(config.maxClusters).toBeNull();
    expect(config.maskPrefix).toBe("<");
    expect(config.maskSuffix).toBe(">");
    expect(config.snapshotIntervalMinutes).toBe(1);
  });

  it("should override via TemplateMinerConfig.from()", () => {
    const config = TemplateMinerConfig.from({ simTh: 0.5, depth: 5 });
    expect(config.simTh).toBe(0.5);
    expect(config.depth).toBe(5);
    // Unspecified should keep defaults
    expect(config.maxChildren).toBe(100);
    expect(config.maskPrefix).toBe("<");
  });

  it("should merge masking instructions", () => {
    const customMask = new MaskingInstruction("custom", "CUSTOM");
    const config = TemplateMinerConfig.from({
      maskingInstructions: [customMask],
    });
    expect(config.maskingInstructions).toEqual([customMask]);
  });

  it("should not modify source object in from()", () => {
    const source: Partial<TemplateMinerConfig> = { simTh: 0.6 };
    TemplateMinerConfig.from(source);
    // Source should be unchanged
    expect(source.simTh).toBe(0.6);
    expect(Object.keys(source)).toEqual(["simTh"]);
  });
});

  it("should handle async persistence save failure gracefully", () => {
    const handler: PersistenceHandler = {
      saveState(_state: Uint8Array): Promise<void> {
        return Promise.reject(new Error("Simulated persistence failure"));
      },
      loadState(): null {
        return null;
      },
    };

    const miner = new TemplateMiner({ persistenceHandler: handler });
    // Should not throw — error is caught in Promise.catch
    expect(() => miner.addLogMessage("test message")).not.toThrow();
  });

  it("should handle async persistence load failure gracefully", async () => {
    const handler: PersistenceHandler = {
      saveState(_state: Uint8Array): void {
        // sync, no error
      },
      loadState(): Promise<Uint8Array | null> {
        return Promise.reject(new Error("Simulated load failure"));
      },
    };

    // Use create() factory — it awaits initPromise which catches the rejection
    const miner = await TemplateMiner.create({ persistenceHandler: handler });
    // Should not throw — rejection was caught by initPromise handler
    expect(miner.drain.clustersCounter).toBe(0);
  });

  it("should invoke onError callback on async persistence failure", async () => {
    const errors: string[] = [];
    const handler: PersistenceHandler = {
      saveState(_state: Uint8Array): Promise<void> {
        return Promise.reject(new Error("Save failed"));
      },
      loadState(): null {
        return null;
      },
    };

    const config = TemplateMinerConfig.from({
      onError: (context, err) => {
        errors.push(`${context}: ${err.message}`);
      },
    });
    const miner = new TemplateMiner({ config, persistenceHandler: handler });
    
    // Trigger save which will fail asynchronously
    miner.addLogMessage("test");
    
    // Wait for async rejection to be caught
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.some((e) => e.includes("saveState"))).toBe(true);
    expect(errors.some((e) => e.includes("Save failed"))).toBe(true);
  });

  it("should invoke onError callback on async load failure", async () => {
    const errors: string[] = [];
    const handler: PersistenceHandler = {
      saveState(_state: Uint8Array): void {},
      loadState(): Promise<Uint8Array | null> {
        return Promise.reject(new Error("Load failed"));
      },
    };

    const config = TemplateMinerConfig.from({
      onError: (context, err) => {
        errors.push(`${context}: ${err.message}`);
      },
    });

    // Use factory to properly await initPromise
    const miner = await TemplateMiner.create({
      config,
      persistenceHandler: handler,
    });

    // Should have caught the load error via onError
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("loadState");
    expect(errors[0]).toContain("Load failed");
    // Model should be empty since load failed
    expect(miner.drain.clustersCounter).toBe(0);
  });
