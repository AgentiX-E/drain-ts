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
