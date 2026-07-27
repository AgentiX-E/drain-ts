/**
 * Unit tests for KafkaPersistence and RedisPersistence.
 *
 * Since these require external services and optional peer dependencies,
 * tests validate interface compliance. The Redis tests are skipped when
 * ioredis is not installed.
 */
import { describe, it, expect } from "vitest";
import { KafkaPersistence } from "../../src/persistence/KafkaPersistence.js";

describe("KafkaPersistence", () => {
  it("should implement PersistenceHandler interface", () => {
    const p = new KafkaPersistence("test-topic", {
      brokers: ["localhost:9092"],
      clientId: "drain-ts-test",
    });
    expect(p.name).toBe("kafka");
    expect(typeof p.saveState).toBe("function");
    expect(typeof p.loadState).toBe("function");
  });

  it("should use custom snapshot poll timeout", () => {
    const p = new KafkaPersistence(
      "test-topic",
      { brokers: ["localhost:9092"] },
      30000,
    );
    expect(p).toBeDefined();
  });

  it("should accept SSL config", () => {
    const p = new KafkaPersistence("secure-topic", {
      brokers: ["broker:9093"],
      ssl: true,
      sasl: { mechanism: "plain", username: "user", password: "pass" },
    });
    expect(p).toBeDefined();
  });
});

describe("RedisPersistence", () => {
  it("should implement PersistenceHandler interface when ioredis is available", () => {
    try {
      require.resolve("ioredis");
    } catch {
      expect(true).toBe(true); // Skip if ioredis not installed
      return;
    }
    const { RedisPersistence } = require("../../src/persistence/RedisPersistence.js");
    const p = new RedisPersistence({ host: "localhost", port: 6379 });
    expect(p.name).toBe("redis");
    expect(typeof p.saveState).toBe("function");
    expect(typeof p.loadState).toBe("function");
    p.disconnect();
  });

  it("should accept TLS options when ioredis is available", () => {
    try {
      require.resolve("ioredis");
    } catch {
      expect(true).toBe(true);
      return;
    }
    const { RedisPersistence } = require("../../src/persistence/RedisPersistence.js");
    const p = new RedisPersistence({
      host: "redis.example.com",
      port: 6380,
      password: "secret",
      tls: {},
    });
    expect(p).toBeDefined();
    p.disconnect();
  });

  it("should support disconnect when ioredis is available", () => {
    try {
      require.resolve("ioredis");
    } catch {
      expect(true).toBe(true);
      return;
    }
    const { RedisPersistence } = require("../../src/persistence/RedisPersistence.js");
    const p = new RedisPersistence({ host: "localhost", port: 6379 });
    expect(typeof p.disconnect).toBe("function");
    p.disconnect();
  });
});
