// 认证接口
// 支持 EdgeOne Pages / Cloudflare Workers
// 含 TOTP 两步验证（RFC 6238）
// [安全] VULN-06/07/08/09：恢复码轮换、登录限速、恒定时间比较、标准 Authorization 头

import { getKV, getCorsHeaders, jsonResponse, verifyAuth, getAuthToken, timingSafeEqual } from './_kvAdapter.js';

// ==================== 登录限速（进程内） ====================
const MAX_ATTEMPTS = 5; // 连续失败 5 次后触发退避
const MAX_BACKOFF_MS = 300000; // 退避上限 5 分钟
const loginAttempts = new Map(); // ip -> { count, totpFails, lockedUntil }

function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function isLocked(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    // 锁定期已过，重置计数
    loginAttempts.delete(ip);
    return false;
  }
  return false;
}

function lockRemainingMs(ip) {
  const rec = loginAttempts.get(ip);
  if (!rec?.lockedUntil) return 0;
  return Math.max(0, rec.lockedUntil - Date.now());
}

function recordFailure(ip, type) {
  const now = Date.now();
  const rec = loginAttempts.get(ip) || { count: 0, totpFails: 0, lockedUntil: 0 };
  if (type === 'totp') rec.totpFails += 1;
  else rec.count += 1;
  const fails = rec.count + rec.totpFails;
  if (fails >= MAX_ATTEMPTS) {
    const backoff = Math.min(Math.pow(2, fails - MAX_ATTEMPTS) * 1000, MAX_BACKOFF_MS);
    rec.lockedUntil = now + backoff;
    rec.count = 0;
    rec.totpFails = 0;
  } else {
    rec.lockedUntil = 0;
  }
  loginAttempts.set(ip, rec);
}

