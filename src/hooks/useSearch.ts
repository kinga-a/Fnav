import { useState, useCallback, useMemo, useEffect } from 'react';
import { SearchMode, ExternalSearchSource, LinkItem } from '../../types';
import { DEFAULT_SEARCH_SOURCES } from '../constants/defaultSearchSources';
import { useLinksContext } from '../contexts/LinksContext';
import { useConfigContext } from '../contexts/ConfigContext';
import { useCategoriesContext } from '../contexts/CategoriesContext';
import { SEARCH_ENGINES } from '../constants';

export function useSearch() {
  const { links = [] } = useLinksContext();
  const { categories = [] } = useCategoriesContext();
  const { search: searchConfig, setSearch } = useConfigContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  
  // 站内搜索状态：以管理员在设置面板选的默认引擎为准
  const defaultIsInternal = (searchConfig?.defaultEngine || 'internal') === 'internal';
  const [isInternal, setIsInternal] = useState(defaultIsInternal);

  // 访客当前会话临时切换的引擎 ID（仅当前页面会话有效，不写 localStorage 持久化）
  const [visitorEngineId, setVisitorEngineId] = useState<string>('');

  // 管理员配置加载完成 / 变更时：以服务器配置为准，清掉本地旧的引擎选择残留。
  // 修复此前的 bug：访客曾选过外部引擎后，localStorage 会永久覆盖管理员的默认设置，
  // 导致设置面板改了"站内搜索"也不生效。
  useEffect(() => {
    setIsInternal(defaultIsInternal);
    setVisitorEngineId('');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('visitor_search_engine');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultIsInternal]);

  const updateVisitorEngine = useCallback((id: string) => {
    setVisitorEngineId(id);
    setIsInternal(id === 'internal');
  }, []);

  const defaultEngineId = searchConfig?.defaultEngine || 'internal';
  const currentEngineId = visitorEngineId || defaultEngineId;

  const searchMode = searchConfig?.mode || 'internal';
  const externalSources = searchConfig?.externalSources?.length > 0 
    ? searchConfig.externalSources 
    : DEFAULT_SEARCH_SOURCES;
  const selectedSource = searchConfig?.selectedSource || null;
  const customEngineUrl = searchConfig?.customEngineUrl || '';

  const setSearchMode = useCallback((mode: SearchMode) => {
    setSearch({ ...searchConfig, mode, externalSources, selectedSource });
  }, [searchConfig, externalSources, selectedSource, setSearch]);

  const setSelectedSource = useCallback((source: ExternalSearchSource | null) => {
    setSearch({ ...searchConfig, mode: searchMode, externalSources, selectedSource: source });
  }, [searchConfig, searchMode, externalSources, setSearch]);

  const updateExternalSources = useCallback((sources: ExternalSearchSource[]) => {
    setSearch({ ...searchConfig, mode: searchMode, externalSources: sources, selectedSource });
  }, [searchConfig, searchMode, selectedSource, setSearch]);

  // Filtered links for internal search
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !isInternal) return [];
    const q = searchQuery.toLowerCase();
    
    // 创建分类权重映射
    const categoryWeightMap = new Map(categories.map(c => [c.id, c.weight || 0]));

    return links
      .filter(l =>
        l.title.toLowerCase().includes(q) ||
        l.url.toLowerCase().includes(q) ||
        (l.description?.toLowerCase().includes(q) ?? false)
      )
      .sort((a, b) => {
        // 1. 置顶链接排在最前面
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        
        // 2. 如果都是置顶，按置顶顺序排序
        if (a.pinned && b.pinned) {
          return (a.pinnedOrder || 0) - (b.pinnedOrder || 0);
        }

        // 3. 非置顶链接，按所属分类的权重排序（小的排前面）
        const wa = categoryWeightMap.get(a.categoryId) || 0;
        const wb = categoryWeightMap.get(b.categoryId) || 0;
        if (wa !== wb) return wa - wb;

        // 4. 同分类权重下，按链接自身的顺序排序
        return (a.order || 0) - (b.order || 0);
      });
  }, [links, categories, searchQuery, isInternal]);

  // Execute search
  const handleSearch = useCallback((query: string) => {
    if (!query.trim()) return;
    
    if (!isInternal) {
      let searchUrl = '';
      let engineId = currentEngineId;
      if (engineId === 'internal') {
        engineId = 'google';
      }
      if (engineId === 'custom' && customEngineUrl) {
        searchUrl = customEngineUrl + encodeURIComponent(query);
      } else {
        const engine = SEARCH_ENGINES.find(e => e.id === engineId);
        if (engine && engine.url) {
          searchUrl = engine.url + encodeURIComponent(query);
        }
      }
      if (searchUrl) window.open(searchUrl, '_blank');
    }
    setSearchQuery(query);
  }, [isInternal, currentEngineId, customEngineUrl]);

  return {
    searchQuery, setSearchQuery,
    searchMode, setSearchMode,
    externalSources, updateExternalSources,
    selectedSource, setSelectedSource,
    searchResults,
    handleSearch,
    isMobileSearchOpen, setIsMobileSearchOpen,
    isSearchExpanded, setIsSearchExpanded,
    isInternal, setIsInternal,
    visitorEngineId: currentEngineId,
    setVisitorEngineId: updateVisitorEngine,
  };
}
