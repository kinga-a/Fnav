// 统一存储接口 v2.3 - 性能优化版
// 支持 EdgeOne Pages / Cloudflare Workers

import { getKV, getCorsHeaders, verifyAuth, jsonResponse, getAuthToken } from './_kvAdapter.js';

const STORAGE_KEYS = {
  CONFIG_KEY: 'config',
  CATEGORIES_CONFIG_KEY: 'cate_config',
};

const CONFIG_SECTIONS = ['ai', 'website', 'mastodon', 'weather', 'search', 'icon', 'view', 'ui'];

// 敏感 key：即使鉴权逻辑将来再次失效，也必须在任何读取路径中显式拒绝
const DENIED_KEYS = ['auth_token', 'last_token', 'totp_secret', 'totp_recovery', 'totp_pending'];

// 允许通过 ?key= 直接读取的 KV key 前缀白名单
const ALLOWED_KEY_PREFIXES = ['config', 'cate_config', 'links:', 'favicon:'];

// 敏感配置段：getConfig 单值/批量读取时必须鉴权；即使匿名批量被放行也绝不返回（纵深防御）
const SENSITIVE_SECTIONS = new Set(['ai']);

function isDeniedKey(key) {
  return DENIED_KEYS.some(k => key === k || key.startsWith(`${k}:`));
}

function isAllowedKey(key) {
  return ALLOWED_KEY_PREFIXES.some(p => key.startsWith(p));
}

/**
 * 判断某 getConfig 请求是否需要鉴权
 *  - true / favicon / categories / links 为访客浏览所需，匿名放行
 *  - 批量请求只要包含任一敏感 section 就必须鉴权
 *  - 单值请求命中敏感 section 就必须鉴权
 */
function requiresAuthForConfig(getConfig) {
  if (!getConfig) return false;
  if (getConfig === 'true') return false;
  if (getConfig === 'favicon' || getConfig === 'categories' || getConfig === 'links') return false;
  if (getConfig.includes(',')) {
    // 批量：只要含敏感 section 就要求鉴权
    return getConfig.split(',').some(s => SENSITIVE_SECTIONS.has(s.trim()));
  }
  return SENSITIVE_SECTIONS.has(getConfig);
}

async function readConfigSection(kv, section) {
  const sectionStr = await kv.get(`config:${section}`);
  if (sectionStr) return JSON.parse(sectionStr);
  const configStr = await kv.get('config');
  const config = configStr ? JSON.parse(configStr) : {};
  return config[section] || null;
}

async function mergeAllConfigSections(kv) {
  const merged = {};
  let hasAnyIndividual = false;
  const results = await Promise.all(CONFIG_SECTIONS.map(async (s) => {
    const v = await kv.get(`config:${s}`);
    if (v) { hasAnyIndividual = true; return [s, JSON.parse(v)]; }
    return null;
  }));
  for (const r of results) {
    if (r) merged[r[0]] = r[1];
  }
  if (hasAnyIndividual) {
    const configStr = await kv.get('config');
    if (configStr) {
      const legacy = JSON.parse(configStr);
      for (const s of CONFIG_SECTIONS) {
        if (!merged[s] && legacy[s]) merged[s] = legacy[s];
      }
    }
    return merged;
  }
  const configStr = await kv.get('config');
  return configStr ? JSON.parse(configStr) : {};
}

function categoryLinksKey(categoryId) {
  return `links:${categoryId}`;
}

// 读取所有分类链接（带密码过滤 + 私人书签过滤）
async function readAllCategoryLinks(kv, categories, unlockedCategories = new Set(), isAdmin = false) {
  if (categories.length === 0) return [];

  const linkPromises = categories.map(async (cat) => {
    const hasPassword = cat.password && cat.password.trim() !== '';
    const isUnlocked = unlockedCategories.has(cat.id);

    if (hasPassword && !isUnlocked && !isAdmin) {
      return [];
    }

    const data = await kv.get(categoryLinksKey(cat.id));
    return data ? JSON.parse(data) : [];
  });

  const linkArrays = await Promise.all(linkPromises);
  return linkArrays.flat();
}