function resetAttempts(ip) {
  loginAttempts.delete(ip);
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);
  const clientIp = getClientIp(request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
  }

  try {
    const kv = getKV(env);
    const body = await request.json();

    // ==================== TOTP 管理操作（需要有效 Token） ====================
    if (body.action === 'totp-setup' || body.action === 'totp-activate' || body.action === 'totp-disable') {
      const token = getAuthToken(request);
      const isAdmin = await verifyAuth({ providedPassword: token, serverPassword: env.PASSWORD, kv });
      if (!isAdmin) {
        return jsonResponse({ error: '请先登录' }, 401, corsHeaders);
      }

      if (body.action === 'totp-setup') {
        // 生成新密钥（暂存为 pending，确认后才激活）
        const secret = generateTotpSecret();
        await kv.put('totp_pending', secret);
        const label = encodeURIComponent('F-Nav');
        const otpauth = `otpauth://totp/F-Nav:admin?secret=${secret}&issuer=${label}&algorithm=SHA1&digits=6&period=30`;
        return jsonResponse({ success: true, secret, otpauth }, 200, corsHeaders);
      }

      if (body.action === 'totp-activate') {
        const pending = await kv.get('totp_pending');
        if (!pending) {
          return jsonResponse({ error: '请先生成密钥' }, 400, corsHeaders);
        }
        const ok = await verifyTotp(pending, String(body.code || '').trim());
        if (!ok) {
          return jsonResponse({ error: '动态验证码错误，请检查验证器时间后重试' }, 401, corsHeaders);
        }
        const recovery = generateRecoveryCode();
        await kv.put('totp_secret', pending);
        await kv.put('totp_recovery', recovery);
        await kv.delete('totp_pending');
        return jsonResponse({ success: true, recovery }, 200, corsHeaders);
      }

      if (body.action === 'totp-disable') {
        await kv.delete('totp_secret');
        await kv.delete('totp_recovery');
        await kv.delete('totp_pending');
        return jsonResponse({ success: true }, 200, corsHeaders);
      }
    }

    // ==================== 普通登录 ====================

    // [安全] VULN-07：锁定期内直接拒绝
    if (isLocked(clientIp)) {
      const retryAfter = Math.ceil(lockRemainingMs(clientIp) / 1000);
      return jsonResponse({ error: '尝试次数过多，请稍后再试' }, 429, {
        ...corsHeaders,
        'Retry-After': String(retryAfter),
      });
    }

    const { password, totp } = body;

    if (!env.PASSWORD) {
      return jsonResponse({ error: '服务器未配置管理员密码' }, 500, corsHeaders);
    }

    // [安全] VULN-08：恒定时间比较，避免时序侧信道
    if (typeof password !== 'string' || !timingSafeEqual(password, env.PASSWORD)) {
      recordFailure(clientIp, 'password');
      return jsonResponse({ error: '密码错误' }, 401, corsHeaders);
    }

    // 两步验证：若已启用 TOTP，必须校验动态码或恢复码
    const totpSecret = await kv.get('totp_secret');
    let rotatedRecovery = null;
    if (totpSecret) {
      const code = String(totp || '').trim();
      const recovery = await kv.get('totp_recovery');
      // [安全] VULN-06：恢复码一次性消费并轮换，TOTP 保持启用（不再永久关闭两步验证）
      if (recovery && code && timingSafeEqual(code.toLowerCase(), recovery.toLowerCase())) {
        const newRecovery = generateRecoveryCode();
        await kv.put('totp_recovery', newRecovery);
        rotatedRecovery = newRecovery;
      } else if (code && await verifyTotp(totpSecret, code)) {
        // 动态码正确
      } else {
        recordFailure(clientIp, 'totp');
        return jsonResponse({ error: '动态验证码错误或已过期' }, 401, corsHeaders);
      }
    }

    // 登录成功：重置限速计数
    resetAttempts(clientIp);

    // 读取 website 配置（分段 key config:website 优先，兼容旧全量 key config）
    const readWebsiteConfig = async () => {
      try {
        const sectionStr = await kv.get('config:website');
        if (sectionStr) return JSON.parse(sectionStr);
        const configStr = await kv.get('config');
        if (configStr) {
          const cfg = JSON.parse(configStr);
          return cfg.website || {};
        }
      } catch (e) { /* 读配置失败用默认值 */ }
      return {};
    };
    const websiteCfg = await readWebsiteConfig();

    // 清理旧 Token（单设备模式：新登录踢掉旧会话）
    // singleDevice 默认 true（开启单设备），仅当配置明确为 false 时允许多设备同时在线
    if (websiteCfg.singleDevice !== false) {
      try {
        const oldToken = await kv.get('last_token');
        if (oldToken) {
          await kv.delete(`auth_token:${oldToken}`);
        }
      } catch (e) {
        console.warn('Failed to clean old token:', e);
      }
    }

    // 生成安全随机 Token
    const token = generateSecureToken();

    // 读取登录过期时间配置（从 websiteCfg 取，与上面同源）
    let expirationTtl = 24 * 60 * 60; // 默认 1 天
    try {
      const expiry = websiteCfg.passwordExpiry;
      if (expiry) {
        expirationTtl = calcExpiryTtl(expiry);
      }
    } catch (e) {
      console.warn('Failed to read expiry config:', e);
    }

    // 记录认证时间
    await kv.put('last_auth_time', Date.now().toString());

    // 存储新 Token
    const kvOptions = expirationTtl ? { expirationTtl } : {};
    await kv.put(`auth_token:${token}`, 'valid', kvOptions);

    // 记录当前 Token（用于下次登录时清理）
    await kv.put('last_token', token, kvOptions);

    return jsonResponse({
      success: true,
      token,
      // [安全] VULN-06：使用恢复码登录时返回轮换后的新恢复码，提示用户妥善保存
      ...(rotatedRecovery ? { recovery: rotatedRecovery, recoveryRotated: true } : {}),
      message: '认证成功',
    }, 200, corsHeaders);

  } catch (err) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    const requestId = crypto.randomUUID();
    console.error(`Auth API error [${requestId}]:`, err);
    return jsonResponse({ error: '认证请求失败', requestId }, 500, corsHeaders);
  }
}

/**
 * 生成安全随机 Token（32 字节 hex = 64 字符）
 */
function generateSecureToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 计算 Token 过期时间（秒）
 */
function calcExpiryTtl(expiry) {
  const { value = 1, unit = 'week' } = expiry;
  const multipliers = {
    day: 86400,
    week: 604800,
    month: 2592000,
    year: 31536000,
  };
  if (unit === 'permanent') return null;
  return (multipliers[unit] || 604800) * value;
}

// ==================== TOTP (RFC 6238) 工具函数 ====================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes) {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const out = [];
  for (const ch of String(str).replace(/=+$/g, '').toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 生成 20 字节随机 TOTP 密钥（base32） */
function generateTotpSecret() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** 生成恢复码，格式 fnav-xxxx-xxxx-xxxx */
function generateRecoveryCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `fnav-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/** 计算指定计数器的 6 位 TOTP 码 */
async function totpCodeAt(secret, counter) {
  const keyBytes = base32Decode(secret);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1000000).padStart(6, '0');
}

/** 校验 TOTP 码（允许 ±1 个 30 秒窗口的时钟偏差） */
async function verifyTotp(secret, code) {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (let c = counter - 1; c <= counter + 1; c++) {
    if ((await totpCodeAt(secret, c)) === code) return true;
  }
  return false;
}
