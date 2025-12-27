/**
 * Authentication Store using Zustand
 */

import { create } from 'zustand';
import { api, type User, type AuthStatus } from '../api/client';

interface AuthState {
  // State
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  authMethods: {
    password: boolean;
    oauth: boolean;
  };

  // Actions
  checkAuth: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (data: {
    username: string;
    email: string;
    password: string;
    display_name?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  authMethods: {
    password: true,
    oauth: false,
  },

  // Check authentication status
  checkAuth: async () => {
    try {
      set({ isLoading: true, error: null });
      const status: AuthStatus = await api.getAuthStatus();
      set({
        user: status.user,
        isAuthenticated: status.authenticated,
        authMethods: status.methods,
        isLoading: false,
      });
    } catch (err) {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to check auth',
      });
    }
  },

  // Login with email/password
  login: async (email: string, password: string) => {
    try {
      set({ isLoading: true, error: null });
      const { user } = await api.login(email, password);
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Login failed',
      });
      throw err;
    }
  },

  // Register new account
  register: async (data) => {
    try {
      set({ isLoading: true, error: null });
      const { user } = await api.register(data);
      set({
        user,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Registration failed',
      });
      throw err;
    }
  },

  // Logout
  logout: async () => {
    try {
      set({ isLoading: true });
      await api.logout();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Logout failed',
      });
    }
  },

  // Clear error
  clearError: () => {
    set({ error: null });
  },

  // Set user (for after setup)
  setUser: (user: User) => {
    set({ user, isAuthenticated: true });
  },
}));
