import React, { useState, useEffect, Suspense, lazy, useCallback, useRef } from 'react';
import { FolderInput, Pin, PinOff, Copy, CheckSquare, Trash2, X, ChevronDown } from 'lucide-react';
import { useAuthContext } from '../../contexts/AuthContext';
import { useLinksContext } from '../../contexts/LinksContext';
import { useCategoriesContext } from '../../contexts/CategoriesContext';
import { useConfigContext } from '../../contexts/ConfigContext';
import { useSearch } from '../../hooks/useSearch';
import { useDataSync } from '../../hooks/useDataSync';
import { scrollToCategory } from '../../utils/scrollToCategory';
import { normalizeUrlForDedup } from '../../utils/urlDuplicate';
import { toast } from '../../../components/Toast';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { MainContent } from './MainContent';
import { LinkItem, Category } from '../../../types';
import AuthModal from '../../../components/AuthModal';

const LinkModal = lazy(() => import('../../../components/LinkModal'));
const CategoryManagerModal = lazy(() => import('../../../components/CategoryManagerModal'));
const BackupModal = lazy(() => import('../../../components/BackupModal'));
const CategoryAuthModal = lazy(() => import('../../../components/CategoryAuthModal'));
const ImportModal = lazy(() => import('../../../components/ImportModal'));
const SettingsModal = lazy(() => import('../../../components/SettingsModal'));
const SearchConfigModal = lazy(() => import('../../../components/SearchConfigModal'));
const ContextMenu = lazy(() => import('../../../components/ContextMenu'));
const QRCodeModal = lazy(() => import('../../../components/QRCodeModal'));

