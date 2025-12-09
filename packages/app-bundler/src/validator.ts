export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface ValidationWarning {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export function validateManifest(manifest: unknown): ValidationResult {
  // TODO: implement manifest validation
  return { valid: true, errors: [], warnings: [] };
}
