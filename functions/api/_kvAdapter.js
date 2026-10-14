// 跨平台 KV 适配层
// 支持 EdgeOne Pages (全局变量) / Cloudflare Workers (env 绑定)

/**
 * 获取 KV 实例，自动检测运行平台
 * @param {object} env - 函数 context.env
 * @returns {object} KV 实例
 */
export function getKV(env) {
  // Cloudflare Workers: KV 在 env 上
  if (env?.CLOUDNAV_KV && typeof env.CLOUDNAV_KV.get === 'function') {
    return env.CLOUDNAV_KV;
  }
  // EdgeOne Pages: KV 作为全局变量注入
  if (typeof CLOUDNAV_KV !== 'undefined' && typeof CLOUDNAV_KV.get === 'function') {
    return CLOUDNAV_KV;
  }
  throw new Error('KV binding "CLOUDNAV_KV" not found. Please check your deployment configuration.');
}

/**
 * 恒定时间字符串比较，避免时序侧信道
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function timingSafeEqual(a, b) {
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
 * @param {Request} request
 * @returns {string|null}
 */
export function getAuthToken(request) {
  const authHeader = request?.headers?.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const legacy = request?.headers?.get('x-auth-password');
  return legacy || null;
}

/**
 * 获取 CORS 头。
 * 安全策略：
 *  - 同源请求（Origin 与请求自身 Host 一致）直接放行
 *  - 跨源请求仅当 Origin 命中 env.ALLOWED_ORIGIN（逗号分隔白名单）时放行
 *  - 不再存在 `*` 兜底；未命中时不返回 Access-Control-Allow-Origin
 * @param {object} env - 函数 context.env
 * @param {Request} [request] - 当前请求（用于推导同源/Origin）
 * @returns {object} CORS headers
 */
export function getCorsHeaders(env, request) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, x-auth-password, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  const reqOrigin = request?.headers?.get('origin');
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
    const selfHost = request ? new URL(request.url).hostname : null;
    const allowedOrigins = (env?.ALLOWED_ORIGIN || '')
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
    // 未命中白名单：不返回 ACAO，浏览器将拦截跨源读取
  } catch (e) {
    // 非法 Origin 一律不放行
  }

  return headers;
}

/**
 * 认证检查：验证密码或 Token（恒定时间比较）
 * @param {object} params
 * @param {string} params.providedPassword - 客户端提供的密码或 Token
 * @param {string} params.serverPassword - 环境变量中的密码
 * @param {object} params.kv - KV 实例
 * @returns {Promise<boolean>}
 */
export async function verifyAuth({ providedPassword, serverPassword, kv }) {
  if (!providedPassword) return false;

  // 直接匹配密码（恒定时间比较，避免时序侧信道）
  if (serverPassword && timingSafeEqual(providedPassword, serverPassword)) {
    return true;
  }

  // 查 KV 中的 Token
  try {
    const tokenVal = await kv.get(`auth_token:${providedPassword}`);
    return tokenVal === 'valid';
  } catch {
    return false;
  }
}

/**
 * 创建标准 JSON 响应（附带安全响应头，防 MIME 混淆 / 点击劫持 / 信息外泄）
 * @param {any} data - 响应数据
 * @param {number} status - HTTP 状态码
 * @param {object} extraHeaders - 额外响应头
 * @returns {Response}
 */
export function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...extraHeaders,
    },
  });
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

/**
 * 判断主机名是否为私有/保留/内网地址
 * @param {string} hostname
 * @returns {boolean}
 */
export function isBlockedHost(hostname) {
  if (!hostname) return true;
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return PRIVATE_HOST_RE.test(host);
}

/**
 * 校验外部抓取目标 URL：仅允许 HTTPS 公网地址
 * @param {string} raw - 用户提供的 URL 字符串
 * @returns {{ ok: boolean, url?: URL, error?: string }}
 */
export function validateExternalUrl(raw) {
  if (!raw) return { ok: false, error: 'Missing URL' };
  let url;
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
 * @param {string} startUrl
 * @param {object} init - fetch 参数（不含 redirect）
 * @param {number} maxHops - 最大跳转次数
 * @returns {Promise<Response|null>}
 */
export async function safeFetchWithRedirects(startUrl, init, maxHops = 3) {
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
