// Vite plugin
export { takosPlugin, type TakosPluginOptions } from "./vite-plugin.js";

// Manifest generator
export {
  generateManifest,
  generateManifestFromFile,
  type GenerateManifestOptions,
  type GeneratedManifest,
  type ManifestScreen,
  type ManifestHandler,
} from "./manifest-generator.js";

// Validator
export {
  validateManifest,
  validateManifestFile,
  type ValidationResult,
  type ValidationError,
  type ValidationWarning,
} from "./validator.js";
