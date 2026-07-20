/**
 * @agentix-e/drain-ts/presets
 *
 * Re-exports masking instruction presets for convenient tree-shaking.
 * Import from here to only bundle the mask presets you need.
 *
 * @example
 * ```typescript
 * import { IP_MASK, NUM_MASK } from "@agentix-e/drain-ts/presets";
 * ```
 */

export {
  IP_MASK,
  NUM_MASK,
  HEX_MASK,
  UUID_MASK,
  EMAIL_MASK,
  DEFAULT_MASKING_INSTRUCTIONS,
  EXTENDED_MASKING_INSTRUCTIONS,
  ALL_MASKING_INSTRUCTIONS,
} from "./masker/presets.js";
