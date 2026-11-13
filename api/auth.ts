// Vercel 认证接口
// 含 TOTP 两步验证（RFC 6238）
// [安全] VULN-06/07/08/09：恢复码轮换、登录限速、恒定时间比较、标准 Authorization 头
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKV, getCorsHeaders, generateSecureToken, calcExpiryTtl, verifyAuth, getAuthToken, timingSafeEqual, jsonResponse } from './_kvHelper.js';

// ==================== 登录限速（进程内） ====================
const MAX_ATTEMPTS = 5; // 连续失败 5 次后触发退避
const MAX_BACKOFF_MS = 300000; // 退避上限 5 分钟
const loginAttempts = new Map<string, { count: number; totpFails: number; lockedUntil: number }>();

function getClientIp(req: VercelRequest): string {
  const xff = req.headers['x-forwarded-for'];
  return (
    (req.headers['cf-connecting-ip'] as string) ||
    (Array.isArray(xff) ? xff[0] : (xff as string | undefined))?.split(',')[0]?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    'unknown'
  );
}

function isLocked(ip: string): boolean {
  const rec = loginAttempts.get(ip);
  if (!rec) return false;
  if (rec.lockedUntil && Date.now() < rec.lockedUntil) return true;
  if (rec.lockedUntil && Date.now() >= rec.lockedUntil) {
    loginAttempts.delete(ip);
    return false;
  }
  return false;
}

function lockRemainingMs(ip: string): number {
  const rec = loginAttempts.get(ip);
  if (!rec?.lockedUntil) return 0;
  return Math.max(0, rec.lockedUntil - Date.now());
}

