/**
 * Masker module barrel exports.
 *
 * @module masker
 */

export { MaskingInstruction } from "./MaskingInstruction.js";
export { LogMasker } from "./LogMasker.js";
export {
  IP_MASK,
  NUM_MASK,
  HEX_MASK,
  UUID_MASK,
  EMAIL_MASK,
  DEFAULT_MASKING_INSTRUCTIONS,
  EXTENDED_MASKING_INSTRUCTIONS,
  ALL_MASKING_INSTRUCTIONS,
} from "./presets.js";
