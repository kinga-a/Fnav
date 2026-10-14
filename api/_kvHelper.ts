// Vercel KV 辅助函数
// [安全] 与 functions/api/_kvAdapter.js 保持一致的加固：恒定时间比较、标准鉴权头、CORS 白名单、安全响应头、SSRF 防护
import { kv } from '@vercel/kv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export function getKV() {
  return kv;
}

/**
 * 恒定时间字符串比较，避免时序侧信道
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 从请求中提取认证凭据（Token 或密码）
 * 优先使用标准 Authorization: Bearer <token>，兼容旧版 x-auth-password 头
 */
export function getAuthToken(req: VercelRequest): string | null {
  const authHeader = (req.headers['authorization'] as string | undefined) || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const legacy = req.headers['x-auth-password'] as string | undefined;
  return legacy || null;
}

/**
 * 获取 CORS 头。
 * 安全策略：同源请求直接放行；跨源仅当 Origin 命中 process.env.ALLOWED_ORIGIN（逗号分隔白名单）时放行；
 * 不再存在 `*` 兜底。
 */
export function getCorsHeaders(req?: VercelRequest) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  const reqOrigin = (req?.headers['origin'] as string | undefined) || '';
  if (!reqOrigin) return headers;

  // 浏览器扩展源（chrome-extension://<扩展ID>）：扩展 ID 随本机安装而变，
  // 无法预写白名单，放行该前缀源。受保护数据仍由鉴权/过滤把关
  // （密码分类 403、isPrivate 剔除、管理操作需密码、?key= 需鉴权），不新增泄露面。
  if (/^chrome-extension:\/\//i.test(reqOrigin)) {
    headers['Access-Control-Allow-Origin'] = reqOrigin;
    headers['Vary'] = 'Origin';
    return headers;
  }

  try {
    const originHost = new URL(reqOrigin).hostname;
    const selfHost = (req?.headers['host'] || '').split(':')[0];
    const allowedOrigins = (process.env.ALLOWED_ORIGIN || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (selfHost && originHost === selfHost) {
      headers['Access-Control-Allow-Origin'] = reqOrigin;
      headers['Vary'] = 'Origin';
    } else if (allowedOrigins.includes(reqOrigin)) {
      headers['Access-Control-Allow-Origin'] = reqOrigin;
      headers['Vary'] = 'Origin';
    }
  } catch (e) {
    // 非法 Origin 一律不放行
  }

  return headers;
}

export function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('');
}

export function calcExpiryTtl(expiry: { value: number; unit: string }): number | null {
  const { value = 1, unit = 'week' } = expiry;
  const multipliers: Record<string, number> = {
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };
  if (unit === 'permanent') return null;
  return (multipliers[unit] || 604800) * value;
}

export async function verifyAuth(providedPassword: string): Promise<boolean> {
  if (!providedPassword) return false;

  // 恒定时间比较，避免时序侧信道
  if (process.env.PASSWORD && timingSafeEqual(providedPassword, process.env.PASSWORD)) {
    return true;
  }

  try {
    const tokenVal = await kv.get(`auth_token:${providedPassword}`);
    return tokenVal === 'valid';
  } catch {
    return false;
  }
}

/**
 * 统一 JSON 响应（附带 CORS 与安全响应头）
 */
export function jsonResponse(res: VercelResponse, status: number, data: unknown, corsHeaders: Record<string, string>) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  for (const [k, v] of Object.entries(corsHeaders)) {
    res.setHeader(k, v);
  }
  return res.status(status).json(data);
}

// ==================== SSRF 防护工具 ====================

const PRIVATE_HOST_RE = new RegExp(
  '^(localhost|.*\\.local|.*\\.internal|.*\\.lan)$|' +
  '^(127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})$|' +
  '^(10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})$|' +
  '^(192\\.168\\.\\d{1,3}\\.\\d{1,3})$|' +
  '^(169\\.254\\.\\d{1,3}\\.\\d{1,3})$|' +
  '^(172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3})$|' +
  '^(0\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3})$|' +
  '^(100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.\\d{1,3}\\.\\d{1,3})$|' +
  '^(::1|::|fe80:[0-9a-f:]+|fc[0-9a-f]{2}:[0-9a-f:]+|fd[0-9a-f]{2}:[0-9a-f:]+)$',
  'i'
);

export function isBlockedHost(hostname: string): boolean {
  if (!hostname) return true;
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return PRIVATE_HOST_RE.test(host);
}

export function validateExternalUrl(raw: string): { ok: boolean; url?: URL; error?: string } {
  if (!raw) return { ok: false, error: 'Missing URL' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (url.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTPS URLs are allowed' };
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, error: 'Private or reserved hosts are not allowed' };
  }
  return { ok: true, url };
}

/**
 * 手动跟随跳转并逐跳校验（防止 redirect 绕过协议/IP 校验）
 */
export async function safeFetchWithRedirects(startUrl: string, init: RequestInit, maxHops = 3): Promise<Response | null> {
  let current = startUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const check = validateExternalUrl(current);
    if (!check.ok) return null;
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return null;
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  return null;
}
