/**
 * Redis persistence handler for drain-ts.
 *
 * Maps 1:1 to Python `RedisPersistence` class (drain3/redis_persistence.py).
 *
 * Stores Drain state snapshots as values under a configurable Redis key.
 * Requires `ioredis` as an optional peer dependency.
 *
 * ```bash
 * npm install ioredis
 * ```
 *
 * @module RedisPersistence
 */

import type { PersistenceHandler } from "./PersistenceHandler.js";

/**
 * Redis-backed state persistence.
 *
 * State is stored as a raw byte value under a configurable key.
 * Supports TLS connections via the Redis options.
 */
export class RedisPersistence implements PersistenceHandler {
  readonly name = "redis";
  private readonly _client: any;
  private readonly _key: string;

  /**
   * @param redisOptions - ioredis connection options (host, port, db, password, tls, etc.)
   * @param key - Redis key for state storage (default: "drain-ts:state")
   */
  constructor(
    redisOptions: Record<string, unknown>,
    key: string = "drain-ts:state",
  ) {
    this._key = key;
    const { Redis } = require("ioredis");
    this._client = new Redis(redisOptions);
  }

  /**
   * Saves state to Redis under the configured key.
   *
   * Python: RedisPersistence.save_state() — r.set(key, state)
   */
  async saveState(state: Uint8Array): Promise<void> {
    await this._client.set(this._key, Buffer.from(state));
  }

  /**
   * Loads state from Redis.
   *
   * Python: RedisPersistence.load_state() — r.get(key)
   *
   * @returns State buffer or null if no value exists at the key
   */
  async loadState(): Promise<Uint8Array | null> {
    const value = await this._client.getBuffer(this._key);
    return value ? new Uint8Array(value) : null;
  }

  /**
   * Closes the Redis connection gracefully.
   */
  async disconnect(): Promise<void> {
    await this._client.quit();
  }
}
