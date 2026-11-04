// 抓取目标网页的 <title> 与 <meta name="description">，用于无 AI 时自动填写书签信息
// [安全] VULN-03：SSRF 防护（仅 HTTPS 公网地址 + 逐跳校验 + 大小限制 + 简单限流），保留匿名访问
import { getCorsHeaders, jsonResponse, validateExternalUrl, safeFetchWithRedirects } from './_kvAdapter.js';

const MAX_HTML_BYTES = 200000; // 读取上限 200KB（与原有逻辑一致）
const REQUEST_WINDOW_MS = 60000; // 1 分钟窗口
const MAX_REQUESTS_PER_WINDOW = 30; // 每窗口每 IP 最多 30 次（含 TOTP 在内的通用限流）

// 进程内简易限流（按客户端 IP）
const rateBuckets = new Map();

function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  );
}

function checkRateLimit(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > REQUEST_WINDOW_MS) {
    rateBuckets.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS_PER_WINDOW) {
    rateBuckets.set(ip, { windowStart: now, count: 1 });
    return false;
  }
  return true;
}

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
  }

  // [安全] 简单限流，降低被当作端口扫描器的风险
  if (!checkRateLimit(getClientIp(request))) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429, corsHeaders);
  }

  const target = new URL(request.url).searchParams.get('url');
  if (!target) {
    return jsonResponse({ error: 'url parameter required' }, 400, corsHeaders);
  }

  // [安全] VULN-03：仅允许 HTTPS 公网地址，拦截私有/保留 IP 段
  const rawUrl = target.startsWith('http') ? target : `https://${target}`;
  const validated = validateExternalUrl(rawUrl);
  if (!validated.ok) {
    return jsonResponse({ error: validated.error || 'invalid url' }, 400, corsHeaders);
  }

  try {
    // 增强浏览器伪装：更完整的 UA + 常见请求头，降低被 WAF/bot 检测拦截的概率
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    // 重试逻辑：对超时/502/网络错误最多重试 2 次，逐步增加超时时间
    const MAX_RETRIES = 2;
    const TIMEOUTS = [8000, 12000, 15000]; // 首次 8s，第一次重试 12s，第二次 15s
    let res = null;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUTS[attempt]);
      try {
        res = await safeFetchWithRedirects(validated.url.toString(), {
          headers: browserHeaders,
          signal: controller.signal,
        }, 3);
        clearTimeout(timer);
        if (res && res.ok) break; // 成功则跳出重试
        if (res && res.status >= 400 && res.status < 500 && res.status !== 429) break; // 4xx（非限流）不重试
      } catch (fetchErr) {
        clearTimeout(timer);
        lastError = fetchErr;
        // 超时或网络错误才重试，其他错误直接跳出
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // 递增延迟
        }
      }
    }

    if (!res) {
      return jsonResponse({ error: '无法获取页面信息' }, 502, corsHeaders);
    }
    if (!res.ok) {
      // [安全] VULN-04：不向客户端暴露目标服务器状态码（防探测），详情仅进服务端日志
      console.error(`[metadata] target returned ${res.status} for ${validated.url.toString()}`);
      return jsonResponse({ error: '无法获取页面信息' }, 502, corsHeaders);
    }

    // 读取前 MAX_HTML_BYTES，用流式 TextDecoder 正确拼接
    const decoder = new TextDecoder('utf-8');
    let html = '';
    let received = 0;
    const reader = res.body.getReader();
    while (received < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      received += value.length;
    }
    html += decoder.decode();
    reader.cancel();

    const headEnd = html.toLowerCase().indexOf('</head>');
    const head = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, MAX_HTML_BYTES);

    // title
    let title = '';
    const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = decodeEntities(titleMatch[1]);

    // meta description: name=description 优先，其次 og:description
    let description = '';
    const metaRe = /<meta[^>]+>/gi;
    let m;
    while ((m = metaRe.exec(head)) !== null) {
      const tag = m[0];
      const name = (tag.match(/name\s*=\s*["']([^"']+)["']/i) || tag.match(/property\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
      if (name.toLowerCase() === 'description' || name.toLowerCase() === 'og:description') {
        const content = (tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
        if (content) {
          description = decodeEntities(content);
          if (name.toLowerCase() === 'description') break;
        }
      }
    }

    return jsonResponse({ title, description }, 200, {
      ...corsHeaders,
      'Cache-Control': 'public, max-age=86400',
    });
  } catch (err) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    console.error('[metadata] fetch failed:', err);
    return jsonResponse({ error: '无法获取页面信息' }, 502, corsHeaders);
  }
}
