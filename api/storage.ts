// Vercel 存储接口
// [安全] VULN-01：?key= 直接读取需认证 + key 白名单 + 敏感 key 拒绝；分类密码恒脱敏；错误信息脱敏
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getKV, getCorsHeaders, verifyAuth, getAuthToken, jsonResponse } from './_kvHelper.js';

const CONFIG_SECTIONS = ['ai', 'website', 'mastodon', 'weather', 'search', 'icon', 'view', 'ui'];

const STORAGE_KEYS = {
  CONFIG_KEY: 'config',
  CATEGORIES_CONFIG_KEY: 'cate_config',
  LINKS_CONFIG_KEY: 'links_config',
};

// 敏感 key：任何读取/写入路径都必须显式拒绝
const DENIED_KEYS = ['auth_token', 'last_token', 'totp_secret', 'totp_recovery', 'totp_pending'];

// 允许通过 ?key= 直接读取的 KV key 前缀白名单
const ALLOWED_KEY_PREFIXES = ['config', 'cate_config', 'links:', 'favicon:'];

function isDeniedKey(key: string): boolean {
  return DENIED_KEYS.some(k => key === k || key.startsWith(`${k}:`));
}

function isAllowedKey(key: string): boolean {
  return ALLOWED_KEY_PREFIXES.some(p => key.startsWith(p));
}

// 敏感配置段：getConfig 单值/批量读取时必须鉴权；即使匿名批量被放行也绝不返回（纵深防御）
const SENSITIVE_SECTIONS = new Set(['ai']);

/**
 * 判断某 getConfig 请求是否需要鉴权（与 EdgeOne 版本一致）
 *  - true / favicon / categories / links 为访客浏览所需，匿名放行
 *  - 批量请求只要包含任一敏感 section 就必须鉴权
 *  - 单值请求命中敏感 section 就必须鉴权
 */
function requiresAuthForConfig(getConfig: string | null | undefined): boolean {
  if (!getConfig) return false;
  if (getConfig === 'true') return false;
  if (getConfig === 'favicon' || getConfig === 'categories' || getConfig === 'links') return false;
  if (getConfig.includes(',')) {
    // 批量：只要含敏感 section 就要求鉴权
    return getConfig.split(',').some(s => SENSITIVE_SECTIONS.has(s.trim()));
  }
  return SENSITIVE_SECTIONS.has(getConfig);
}

async function readConfigSection(kv: any, section: string) {
  const sectionStr = await kv.get(`config:${section}`);
  if (sectionStr) return typeof sectionStr === 'string' ? JSON.parse(sectionStr) : sectionStr;
  const configStr = await kv.get('config');
  const config = configStr ? (typeof configStr === 'string' ? JSON.parse(configStr) : configStr) : {};
  return config[section] || null;
}

async function mergeAllConfigSections(kv: any) {
  const merged: Record<string, any> = {};
  let hasAnyIndividual = false;
  const results = await Promise.all(CONFIG_SECTIONS.map(async (s) => {
    const v = await kv.get(`config:${s}`);
    if (v) { hasAnyIndividual = true; return [s, typeof v === 'string' ? JSON.parse(v) : v]; }
    return null;
  }));
  for (const r of results) {
    if (r) merged[r[0]] = r[1];
  }
  if (hasAnyIndividual) {
    const configStr = await kv.get('config');
    if (configStr) {
      const legacy = typeof configStr === 'string' ? JSON.parse(configStr) : configStr;
      for (const s of CONFIG_SECTIONS) {
        if (!merged[s] && legacy[s]) merged[s] = legacy[s];
      }
    }
    return merged;
  }
  const configStr = await kv.get('config');
  return configStr ? (typeof configStr === 'string' ? JSON.parse(configStr) : configStr) : {};
}

// 生成分类链接 key
function categoryLinksKey(categoryId: string) {
  return `links:${categoryId}`;
}

