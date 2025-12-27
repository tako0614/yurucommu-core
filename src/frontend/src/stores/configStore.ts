/**
 * Config Store using Zustand
 */

import { create } from 'zustand';
import { api, type Config } from '../api/client';

interface ConfigState {
  // State
  config: Config | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadConfig: () => Promise<void>;
}

const DEFAULT_CONFIG: Config = {
  siteName: 'yurucommu',
  siteDescription: 'A federated social network',
  maxPostLength: 500,
  features: {
    enableBoosts: true,
    enableLikes: true,
    enableReplies: true,
    enableMediaUpload: true,
  },
};

export const useConfigStore = create<ConfigState>((set) => ({
  // Initial state
  config: DEFAULT_CONFIG,
  isLoading: false,
  error: null,

  // Load config from server
  loadConfig: async () => {
    try {
      set({ isLoading: true, error: null });
      const config = await api.getConfig();
      set({
        config,
        isLoading: false,
      });
    } catch (err) {
      // Use default config on error
      set({
        config: DEFAULT_CONFIG,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load config',
      });
    }
  },
}));
