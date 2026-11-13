import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, GripVertical, Settings, ArrowLeft, Check, RotateCcw } from 'lucide-react';
import { SearchConfig, SearchEngine } from '../types';
import { toast } from './Toast';
import { SEARCH_ENGINES } from '../src/constants';

interface SearchConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  searchConfig: SearchConfig;
  onSave: (config: SearchConfig) => void;
}

const SearchConfigModal: React.FC<SearchConfigModalProps> = ({ isOpen, onClose, searchConfig, onSave }) => {
  const [localConfig, setLocalConfig] = useState<SearchConfig>(searchConfig);

  useEffect(() => {
    if (isOpen) setLocalConfig(searchConfig);
  }, [isOpen, searchConfig]);

  if (!isOpen) return null;

  const toggleEngine = (engine: SearchEngine) => {
    const current = localConfig.externalSources || [];
    const exists = current.find(e => e.id === engine.id);
    if (exists) {
      setLocalConfig(prev => ({ ...prev, externalSources: current.filter(e => e.id !== engine.id) }));
    } else {
      setLocalConfig(prev => ({ ...prev, externalSources: [...current, engine] }));
    }
  };

  const updateCustomUrl = (url: string) => {
    setLocalConfig(prev => ({
      ...prev,
      externalSources: (prev.externalSources || []).map(e =>
        e.id === 'custom' ? { ...e, url } : e
      )
    }));
  };

  const moveEngine = (index: number, direction: 'up' | 'down') => {
    const list = [...(localConfig.externalSources || [])];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    
    [list[index], list[targetIndex]] = [list[targetIndex], list[index]];
    setLocalConfig(prev => ({ ...prev, externalSources: list }));
  };

  const handleSave = () => {
    onSave(localConfig);
    onClose();
    toast.success('搜索设置已保存');
  };

  const handleReset = () => {
    setLocalConfig({
      mode: 'internal',
      externalSources: [],
      selectedSource: null,
      defaultEngine: 'internal'
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Settings size={20} /> 搜索设置
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-hide p-4 space-y-6">
          {/* 默认模式 */}
          <section>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">默认搜索模式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setLocalConfig(prev => ({ ...prev, mode: 'internal' }))}
                className={`py-2 px-3 rounded-lg text-sm font-medium transition-all border-2 ${
                  localConfig.mode === 'internal'
                    ? 'bg-blue-50 border-blue-500 text-blue-600'
                    : 'bg-slate-100 dark:bg-slate-700 border-transparent text-slate-600 dark:text-slate-300'
                }`}
              >
                站内搜索
              </button>
              <button
                onClick={() => setLocalConfig(prev => ({ ...prev, mode: 'external' }))}
                className={`py-2 px-3 rounded-lg text-sm font-medium transition-all border-2 ${
                  localConfig.mode === 'external'
                    ? 'bg-blue-50 border-blue-500 text-blue-600'
                    : 'bg-slate-100 dark:bg-slate-700 border-transparent text-slate-600 dark:text-slate-300'
                }`}
              >
                互联网搜索
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {localConfig.mode === 'internal'
                ? '默认在本站点内搜索书签。'
                : '默认使用外部搜索引擎搜索互联网。'}
            </p>
          </section>

          {/* 默认搜索引擎（仅互联网模式） */}
          {localConfig.mode === 'external' && (
            <section>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">默认搜索引擎</label>
              <select
                value={localConfig.defaultEngine || 'internal'}
                onChange={(e) => setLocalConfig(prev => ({ ...prev, defaultEngine: e.target.value }))}
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              >
                <option value="internal">站内搜索</option>
                {SEARCH_ENGINES.map(engine => (
                  <option key={engine.id} value={engine.id}>{engine.name}</option>
                ))}
                {(localConfig.externalSources || []).filter(e => e.id === 'custom').map(e => (
                  <option key="custom" value="custom">自定义搜索引擎</option>
                ))}
              </select>
            </section>
          )}

          {/* 外部搜索引擎管理 */}
          <section>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              互联网搜索源（拖拽排序）
            </label>
            
            {/* 已选列表 */}
            <div className="space-y-2 mb-3">
              {(localConfig.externalSources || []).map((engine, index) => (
                <div key={engine.id} className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-700/50 rounded-lg">
                  <GripVertical size={16} className="text-slate-400" />
                  <span className="flex-1 text-sm text-slate-700 dark:text-slate-300">{engine.name}</span>
                  <button onClick={() => moveEngine(index, 'up')} disabled={index === 0} className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-30">
                    <ArrowLeft size={14} className="rotate-90" />
                  </button>
                  <button onClick={() => moveEngine(index, 'down')} disabled={index === (localConfig.externalSources || []).length - 1} className="p-1 text-slate-400 hover:text-blue-500 disabled:opacity-30">
                    <ArrowLeft size={14} className="-rotate-90" />
                  </button>
                  <button onClick={() => toggleEngine(engine)} className="p-1 text-red-400 hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* 可选列表 */}
            <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
              <label className="block text-xs text-slate-500 mb-2">添加搜索源</label>
              <div className="flex flex-wrap gap-2">
                {SEARCH_ENGINES.filter(e => !(localConfig.externalSources || []).find(sel => sel.id === e.id)).map(engine => (
                  <button
                    key={engine.id}
                    onClick={() => toggleEngine(engine)}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 dark:bg-slate-700 rounded-full hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors"
                  >
                    <Plus size={12} /> {engine.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 自定义搜索 URL */}
            {(localConfig.externalSources || []).find(e => e.id === 'custom') && (
              <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">自定义搜索 URL</label>
                <input
                  type="text"
                  value={(localConfig.externalSources || []).find(e => e.id === 'custom')?.url || ''}
                  onChange={(e) => updateCustomUrl(e.target.value)}
                  placeholder="https://example.com/search?q="
                  className="w-full p-2 text-xs rounded border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
                <p className="text-[10px] text-slate-500 mt-1">关键词将拼接在 URL 末尾。</p>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
          <button
            onClick={handleReset}
            className="flex items-center gap-1 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <RotateCcw size={14} /> 重置
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Check size={16} /> 保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchConfigModal;