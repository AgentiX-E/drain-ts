/**
 * Masker module barrel exports.
 *
 * @module masker
 */

export { AbstractMaskingInstruction, MaskingInstruction } from "./MaskingInstruction.js";
export { LogMasker } from "./LogMasker.js";
export {
  IP_MASK,
  NUM_MASK,
  HEX_MASK,
  UUID_MASK,
  EMAIL_MASK,
  HOST_PORT_MASK,
  BLOCK_ID_MASK,
  PATH_MASK,
  SYSLOG_NUM_MASK,
  DEFAULT_MASKING_INSTRUCTIONS,
  EXTENDED_MASKING_INSTRUCTIONS,
  ALL_MASKING_INSTRUCTIONS,
} from "./presets.js";