// 读取所有分类链接（带密码分类过滤，与 EdgeOne 版一致）
// 密码分类：未解锁且非管理员时返回 []，绝不向匿名访客泄露私人书签
async function readAllCategoryLinks(kv: any, unlockedCategories = new Set<string>(), isAdmin = false) {
  // 1. 获取所有分类
  const categoriesStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
  const categories = categoriesStr ? (typeof categoriesStr === 'string' ? JSON.parse(categoriesStr) : categoriesStr) : [];

  if (categories.length === 0) {
    // 如果没有分类配置，尝试读取旧版全量链接
    const legacyData = await kv.get(STORAGE_KEYS.LINKS_CONFIG_KEY);
    const legacy = legacyData ? (typeof legacyData === 'string' ? JSON.parse(legacyData) : legacyData) : [];
    // 私人书签（isPrivate）：未登录（非管理员）时剔除
    return isAdmin ? legacy : legacy.filter((l: any) => !l.isPrivate);
  }

  // 2. 并行读取每个分类的链接；密码分类未解锁且非管理员时不返回
  const linkPromises = categories.map(async (cat: any) => {
    const hasPassword = cat.password && String(cat.password).trim() !== '';
    if (hasPassword && !unlockedCategories.has(cat.id) && !isAdmin) {
      return [];
    }
    const data = await kv.get(categoryLinksKey(cat.id));
    const links = data ? (typeof data === 'string' ? JSON.parse(data) : data) : [];
    // 私人书签（isPrivate）：未登录（非管理员）时剔除，与前端可见性一致
    return isAdmin ? links : links.filter((l: any) => !l.isPrivate);
  });

  const linkArrays = await Promise.all(linkPromises);
  const allLinks = linkArrays.flat();

  // 3. 兼容性检查：如果拆分存储没数据，但旧版全量存储有数据，则返回旧版数据
  if (allLinks.length === 0) {
    const legacyData = await kv.get(STORAGE_KEYS.LINKS_CONFIG_KEY);
    const legacy = legacyData ? (typeof legacyData === 'string' ? JSON.parse(legacyData) : legacyData) : [];
    // 私人书签（isPrivate）：未登录（非管理员）时剔除
    return isAdmin ? legacy : legacy.filter((l: any) => !l.isPrivate);
  }

  return allLinks;
}

// 保存链接到对应的分类 key
async function saveCategoryLinks(kv: any, links: any[], categories?: any[]) {
  // 按 categoryId 分组
  const grouped: Record<string, any[]> = {};
  for (const link of links) {
    const catId = link.categoryId || 'common';
    if (!grouped[catId]) grouped[catId] = [];
    grouped[catId].push(link);
  }

  // 并行写入每个分类
  const writes = Object.entries(grouped).map(([catId, catLinks]) =>
    kv.set(categoryLinksKey(catId), JSON.stringify(catLinks))
  );

  // [修复] 删除后为空的分类：清掉旧的 KV key，避免旧书签在刷新时“复活”
  // 注意：@vercel/kv 没有 kv.list/kv.delete 方法，正确写法是 kv.del
  const cleanups = (categories || []).map(async (cat: any) => {
    if (!grouped[cat.id]) {
      await kv.del(categoryLinksKey(cat.id));
    }
  });

  await Promise.all([...writes, ...cleanups]);

  // 写入后清除旧版全量存储（可选，为了安全起见这里暂时不删，或者只写一个标记）
}

