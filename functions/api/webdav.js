// WebDAV 代理接口
// 支持 EdgeOne Pages / Cloudflare Workers
// [安全] 仅允许已认证管理员使用，目标 URL 仅限 HTTPS 公网地址（防 SSRF / 开放代理 / 凭据外送）

import { getKV, getCorsHeaders, jsonResponse, verifyAuth, getAuthToken, validateExternalUrlAsync, safeFetchWithRedirects } from './_kvAdapter.js';

const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024; // 下载备份上限 20MB

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
    const { operation, config, payload } = body;

    if (!config || !config.url || !config.username || !config.password) {
      return jsonResponse({ error: 'Missing configuration' }, 400, corsHeaders);
    }

    if (!['check', 'upload', 'download'].includes(operation)) {
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

    let baseUrl = validated.url.toString();
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    const filename = 'cloudnav_backup.json';
    const fileUrl = baseUrl + filename;
    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;

    let fetchUrl = baseUrl;
    let method = 'PROPFIND';
    let headers = {
      'Authorization': authHeader,
      'User-Agent': 'CloudNav/1.0',
    };
    let requestBody = undefined;

    if (operation === 'check') {
      fetchUrl = baseUrl;
      method = 'PROPFIND';
      headers['Depth'] = '0';
    } else if (operation === 'upload') {
      fetchUrl = fileUrl;
      method = 'PUT';
      headers['Content-Type'] = 'application/json';
      requestBody = JSON.stringify(payload || {});
      if (requestBody.length > MAX_PAYLOAD_BYTES) {
        return jsonResponse({ error: 'Payload too large' }, 413, corsHeaders);
      }
    } else if (operation === 'download') {
      fetchUrl = fileUrl;
      method = 'GET';
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    // [安全] 逐跳校验跳转目标，防止 redirect 绕过协议/IP 白名单
    const response = await safeFetchWithRedirects(fetchUrl, {
      method,
      headers,
      body: requestBody,
      signal: controller.signal,
    }, 2);
    clearTimeout(timer);

    if (!response) {
      return jsonResponse({ error: 'Request blocked or failed' }, 502, corsHeaders);
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
      return jsonResponse(data, 200, corsHeaders);
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
