import type { PersistenceHandler } from "./PersistenceHandler.js";

/**
 * In-memory persistence handler.
 *
 * Maps to Python `MemoryBufferPersistence` (added in Drain3 v0.9.1).
 *
 * State is held in a memory buffer — useful for testing, temporary
 * use, or scenarios where persistence to disk is not needed. State
 * is lost on process restart.
 *
 * Zero dependencies.
 *
 * @example
 * ```typescript
 * const handler = new MemoryPersistence();
 * const miner = new TemplateMiner({ persistenceHandler: handler });
 * miner.addLogMessage("test");
 * // State is in memory; accessible via handler.loadState()
 * ```
 */
export class MemoryPersistence implements PersistenceHandler {
  private _buffer: Uint8Array | null = null;

  /**
   * Stores the state in the internal memory buffer.
   */
  saveState(state: Uint8Array): void {
    this._buffer = state;
  }

  /**
   * Returns the stored state, or null if nothing has been saved.
   */
  loadState(): Uint8Array | null {
    return this._buffer;
  }
}
