/**
 * @agentix-e/drain-ts
 *
 * A TypeScript/Node.js streaming log template miner based on the Drain algorithm,
 * ported with high fidelity from the official Python Drain3 implementation.
 *
 * @packageDocumentation
 */

// Core algorithm exports
export {
  Drain,
  DrainBase,
  LogCluster,
  LogClusterCache,
  Node,
  ChangeType,
  MatchStrategy,
  type AddLogResult,
  type DrainOptions,
  type DrainSnapshot,
  type DrainSnapshotCluster,
  type ExtractedParameter,
} from "./core/index.js";

// Masker exports
export {
  MaskingInstruction,
  LogMasker,
  IP_MASK,
  NUM_MASK,
  HEX_MASK,
  UUID_MASK,
  EMAIL_MASK,
  DEFAULT_MASKING_INSTRUCTIONS,
  EXTENDED_MASKING_INSTRUCTIONS,
  ALL_MASKING_INSTRUCTIONS,
} from "./masker/index.js";

// TemplateMiner (main user-facing API)
export { TemplateMiner, type PersistenceHandler } from "./TemplateMiner.js";
export { TemplateMinerConfig } from "./TemplateMinerConfig.js";
