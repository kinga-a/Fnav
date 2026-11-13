import React, { useState, useEffect, useRef } from 'react';
import { X, ArrowUp, ArrowDown, Trash2, Edit2, Plus, Check, Lock, Unlock, Palette, Save } from 'lucide-react';
import { toast } from './Toast';
import { Category } from '../types';
import Icon from './Icon';
import IconSelector from './IconSelector';
import CategoryActionAuthModal from './CategoryActionAuthModal';
import { useDialogClose } from '../src/hooks/useDialogClose';
import { useModalA11y } from '../src/hooks/useModalA11y';

interface CategoryManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  links: { id: string; categoryId: string; title: string }[];
  onUpdateCategories: (newCategories: Category[]) => void;
  onDeleteCategory: (id: string) => void;
  onUpdateLinks?: (links: { id: string; categoryId: string; title: string }[]) => void;
  onSaveCategories?: (newCategories: Category[], newLinks: { id: string; categoryId: string; title: string }[]) => void;
  onVerifyPassword?: (password: string) => Promise<boolean>;
}

const CategoryManagerModal: React.FC<CategoryManagerModalProps> = ({
  isOpen,
  onClose,
  categories,
  links,
  onUpdateCategories,
  onDeleteCategory,
  onUpdateLinks,
  onSaveCategories,
  onVerifyPassword
}) => {
  const [localCategories, setLocalCategories] = useState<Category[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editClearPassword, setEditClearPassword] = useState(false);
  const [editIcon, setEditIcon] = useState('');
  const [editParentId, setEditParentId] = useState<string>('');
  const [editWeight, setEditWeight] = useState<number>(0);

  const [newCatName, setNewCatName] = useState('');
  const [newCatPassword, setNewCatPassword] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('Folder');
  const [newCatParentId, setNewCatParentId] = useState<string>('');

  const [isIconSelectorOpen, setIsIconSelectorOpen] = useState(false);
  const [iconSelectorTarget, setIconSelectorTarget] = useState<'edit' | 'new' | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [hasVerifiedPermissions, setHasVerifiedPermissions] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    type: 'edit' | 'delete';
    categoryId: string;
    categoryName: string;
  } | null>(null);

  const migrateIdsRef = useRef<Set<string>>(new Set());

  const { closing, close } = useDialogClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, close, panelRef);

  useEffect(() => {
    if (isOpen) {
      setLocalCategories([...categories]);
      setHasChanges(false);
      setEditingId(null);
    }
  }, [isOpen, categories]);

  if (!isOpen) return null;

  const getTopLevelCategories = () => {
    return localCategories.filter(cat => !cat.isSubcategory && !cat.parentId);
  };

  const getParentOptions = (excludeId?: string) => {
    return localCategories.filter(cat => {
      if (cat.id === excludeId) return false;
      if (cat.isSubcategory || cat.parentId) return false;
      if (excludeId) {
        const isDescendant = (parentId: string, childId: string): boolean => {
          const parent = localCategories.find(c => c.id === parentId);
          if (!parent) return false;
          if (parent.parentId === childId) return true;
          return parent.parentId ? isDescendant(parent.parentId, childId) : false;
        };
        return !isDescendant(cat.id, excludeId);
      }
      return true;
    });
  };

  const markChanged = (newCats: Category[]) => {
    setLocalCategories(newCats);
    setHasChanges(true);
  };

  const handleMove = (categoryId: string, direction: 'up' | 'down') => {
    const cat = localCategories.find(c => c.id === categoryId);
    if (!cat) return;

    const isTopLevel = !cat.isSubcategory && !cat.parentId;
    const siblings = localCategories
      .filter(c => isTopLevel ? (!c.isSubcategory && !c.parentId) : (c.parentId === cat.parentId))
      .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));

    const siblingIndex = siblings.findIndex(c => c.id === cat.id);
    if (direction === 'up' && siblingIndex <= 0) return;
    if (direction === 'down' && siblingIndex >= siblings.length - 1) return;

    const target = direction === 'up' ? siblings[siblingIndex - 1] : siblings[siblingIndex + 1];

    const newCats = localCategories.map(c => {
      if (c.id === cat.id) return { ...c, weight: target.weight ?? 0 };
      if (c.id === target.id) return { ...c, weight: cat.weight ?? 0 };
      return c;
    });
    markChanged(newCats);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const topLevel = localCategories
        .filter(c => !c.isSubcategory && !c.parentId)
        .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));
      const subs = localCategories
        .filter(c => c.isSubcategory || c.parentId)
        .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));

      const sorted: Category[] = [];
      for (const cat of topLevel) {
        sorted.push(cat);
        const children = subs.filter(s => s.parentId === cat.id);
        sorted.push(...children);
      }
      const orphans = subs.filter(s => !topLevel.some(t => t.id === s.parentId));
      sorted.push(...orphans);

      const migrateIds = migrateIdsRef.current;
      const finalLinks = migrateIds.size > 0
        ? links.map(l => migrateIds.has(l.categoryId) ? { ...l, categoryId: 'common' } : l)
        : links;
      migrateIdsRef.current = new Set();

      if (onSaveCategories) {
        onSaveCategories(sorted, finalLinks);
      } else {
        onUpdateCategories(sorted);
      }
      setHasChanges(false);
      toast.success('分类更改已保存');
      close();
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePasswordVerification = async (password: string): Promise<boolean> => {
    if (!onVerifyPassword) return true;
    try {
      return await onVerifyPassword(password);
    } catch (error) {
      console.error('Password verification error:', error);
      return false;
    }
  };

  const handleStartEdit = (cat: Category) => {
    if (!onVerifyPassword || hasVerifiedPermissions) {
      startEdit(cat);
      return;
    }
    setPendingAction({ type: 'edit', categoryId: cat.id, categoryName: cat.name });
    setIsAuthModalOpen(true);
  };

  const collectSelfAndDescendants = (catId: string, list: Category[]): Set<string> => {
    const ids = new Set<string>([catId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of list) {
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
          ids.add(c.id);
          changed = true;
        }
      }
    }
    return ids;
  };

  const handleDeleteClick = (cat: Category) => {
    if (!onVerifyPassword || hasVerifiedPermissions) {
      const idsToRemove = collectSelfAndDescendants(cat.id, localCategories);
      const affectedCount = links.filter(l => idsToRemove.has(l.categoryId)).length;
      const msg = affectedCount > 0
        ? `确定删除"${cat.name}"及其子分类吗？\n其下 ${affectedCount} 个书签将移动到"常用推荐"。`
        : `确定删除"${cat.name}"及其子分类吗？`;
      if (confirm(msg)) {
        const newCats = localCategories.filter(c => !idsToRemove.has(c.id));
        migrateIdsRef.current = new Set([...migrateIdsRef.current, ...idsToRemove]);
        markChanged(newCats);
      }
      return;
    }
    setPendingAction({ type: 'delete', categoryId: cat.id, categoryName: cat.name });
    setIsAuthModalOpen(true);
  };

  const handleAuthSuccess = () => {
    if (!pendingAction) return;
    setHasVerifiedPermissions(true);

    if (pendingAction.type === 'edit') {
      const cat = localCategories.find(c => c.id === pendingAction.categoryId);
      if (cat) startEdit(cat);
    } else if (pendingAction.type === 'delete') {
      const cat = localCategories.find(c => c.id === pendingAction.categoryId);
      if (cat) {
        const idsToRemove = collectSelfAndDescendants(cat.id, localCategories);
        const affectedCount = links.filter(l => idsToRemove.has(l.categoryId)).length;
        const msg = affectedCount > 0
          ? `确定删除"${cat.name}"及其子分类吗？\n其下 ${affectedCount} 个书签将移动到"常用推荐"。`
          : `确定删除"${cat.name}"及其子分类吗？`;
        if (confirm(msg)) {
          migrateIdsRef.current = new Set([...migrateIdsRef.current, ...idsToRemove]);
          markChanged(localCategories.filter(c => !idsToRemove.has(c.id)));
        }
      }
    }
    setPendingAction(null);
  };

  const handleAuthModalClose = () => {
    setIsAuthModalOpen(false);
    setPendingAction(null);
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditPassword(cat.password || '');
    setEditClearPassword(false);
    setEditIcon(cat.icon);
    setEditParentId(cat.parentId || '');
    setEditWeight(cat.weight ?? 0);
  };

  const saveEdit = () => {
    if (!editingId || !editName.trim()) return;
    const newCats = localCategories.map(c => {
      if (c.id === editingId) {
        return {
          ...c,
          name: editName.trim(),
          icon: editIcon,
          password: editClearPassword ? undefined : (editPassword.trim() || undefined),
          hasPassword: editClearPassword ? false : (editPassword.trim() ? true : c.hasPassword),
          clearPassword: editClearPassword,
          parentId: editParentId || undefined,
          isSubcategory: !!editParentId,
          weight: editWeight,
        };
      }
      return c;
    });
    markChanged(newCats);
    toast.success(`已更新分类「${editName.trim()}」`);
    setEditingId(null);
    setEditParentId('');
  };

  const handleAdd = () => {
    if (!newCatName.trim()) return;
    const maxWeight = Math.max(0, ...localCategories.map(c => c.weight ?? 0));
    const newCat: Category = {
      id: Date.now().toString(),
      name: newCatName.trim(),
      icon: newCatIcon,
      password: newCatPassword.trim() || undefined,
      parentId: newCatParentId || undefined,
      isSubcategory: !!newCatParentId,
      weight: maxWeight + 1,
    };
    markChanged([...localCategories, newCat]);
    toast.success(`已添加分类「${newCat.name}」`);
    setNewCatName('');
    setNewCatPassword('');
    setNewCatIcon('Folder');
    setNewCatParentId('');
  };

  const openIconSelector = (target: 'edit' | 'new') => {
    setIconSelectorTarget(target);
    setIsIconSelectorOpen(true);
  };

  const handleIconSelect = (iconName: string) => {
    if (iconSelectorTarget === 'edit') setEditIcon(iconName);
    else if (iconSelectorTarget === 'new') setNewCatIcon(iconName);
  };

  const cancelIconSelector = () => {
    setIsIconSelectorOpen(false);
    setIconSelectorTarget(null);
  };

  return (
    <>
      <div className={`fixed inset-0 z-50 flex items-center justify-center px-4 py-[5dvh] bg-black/50 backdrop-blur-sm ${closing ? 'modal-overlay-out' : 'modal-overlay'}`}>
        <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="category-modal-title" className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 flex flex-col h-full focus:outline-none ${closing ? 'modal-panel-out' : 'modal-panel'}`}>
          <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
            <h3 id="category-modal-title" className="text-lg font-semibold dark:text-white">
              分类管理
              {hasChanges && <span className="ml-2 text-sm text-amber-500">(有未保存的更改)</span>}
            </h3>
            <button onClick={close} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
              <X className="w-5 h-5 dark:text-slate-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-2">
            {(() => {
              const topLevelCategories = localCategories
                .filter(cat => !cat.isSubcategory && !cat.parentId)
                .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));
              const renderCategoryWithChildren = (category: Category, level: number = 0) => {
                const children = localCategories
                .filter(cat => cat.parentId === category.id)
                .sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0));
                const categoryIndex = localCategories.findIndex(c => c.id === category.id);
                const isTopLevel = !category.isSubcategory && !category.parentId;
                const siblings = localCategories.filter(c =>
                  isTopLevel ? (!c.isSubcategory && !c.parentId) : (c.parentId === category.parentId)
                );
                const siblingIndex = siblings.findIndex(c => c.id === category.id);

                return (
                  <React.Fragment key={category.id}>
                    <div className={`flex flex-col p-3 bg-slate-50 dark:bg-slate-700/50 rounded-lg group gap-2 ${level > 0 ? 'ml-6' : ''}`}>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col gap-1 mr-2">
                          <button
                            onClick={() => handleMove(category.id, 'up')}
                            disabled={siblingIndex === 0}
                            className="p-0.5 text-slate-400 hover:text-blue-500 disabled:opacity-30"
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            onClick={() => handleMove(category.id, 'down')}
                            disabled={siblingIndex === siblings.length - 1}
                            className="p-0.5 text-slate-400 hover:text-blue-500 disabled:opacity-30"
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          {editingId === category.id && category.id !== 'common' ? (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <Icon name={editIcon} size={16} />
                                <input
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="flex-1 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none"
                                  placeholder="分类名称"
                                  autoFocus
                                />
                                <button type="button" className="p-1 text-slate-400 hover:text-blue-600 transition-colors" onClick={() => openIconSelector('edit')} title="选择图标">
                                  <Palette size={16} />
                                </button>
                              </div>
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-slate-500">父分类:</label>
                                <select
                                  value={editParentId}
                                  onChange={(e) => setEditParentId(e.target.value)}
                                  className="flex-1 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none"
                                  aria-label="选择父分类"
                                >
                                  <option value="">顶级分类</option>
                                  {getParentOptions(category.id).map(parent => (
                                    <option key={parent.id} value={parent.id}>作为 "{parent.name}" 的子分类</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex items-center gap-2">
                                <Lock size={14} className="text-slate-400" />
                                <input
                                  type="password"
                                  value={editPassword}
                                  onChange={(e) => setEditPassword(e.target.value)}
                                  disabled={editClearPassword}
                                  className="flex-1 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none disabled:opacity-50"
                                  placeholder="密码（可选）"
                                />
                              </div>
                              {category.hasPassword && (
                                <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={editClearPassword}
                                    onChange={(e) => setEditClearPassword(e.target.checked)}
                                    className="rounded border-slate-300"
                                  />
                                  移除密码（保存后该分类不再加密）
                                </label>
                              )}
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500">排序权重:</span>
                                <input
                                  type="number"
                                  value={editWeight}
                                  onChange={(e) => setEditWeight(Number(e.target.value))}
                                  className="w-20 p-1.5 px-2 text-sm rounded border border-blue-500 dark:bg-slate-800 dark:text-white outline-none"
                                  min={0}
                                />
                                <span className="text-xs text-slate-400">越小越靠前</span>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              {category.isSubcategory && (
                                <div className="w-2 border-l-2 border-slate-300 dark:border-slate-600 ml-2"></div>
                              )}
                              <Icon name={category.icon} size={16} />
                              <span className="font-medium dark:text-slate-200 truncate">
                                {category.isSubcategory && <span className="text-slate-400 mr-1">└</span>}
                                {category.name}
                                {category.id === 'common' && (
                                  <span className="ml-2 text-xs text-slate-400">(默认分类，不可编辑)</span>
                                )}
                              </span>
                              <span className="text-xs text-slate-400 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded">
                                w:{category.weight ?? 0}
                              </span>
                              {category.password && <Lock size={12} className="text-slate-400" />}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1 self-start mt-1">
                          {editingId === category.id ? (
                            <button onClick={saveEdit} className="text-green-500 hover:bg-green-50 dark:hover:bg-slate-600 p-1.5 rounded bg-white dark:bg-slate-800 shadow-sm border border-slate-200 dark:border-slate-600">
                              <Check size={16} />
                            </button>
                          ) : (
                            <>
                              {category.id !== 'common' && (
                                <button onClick={() => handleStartEdit(category)} className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-slate-200 dark:hover:bg-slate-600 rounded">
                                  <Edit2 size={14} />
                                </button>
                              )}
                              {category.id !== 'common' && (
                                <button onClick={() => handleDeleteClick(category)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-slate-200 dark:hover:bg-slate-600 rounded">
                                  <Trash2 size={14} />
                                </button>
                              )}
                              {category.id === 'common' && (
                                <div className="p-1.5 text-slate-300" title="常用推荐分类不能被删除">
                                  <Lock size={14} />
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {children.map(child => renderCategoryWithChildren(child, level + 1))}
                  </React.Fragment>
                );
              };

              return topLevelCategories.map(cat => renderCategoryWithChildren(cat));
            })()}
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
            <label className="text-xs font-semibold text-slate-500 uppercase mb-2 block">添加新分类</label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Icon name={newCatIcon} size={16} />
                <input
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  placeholder="分类名称"
                  className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                />
                <button type="button" className="p-1 text-gray-500 hover:text-blue-600 transition-colors" onClick={() => openIconSelector('new')} title="选择图标">
                  <Palette size={16} />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500">父分类:</label>
                <select
                  value={newCatParentId}
                  onChange={(e) => setNewCatParentId(e.target.value)}
                  className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  aria-label="选择父分类"
                >
                  <option value="">顶级分类</option>
                  {getParentOptions().map(parent => (
                    <option key={parent.id} value={parent.id}>作为 "{parent.name}" 的子分类</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={newCatPassword}
                    onChange={(e) => setNewCatPassword(e.target.value)}
                    placeholder="密码 (可选)"
                    className="w-full pl-8 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  />
                </div>
                <button
                  onClick={handleAdd}
                  disabled={!newCatName.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors flex items-center"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex gap-3 justify-end shrink-0">
            <button
              onClick={close}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Save size={14} />
              {isSaving ? '保存中...' : '保存更改'}
            </button>
          </div>

          {isIconSelectorOpen && (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[80dvh] overflow-hidden flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">选择图标</h3>
                  <button type="button" onClick={cancelIconSelector} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors" aria-label="关闭图标选择器">
                    <X size={20} />
                  </button>
                </div>
                <div className="flex-1 overflow-auto scrollbar-hide p-4">
                  <IconSelector
                    onSelectIcon={(iconName) => {
                      handleIconSelect(iconName);
                      setIsIconSelectorOpen(false);
                      setIconSelectorTarget(null);
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {isAuthModalOpen && pendingAction && (
            <CategoryActionAuthModal
              isOpen={isAuthModalOpen}
              onClose={handleAuthModalClose}
              onVerify={handlePasswordVerification}
              onVerified={handleAuthSuccess}
              actionType={pendingAction.type}
              categoryName={pendingAction.categoryName}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default CategoryManagerModal;
