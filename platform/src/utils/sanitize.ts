/**
 * HTML Sanitization for ActivityPub content
 * 
 * Prevents XSS attacks by stripping dangerous HTML/JavaScript
 * while preserving safe formatting tags.
 */

/**
 * Allowed HTML tags for ActivityPub content
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'span', 'div',
  'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
]);

/**
 * Allowed attributes (tag-specific)
 */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  'a': new Set(['href', 'rel', 'class']),
  'span': new Set(['class']),
  'div': new Set(['class']),
};

/**
 * Dangerous protocols to block
 */
const DANGEROUS_PROTOCOLS = /^(javascript|data|vbscript):/i;

/**
 * Sanitize HTML content from remote ActivityPub instances
 * 
 * @param html - Raw HTML content
 * @returns Sanitized HTML safe for storage and display
 */
export function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }

  // Remove script tags and their content
  let sanitized = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove style tags and their content
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove dangerous attributes
  sanitized = sanitized.replace(/\s*javascript\s*:/gi, '');
  sanitized = sanitized.replace(/\s*data\s*:/gi, '');

  // Parse and rebuild HTML with allowed tags only
  sanitized = filterTags(sanitized);

  return sanitized;
}

/**
 * Filter HTML to only allowed tags and attributes
 */
function filterTags(html: string): string {
  // Simple tag parser (not a full HTML parser, but good enough for basic sanitization)
  const tagRegex = /<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi;
  
  return html.replace(tagRegex, (match, tagName, attrs) => {
    const lowerTag = tagName.toLowerCase();
    
    // Check if tag is allowed
    if (!ALLOWED_TAGS.has(lowerTag)) {
      return ''; // Remove disallowed tag
    }

    // For closing tags, just return them
    if (match.startsWith('</')) {
      return `</${lowerTag}>`;
    }

    // For opening tags, filter attributes
    const allowedAttrs = ALLOWED_ATTRIBUTES[lowerTag] || new Set();
    const filteredAttrs = filterAttributes(attrs, allowedAttrs);

    if (filteredAttrs) {
      return `<${lowerTag} ${filteredAttrs}>`;
    } else {
      return `<${lowerTag}>`;
    }
  });
}

/**
 * Filter attributes to only allowed ones
 */
function filterAttributes(attrs: string, allowed: Set<string>): string {
  if (!attrs || attrs.trim() === '') {
    return '';
  }

  const attrRegex = /([a-z-]+)\s*=\s*["']([^"']*)["']/gi;
  const filtered: string[] = [];
  let match;

  while ((match = attrRegex.exec(attrs)) !== null) {
    const [, name, value] = match;
    const lowerName = name.toLowerCase();

    // Check if attribute is allowed for this tag
    if (allowed.has(lowerName)) {
      // Special validation for href
      if (lowerName === 'href') {
        if (!DANGEROUS_PROTOCOLS.test(value)) {
          filtered.push(`${lowerName}="${escapeHtml(value)}"`);
        }
      } else {
        filtered.push(`${lowerName}="${escapeHtml(value)}"`);
      }
    }
  }

  return filtered.join(' ');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };
  return text.replace(/[&<>"'/]/g, (char) => map[char] || char);
}

/**
 * Sanitize plain text (for non-HTML content)
 * 
 * @param text - Plain text content
 * @returns Escaped text safe for HTML display
 */
export function sanitizePlainText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  return escapeHtml(text);
}

/**
 * Extract plain text from HTML (strip all tags)
 * 
 * @param html - HTML content
 * @returns Plain text without tags
 */
export function stripHtml(html: string): string {
  if (!html || typeof html !== 'string') {
    return '';
  }
  return html.replace(/<[^>]*>/g, '').trim();
}

/**
 * Validate and sanitize URL
 * 
 * @param url - URL string
 * @returns Sanitized URL or null if invalid/dangerous
 */
export function sanitizeUrl(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    const parsed = new URL(url);
    
    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

