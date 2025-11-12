/**
 * Shared Environment Configuration
 * 
 * Provides type-safe access to environment variables across platforms.
 * Platform-specific implementations should provide these values.
 */

export type EnvironmentConfig = {
  /** Backend API URL */
  backendUrl: string;
  /** Environment mode */
  mode: 'development' | 'production' | 'test';
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: EnvironmentConfig = {
  backendUrl: '',
  mode: 'production',
};

/**
 * Create environment configuration with defaults
 */
export function createEnvConfig(overrides?: Partial<EnvironmentConfig>): EnvironmentConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

