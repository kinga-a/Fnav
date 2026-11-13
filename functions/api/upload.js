// EdgeOne Pages / Cloudflare Pages 统一上传接口
// 支持将图标上传到 EdgeOne Pages Blob (腾讯云) 或 Cloudflare R2 (S3/Cloudflare)
// 简洁注释以遵循用户全局规则

import { getKV, getCorsHeaders, verifyAuth, jsonResponse, getAuthToken, validateExternalUrlAsync, safeFetchWithRedirects } from './_kvAdapter.js';

const MAX_FETCH_BYTES = 2 * 1024 * 1024; // 外部抓取上限 2MB
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 上传文件上限 2MB
const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/svg+xml': 'svg',
};

function extFromMime(contentType) {
  return MIME_TO_EXT[String(contentType || '').split(';')[0].trim().toLowerCase()] || '';
}

function looksLikeSvg(buffer) {
  try {
    const head = new TextDecoder('utf-8').decode(buffer.slice(0, 512)).trim().toLowerCase();
    return head.includes('<svg');
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);
  }

  // 1. 认证检查
  let kv;
  try {
    kv = getKV(env);
  } catch (e) {
    if (!env.PASSWORD) {
      return jsonResponse({ error: 'KV or PASSWORD not configured' }, 500, corsHeaders);
    }
  }

  const providedPassword = getAuthToken(request);
  const isAuthenticated = await verifyAuth({
    providedPassword,
    serverPassword: env.PASSWORD,
    kv,
  });

  if (!isAuthenticated) {
    return jsonResponse({ error: '需要密码验证' }, 401, corsHeaders);
  }

  // 处理删除请求 (DELETE)
  if (request.method === 'DELETE') {
    const url = new URL(request.url);
    const key = url.searchParams.get('key');
    const platform = url.searchParams.get('platform');
    if (!key) {
      return jsonResponse({ error: 'Key parameter required' }, 400, corsHeaders);
    }

    try {
      const isCloudflareR2 = platform === 'cloudflare' || (platform !== 'edgeone' && ((env.CLOUDNAV_R2 && typeof env.CLOUDNAV_R2.delete === 'function') || env.UPLOAD_PLATFORM === 'cloudflare'));

      if (env.STORAGE_BACKEND === 'filesystem') {
        // Docker 部署：删除文件系统 KV 中的图标缓存
        const kv = getKV(env);
        await kv.delete(`favicon:${key}`);
      } else if (isCloudflareR2) {
        if (!env.CLOUDNAV_R2) {
          return jsonResponse({ error: 'Cloudflare R2 binding CLOUDNAV_R2 not found' }, 500, corsHeaders);
        }
        await env.CLOUDNAV_R2.delete(key);
      } else {
        // EdgeOne Pages Blob
        let getStore;
        try {
          const blobSdk = await import('@edgeone/pages-blob');
          getStore = blobSdk.getStore;
        } catch (e) {}

        if (getStore) {
          const store = getStore('favicons');
          await store.delete(key);
        }
      }
      return jsonResponse({ success: true }, 200, corsHeaders);
    } catch (err) {
      // [安全] VULN-04：不向客户端泄漏内部异常详情
      const requestId = crypto.randomUUID();
      console.error(`Delete error [${requestId}]:`, err);
      return jsonResponse({ error: '服务暂时不可用', requestId }, 500, corsHeaders);
    }
  }

  try {
    const formData = await request.formData();
    let file = formData.get('file');
    let arrayBuffer;
    let contentType = 'image/png';
    let ext = 'png';
    let filename = 'icon.png';

    const fetchUrl = formData.get('url');
    if (!file && !fetchUrl) {
      return jsonResponse({ error: 'No file or url provided' }, 400, corsHeaders);
    }

    // 获取分类名并净化
    let categoryName = formData.get('categoryName') || 'common';
    categoryName = String(categoryName)
      .replace(/[\\/:*?"<>|]/g, '_')
      .trim();
    if (!categoryName) {
      categoryName = 'common';
    }

    if (fetchUrl) {
      // [安全] VULN-12：仅允许 HTTPS 公网地址，拦截私有/保留 IP 段，限制响应大小
      const validated = await validateExternalUrlAsync(String(fetchUrl));
      if (!validated.ok) {
        return jsonResponse({ error: validated.error || 'Invalid fetch URL' }, 400, corsHeaders);
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const fetchRes = await safeFetchWithRedirects(validated.url.toString(), {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          signal: controller.signal,
        }, 2);
        clearTimeout(timer);

        if (!fetchRes) {
          return jsonResponse({ error: 'Failed to fetch external URL' }, 400, corsHeaders);
        }
        if (!fetchRes.ok) {
          return jsonResponse({ error: `Failed to fetch external URL: ${fetchRes.statusText}` }, 400, corsHeaders);
        }

        const contentLength = Number(fetchRes.headers.get('content-length') || 0);
        if (contentLength > MAX_FETCH_BYTES) {
          return jsonResponse({ error: 'External file too large' }, 413, corsHeaders);
        }

        const chunks = [];
        let total = 0;
        const reader = fetchRes.body.getReader();
        while (total < MAX_FETCH_BYTES) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
        }
        reader.cancel();
        if (total >= MAX_FETCH_BYTES) {
          return jsonResponse({ error: 'External file too large' }, 413, corsHeaders);
        }
        const buf = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          buf.set(c, offset);
          offset += c.length;
        }
        arrayBuffer = buf.buffer;
        contentType = fetchRes.headers.get('content-type') || '';
        ext = extFromMime(contentType);
        if (!ext) {
          return jsonResponse({ error: 'Unsupported image type' }, 415, corsHeaders);
        }
        if (ext === 'svg' && !looksLikeSvg(buf)) {
          return jsonResponse({ error: 'Invalid SVG payload' }, 415, corsHeaders);
        }
        filename = `icon.${ext}`;
      } catch (fetchErr) {
        const requestId = crypto.randomUUID();
        console.error(`Fetch URL error [${requestId}]:`, fetchErr);
        return jsonResponse({ error: 'Fetch URL error' }, 400, corsHeaders);
      }
    } else {
      arrayBuffer = await file.arrayBuffer();
      if (arrayBuffer.byteLength > MAX_FILE_BYTES) {
        return jsonResponse({ error: 'File too large' }, 413, corsHeaders);
      }
      contentType = file.type || '';
      ext = extFromMime(contentType);
      if (!ext) {
        return jsonResponse({ error: 'Unsupported image type' }, 415, corsHeaders);
      }
      if (ext === 'svg' && !looksLikeSvg(new Uint8Array(arrayBuffer))) {
        return jsonResponse({ error: 'Invalid SVG payload' }, 415, corsHeaders);
      }
      filename = `icon.${ext}`;
    }

    // 生成唯一 Key 并按分类存放
    const randomId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 10);
    const key = `${categoryName}/${randomId}.${ext}`;

    // 2. 检测并上传到目标平台
    const platform = formData.get('platform');
    const isCloudflareR2 = platform === 'cloudflare' || (platform !== 'edgeone' && ((env.CLOUDNAV_R2 && typeof env.CLOUDNAV_R2.put === 'function') || env.UPLOAD_PLATFORM === 'cloudflare'));

    if (env.STORAGE_BACKEND === 'filesystem') {
      // Docker 部署：图标二进制写入文件系统 KV（30 天 TTL）
      const kv = getKV(env);
      await kv.put(`favicon:${key}`, arrayBuffer, { expirationTtl: 30 * 24 * 60 * 60 });
    } else if (isCloudflareR2) {
      if (!env.CLOUDNAV_R2) {
        return jsonResponse({ error: 'Cloudflare R2 binding CLOUDNAV_R2 not found' }, 500, corsHeaders);
      }
      await env.CLOUDNAV_R2.put(key, arrayBuffer, {
        httpMetadata: {
          contentType: contentType,
          cacheControl: 'public, max-age=31536000',
        }
      });
    } else {
      // 默认使用 EdgeOne Pages Blob
      let getStore;
      try {
        const blobSdk = await import('@edgeone/pages-blob');
        getStore = blobSdk.getStore;
      } catch (e) {}

      if (!getStore) {
        return jsonResponse({ error: 'Storage backend not available' }, 500, corsHeaders);
      }

      const store = getStore('favicons');
      await store.set(key, arrayBuffer, {
        cacheControl: 'public, max-age=31536000'
      });
    }

    const iconUrl = `/api/favicon?key=${encodeURIComponent(key)}`;
    return jsonResponse({ success: true, url: iconUrl }, 200, corsHeaders);

  } catch (err) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    const requestId = crypto.randomUUID();
    console.error(`Upload error [${requestId}]:`, err);
    return jsonResponse({ error: '服务暂时不可用', requestId }, 500, corsHeaders);
  }
}