// 保存链接到对应的分类 key
async function saveCategoryLinks(kv, links, categories) {
  const grouped = {};
  for (const link of links) {
    const catId = link.categoryId || 'common';
    if (!grouped[catId]) grouped[catId] = [];
    grouped[catId].push(link);
  }

  const writes = Object.entries(grouped).map(([catId, catLinks]) =>
    kv.put(categoryLinksKey(catId), JSON.stringify(catLinks))
  );

  // [修复] 删除后为空的分类：清掉旧的 KV key，避免旧书签在刷新时“复活”
  const cleanups = (categories || []).map(async (cat) => {
    if (!grouped[cat.id]) {
      await kv.delete(categoryLinksKey(cat.id));
    }
  });

  await Promise.all([...writes, ...cleanups]);
}

export async function onRequest(context) {
  const { request, env } = context;
  const corsHeaders = getCorsHeaders(env, request);
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const kv = getKV(env);

    if (request.method === 'GET') {
      const checkAuth = url.searchParams.get('checkAuth');
      const getConfig = url.searchParams.get('getConfig');
      const key = url.searchParams.get('key');
      const readOnly = url.searchParams.get('readOnly');
      const category = url.searchParams.get('category');
      const categoryPassword = url.searchParams.get('catPassword');

      if (checkAuth === 'true') {
        // 增强：若请求携带 Token，顺带验证其有效性（被其他设备登录踢下线时前端可自动登出）
        const providedToken = getAuthToken(request);
        let tokenValid = null;
        if (providedToken) {
          tokenValid = await verifyAuth({
            providedPassword: providedToken,
            serverPassword: env.PASSWORD,
            kv,
          });
        }
        // 是否已开启 TOTP 两步验证（登录弹窗据此显示动态码输入框）
        const totpEnabled = !!(await kv.get('totp_secret'));
        return jsonResponse({
          hasPassword: !!env.PASSWORD,
          requiresAuth: !!env.PASSWORD,
          readOnlyAccess: true,
          capabilities: { upload: true },
          tokenValid,
          totpEnabled,
        }, 200, corsHeaders);
      }

      // [安全] VULN-01（补漏）：getConfig 读取敏感配置段（如 ai）需鉴权。
      // 单值 ai → 未鉴权 401（防直接偷 Key）；
      // 批量含 ai → 未鉴权时剔除 ai 段返回其余（200），不破坏前端匿名加载；已鉴权返回全部。
      const configIsAdmin = await verifyAuth({
        providedPassword: getAuthToken(request),
        serverPassword: env.PASSWORD,
        kv,
      });
      if (getConfig && !getConfig.includes(',') && requiresAuthForConfig(getConfig) && !configIsAdmin) {
        return jsonResponse({ error: '需要密码验证' }, 401, corsHeaders);
      }

      // 优化：支持批量获取多个配置 ?getConfig=search,website,ai
      if (getConfig && getConfig.includes(',')) {
        const requestedSections = getConfig.split(',').filter(s => CONFIG_SECTIONS.includes(s) || s === 'true');
        const configMap = {};

        if (requestedSections.includes('true') || requestedSections.length === 0) {
          // 获取全部配置 + 链接 + 分类
          const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
          const allCategories = categoriesData ? JSON.parse(categoriesData) : [];

          let unlockedCategories = new Set();
          const unlockedParam = url.searchParams.get('unlocked');
          if (unlockedParam) {
            try { unlockedCategories = new Set(JSON.parse(unlockedParam)); } catch (e) {}
          }

          const links = await readAllCategoryLinks(kv, allCategories, unlockedCategories, configIsAdmin);
          const sanitizedCategories = allCategories.map(({ password, ...rest }) => ({
            ...rest,
            hasPassword: !!(password && password.trim() !== '')
          }));

          // 同时获取所有配置
          const allConfig = await mergeAllConfigSections(kv);

          // [安全] 纵深防御：未鉴权读取时，绝不返回敏感配置段（如 ai）
          if (!configIsAdmin) {
            for (const s of SENSITIVE_SECTIONS) {
              delete allConfig[s];
            }
          }

          return jsonResponse({
            links,
            categories: sanitizedCategories,
            configs: allConfig,
          }, 200, corsHeaders);
        }

        await Promise.all(requestedSections.map(async (section) => {
          // [安全] 未鉴权时跳过敏感段（ai），其余正常返回（不破坏前端匿名批量加载）
          if (!configIsAdmin && SENSITIVE_SECTIONS.has(section)) return;
          const val = await readConfigSection(kv, section);
          const configKey = section === 'mastodon' ? 'ticker' : section;
          configMap[configKey] = val || {};
        }));

        return jsonResponse(configMap, 200, corsHeaders);
      }

      if (CONFIG_SECTIONS.includes(getConfig)) {
        const sectionVal = await readConfigSection(kv, getConfig);
        const defaults = {
          website: { passwordExpiry: { value: 1, unit: 'week' } },
        };
        return jsonResponse(sectionVal || defaults[getConfig] || {}, 200, corsHeaders);
      }

      if (getConfig === 'favicon') {
        const domain = url.searchParams.get('domain');
        if (!domain) {
          return jsonResponse({ error: 'Domain parameter is required' }, 400, corsHeaders);
        }
        const cachedIcon = await kv.get(`favicon:${domain}`);
        return jsonResponse({ icon: cachedIcon || null, cached: !!cachedIcon }, 200, corsHeaders);
      }

      if (getConfig === 'categories') {
        const data = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = data ? JSON.parse(data) : [];
        const sanitized = categories.map(({ password, ...rest }) => ({
          ...rest,
          hasPassword: !!(password && password.trim() !== '')
        }));
        return jsonResponse(sanitized, 200, corsHeaders);
      }

      let unlockedCategories = new Set();
      const unlockedParam = url.searchParams.get('unlocked');
      if (unlockedParam) {
        try {
          unlockedCategories = new Set(JSON.parse(unlockedParam));
        } catch (e) {}
      }

      const providedPassword = getAuthToken(request);
      const isAdmin = await verifyAuth({
        providedPassword,
        serverPassword: env.PASSWORD,
        kv,
      });

      if (getConfig === 'links') {
        const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const categories = categoriesData ? JSON.parse(categoriesData) : [];

        if (category) {
          const cat = categories.find(c => c.id === category);
          if (!cat) {
            return jsonResponse({ error: '分类不存在' }, 404, corsHeaders);
          }

          const hasPassword = cat.password && cat.password.trim() !== '';
          let isUnlocked = unlockedCategories.has(category);

          if (categoryPassword && hasPassword && !isUnlocked && !isAdmin) {
            const inputPwd = categoryPassword.trim();
            const storedPwd = (cat.password || '').trim();
            if (inputPwd === storedPwd) {
              isUnlocked = true;
            } else {
              return jsonResponse({ error: '密码错误' }, 403, corsHeaders);
            }
          }

          if (hasPassword && !isUnlocked && !isAdmin) {
            return jsonResponse({ error: '该分类需要密码访问' }, 403, corsHeaders);
          }

          const data = await kv.get(categoryLinksKey(category));
          const links = data ? JSON.parse(data) : [];
          return jsonResponse(links, 200, corsHeaders);
        }

        const links = await readAllCategoryLinks(kv, categories, unlockedCategories, isAdmin);
        return jsonResponse(links, 200, corsHeaders);
      }

      // [安全] VULN-01：?key= 直接读取任意 KV key —— 必须认证，且仅允许白名单内的非敏感 key
      if (key) {
        if (!isAdmin) {
          return jsonResponse({ error: '需要密码验证' }, 401, corsHeaders);
        }
        // 关键防线：即使鉴权逻辑将来再次失效，敏感 key 也必须显式拒绝
        if (isDeniedKey(key)) {
          return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
        }
        if (!isAllowedKey(key)) {
          return jsonResponse({ error: 'Invalid key' }, 400, corsHeaders);
        }
        if (key === STORAGE_KEYS.CONFIG_KEY) {
          const merged = await mergeAllConfigSections(kv);
          return jsonResponse({ key, value: JSON.stringify(merged) }, 200, corsHeaders);
        }
        const value = await kv.get(key);
        return jsonResponse({ key, value }, 200, corsHeaders);
      }

      if (getConfig === 'true') {
        const categoriesData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const allCategories = categoriesData ? JSON.parse(categoriesData) : [];

        const sanitizedCategories = allCategories.map(({ password, ...rest }) => ({
          ...rest,
          hasPassword: !!(password && password.trim() !== '')
        }));

        const links = await readAllCategoryLinks(kv, allCategories, unlockedCategories, isAdmin);

        return jsonResponse({
          links,
          categories: sanitizedCategories,
        }, 200, corsHeaders);
      }

      return jsonResponse({ links: [], categories: [] }, 200, corsHeaders);
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const readOnlyOperations = ['favicon'];

      if (readOnlyOperations.includes(body.operation) || body.saveConfig === 'favicon') {
        if (body.saveConfig === 'favicon') {
          const { domain, icon } = body;
          if (!domain || !icon) {
            return jsonResponse({ error: 'Domain and icon are required' }, 400, corsHeaders);
          }
          await kv.put(`favicon:${domain}`, icon, { expirationTtl: 30 * 24 * 60 * 60 });
          return jsonResponse({ success: true }, 200, corsHeaders);
        }
      }

      const providedPassword = getAuthToken(request);
      const isAuthenticated = await verifyAuth({
        providedPassword,
        serverPassword: env.PASSWORD,
        kv,
      });

      if (!isAuthenticated) {
        return jsonResponse({ error: '管理操作需要密码验证' }, 401, corsHeaders);
      }

      if (body.authOnly) {
        await kv.put('last_auth_time', Date.now().toString());
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      // [安全] 写入路径同样拒绝敏感 key，防止误覆盖鉴权/TOTP 数据
      if (body.key && isDeniedKey(body.key)) {
        return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
      }

      if (CONFIG_SECTIONS.includes(body.saveConfig)) {
        await kv.put(`config:${body.saveConfig}`, JSON.stringify(body.config));
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      if (body.saveConfig === 'categories') {
        const existingData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const existingCategories = existingData ? JSON.parse(existingData) : [];
        const existingPasswords = new Map(existingCategories.map(c => [c.id, c.password]));

        const mergedCategories = body.categories.map(cat => ({
          ...cat,
          password: cat.password || existingPasswords.get(cat.id) || undefined,
        }));

        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(mergedCategories));
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      if (body.saveConfig === 'links') {
        if (body.categoryId) {
          await kv.put(categoryLinksKey(body.categoryId), JSON.stringify(body.links));
        } else {
          const cateStr = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
          const allCats = cateStr ? JSON.parse(cateStr) : [];
          await saveCategoryLinks(kv, body.links, allCats);
        }
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      if (body.key === STORAGE_KEYS.CONFIG_KEY && body.value) {
        await kv.put('config', body.value);
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      if (body.key && body.value && body.key !== STORAGE_KEYS.CONFIG_KEY) {
        await kv.put(body.key, body.value);
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      if (body.links && body.categories) {
        await saveCategoryLinks(kv, body.links, body.categories);
        const existingData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const existingCategories = existingData ? JSON.parse(existingData) : [];
        const existingPasswords = new Map(existingCategories.map(c => [c.id, c.password]));

        const mergedCategories = body.categories.map(cat => ({
          ...cat,
          password: cat.password || existingPasswords.get(cat.id) || undefined,
        }));

        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(mergedCategories));
        return jsonResponse({ success: true }, 200, corsHeaders);
      } else if (body.links) {
        await saveCategoryLinks(kv, body.links);
        return jsonResponse({ success: true }, 200, corsHeaders);
      } else if (body.categories) {
        const existingData = await kv.get(STORAGE_KEYS.CATEGORIES_CONFIG_KEY);
        const existingCategories = existingData ? JSON.parse(existingData) : [];
        const existingPasswords = new Map(existingCategories.map(c => [c.id, c.password]));

        const mergedCategories = body.categories.map(cat => ({
          ...cat,
          password: cat.password || existingPasswords.get(cat.id) || undefined,
        }));

        await kv.put(STORAGE_KEYS.CATEGORIES_CONFIG_KEY, JSON.stringify(mergedCategories));
        return jsonResponse({ success: true }, 200, corsHeaders);
      }

      return jsonResponse({ error: 'Invalid data format' }, 400, corsHeaders);
    }

    return jsonResponse({ error: 'Method Not Allowed' }, 405, corsHeaders);

  } catch (err) {
    // [安全] VULN-04：不向客户端泄漏内部异常详情，仅输出请求 ID 便于服务端日志排查
    const requestId = crypto.randomUUID();
    console.error(`Storage API error [${requestId}]:`, err);
    return jsonResponse({ error: '服务暂时不可用', requestId }, 500, corsHeaders);
  }
}