function recordFailure(ip: string, type: 'password' | 'totp') {
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

function resetAttempts(ip: string) {
  loginAttempts.delete(ip);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsHeaders = getCorsHeaders(req);
  const clientIp = getClientIp(req);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin'] || '').end();
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method Not Allowed' }, corsHeaders);
  }

  try {
    const kv = getKV();
    const body = req.body as any;

    // ==================== TOTP 管理操作（需要有效 Token） ====================
    if (body.action === 'totp-setup' || body.action === 'totp-activate' || body.action === 'totp-disable') {
      const token = getAuthToken(req);
      const isAdmin = await verifyAuth(token || '');
      if (!isAdmin) {
        return jsonResponse(res, 401, { error: '请先登录' }, corsHeaders);
      }

      if (body.action === 'totp-setup') {
        const secret = generateTotpSecret();
        await kv.set('totp_pending', secret);
        const otpauth = `otpauth://totp/F-Nav:admin?secret=${secret}&issuer=F-Nav&algorithm=SHA1&digits=6&period=30`;
        return jsonResponse(res, 200, { success: true, secret, otpauth }, corsHeaders);
      }

      if (body.action === 'totp-activate') {
        const pending = await kv.get('totp_pending');
        if (!pending) {
          return jsonResponse(res, 400, { error: '请先生成密钥' }, corsHeaders);
        }
        const ok = await verifyTotp(String(pending), String(body.code || '').trim());
        if (!ok) {
          return jsonResponse(res, 401, { error: '动态验证码错误，请检查验证器时间后重试' }, corsHeaders);
        }
        const recovery = generateRecoveryCode();
        await kv.set('totp_secret', pending);
        await kv.set('totp_recovery', recovery);
        await kv.del('totp_pending');
        return jsonResponse(res, 200, { success: true, recovery }, corsHeaders);
      }

      if (body.action === 'totp-disable') {
        await kv.del('totp_secret');
        await kv.del('totp_recovery');
        await kv.del('totp_pending');
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }
    }

    // ==================== 普通登录 ====================

    // [安全] VULN-07：锁定期内直接拒绝
    if (isLocked(clientIp)) {
      const retryAfter = Math.ceil(lockRemainingMs(clientIp) / 1000);
      return jsonResponse(res, 429, { error: '尝试次数过多，请稍后再试' }, {
        ...corsHeaders,
        'Retry-After': String(retryAfter),
      });
    }

    const { password, totp } = body;

    if (!process.env.PASSWORD) {
      console.error('Environment variable PASSWORD is not set');
      return jsonResponse(res, 500, { error: '服务器未配置管理员密码' }, corsHeaders);
    }

    // [安全] VULN-08：恒定时间比较，避免时序侧信道
    if (typeof password !== 'string' || !timingSafeEqual(password, process.env.PASSWORD)) {
      recordFailure(clientIp, 'password');
      return jsonResponse(res, 401, { error: '密码错误' }, corsHeaders);
    }

    // 两步验证：若已启用 TOTP，必须校验动态码或恢复码
    const totpSecret = await kv.get('totp_secret');
    let rotatedRecovery: string | null = null;
    if (totpSecret) {
      const code = String(totp || '').trim();
      const recovery = await kv.get('totp_recovery');
      // [安全] VULN-06：恢复码一次性消费并轮换，TOTP 保持启用（不再永久关闭两步验证）
      if (recovery && code && timingSafeEqual(code.toLowerCase(), String(recovery).toLowerCase())) {
        const newRecovery = generateRecoveryCode();
        await kv.set('totp_recovery', newRecovery);
        rotatedRecovery = newRecovery;
      } else if (code && await verifyTotp(String(totpSecret), code)) {
        // 动态码正确
      } else {
        recordFailure(clientIp, 'totp');
        return jsonResponse(res, 401, { error: '动态验证码错误或已过期' }, corsHeaders);
      }
    }

    // 登录成功：重置限速计数
    resetAttempts(clientIp);

    // 按客户端类型隔离会话：网页与浏览器扩展各自单设备
    const clientType = body.client === 'extension' ? 'extension' : 'web';
    const tokenKey = clientType === 'extension' ? 'last_token:extension' : 'last_token';

    // 清理该客户端类型的旧 Token
    try {
      const oldToken = await kv.get(tokenKey);
      if (oldToken) {
        await kv.del(`auth_token:${oldToken}`);
      }
    } catch (e) {
      console.warn('Failed to clean old token:', e);
    }

    const token = generateSecureToken();

    let expirationTtl = 24 * 60 * 60;
    try {
      const configData = await kv.get('config');
      if (configData) {
        const config = typeof configData === 'string' ? JSON.parse(configData) : configData;
        const expiry = config.website?.passwordExpiry;
        if (expiry) {
          expirationTtl = calcExpiryTtl(expiry) || 24 * 60 * 60;
        }
      }
    } catch (e) {
      console.warn('Failed to read expiry config:', e);
    }

    await kv.set('last_auth_time', Date.now().toString());
    if (expirationTtl) {
      await kv.set(`auth_token:${token}`, 'valid', { ex: expirationTtl });
      await kv.set(tokenKey, token, { ex: expirationTtl });
    } else {
      await kv.set(`auth_token:${token}`, 'valid');
      await kv.set(tokenKey, token);
    }

    return jsonResponse(res, 200, {
      success: true,
      token,
      // [安全] VULN-06：使用恢复码登录时返回轮换后的新恢复码，提示用户妥善保存
      ...(rotatedRecovery ? { recovery: rotatedRecovery, recoveryRotated: true } : {}),
      message: '认证成功',
    }, corsHeaders);

  } catch (err: any) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
    console.error(`Auth API error [${requestId}]:`, err);
    return jsonResponse(res, 500, { error: '认证请求失败', requestId }, corsHeaders);
  }
}

// ==================== TOTP (RFC 6238) 工具函数 ====================

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Uint8Array): string {
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

function base32Decode(str: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
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
function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** 生成恢复码，格式 fnav-xxxx-xxxx-xxxx */
function generateRecoveryCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `fnav-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/** 计算指定计数器的 6 位 TOTP 码 */
async function totpCodeAt(secret: string, counter: number): Promise<string> {
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
async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (let c = counter - 1; c <= counter + 1; c++) {
    if ((await totpCodeAt(secret, c)) === code) return true;
  }
  return false;
}
