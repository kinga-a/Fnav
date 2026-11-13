// Vercel WebDAV 代理接口
// [安全] VULN-02：仅允许已认证管理员使用，目标 URL 仅限 HTTPS 公网地址（防 SSRF / 开放代理 / 凭据外送）
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKV, getCorsHeaders, verifyAuth, getAuthToken, jsonResponse, validateExternalUrl, safeFetchWithRedirects } from './_kvHelper.js';

const MAX_PAYLOAD_BYTES = 20 * 1024 * 1024; // 下载备份上限 20MB

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin'] || '').end();
  }

  if (req.method !== 'POST') {
    return jsonResponse(res, 405, { error: 'Method Not Allowed' }, corsHeaders);
  }

  // [安全] VULN-02：强制认证，防止开放代理被匿名利用
  const providedPassword = getAuthToken(req) || '';
  const isAdmin = await verifyAuth(providedPassword);
  if (!isAdmin) {
    return jsonResponse(res, 401, { error: 'Unauthorized' }, corsHeaders);
  }

  try {
    const { operation, config, payload } = req.body;

    if (!config || !config.url || !config.username || !config.password) {
      return jsonResponse(res, 400, { error: 'Missing configuration' }, corsHeaders);
    }

    if (!['check', 'upload', 'download'].includes(operation)) {
      return jsonResponse(res, 400, { error: 'Invalid operation' }, corsHeaders);
    }

    // [安全] VULN-02：协议与目标校验（仅 HTTPS 公网地址）
    const validated = validateExternalUrl(String(config.url).trim());
    if (!validated.ok || !validated.url) {
      return jsonResponse(res, 400, { error: validated.error || 'Invalid target URL' }, corsHeaders);
    }
    const targetUrl: URL = validated.url;
    if (targetUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(targetUrl.hostname)) {
      return jsonResponse(res, 400, { error: 'WebDAV 仅支持 HTTPS 地址' }, corsHeaders);
    }

    let baseUrl = targetUrl.toString();
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    const filename = 'cloudnav_backup.json';
    const fileUrl = baseUrl + filename;
    const authHeader = `Basic ${btoa(`${config.username}:${config.password}`)}`;

    let fetchUrl = baseUrl;
    let method = 'PROPFIND';
    let headers: Record<string, string> = {
      'Authorization': authHeader,
      'User-Agent': 'CloudNav/1.0',
    };
    let requestBody: string | undefined;

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
        return jsonResponse(res, 413, { error: 'Payload too large' }, corsHeaders);
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
      return jsonResponse(res, 502, { error: 'Request blocked or failed' }, corsHeaders);
    }

    if (operation === 'download') {
      if (!response.ok) {
        if (response.status === 404) {
          return jsonResponse(res, 404, { error: 'Backup file not found' }, corsHeaders);
        }
        return jsonResponse(res, response.status, { error: `WebDAV Error: ${response.status}` }, corsHeaders);
      }
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return jsonResponse(res, 413, { error: 'Backup file too large' }, corsHeaders);
      }
      const data = await response.json();
      return jsonResponse(res, 200, data, corsHeaders);
    }

    const success = response.ok || response.status === 207;
    return jsonResponse(res, 200, { success, status: response.status }, corsHeaders);

  } catch (err: any) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
    console.error(`WebDAV API error [${requestId}]:`, err);
    return jsonResponse(res, 500, { error: '服务暂时不可用', requestId }, corsHeaders);
  }
}
