// Vercel Serverless Favicon 代理接口
// 保持跨平台一致性，简洁注释
// [安全] 统一 CORS 白名单策略 + 防盗链（仅同源 Referer）

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getCorsHeaders, jsonResponse } from './_kvHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin'] || '').end();
  }

  if (req.method !== 'GET') {
    return jsonResponse(res, 405, { error: 'Method Not Allowed' }, corsHeaders);
  }

  // 防盗链保护（防站外盗用）：白名单模式，仅允许同源 Referer
  const referer = req.headers['referer'] as string | undefined;
  const secFetchSite = req.headers['sec-fetch-site'] as string | undefined;
  const selfHost = (req.headers['host'] || '').split(':')[0];
  if (referer) {
    try {
      const refererHost = new URL(referer).hostname;
      if (refererHost !== selfHost && refererHost !== 'localhost' && refererHost !== '127.0.0.1') {
        return res.status(403).send('Forbidden: Hotlinking is not allowed');
      }
    } catch (e) {
      return res.status(403).send('Forbidden: Hotlinking is not allowed');
    }
  } else if (secFetchSite === 'cross-site') {
    return res.status(403).send('Forbidden: Hotlinking is not allowed');
  }

  const domain = req.query.domain as string;
  if (!domain) {
    return jsonResponse(res, 400, { error: 'Domain required' }, corsHeaders);
  }
  if (!/^[a-z0-9.-]{1,253}$/i.test(domain) || domain.includes('..')) {
    return jsonResponse(res, 400, { error: 'Invalid domain' }, corsHeaders);
  }

  // Vercel 运行环境下使用重定向降级处理，保障性能与跨平台兼容
  const fallbackUrl = `https://www.faviconextractor.com/favicon/${encodeURIComponent(domain)}?larger=true`;
  return res.redirect(302, fallbackUrl);
}