export function AppLayout() {
  const { authToken, requiresAuth, isCheckingAuth, capabilities, login, logout, totpEnabled } = useAuthContext();
  const { links = [], addLink, updateLink, deleteLink, deleteLinks, updateLinks, setLinksAndSync } = useLinksContext();
  const { categories = [], categoryTree = [], setCategoriesAndSync, unlockedCategoryIds, unlockCategory } = useCategoriesContext();
  const { ai: aiConfig, icon: iconConfig, viewMode, showPinnedWebsites, ticker, weather, website, webdav, search, setAI, setIcon, setWebsite, setShowPinned, setMastodon, setWeather, setWebDav, setSearch, setViewMode, setSubcategoryLayout } = useConfigContext();

  const {
    searchQuery, setSearchQuery, searchResults, isMobileSearchOpen, setIsMobileSearchOpen,
    isSearchExpanded, setIsSearchExpanded,
    isInternal, setIsInternal, handleSearch, visitorEngineId, setVisitorEngineId
  } = useSearch();
  const { initData } = useDataSync();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  const [isDragSortMode, setIsDragSortMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCatManagerOpen, setIsCatManagerOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isSearchConfigModalOpen, setIsSearchConfigModalOpen] = useState(false);
  const [catAuthModalData, setCatAuthModalData] = useState<Category | null>(null);

  const [editingLink, setEditingLink] = useState<LinkItem | undefined>(undefined);
  const [prefillLink, setPrefillLink] = useState<Partial<LinkItem> | undefined>(undefined);

  const [isBatchEditMode, setIsBatchEditMode] = useState(false);
  const [selectedLinks, setSelectedLinks] = useState<Set<string>>(new Set());
  const [isMoveDropdownOpen, setIsMoveDropdownOpen] = useState(false);

  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    link: LinkItem | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, link: null });

  const [qrCodeModal, setQrCodeModal] = useState<{
    isOpen: boolean; url: string; title: string;
  }>({ isOpen: false, url: '', title: '' });

  const [pendingDragLinks, setPendingDragLinks] = useState<{ links: LinkItem[]; categories: Category[] } | null>(null);

  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragState = useRef({
    startX: 0, startY: 0, currentX: 0, startTime: 0, sidebarWasOpen: false, isActive: false,
  });
  const SIDEBAR_WIDTH = 256;
  const EDGE_THRESHOLD = 30;
  const OPEN_THRESHOLD = 80;
  const CLOSE_THRESHOLD = 80;

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const isEdge = touch.clientX < EDGE_THRESHOLD;
    const isInSidebar = sidebarOpen && touch.clientX < SIDEBAR_WIDTH;
    if (!isEdge && !isInSidebar) return;
    dragState.current = {
      startX: touch.clientX, startY: touch.clientY, currentX: touch.clientX,
      startTime: Date.now(), sidebarWasOpen: sidebarOpen, isActive: true,
    };
    setIsDragging(true);
    setDragOffset(0);
  }, [sidebarOpen]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const state = dragState.current;
    if (!state.isActive || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - state.startX;
    const deltaY = touch.clientY - state.startY;
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
      state.isActive = false; setIsDragging(false); setDragOffset(0); return;
    }
    if (Math.abs(deltaX) < 5) return;
    state.currentX = touch.clientX;
    if (state.sidebarWasOpen) {
      setDragOffset(Math.max(-SIDEBAR_WIDTH, Math.min(0, deltaX)));
    } else {
      setDragOffset(Math.max(0, Math.min(SIDEBAR_WIDTH, deltaX)));
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    const state = dragState.current;
    if (!state.isActive) return;
    state.isActive = false;
    const deltaX = state.currentX - state.startX;
    const elapsed = Date.now() - state.startTime;
    const velocity = Math.abs(deltaX) / (elapsed || 1);
    setIsDragging(false);
    if (state.sidebarWasOpen) {
      if (deltaX < -CLOSE_THRESHOLD || (deltaX < -20 && velocity > 0.5)) setSidebarOpen(false);
    } else {
      if (deltaX > OPEN_THRESHOLD || (deltaX > 20 && velocity > 0.5)) setSidebarOpen(true);
    }
    setDragOffset(0);
  }, []);

  useEffect(() => {
    const isMobile = window.innerWidth < 1024;
    if (!isMobile) return;
    document.addEventListener('touchstart', handleTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true, capture: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', handleTouchEnd, { passive: true, capture: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchEnd, true);
      document.removeEventListener('touchcancel', handleTouchEnd, true);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  useEffect(() => {
    const init = async () => {
      await initData(unlockedCategoryIds);
      setIsInitialLoading(false);
    };
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInput = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' || (activeElement as HTMLElement)?.isContentEditable;
      if (isInput) return;
      if (e.key === 'Escape') {
        if (isSearchExpanded) { setIsSearchExpanded(false); setSearchQuery(''); document.getElementById('search-input')?.blur(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1 && e.key !== 'Process') return;
      if (isModalOpen || isAuthOpen || isCatManagerOpen || isBackupModalOpen || isImportModalOpen || isSettingsModalOpen || isSearchConfigModalOpen || isEditMode || isBatchEditMode || isDragSortMode) return;
      if (!isSearchExpanded && !isMobileSearchOpen) setIsSearchExpanded(true);
      if (e.key !== 'Process') { setSearchQuery(prev => prev + e.key); e.preventDefault(); }
      setTimeout(() => document.getElementById('search-input')?.focus(), 0);
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    init();
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [initData, unlockedCategoryIds]);

  useEffect(() => {
    if (aiConfig) {
       const title = aiConfig.websiteTitle || 'F-Nav';
       document.title = title;
 
      // 同步更新分享到社交平台时的标题（og:title / twitter:title）
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) ogTitle.setAttribute('content', title);
      const twitterTitle = document.querySelector('meta[name="twitter:title"]');
      if (twitterTitle) twitterTitle.setAttribute('content', title);
 
      let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
      link.href = aiConfig.faviconUrl || '/favicon.ico';
    }
  }, [aiConfig?.websiteTitle, aiConfig?.faviconUrl]);

  useEffect(() => { if (authToken) setIsAuthOpen(false); }, [authToken]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const addUrl = urlParams.get('add_url');
    if (addUrl) {
      window.history.replaceState({}, '', window.location.pathname);
      setPrefillLink({ title: urlParams.get('add_title') || '', url: addUrl, categoryId: 'common' });
      setEditingLink(undefined);
      setIsModalOpen(true);
    }
  }, []);

  const handleAddLink = useCallback(() => {
    setEditingLink(undefined); setPrefillLink(undefined); setIsModalOpen(true);
  }, []);

  const handleEditLink = useCallback((link: LinkItem) => {
    setEditingLink(link); setPrefillLink(undefined); setIsModalOpen(true);
  }, []);

  const handleDeleteLink = useCallback((id: string) => {
    if (!confirm('确定删除此链接吗？')) return;
    const linkToDelete = links.find(l => l.id === id);
    if (linkToDelete) {
      // Cleanup icon storage...
      if (linkToDelete.edgeoneBlobUrl?.startsWith('/api/favicon?key=')) {
        try { const u = new URL(linkToDelete.edgeoneBlobUrl, window.location.origin); const key = u.searchParams.get('key');
          if (key) fetch(`/api/upload?key=${encodeURIComponent(key)}&platform=edgeone`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken || ''}` } }).catch(()=>{});
        } catch(e){}
      }
      if (linkToDelete.cloudflareR2Url?.startsWith('/api/favicon?key=')) {
        try { const u = new URL(linkToDelete.cloudflareR2Url, window.location.origin); const key = u.searchParams.get('key');
          if (key) fetch(`/api/upload?key=${encodeURIComponent(key)}&platform=cloudflare`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${authToken || ''}` } }).catch(()=>{});
        } catch(e){}
      }
    }
    const deletedTitle = linkToDelete?.title || '书签';
    const newLinks = links.filter(l => l.id !== id);
    setLinksAndSync(newLinks, categories);
    toast.success(`「${deletedTitle}」删除成功`);
  }, [links, categories, setLinksAndSync, authToken]);

  const toggleLinkSelection = useCallback((id: string) => {
    setSelectedLinks(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }, []);

  const toggleBatchEditMode = useCallback(() => {
    setIsBatchEditMode(prev => !prev); setSelectedLinks(new Set());
  }, []);

  // ===== 修复：确保保存时 id 有效，且使用最新的 links 状态 =====
  // keepOpen: 批量添加模式下保持弹窗打开
  const handleSaveLink = useCallback((link: LinkItem, keepOpen?: boolean) => {
    // 确保 id 有效，如果无效则生成新 id
    const validLink = {
      ...link,
      id: link.id && link.id.trim() !== '' ? link.id : `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    };

    // [新增] 重复书签校验：相同规范化 URL 不允许重复添加（编辑时排除自身）
    const normalizedUrl = normalizeUrlForDedup(validLink.url);
    const duplicate = links.find(l =>
      l.id !== validLink.id && normalizeUrlForDedup(l.url) === normalizedUrl
    );
    if (duplicate) {
      toast.error(`链接已存在：「${duplicate.title}」(${duplicate.url})`);
      return; // 不保存，弹窗保持打开让用户修改
    }

    if (editingLink) {
      // 编辑现有链接：使用函数式更新避免 stale closure
      setLinksAndSync(
        links.map(l => l.id === validLink.id ? validLink : l),
        categories
      );
      toast.success(`「${validLink.title}」更新成功`);
    } else {
      // 新建链接
      setLinksAndSync([...links, validLink], categories);
      toast.success(`「${validLink.title}」创建成功`);
    }
    if (!keepOpen) {
      setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined);
    }
  }, [editingLink, links, categories, setLinksAndSync]);

  const handleContextMenu = useCallback((e: React.MouseEvent, link: LinkItem) => {
    if (isBatchEditMode || !authToken) return;
    e.preventDefault(); e.stopPropagation();
    setContextMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, link });
  }, [isBatchEditMode, authToken]);

  const handleBatchDelete = useCallback(() => {
    if (!confirm(`确定删除选中的 ${selectedLinks.size} 个链接吗？`)) return;
    const newLinks = links.filter(l => !selectedLinks.has(l.id));
    setLinksAndSync(newLinks, categories);
    setSelectedLinks(new Set()); setIsBatchEditMode(false);
    toast.success(`已批量删除 ${selectedLinks.size} 个书签`);
  }, [selectedLinks, links, categories, setLinksAndSync]);

  // 批量移动到指定分类
  const handleBatchMove = useCallback((targetCategoryId: string) => {
    if (!targetCategoryId) return;
    const updated = links.map(l => selectedLinks.has(l.id) ? { ...l, categoryId: targetCategoryId } : l);
    setLinksAndSync(updated, categories);
    toast.success(`已将 ${selectedLinks.size} 个链接移动到指定分类`);
    setSelectedLinks(new Set()); setIsBatchEditMode(false);
  }, [selectedLinks, links, categories, setLinksAndSync]);

  // 批量置顶 / 取消置顶（若全部已置顶则取消，否则全部置顶）
  const handleBatchPin = useCallback(() => {
    const selectedLinkObjs = links.filter(l => selectedLinks.has(l.id));
    const allPinned = selectedLinkObjs.length > 0 && selectedLinkObjs.every(l => l.pinned);
    const updated = links.map(l => selectedLinks.has(l.id) ? { ...l, pinned: !allPinned } : l);
    setLinksAndSync(updated, categories);
    toast.success(allPinned ? `已取消 ${selectedLinks.size} 个链接的置顶` : `已置顶 ${selectedLinks.size} 个链接`);
  }, [selectedLinks, links, categories, setLinksAndSync]);

  // 批量复制链接地址到剪贴板
  const handleBatchCopy = useCallback(() => {
    const urls = links.filter(l => selectedLinks.has(l.id)).map(l => l.url).join('\n');
    navigator.clipboard.writeText(urls).then(() => {
      toast.success(`已复制 ${selectedLinks.size} 个链接地址到剪贴板`);
    }).catch(() => {
      toast.error('复制失败，请重试');
    });
  }, [selectedLinks, links]);

  // 全选 / 取消全选
  const handleSelectAll = useCallback(() => {
    if (selectedLinks.size === links.length && links.length > 0) {
      setSelectedLinks(new Set());
    } else {
      setSelectedLinks(new Set(links.map(l => l.id)));
    }
  }, [selectedLinks, links]);

  const handleWeightChange = useCallback((linkId: string, weight: number) => {
    const updated = links.map(l => l.id === linkId ? { ...l, weight } : l);
    setLinksAndSync(updated, categories);
  }, [links, categories, setLinksAndSync]);

  const toggleDragSortMode = useCallback(() => setIsDragSortMode(prev => !prev), []);
  const toggleEditMode = useCallback(() => setIsEditMode(prev => !prev), []);

  const handleUnlockCategory = useCallback((cat: Category) => {
    if (cat.hasPassword && !unlockedCategoryIds.has(cat.id)) setCatAuthModalData(cat);
    else scrollToCategory(cat.id);
  }, [unlockedCategoryIds]);

  const handleCategoryUnlock = useCallback((id: string) => {
    unlockCategory(id); setCatAuthModalData(null);
    const newUnlocked = new Set([...unlockedCategoryIds, id]);
    initData(newUnlocked);
  }, [unlockCategory, unlockedCategoryIds, initData]);

  if (isInitialLoading) {
    return (
      <div className="flex h-[100dvh] bg-slate-50 dark:bg-slate-900 flex-col items-center justify-center gap-4 text-slate-900 dark:text-slate-50">
        <div className="w-10 h-10 border-4 border-slate-200 dark:border-slate-700 border-t-blue-500 rounded-full animate-spin" />
        <div className="text-lg font-bold tracking-wider text-slate-700 dark:text-slate-300">Nav</div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] bg-slate-50 dark:bg-slate-900 overflow-hidden text-slate-900 dark:text-slate-50">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} activeCategoryId={activeCategoryId} onOpenCatManager={() => setIsCatManagerOpen(true)} onOpenBackup={() => setIsBackupModalOpen(true)} onUnlockCategory={handleUnlockCategory} dragOffset={dragOffset} isDragging={isDragging} />
      <div className="flex-1 flex flex-col min-w-0">
        <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} isInternal={isInternal} onInternalChange={setIsInternal} onSearch={handleSearch} onAddLink={handleAddLink} onOpenSettings={() => setIsSettingsModalOpen(true)} onOpenCatManager={() => setIsCatManagerOpen(true)} onOpenBackup={() => setIsBackupModalOpen(true)} onOpenImport={() => setIsImportModalOpen(true)} onOpenAuth={() => setIsAuthOpen(true)} onToggleSidebar={() => setSidebarOpen(prev => !prev)} isBatchEditMode={isBatchEditMode} onToggleBatchEditMode={toggleBatchEditMode} isMobileSearchOpen={isMobileSearchOpen} onToggleMobileSearch={() => setIsMobileSearchOpen(prev => !prev)} isSearchExpanded={isSearchExpanded} setIsSearchExpanded={setIsSearchExpanded} isDragSortMode={isDragSortMode} onToggleDragSortMode={toggleDragSortMode} isEditMode={isEditMode} onToggleEditMode={toggleEditMode} visitorEngineId={visitorEngineId} onVisitorEngineChange={setVisitorEngineId} />
        <MainContent searchQuery={searchQuery} searchResults={searchResults} isBatchEditMode={isBatchEditMode} selectedLinks={selectedLinks} onToggleSelection={toggleLinkSelection} onEditLink={handleEditLink} onDeleteLink={handleDeleteLink} onContextMenu={handleContextMenu} isDragSortMode={isDragSortMode} isEditMode={isEditMode} onWeightChange={handleWeightChange} isInternal={isInternal} />
      </div>
      <AuthModal isOpen={isAuthOpen} onLogin={login} onClose={() => setIsAuthOpen(false)} totpEnabled={totpEnabled} />
      <Suspense fallback={null}>
        {isModalOpen && <LinkModal isOpen={isModalOpen} onClose={() => { setIsModalOpen(false); setEditingLink(undefined); setPrefillLink(undefined); }} onSave={handleSaveLink} onDelete={editingLink ? () => handleDeleteLink(editingLink.id) : undefined} categories={categories} initialData={editingLink || prefillLink as LinkItem} aiConfig={aiConfig} defaultCategoryId={undefined} iconConfig={iconConfig} supportsUpload={capabilities?.upload ?? true} />}
        {isCatManagerOpen && <CategoryManagerModal isOpen={isCatManagerOpen} onClose={() => setIsCatManagerOpen(false)} categories={categories} links={links} onUpdateCategories={(newCats) => setCategoriesAndSync(newCats, links)} onDeleteCategory={(id) => { const newCats = categories.filter(c => c.id !== id); setCategoriesAndSync(newCats, links); }} onUpdateLinks={(newLinks) => setLinksAndSync(newLinks, categories)} onSaveCategories={(newCats, newLinks) => { updateLinks(newLinks); setCategoriesAndSync(newCats, newLinks); }} />}
        {isBackupModalOpen && <BackupModal isOpen={isBackupModalOpen} onClose={() => setIsBackupModalOpen(false)} links={links} categories={categories} onRestore={(newLinks, newCats) => setLinksAndSync(newLinks, newCats)} webDavConfig={webdav || { url: '', username: '', password: '', enabled: false }} onSaveWebDavConfig={setWebDav} searchConfig={search || { mode: 'internal', externalSources: [] }} onRestoreSearchConfig={setSearch} aiConfig={aiConfig} onRestoreAIConfig={setAI} />}
        {isImportModalOpen && <ImportModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} existingLinks={links} categories={categories} onImport={(newLinks, newCats) => setLinksAndSync(newLinks, newCats)} />}
        {isSettingsModalOpen && <SettingsModal isOpen={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} authToken={authToken} onSettingsLoaded={(settings) => { setAI(settings.ai); setWebsite({ ...website, passwordExpiry: settings.passwordExpiry }); setMastodon(settings.ticker); setWeather(settings.weather); setShowPinned(settings.showPinnedWebsites); if (settings.defaultViewMode) setViewMode(settings.defaultViewMode); if (settings.subcategoryLayout) setSubcategoryLayout(settings.subcategoryLayout); }} onImportClick={() => { setIsSettingsModalOpen(false); setIsImportModalOpen(true); }} onBackupClick={() => { setIsSettingsModalOpen(false); setIsBackupModalOpen(true); }} />}
        {isSearchConfigModalOpen && <SearchConfigModal isOpen={isSearchConfigModalOpen} onClose={() => setIsSearchConfigModalOpen(false)} />}
        {contextMenu.isOpen && contextMenu.link && (
          <ContextMenu isOpen={contextMenu.isOpen} position={contextMenu.position} link={contextMenu.link} onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))} onCopyLink={() => { navigator.clipboard.writeText(contextMenu.link!.url); setContextMenu(prev => ({ ...prev, isOpen: false })); }} onShowQRCode={(url, title) => { setQrCodeModal({ isOpen: true, url, title }); setContextMenu(prev => ({ ...prev, isOpen: false })); }} onEdit={() => { setEditingLink(contextMenu.link!); setIsModalOpen(true); setContextMenu(prev => ({ ...prev, isOpen: false })); }} onDelete={() => { handleDeleteLink(contextMenu.link!.id); setContextMenu(prev => ({ ...prev, isOpen: false })); }} onTogglePin={() => {
            const targetLink = contextMenu.link!;
            const newPinned = !targetLink.pinned;
            setLinksAndSync(
              links.map(l => l.id === targetLink.id ? { ...l, pinned: newPinned } : l),
              categories
            );
            setContextMenu(prev => ({ ...prev, isOpen: false }));
            toast.success(newPinned ? `「${targetLink.title}」已置顶` : `「${targetLink.title}」已取消置顶`);
          }} />
        )}
        {qrCodeModal.isOpen && <QRCodeModal isOpen={qrCodeModal.isOpen} url={qrCodeModal.url} title={qrCodeModal.title} onClose={() => setQrCodeModal({ isOpen: false, url: '', title: '' })} />}
      </Suspense>
      {catAuthModalData && <CategoryAuthModal isOpen={!!catAuthModalData} category={catAuthModalData} onClose={() => setCatAuthModalData(null)} onUnlock={handleCategoryUnlock} />}
      {isBatchEditMode && (() => {
        const allPinned = selectedLinks.size > 0 && links.filter(l => selectedLinks.has(l.id)).every(l => l.pinned);
        const isAllSelected = selectedLinks.size === links.length && links.length > 0;
        const cancelBatch = () => { setSelectedLinks(new Set()); setIsBatchEditMode(false); };
        const hasSelection = selectedLinks.size > 0;
        return (
        <>
          {/* ===== 移动端布局 ===== */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50">
            <div className="flex flex-col gap-2 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl rounded-t-2xl border-t border-slate-200/60 dark:border-slate-700/60 shadow-[0_-4px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.3)]">
              {/* 第一行：计数 + 全选 + 置顶 + 取消 */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap ${hasSelection ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
                  {hasSelection ? (
                    <><span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-blue-500 text-white text-xs font-bold">{selectedLinks.size}</span> 已选中</>
                  ) : (
                    <><CheckSquare size={16} /> 批量编辑</>
                  )}
                </div>
                <button onClick={handleSelectAll} disabled={links.length === 0} className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
                  <CheckSquare size={16} /> {isAllSelected ? '取消全选' : '全选'}
                </button>
                {hasSelection && (
                  <button onClick={handleBatchPin} className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800/50 transition-all active:scale-95 whitespace-nowrap">
                    {allPinned ? <PinOff size={16} /> : <Pin size={16} />} {allPinned ? '取消置顶' : '置顶'}
                  </button>
                )}
                <button onClick={cancelBatch} className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl transition-all active:scale-95 whitespace-nowrap bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                  <X size={16} /> 取消
                </button>
              </div>
              {/* 选中后：移动分类（全宽）+ 复制/删除（两列） */}
              {hasSelection && (
                <>
                  <div className="h-px bg-slate-200 dark:bg-slate-700" />
                  <div className="relative">
                    <button
                      onClick={() => setIsMoveDropdownOpen(!isMoveDropdownOpen)}
                      className="relative w-full flex items-center justify-center py-2.5 text-sm font-medium rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/40 focus:ring-2 focus:ring-indigo-400/40 outline-none transition-all active:scale-95 whitespace-nowrap"
                    >
                      <FolderInput size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-500 dark:text-indigo-400 pointer-events-none" />
                      <span>移动分类</span>
                      <ChevronDown size={14} className={`absolute right-3 top-1/2 -translate-y-1/2 transition-transform ${isMoveDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isMoveDropdownOpen && (
                      <>
                        <div className="fixed inset-0" onClick={() => setIsMoveDropdownOpen(false)} />
                        <div className="absolute bottom-full left-0 right-0 mb-2 max-h-60 overflow-y-auto p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl">
                          {categoryTree.map(parent => (
                            <div key={parent.id} className="mb-1 last:mb-0">
                              <div className="px-2 py-1 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{parent.name}</div>
                              <button onClick={() => { handleBatchMove(parent.id); setIsMoveDropdownOpen(false); }} className="w-full flex items-center px-3 py-2 text-sm rounded-lg text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer transition-colors">
                                {parent.name}
                              </button>
                              {parent.children?.map(child => (
                                <button key={child.id} onClick={() => { handleBatchMove(child.id); setIsMoveDropdownOpen(false); }} className="w-full flex items-center pl-6 pr-3 py-2 text-sm rounded-lg text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer transition-colors">
                                  └ {child.name}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={handleBatchCopy} className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800/50 transition-all active:scale-95 whitespace-nowrap">
                      <Copy size={16} /> 复制链接
                    </button>
                    <button onClick={handleBatchDelete} className="flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium rounded-xl bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white shadow-sm shadow-red-500/30 transition-all active:scale-95 whitespace-nowrap">
                      <Trash2 size={16} /> 删除选中
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          {/* ===== PC 端布局 ===== */}
          <div className="hidden lg:flex fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl rounded-2xl border border-slate-200/60 dark:border-slate-700/60 shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium whitespace-nowrap ${hasSelection ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300' : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500'}`}>
                {hasSelection ? (
                  <><span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-blue-500 text-white text-xs font-bold">{selectedLinks.size}</span> 已选中</>
                ) : (
                  <><CheckSquare size={16} /> 批量编辑</>
                )}
              </div>
              <button onClick={handleSelectAll} disabled={links.length === 0} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
                <CheckSquare size={16} /> {isAllSelected ? '取消全选' : '全选'}
              </button>
              {hasSelection && (
                <>
                  <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />
                  <button onClick={handleBatchPin} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/40 border border-amber-200 dark:border-amber-800/50 transition-all active:scale-95 whitespace-nowrap">
                    {allPinned ? <PinOff size={16} /> : <Pin size={16} />} {allPinned ? '取消置顶' : '置顶'}
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setIsMoveDropdownOpen(!isMoveDropdownOpen)}
                      className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl border border-indigo-200 dark:border-indigo-800/50 bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/40 focus:ring-2 focus:ring-indigo-400/40 outline-none transition-all active:scale-95 whitespace-nowrap"
                    >
                      <FolderInput size={16} /> 移动分类 <ChevronDown size={14} className={`transition-transform ${isMoveDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isMoveDropdownOpen && (
                      <>
                        <div className="fixed inset-0" onClick={() => setIsMoveDropdownOpen(false)} />
                        <div className="absolute bottom-full left-0 min-w-48 mb-2 max-h-60 overflow-y-auto p-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl">
                          {categoryTree.map(parent => (
                            <div key={parent.id} className="mb-1 last:mb-0">
                              <div className="px-2 py-1 text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{parent.name}</div>
                              <button onClick={() => { handleBatchMove(parent.id); setIsMoveDropdownOpen(false); }} className="w-full flex items-center px-3 py-2 text-sm rounded-lg text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer transition-colors whitespace-nowrap">
                                {parent.name}
                              </button>
                              {parent.children?.map(child => (
                                <button key={child.id} onClick={() => { handleBatchMove(child.id); setIsMoveDropdownOpen(false); }} className="w-full flex items-center pl-6 pr-3 py-2 text-sm rounded-lg text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:text-indigo-600 dark:hover:text-indigo-300 cursor-pointer transition-colors whitespace-nowrap">
                                  └ {child.name}
                                </button>
                              ))}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button onClick={handleBatchCopy} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800/50 transition-all active:scale-95 whitespace-nowrap">
                    <Copy size={16} /> 复制链接
                  </button>
                  <button onClick={handleBatchDelete} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-700 text-white shadow-sm shadow-red-500/30 transition-all active:scale-95 whitespace-nowrap">
                    <Trash2 size={16} /> 删除选中
                  </button>
                </>
              )}
              {hasSelection && <div className="w-px h-6 bg-slate-200 dark:bg-slate-700" />}
              <button onClick={cancelBatch} className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl transition-all active:scale-95 whitespace-nowrap bg-slate-100 dark:bg-slate-700/60 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
                <X size={16} /> 取消
              </button>
            </div>
          </div>
        </>
        );
      })()}
    </div>
  );
}
