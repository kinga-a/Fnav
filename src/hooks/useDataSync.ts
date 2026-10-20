import { useCallback, useEffect, useRef } from 'react';
import { LinkItem, Category, DEFAULT_CATEGORIES, INITIAL_LINKS } from '../../types';
import { STORAGE_KEYS, API_ENDPOINTS } from '../constants';
import { useLinksContext } from '../contexts/LinksContext';
import { useCategoriesContext } from '../contexts/CategoriesContext';
import { useConfigContext } from '../contexts/ConfigContext';
import { useAuthContext } from '../contexts/AuthContext';

/**
 * 数据同步 Hook：管理 localStorage ↔ KV 的加载和同步
 */
export function useDataSync() {
  const { links = [], initLinks, setLinksAndSync } = useLinksContext();
  const { categories = [], initCategories, unlockedCategoryIds } = useCategoriesContext();
  const { initConfig } = useConfigContext();
  const { authToken } = useAuthContext();
  const initialized = useRef(false);

  // 从 localStorage 加载
  const loadFromLocal = useCallback((): { links: LinkItem[]; categories: Category[] } => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.LOCAL_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        let cats: Category[] = parsed.categories || DEFAULT_CATEGORIES;

        if (!cats.some((c: Category) => c.id === 'common')) {
          cats = [{ id: 'common', name: '常用推荐', icon: 'Star' }, ...cats];
        } else {
          const idx = cats.findIndex((c: Category) => c.id === 'common');
          if (idx > 0) {
            const common = cats[idx];
            cats = [common, ...cats.slice(0, idx), ...cats.slice(idx + 1)];
          }
        }

        const validIds = new Set(cats.map((c: Category) => c.id));
        let lnks: LinkItem[] = (parsed.links || INITIAL_LINKS).map((l: LinkItem) =>
          validIds.has(l.categoryId) ? l : { ...l, categoryId: 'common' }
        );

        return { links: lnks, categories: cats };
      }
    } catch (e) {
      console.error('Load from local failed:', e);
    }
    return { links: INITIAL_LINKS, categories: DEFAULT_CATEGORIES };
  }, []);

  // 从 KV 加载链接和分类（带密码过滤）
  const loadFromCloud = useCallback(async (unlockedCats?: Set<string>): Promise<{ links: LinkItem[]; categories: Category[] } | null> => {
    try {
      const unlockedArray = unlockedCats ? Array.from(unlockedCats) : [];
      // [安全] 登录态请求必须带 Authorization，否则后端按匿名剔除 isPrivate 私人书签
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_ENDPOINTS.STORAGE}?getConfig=true&readOnly=true&unlocked=${encodeURIComponent(JSON.stringify(unlockedArray))}`, { headers });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.links?.length > 0 || data.categories?.length > 0) {
        return { links: data.links || [], categories: data.categories || [] };
      }
      return null;
    } catch (e) {
      console.error('Load from cloud failed:', e);
      return null;
    }
  }, [authToken]);

  // 优化：从单个请求加载所有配置
  const loadConfigsFromCloud = useCallback(async () => {
    try {
      // 使用批量接口一次性获取所有配置（登录态带 token，否则敏感段 ai 被后端剔除）
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_ENDPOINTS.STORAGE}?getConfig=ai,website,mastodon,weather,search,icon`, { headers });
      if (!res.ok) return;

      const data = await res.json();
      const configMap: Record<string, any> = {};

      for (const [key, val] of Object.entries(data)) {
        if (val && typeof val === 'object' && Object.keys(val).length > 0) {
          const configKey = key === 'mastodon' ? 'ticker' : key;
          configMap[configKey] = val;
        }
      }

      if (Object.keys(configMap).length > 0) {
        initConfig(configMap);
      }
    } catch (e) {
      console.error('Load configs failed:', e);
    }
  }, [initConfig, authToken]);

  // 初始化数据
  const initData = useCallback(async (unlockedCats?: Set<string>) => {
    if (initialized.current) return;
    initialized.current = true;

    // 回收孤儿书签：categoryId 指向已删除分类的，统一归到默认分类 common（常用推荐）
    const normalizeOrphans = (list: LinkItem[], cats: Category[]): LinkItem[] => {
      const validIds = new Set(cats.map(c => c.id));
      return list.map(l => {
        if (l.pinned || l.categoryId === 'common' || validIds.has(l.categoryId)) return l;
        return { ...l, categoryId: 'common' };
      });
    };

    // 1. 先从本地加载（快速展示）
    const local = loadFromLocal();
    initLinks(normalizeOrphans(local.links, local.categories));
    initCategories(local.categories);

    // 2. 并行从云端获取最新数据
    const [cloud] = await Promise.all([
      loadFromCloud(unlockedCats),
      loadConfigsFromCloud(),
    ]);

    if (cloud) {
      let cats = cloud.categories || [];
      if (cats.length > 0 && !cats.some((c: Category) => c.id === 'common')) {
        cats = [{ id: 'common', name: '常用推荐', icon: 'Star' }, ...cats];
      }
      const fixedLinks = normalizeOrphans(cloud.links || [], cats);
      initLinks(fixedLinks);
      initCategories(cats);
      localStorage.setItem(STORAGE_KEYS.LOCAL_STORAGE_KEY, JSON.stringify({
        links: fixedLinks,
        categories: cats,
      }));
    }
  }, [loadFromLocal, loadFromCloud, loadConfigsFromCloud, initLinks, initCategories]);

  // 同步到云端
  const syncToCloud = useCallback(async () => {
    if (!links.length && !categories.length) return;
    setLinksAndSync(links, categories);
  }, [links, categories, setLinksAndSync]);

  // [修复] 本会话内登录成功（authToken 从空变有值）时，自动重新从云端拉取数据——
  // 这次请求带 token，后端才会返回 isPrivate 私人书签；无需用户手动刷新页面。
  const prevAuthToken = useRef(authToken);
  useEffect(() => {
    const wasLoggedOut = !prevAuthToken.current;
    prevAuthToken.current = authToken;
    if (wasLoggedOut && authToken) {
      initialized.current = false; // 允许 initData 重跑
      initData(unlockedCategoryIds);
    }
  }, [authToken, initData, unlockedCategoryIds]);

  return { initData, loadFromLocal, loadFromCloud, syncToCloud };
}
