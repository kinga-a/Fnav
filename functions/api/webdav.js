// WebDAV 代理接口
// 支持 EdgeOne Pages / Cloudflare Workers
// [安全] 仅允许已认证管理员使用，目标 URL 仅限 HTTPS 公网地址（防 SSRF / 开放代理 / 凭据外送）

import { getKV, getCorsHeaders, jsonResponse, verifyAuth, getAuthToken, validateExternalUrlAsync, safeFetchWithRedirects } from './_kvAdapter.js';

const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024; // 上传/下载备份上限 20MB
const BACKUP_FILE_RE = /^cloudnav_backup_\d{8}_\d{6}\.json$/;

export function buildDirUrl(targetUrl, pathValue) {
  const base = targetUrl.toString().replace(/\/+$/, '');
  const safePath = String(pathValue || '').replace(/^\/+|\/+$/g, '');
  if (safePath.includes('..') || !/^[A-Za-z0-9._\-\/]*$/.test(safePath)) return null;
  return `${base}/${safePath ? `${safePath}/` : ''}`;
}

export function parseBackupFiles(xml) {
  const names = new Set();
  const hrefRe = /<(?:[a-zA-Z0-9]+:)?href[^>]*>([^<]+)<\/(?:[a-zA-Z0-9]+:)?href>/gi;
  for (const match of xml.matchAll(hrefRe)) {
    let href = match[1];
    try { href = decodeURIComponent(href); } catch { /* keep raw */ }
    const base = href.split('/').filter(Boolean).pop() || '';
    if (BACKUP_FILE_RE.test(base)) names.add(base);
  }
  return [...names].sort().reverse();
}

export async function requestWithRetry(fetchUrl, init, attempts = 3) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await safeFetchWithRedirects(fetchUrl, { ...init, signal: controller.signal }, 2);
      if (response) return response;
      // 被 SSRF 校验拦截，重试无意义
      return null;
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw lastError || new Error('WebDAV request failed');
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
  }

  // [安全] VULN-02：强制认证，防止开放代理被匿名利用
  let kv;
  try {
    kv = getKV(env);
  } catch (e) {
    return jsonResponse({ error: 'Server not configured' }, 500, corsHeaders);
  }
  const providedPassword = getAuthToken(request);
  const isAdmin = await verifyAuth({
    providedPassword,
    serverPassword: env.PASSWORD,
    kv,
  });
  if (!isAdmin) {
    return jsonResponse({ error: 'Unauthorized' }, 401, corsHeaders);
  }

  try {
    const body = await request.json();
    const { operation, config, payload, fileName } = body;

    if (!config || !config.url || !config.username || !config.password) {
      return jsonResponse({ error: 'Missing configuration' }, 400, corsHeaders);
    }

    if (!['check', 'upload', 'download', 'list', 'delete'].includes(operation)) {
      return jsonResponse({ error: 'Invalid operation' }, 400, corsHeaders);
    }

    // [安全] VULN-02：协议与目标校验（仅 HTTPS 公网地址）
    const validated = await validateExternalUrlAsync(config.url.trim());
    if (!validated.ok) {
      return jsonResponse({ error: validated.error || 'Invalid target URL' }, 400, corsHeaders);
    }

    if (validated.url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(validated.url.hostname)) {
      return jsonResponse({ error: 'WebDAV 仅支持 HTTPS 地址' }, 400, corsHeaders);
    }

    const dirUrl = buildDirUrl(validated.url, config.path);
    if (!dirUrl) {
      return jsonResponse({ error: 'Invalid backup path' }, 400, corsHeaders);
    }

    if ((operation === 'upload' || operation === 'download' || operation === 'delete') && !BACKUP_FILE_RE.test(String(fileName || ''))) {
      return jsonResponse({ error: 'Invalid backup file name' }, 400, corsHeaders);
    }

    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;
    const baseHeaders = {
      'Authorization': authHeader,
      'User-Agent': 'CloudNav/1.0',
    };

    let fetchUrl = dirUrl;
    let method = 'PROPFIND';
    let headers = { ...baseHeaders };
    let requestBody = undefined;

    if (operation === 'check' || operation === 'list') {
      fetchUrl = dirUrl;
      method = 'PROPFIND';
      headers['Depth'] = operation === 'list' ? '1' : '0';
    } else if (operation === 'upload') {
      fetchUrl = dirUrl + fileName;
      method = 'PUT';
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(payload || {});
      const bodyBytes = new TextEncoder().encode(requestBody).length;
      if (bodyBytes > MAX_PAYLOAD_BYTES) {
        return jsonResponse({ error: 'Payload too large' }, 413, corsHeaders);
      }
    } else if (operation === 'download') {
      fetchUrl = dirUrl + fileName;
      method = 'GET';
    } else if (operation === 'delete') {
      fetchUrl = dirUrl + fileName;
      method = 'DELETE';
    }

    // [安全] 逐跳校验跳转目标，防止 redirect 绕过协议/IP 白名单
    // 网络抖动时自动重试 3 次，缓解 InfiniCloud 等外部 WebDAV 偶发连接超时
    const response = await requestWithRetry(fetchUrl, {
      method,
      headers,
      body: requestBody,
    }, 3);

    if (!response) {
      return jsonResponse({ error: 'Request blocked or failed' }, 502, corsHeaders);
    }

    if (operation === 'list') {
      if (!response.ok) {
        return jsonResponse({ error: `WebDAV Error: ${response.status}` }, response.status, corsHeaders);
      }
      const xml = await response.text();
      return jsonResponse({ success: true, files: parseBackupFiles(xml) }, 200, corsHeaders);
    }

    if (operation === 'download') {
      if (!response.ok) {
        if (response.status === 404) {
          return jsonResponse({ error: 'Backup file not found' }, 404, corsHeaders);
        }
        return jsonResponse({ error: `WebDAV Error: ${response.status}` }, response.status, corsHeaders);
      }
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return jsonResponse({ error: 'Backup file too large' }, 413, corsHeaders);
      }
      const data = await response.json();
      return jsonResponse({ success: true, data }, 200, corsHeaders);
    }

    if (operation === 'delete') {
      const success = response.ok || response.status === 204;
      return jsonResponse({ success, status: response.status }, 200, corsHeaders);
    }

    const success = response.ok || response.status === 207;
    return jsonResponse({ success, status: response.status }, 200, corsHeaders);

  } catch (err) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    const requestId = crypto.randomUUID();
    console.error(`WebDAV API error [${requestId}]:`, err);
    return jsonResponse({ error: '服务暂时不可用', requestId }, 500, corsHeaders);
  }
}