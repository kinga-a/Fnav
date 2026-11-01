import React, { useLayoutEffect, useRef, useState, useEffect, useMemo } from 'react';
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable';
import { LinkItem, Category } from '../../../types';
import { CategoryWithChildren } from '../../contexts/CategoriesContext';
import { LinkCard } from '../link/LinkCard';

interface CategorySectionProps {
  category: CategoryWithChildren;
  links: LinkItem[];
  subcategoryLinks: LinkItem[];
  viewMode: 'compact' | 'detailed';
  isBatchEditMode: boolean;
  selectedLinks: Set<string>;
  onToggleSelection: (id: string) => void;
  onEditLink: (link: LinkItem) => void;
  onDeleteLink: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, link: LinkItem) => void;
  authToken?: string | null;
  isDraggable?: boolean;
  isEditMode?: boolean;
  onWeightChange?: (linkId: string, weight: number) => void;
}

export function CategorySection({
  category, links, subcategoryLinks, viewMode,
  isBatchEditMode, selectedLinks, onToggleSelection,
  onEditLink, onDeleteLink, onContextMenu,
  authToken, isDraggable = false, isEditMode = false, onWeightChange,
}: CategorySectionProps) {
  const allLinks = [...links, ...subcategoryLinks];

  // 按需渲染：区块滚动接近视口（提前 1000px）才挂载卡片内容，挂载后整体完整渲染；
  // root 取最近的 <main>（内部滚动容器），避免 content-visibility 基于视口判断不准的边缘缺失
  const [inView, setInView] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  // 预渲染提前量：高度替换发生在视口外 1000px 处，滚动到时内容早已稳定，无跳变
  const PRERENDER_MARGIN = 1000;

  // ===== 子分类横向标签页切换 =====
  // 只保留有链接的子分类，作为标签项
  const subcategoryTabs = useMemo(() => {
    if (!category.children) return [];
    return category.children
      .map(child => {
        const childLinks = subcategoryLinks.filter(l => l.categoryId === child.id);
        return { child, childLinks };
      })
      .filter(({ childLinks }) => childLinks.length > 0);
  }, [category.children, subcategoryLinks]);

  // 当前激活的子分类标签（默认第一个）
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(null);
  useEffect(() => {
    if (subcategoryTabs.length > 0 && !subcategoryTabs.some(({ child }) => child.id === activeSubcategory)) {
      setActiveSubcategory(subcategoryTabs[0].child.id);
    }
  }, [subcategoryTabs, activeSubcategory]);

  // 监听侧边栏点击子分类时派发的自定义事件，同步激活对应标签
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as string;
      if (subcategoryTabs.some(({ child }) => child.id === detail)) {
        setActiveSubcategory(detail);
      }
    };
    window.addEventListener('fnav:subcategory-focus', handler);
    return () => window.removeEventListener('fnav:subcategory-focus', handler);
  }, [subcategoryTabs]);

  // 判断元素是否在 root（main 滚动容器）视口附近（含 margin 提前量）
  const isNearViewport = (el: Element, root: Element | null, margin = PRERENDER_MARGIN): boolean => {
    const er = el.getBoundingClientRect();
    const rr = root ? root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    return er.bottom >= rr.top - margin && er.top <= rr.bottom + margin;
  };

  // useLayoutEffect：浏览器绘制前同步判断——首屏/接近视口的分类直接激活，
  // 首帧即渲染完整内容，避免"占位高度 → 真实高度"造成的刷新跳动
  useLayoutEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const rootEl = el.closest('main');
    if (isNearViewport(el, rootEl, PRERENDER_MARGIN)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { root: rootEl, rootMargin: `${PRERENDER_MARGIN}px 0px` }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (allLinks.length === 0) return null;

  const gridClass = viewMode === 'detailed'
    ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
    : 'grid-cols-[repeat(auto-fill,80px)]';

  return (
    <section ref={sectionRef} id={`cat-${category.id}`} className="mb-8 scroll-mt-20">
      {inView ? (
        <>
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2 mb-4">
            <span>{category.name}</span>
            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 rounded-full">
              {allLinks.length}
            </span>
          </h2>

          {/* Category's own links - no DndContext here, handled by parent */}
          {links.length > 0 && (
            <SortableContext items={links.map(l => l.id)} strategy={rectSortingStrategy}>
              <div className={`grid gap-3 ${gridClass}`}>
                {links.map(link => (
                  <LinkCard
                    key={link.id}
                    link={link}
                    viewMode={viewMode}
                    isBatchEditMode={isBatchEditMode}
                    isSelected={selectedLinks.has(link.id)}
                    onToggleSelection={onToggleSelection}
                    onEdit={onEditLink}
                    onDelete={onDeleteLink}
                    onContextMenu={onContextMenu}
                    authToken={authToken}
                    isDraggable={isDraggable}
                    isEditMode={isEditMode}
                    onWeightChange={onWeightChange}
                  />
                ))}
              </div>
            </SortableContext>
          )}

          {/* Subcategory links - 横向标签页切换 */}
          {subcategoryTabs.length > 0 && (
            <div className="mt-6">
              {/* 标签栏：子分类名横排，点击切换显示对应卡片 */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                {subcategoryTabs.map(({ child, childLinks }) => {
                  const isActive = activeSubcategory === child.id;
                  return (
                    <button
                      key={child.id}
                      id={`cat-${child.id}`}
                      onClick={() => setActiveSubcategory(child.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all scroll-mt-20 cursor-pointer ${
                        isActive
                          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                    >
                      <span>{child.name}</span>
                      <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                        isActive
                          ? 'bg-blue-200 dark:bg-blue-800 text-blue-600 dark:text-blue-300'
                          : 'bg-slate-200 dark:bg-slate-600 text-slate-400 dark:text-slate-500'
                      }`}>
                        {childLinks.length}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* 当前激活子分类的卡片 */}
              {subcategoryTabs.map(({ child, childLinks }) => {
                if (activeSubcategory !== child.id) return null;
                return (
                  <SortableContext key={child.id} items={childLinks.map(l => l.id)} strategy={rectSortingStrategy}>
                    <div className={`grid gap-3 ${gridClass}`}>
                      {childLinks.map(link => (
                        <LinkCard
                          key={link.id}
                          link={link}
                          viewMode={viewMode}
                          isBatchEditMode={isBatchEditMode}
                          isSelected={selectedLinks.has(link.id)}
                          onToggleSelection={onToggleSelection}
                          onEdit={onEditLink}
                          onDelete={onDeleteLink}
                          onContextMenu={onContextMenu}
                          authToken={authToken}
                          isDraggable={isDraggable}
                          isEditMode={isEditMode}
                          onWeightChange={onWeightChange}
                        />
                      ))}
                    </div>
                  </SortableContext>
                );
              })}
            </div>
          )}
        </>
      ) : (
        // 未激活时撑高度占位（按视图模式校准，减少滚动条误差），激活后整体替换为完整内容。
        // 占位阶段同时挂上子分类空锚点：保证侧边栏点击二级分类能找到目标，
        // 滚动触发 IO 激活后由 scrollToCategory 校正到精确位置
        <div style={{ minHeight: viewMode === 'detailed' ? 240 : 160 }} aria-hidden="true">
          {category.children?.map(child => (
            <div key={child.id} id={`cat-${child.id}`} />
          ))}
        </div>
      )}
    </section>
  );
}
