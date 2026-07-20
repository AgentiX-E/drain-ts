import * as fs from "node:fs";
import * as path from "node:path";
import type { PersistenceHandler } from "./PersistenceHandler.js";

/**
 * File-based persistence handler.
 *
 * Maps to Python FilePersistence (one of the Drain3 persistence implementations).
 *
 * Stores snapshots as JSON files on the local filesystem. Uses only `node:fs`
 * and `node:path` — zero third-party dependencies.
 *
 * The parent directory is created automatically on first save.
 *
 * @example
 * ```typescript
 * const handler = new FilePersistence("/var/lib/drain-ts/snapshot.json");
 * const miner = new TemplateMiner({ persistenceHandler: handler });
 * ```
 */
export class FilePersistence implements PersistenceHandler {
  private readonly _filePath: string;

  /**
   * @param filePath - Absolute or relative path to the snapshot file.
   */
  constructor(filePath: string) {
    this._filePath = filePath;
  }

  /**
   * Writes the snapshot state to the configured file path.
   * Creates parent directories if they don't exist.
   */
  saveState(state: Uint8Array): void {
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this._filePath, state);
  }

  /**
   * Reads the snapshot state from the configured file path.
   * Returns null if the file does not exist or cannot be read.
   */
  loadState(): Uint8Array | null {
    try {
      if (!fs.existsSync(this._filePath)) return null;
      const buffer = fs.readFileSync(this._filePath);
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } catch (err) {
      // Log the error so callers can debug failed restores.
      // Returning null means "no state" — the caller sees a fresh model.
      console.error(
        `[drain-ts] FilePersistence failed to load snapshot from ${this._filePath}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }
}