// 分类数据脱敏：永远不向客户端返回分类密码
function sanitizeCategories(categories: any[]) {
  return categories.map(({ password, ...rest }: any) => ({
    ...rest,
    hasPassword: !!(password && String(password).trim() !== ''),
  }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return res.status(204).setHeader('Access-Control-Allow-Origin', corsHeaders['Access-Control-Allow-Origin'] || '').end();
  }

  try {
    const kv = getKV();

    // ==================== GET ====================
    if (req.method === 'GET') {
      const { checkAuth, getConfig, key, readOnly } = req.query;

      if (checkAuth === 'true') {
        // 增强：若请求携带 Token，顺带验证其有效性（被其他设备登录踢下线时前端可自动登出）
        const providedToken = getAuthToken(req) || undefined;
        let tokenValid: boolean | null = null;
        if (providedToken) {
          tokenValid = await verifyAuth(providedToken);
        }
        // 是否已开启 TOTP 两步验证（登录弹窗据此显示动态码输入框）
        const totpEnabled = !!(await kv.get('totp_secret'));
        return jsonResponse(res, 200, {
          hasPassword: !!process.env.PASSWORD,
          requiresAuth: !!process.env.PASSWORD,
          readOnlyAccess: true,
          capabilities: { upload: false },
          tokenValid,
          totpEnabled,
        }, corsHeaders);
      }

      // [安全] VULN-01（补漏）：getConfig 单值/批量读取敏感配置段（如 ai）必须先鉴权
      if (requiresAuthForConfig(getConfig as string | null | undefined)) {
        const providedPassword = getAuthToken(req) || '';
        const isAdmin = await verifyAuth(providedPassword);
        if (!isAdmin) {
          return jsonResponse(res, 401, { error: '需要密码验证' }, corsHeaders);
        }
      }

      if (CONFIG_SECTIONS.includes(getConfig as string)) {
        const sectionVal = await readConfigSection(kv, getConfig as string);
        const defaults: Record<string, any> = {
          website: { passwordExpiry: { value: 1, unit: 'week' } },
        };
        return jsonResponse(res, 200, sectionVal || defaults[getConfig as string] || {}, corsHeaders);
      }

      if (getConfig === 'favicon') {
        const domain = req.query.domain as string;
        if (!domain) return jsonResponse(res, 400, { error: 'Domain required' }, corsHeaders);
        const cachedIcon = await kv.get(`favicon:${domain}`);
        return jsonResponse(res, 200, { icon: cachedIcon || null, cached: !!cachedIcon }, corsHeaders);
      }

      if (getConfig === 'categories') {
        const data = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = data ? (typeof data === 'string' ? JSON.parse(data) : data) : [];
        // [安全] 恒脱敏：不再存在 readOnly=false 时泄漏分类密码的路径
        return jsonResponse(res, 200, sanitizeCategories(categories), corsHeaders);
      }

      if (getConfig === 'links') {
        const categoryId = req.query.category as string;

        // 解析已解锁分类（前端解锁密码分类后携带）
        let unlockedCategories = new Set<string>();
        const unlockedParam = req.query.unlocked as string;
        if (unlockedParam) {
          try { unlockedCategories = new Set(JSON.parse(unlockedParam)); } catch { /* ignore */ }
        }
        const providedPassword = getAuthToken(req) || '';
        const isAdmin = await verifyAuth(providedPassword);

        if (categoryId) {
          // [安全] VULN-05（补漏）：分类级密码保护必须生效——
          // 密码分类只有在已解锁 / catPassword 正确 / 管理员三种情况下才返回书签，
          // 否则匿名访问者用扩展/直连 API 就能窃取私人书签
          const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
          const categories = categoriesData ? (typeof categoriesData === 'string' ? JSON.parse(categoriesData) : categoriesData) : [];
          const cat = categories.find((c: any) => c.id === categoryId);
          if (!cat) {
            return jsonResponse(res, 404, { error: '分类不存在' }, corsHeaders);
          }

          const hasPassword = cat.password && String(cat.password).trim() !== '';
          let isUnlocked = unlockedCategories.has(categoryId);

          const categoryPassword = req.query.catPassword as string;
          if (categoryPassword && hasPassword && !isUnlocked && !isAdmin) {
            const inputPwd = String(categoryPassword).trim();
            const storedPwd = String(cat.password || '').trim();
            if (inputPwd === storedPwd) {
              isUnlocked = true;
            } else {
              return jsonResponse(res, 403, { error: '密码错误' }, corsHeaders);
            }
          }

          if (hasPassword && !isUnlocked && !isAdmin) {
            return jsonResponse(res, 403, { error: '该分类需要密码访问' }, corsHeaders);
          }

          const data = await kv.get(categoryLinksKey(categoryId));
          const links = data ? (typeof data === 'string' ? JSON.parse(data) : data) : [];
          // 私人书签（isPrivate）：未登录（非管理员）时剔除，与前端可见性一致
          const visibleLinks = isAdmin ? links : links.filter((l: any) => !l.isPrivate);
          return jsonResponse(res, 200, visibleLinks, corsHeaders);
        }

        const links = await readAllCategoryLinks(kv, unlockedCategories, isAdmin);
        return jsonResponse(res, 200, links, corsHeaders);
      }

      // [安全] VULN-01：?key= 直接读取任意 KV key —— 必须认证，且仅允许白名单内的非敏感 key
      if (key) {
        const providedPassword = getAuthToken(req) || '';
        const isAdmin = await verifyAuth(providedPassword);
        if (!isAdmin) {
          return jsonResponse(res, 401, { error: '需要密码验证' }, corsHeaders);
        }
        if (isDeniedKey(key as string)) {
          return jsonResponse(res, 403, { error: 'Forbidden' }, corsHeaders);
        }
        if (!isAllowedKey(key as string)) {
          return jsonResponse(res, 400, { error: 'Invalid key' }, corsHeaders);
        }
        if (key === STORAGE_KEYS.CONFIG_KEY) {
          const merged = await mergeAllConfigSections(kv);
          return jsonResponse(res, 200, { key, value: JSON.stringify(merged) }, corsHeaders);
        }
        const value = await kv.get(key as string);
        return jsonResponse(res, 200, { key, value }, corsHeaders);
      }

      if (getConfig === 'true') {
        const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = categoriesData ? (typeof categoriesData === 'string' ? JSON.parse(categoriesData) : categoriesData) : [];
        // [安全] 恒脱敏：分类密码绝不返回客户端
        const sanitizedCategories = sanitizeCategories(categories);

        // [安全] VULN-05（补漏）：密码分类书签只在已解锁/管理态返回，匿名访问不泄露
        let unlockedCategories = new Set<string>();
        const unlockedParam = req.query.unlocked as string;
        if (unlockedParam) {
          try { unlockedCategories = new Set(JSON.parse(unlockedParam)); } catch { /* ignore */ }
        }
        const providedPassword = getAuthToken(req) || '';
        const isAdmin = await verifyAuth(providedPassword);

        const links = await readAllCategoryLinks(kv, unlockedCategories, isAdmin);

        return jsonResponse(res, 200, {
          links,
          categories: sanitizedCategories,
        }, corsHeaders);
      }

      return jsonResponse(res, 200, { links: [], categories: [] }, corsHeaders);
    }

    // ==================== POST ====================
    if (req.method === 'POST') {
      const body = req.body;

      if (body.saveConfig === 'favicon') {
        const { domain, icon } = body;
        if (!domain || !icon) return jsonResponse(res, 400, { error: 'Domain and icon required' }, corsHeaders);
        await kv.set(`favicon:${domain}`, icon, { ex: 30 * 24 * 60 * 60 });
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }

      const providedPassword = getAuthToken(req) || '';
      const isAuthenticated = await verifyAuth(providedPassword);

      if (!isAuthenticated) {
        return jsonResponse(res, 401, { error: '管理操作需要密码验证' }, corsHeaders);
      }

      // [安全] 写入路径同样拒绝敏感 key
      if (body.key && isDeniedKey(body.key)) {
        return jsonResponse(res, 403, { error: 'Forbidden' }, corsHeaders);
      }

      if (body.authOnly) {
        await kv.set('last_auth_time', Date.now().toString());
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }

      if (CONFIG_SECTIONS.includes(body.saveConfig)) {
        await kv.set(`config:${body.saveConfig}`, JSON.stringify(body.config));
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }

      if (body.saveConfig === 'categories') {
        await kv.set(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }

      if (body.saveConfig === 'links') {
        if (body.categoryId) {
          await kv.set(categoryLinksKey(body.categoryId), JSON.stringify(body.links));
        } else {
          const categoriesStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
          const allCats = categoriesStr ? JSON.parse(categoriesStr as string) : [];
          await saveCategoryLinks(kv, body.links, allCats);
        }
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }

      if (body.key === STORAGE_KEYS.CONFIG_KEY && body.value) {
        await kv.set('config', body.value);
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }

      if (body.links && body.categories) {
        await saveCategoryLinks(kv, body.links, body.categories);
        await kv.set(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      } else if (body.links) {
        await saveCategoryLinks(kv, body.links);
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      } else if (body.categories) {
        await kv.set(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(body.categories));
        return jsonResponse(res, 200, { success: true }, corsHeaders);
      }

      return jsonResponse(res, 400, { error: 'Invalid data format' }, corsHeaders);
    }

    return jsonResponse(res, 405, { error: 'Method Not Allowed' }, corsHeaders);

  } catch (err: any) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情
    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
    console.error(`Storage API error [${requestId}]:`, err);
    return jsonResponse(res, 500, { error: '服务暂时不可用', requestId }, corsHeaders);
  }
}
