// Security module for URL validation
// Protects against SSRF, DNS rebinding, and access to internal services

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitizedUrl?: string;
}

// Private and reserved IP ranges
const blockedIpRanges: { test: (ip: string) => boolean; name: string }[] = [
  // IPv4 loopback
  { test: (ip) => ip === '127.0.0.1' || ip === '127.255.255.254', name: 'loopback' },
  // 127.0.0.0/8
  { test: (ip) => ip.startsWith('127.'), name: 'loopback range' },
  // 10.0.0.0/8
  { test: (ip) => ip.startsWith('10.'), name: 'private class A' },
  // 172.16.0.0/12
  { test: (ip) => {
    const parts = ip.split('.');
    return parts[0] === '172' && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31;
  }, name: 'private class B' },
  // 192.168.0.0/16
  { test: (ip) => ip.startsWith('192.168.'), name: 'private class C' },
  // 169.254.0.0/16 (link-local, includes AWS metadata 169.254.169.254)
  { test: (ip) => ip.startsWith('169.254.'), name: 'link-local / cloud metadata' },
  // 0.0.0.0/8
  { test: (ip) => ip.startsWith('0.'), name: 'unspecified' },
  // 100.64.0.0/10 (CGNAT)
  { test: (ip) => {
    const parts = ip.split('.');
    return parts[0] === '100' && parseInt(parts[1]) >= 64 && parseInt(parts[1]) <= 127;
  }, name: 'CGNAT range' },
  // 192.0.2.0/24 (TEST-NET-1)
  { test: (ip) => ip === '192.0.2.0' || (ip.startsWith('192.0.2.') ), name: 'TEST-NET-1' },
  // 198.51.100.0/24 (TEST-NET-2)
  { test: (ip) => ip.startsWith('198.51.100.'), name: 'TEST-NET-2' },
  // 203.0.113.0/24 (TEST-NET-3)
  { test: (ip) => ip.startsWith('203.0.113.'), name: 'TEST-NET-3' },
  // 224.0.0.0/4 (multicast)
  { test: (ip) => {
    const first = parseInt(ip.split('.')[0]);
    return first >= 224 && first <= 239;
  }, name: 'multicast' },
  // 240.0.0.0/4 (reserved)
  { test: (ip) => {
    const first = parseInt(ip.split('.')[0]);
    return first >= 240;
  }, name: 'reserved' },
];

const blockedHostnames = [
  'localhost',
  'localhost.localdomain',
  'localdomain',
  'broadcasthost',
  '0.0.0.0',
  '::1',
  '[::1]',
];

export function validateUrl(rawUrl: string): ValidationResult {
  if (!rawUrl || !rawUrl.trim()) {
    return { valid: false, error: 'Please enter a URL.' };
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    // Try adding https://
    try {
      url = new URL('https://' + rawUrl.trim());
    } catch {
      return { valid: false, error: 'The URL is not valid. Please enter a full web address like https://example.com' };
    }
  }

  // Only allow HTTP and HTTPS
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, error: `Only HTTP and HTTPS URLs are allowed. This URL uses "${url.protocol}".` };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Block known localhost hostnames
  if (blockedHostnames.includes(hostname)) {
    return { valid: false, error: 'Access to localhost and local domains is blocked for security. Please enter a public website URL.' };
  }

  // Block .local TLD
  if (hostname.endsWith('.local') || hostname.endsWith('.localhost')) {
    return { valid: false, error: 'Local network domains are blocked for security. Please enter a public website URL.' };
  }

  // Block internal hostnames (no dots = likely internal)
  if (!hostname.includes('.')) {
    return { valid: false, error: 'This hostname appears to be an internal server. Please enter a public website URL.' };
  }

  // Check if hostname is an IP address
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const ip = hostname;
    for (const range of blockedIpRanges) {
      if (range.test(ip)) {
        return { valid: false, error: `Access to IP address ${ip} is blocked (${range.name}). This range is reserved for internal or special use.` };
      }
    }
  }

  // Block IPv6 addresses (they're in brackets in URLs)
  if (hostname.includes(':')) {
    // IPv6 — block loopback and link-local
    if (hostname === '::1' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) {
      return { valid: false, error: 'Access to this IPv6 address is blocked (internal/special use range).' };
    }
  }

  // Block common cloud metadata hostnames
  if (hostname === 'metadata.google.internal' || hostname === 'metadata') {
    return { valid: false, error: 'Cloud metadata endpoints are blocked for security.' };
  }

  return { valid: true, sanitizedUrl: url.toString() };
}

export const SECURITY_LIMITS = {
  maxResponseSize: 5 * 1024 * 1024, // 5 MB
  requestTimeout: 30000, // 30 seconds
};
