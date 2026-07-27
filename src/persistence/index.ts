/**
 * Persistence module barrel exports.
 *
 * External backends (Kafka, Redis, etc.) are implemented outside the core
 * package via the {@link PersistenceHandler} interface.
 *
 * @module persistence
 */

export { type PersistenceHandler } from "./PersistenceHandler.js";
export { FilePersistence } from "./FilePersistence.js";
export { MemoryPersistence } from "./MemoryPersistence.js";
