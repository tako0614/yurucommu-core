/**
 * Tenant Configuration Service
 *
 * Handles tenant configuration storage and retrieval for the tenant worker.
 * Configuration is stored in the tenant's D1 database.
 */

import type { Env } from '../types';

// ============================================================================
// Types (mirrored from takos-private, but simplified for tenant use)
// ============================================================================

export interface TenantConfig {
  siteName: string;
  siteDescription: string;
  language: string;
  defaultVisibility: 'public' | 'unlisted' | 'followers' | 'direct';
  features: {
    enableBoosts: boolean;
    enableLikes: boolean;
    enableReplies: boolean;
    enableMediaUpload: boolean;
    enableCustomEmoji: boolean;
  };
  federation: {
    allowList: string[];
    blockList: string[];
    autoAcceptFollows: boolean;
  };
  content: {
    maxPostLength: number;
    maxMediaAttachments: number;
    allowedMediaTypes: string[];
  };
  ui: {
    accentColor: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    customFooterHtml: string | null;
  };
}

export type RuleAction = 'allow' | 'warn' | 'reject' | 'silence';

export interface ContentRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  conditions: {
    field: 'content' | 'actor' | 'domain' | 'mediaType' | 'language';
    operator: 'contains' | 'equals' | 'matches' | 'startsWith' | 'endsWith';
    value: string;
    caseSensitive?: boolean;
  }[];
  action: RuleAction;
  message?: string;
}

export interface RulesConfig {
  version: 1;
  rules: ContentRule[];
}

export interface TenantConfigPackage {
  config: TenantConfig;
  theme: string | null;
  rules: RulesConfig;
}

// ============================================================================
// Default Configuration
// ============================================================================

export const DEFAULT_CONFIG: TenantConfig = {
  siteName: 'My Takos Instance',
  siteDescription: 'A personal ActivityPub server',
  language: 'en',
  defaultVisibility: 'public',
  features: {
    enableBoosts: true,
    enableLikes: true,
    enableReplies: true,
    enableMediaUpload: true,
    enableCustomEmoji: false,
  },
  federation: {
    allowList: [],
    blockList: [],
    autoAcceptFollows: false,
  },
  content: {
    maxPostLength: 500,
    maxMediaAttachments: 4,
    allowedMediaTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  },
  ui: {
    accentColor: '#6366f1',
    logoUrl: null,
    faviconUrl: null,
    customFooterHtml: null,
  },
};

export const DEFAULT_RULES: RulesConfig = {
  version: 1,
  rules: [],
};

// ============================================================================
// Storage Functions
// ============================================================================

const CONFIG_KEY = 'tenant_config';

/**
 * Get the current tenant configuration
 */
export async function getConfig(env: Env): Promise<TenantConfigPackage> {
  const result = await env.DB.prepare(
    `SELECT value FROM tenant_config WHERE key = ?`
  ).bind(CONFIG_KEY).first<{ value: string }>();

  if (!result) {
    return {
      config: DEFAULT_CONFIG,
      theme: null,
      rules: DEFAULT_RULES,
    };
  }

  try {
    return JSON.parse(result.value) as TenantConfigPackage;
  } catch {
    return {
      config: DEFAULT_CONFIG,
      theme: null,
      rules: DEFAULT_RULES,
    };
  }
}

/**
 * Save tenant configuration
 */
export async function saveConfig(env: Env, config: TenantConfigPackage): Promise<void> {
  const value = JSON.stringify(config);

  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_config (key, value, updated_at)
     VALUES (?, ?, datetime('now'))`
  ).bind(CONFIG_KEY, value).run();
}

/**
 * Get only the config portion
 */
export async function getTenantConfig(env: Env): Promise<TenantConfig> {
  const config = await getConfig(env);
  return config.config;
}

/**
 * Get only the theme
 */
export async function getTheme(env: Env): Promise<string | null> {
  const config = await getConfig(env);
  return config.theme;
}

/**
 * Get only the rules
 */
export async function getRules(env: Env): Promise<RulesConfig> {
  const config = await getConfig(env);
  return config.rules;
}

// ============================================================================
// Rule Evaluation
// ============================================================================

export interface RuleEvaluationContext {
  content?: string;
  actor?: string;
  domain?: string;
  mediaType?: string;
  language?: string;
}

export interface RuleEvaluationResult {
  action: RuleAction;
  matchedRule: ContentRule | null;
  message?: string;
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function matchesDomain(domain: string, entry: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedEntry = normalizeDomain(entry);
  return normalizedDomain === normalizedEntry || normalizedDomain.endsWith(`.${normalizedEntry}`);
}

export function isFederationAllowed(config: TenantConfig, domain: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return false;
  }

  if (config.federation.blockList.some(entry => matchesDomain(normalizedDomain, entry))) {
    return false;
  }

  if (config.federation.allowList.length > 0) {
    return config.federation.allowList.some(entry => matchesDomain(normalizedDomain, entry));
  }

  return true;
}

/**
 * Evaluate content against rules
 */
export function evaluateRules(
  rules: RulesConfig,
  context: RuleEvaluationContext
): RuleEvaluationResult {
  // Sort rules by priority (higher first)
  const sortedRules = [...rules.rules]
    .filter(r => r.enabled)
    .sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    if (matchesRule(rule, context)) {
      return {
        action: rule.action,
        matchedRule: rule,
        message: rule.message,
      };
    }
  }

  // Default: allow if no rules match
  return {
    action: 'allow',
    matchedRule: null,
  };
}

function matchesRule(rule: ContentRule, context: RuleEvaluationContext): boolean {
  // All conditions must match (AND logic)
  return rule.conditions.every(condition => matchesCondition(condition, context));
}

function matchesCondition(
  condition: ContentRule['conditions'][0],
  context: RuleEvaluationContext
): boolean {
  const fieldValue = context[condition.field];
  if (fieldValue === undefined) {
    return false;
  }

  const value = condition.caseSensitive ? fieldValue : fieldValue.toLowerCase();
  const pattern = condition.caseSensitive ? condition.value : condition.value.toLowerCase();

  switch (condition.operator) {
    case 'contains':
      return value.includes(pattern);
    case 'equals':
      return value === pattern;
    case 'startsWith':
      return value.startsWith(pattern);
    case 'endsWith':
      return value.endsWith(pattern);
    case 'matches':
      try {
        const regex = new RegExp(condition.value, condition.caseSensitive ? '' : 'i');
        return regex.test(fieldValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

// ============================================================================
// Federation Helpers
// ============================================================================

/**
 * Check if a domain is allowed by federation rules
 */
export function isDomainAllowed(config: TenantConfig, domain: string): boolean {
  const normalizedDomain = domain.toLowerCase();

  // Check block list first
  if (config.federation.blockList.some(d => d.toLowerCase() === normalizedDomain)) {
    return false;
  }

  // If allow list is empty, allow all (except blocked)
  if (config.federation.allowList.length === 0) {
    return true;
  }

  // Check allow list
  return config.federation.allowList.some(d => d.toLowerCase() === normalizedDomain);
}

/**
 * Check if an actor is from a blocked domain
 */
export function isActorBlocked(config: TenantConfig, actorUrl: string): boolean {
  try {
    const domain = new URL(actorUrl).host;
    return !isDomainAllowed(config, domain);
  } catch {
    return true; // Invalid URL = blocked
  }
}
