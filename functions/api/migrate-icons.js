import { getKV, getCorsHeaders, verifyAuth, jsonResponse, getAuthToken } from './_kvAdapter.js';

const UPSTREAM_PROVIDERS = [
  (domain) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
  (domain) => `https://www.faviconextractor.com/favicon/${domain}?larger=true`,
];

const CONCURRENCY = 3;

function detectMimeType(arrayBuffer) {
  const uint8 = new Uint8Array(arrayBuffer);
  if (uint8.length >= 8 && uint8[0] === 0x89 && uint8[1] === 0x50 && uint8[2] === 0x4E && uint8[3] === 0x47) return 'image/png';
  if (uint8.length >= 2 && uint8[0] === 0xFF && uint8[1] === 0xD8) return 'image/jpeg';
  if (uint8.length >= 4 && uint8[0] === 0x47 && uint8[1] === 0x49 && uint8[2] === 0x46 && uint8[3] === 0x38) return 'image/gif';
  if (uint8.length >= 4 && uint8[0] === 0x00 && uint8[1] === 0x00 && uint8[2] === 0x01 && uint8[3] === 0x00) return 'image/x-icon';
  return 'image/png';
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

  // [安全] 标准 Authorization 鉴权头（兼容旧版 x-auth-password）
  const providedPassword = getAuthToken(request);
  const kv = getKV(env);
  const isAuthenticated = await verifyAuth({
    providedPassword,
    serverPassword: env.PASSWORD,
    kv,
  });

  if (!isAuthenticated) {
    return jsonResponse({ error: '需要密码验证' }, 401, corsHeaders);
  }

  try {
    const catsStr = await kv.get('cate_config');
    const categories = catsStr ? JSON.parse(catsStr) : [];

    const categoryLinks = {};
    for (const cat of categories) {
      const data = await kv.get(`links:${cat.id}`);
      categoryLinks[cat.id] = data ? JSON.parse(data) : [];
    }

    let total = 0;
    let cached = 0;
    let failed = 0;
    let skipped = 0;
    const modifiedCategories = new Set();

    const queue = [];
    for (const cat of categories) {
      for (const link of categoryLinks[cat.id]) {
        total++;
        let domain = null;
        try {
          domain = new URL(link.url).hostname;
        } catch (e) {}

        if (!domain) {
          skipped++;
          continue;
        }

        if (link.icon?.startsWith('/api/favicon?key=') ||
            link.icon?.startsWith('/api/favicon?domain=') ||
            link.iconType === 'upload-edgeone' ||
            link.iconType === 'upload-cloudflare') {
          skipped++;
          continue;
        }

        queue.push({ catId: cat.id, link, domain });
      }
    }

    const isCloudflareR2 = (env.CLOUDNAV_R2 && typeof env.CLOUDNAV_R2.put === 'function') || env.UPLOAD_PLATFORM === 'cloudflare';

    for (let i = 0; i < queue.length; i += CONCURRENCY) {
      const batch = queue.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async ({ catId, link, domain }) => {
        try {
          let buffer = null;
          for (const getUrl of UPSTREAM_PROVIDERS) {
            try {
              const res = await fetch(getUrl(domain), {
                headers: { 'User-Agent': 'Mozilla/5.0' }
              });
              if (res.ok) {
                buffer = await res.arrayBuffer();
                if (buffer.byteLength > 0) break;
              }
            } catch (e) {}
          }

          if (!buffer) {
            failed++;
            return;
          }

          const storageKey = `favicon:${domain}`;
          let storageOk = false;

          if (env.STORAGE_BACKEND === 'filesystem') {
            // Docker 部署：图标二进制写入文件系统 KV（30 天 TTL）
            await kv.put(storageKey, buffer, { expirationTtl: 30 * 24 * 60 * 60 });
            storageOk = true;
          } else if (isCloudflareR2 && env.CLOUDNAV_R2) {
            const mime = detectMimeType(buffer);
            await env.CLOUDNAV_R2.put(storageKey, buffer, {
              httpMetadata: { contentType: mime, cacheControl: 'public, max-age=31536000' }
            });
            storageOk = true;
          } else {
            let getStore;
            try {
              const blobSdk = await import('@edgeone/pages-blob');
              getStore = blobSdk.getStore;
            } catch (e) {}

            if (getStore) {
              const store = getStore('favicons');
              await store.set(storageKey, buffer, {
                cacheControl: 'public, max-age=31536000'
              });
              storageOk = true;
            }
          }

          if (!storageOk) {
            failed++;
            return;
          }

          link.icon = `/api/favicon?domain=${encodeURIComponent(domain)}`;
          modifiedCategories.add(catId);
          cached++;
        } catch (e) {
          console.error(`Migration failed for ${domain}:`, e);
          failed++;
        }
      }));
    }

    for (const catId of modifiedCategories) {
      await kv.put(`links:${catId}`, JSON.stringify(categoryLinks[catId]));
    }

    return jsonResponse({ total, cached, failed, skipped }, 200, corsHeaders);

  } catch (err) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    const requestId = crypto.randomUUID();
    console.error(`Migration error [${requestId}]:`, err);
    return jsonResponse({ error: '服务暂时不可用', requestId }, 500, corsHeaders);
  }
}
