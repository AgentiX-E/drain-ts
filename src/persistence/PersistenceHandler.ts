/**
 * Persistence handler — framework-agnostic interface for state save/load.
 *
 * Maps to Python `PersistenceHandler(ABC)` class (drain3/persistence_handler.py).
 *
 * drain-ts defines only the contract. Users provide the implementation
 * for their storage backend of choice. Built-in zero-dependency implementations:
 *
 * - `FilePersistence` — stores snapshots on the local filesystem (node:fs).
 * - `MemoryPersistence` — stores snapshots in memory (testing/transient use).
 *
 * The interface uses `Uint8Array` (Web standard) rather than `Buffer`
 * (Node-specific) for cross-runtime compatibility (Node, Deno, Bun, browsers).
 *
 * @example Custom Redis implementation (~15 lines):
 * ```typescript
 * class RedisPersistence implements PersistenceHandler {
 *   constructor(private redis: Redis, private key: string) {}
 *
 *   async saveState(state: Uint8Array): Promise<void> {
 *     await this.redis.set(this.key, Buffer.from(state));
 *   }
 *
 *   async loadState(): Promise<Uint8Array | null> {
 *     const data = await this.redis.getBuffer(this.key);
 *     return data ? new Uint8Array(data) : null;
 *   }
 * }
 * ```
 *
 * @public
 */
export interface PersistenceHandler {
  /**
   * Persists the serialized snapshot state.
   *
   * Accepts both sync and async implementations — if the return value
   * is a Promise, TemplateMiner will handle it asynchronously.
   *
   * @param state - UTF-8 encoded JSON snapshot.
   */
  saveState(state: Uint8Array): void | Promise<void>;

  /**
   * Loads previously persisted snapshot state.
   *
   * Returns null if no state exists in the storage backend.
   *
   * @returns The state bytes, or null if nothing is stored.
   */
  loadState(): Uint8Array | null | Promise<Uint8Array | null>;
}
