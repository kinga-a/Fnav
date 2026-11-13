import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Loader2, Pin, Wand2, Trash2, Globe } from 'lucide-react';
import { LinkItem, Category, AIConfig, IconSourceType, IconConfig } from '../types';
import { generateLinkDescription, suggestCategory } from '../services/geminiService';
import { toast } from './Toast';
import { STORAGE_KEYS } from '../src/constants';
import { useModalA11y } from '../src/hooks/useModalA11y';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (link: Omit<LinkItem, 'id' | 'createdAt'>, keepOpen?: boolean) => void;
  onDelete?: (id: string) => void;
  categories: Category[];
  initialData?: LinkItem;
  aiConfig: AIConfig;
  defaultCategoryId?: string;
  iconConfig?: IconConfig;
  supportsUpload?: boolean;
}

const LinkModal: React.FC<LinkModalProps> = ({ isOpen, onClose, onSave, onDelete, categories, initialData, aiConfig, defaultCategoryId, iconConfig, supportsUpload = true }) => {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [formErrors, setFormErrors] = useState({ title: false, url: false });
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || 'common');
  const [pinned, setPinned] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [icon, setIcon] = useState('');
  const [iconType, setIconType] = useState<IconSourceType>('origin');
  const [isUploading, setIsUploading] = useState(false);

  const [customIconUrl, setCustomIconUrl] = useState('');
  const [edgeoneBlobUrl, setEdgeoneBlobUrl] = useState('');
  const [cloudflareR2Url, setCloudflareR2Url] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, targetType: 'upload-edgeone' | 'upload-cloudflare') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('图片大小不能超过 2MB');
      return;
    }

    setIsUploading(true);
    try {
      const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_KEY) || localStorage.getItem('authToken') || '';
      const currentCategory = categories.find(c => c.id === categoryId);
      const categoryName = currentCategory ? currentCategory.name : 'common';

      const formData = new FormData();
      formData.append('file', file);
      formData.append('categoryName', categoryName);
      formData.append('platform', targetType === 'upload-cloudflare' ? 'cloudflare' : 'edgeone');

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '上传失败');
      }

      const result = await response.json();
      if (result.success && result.url) {
        setIcon(result.url);
        if (targetType === 'upload-edgeone') {
          setEdgeoneBlobUrl(result.url);
        } else {
          setCloudflareR2Url(result.url);
        }
        toast.success('图标上传成功！');
      } else {
        throw new Error('未返回有效的图标地址');
      }
    } catch (err: any) {
      console.error('上传失败:', err);
      toast.error(`上传失败: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleConvertUrlToStorage = async (targetPlatform: 'edgeone' | 'cloudflare') => {
    if (!icon || !icon.trim()) {
      toast.error('请先输入有效的图片 URL');
      return;
    }

    if (icon.startsWith('/api/favicon?key=')) {
      toast.info('该图标已经是本地存储图标，无需转换');
      return;
    }

    setIsUploading(true);
    try {
      const authToken = localStorage.getItem(STORAGE_KEYS.AUTH_KEY) || localStorage.getItem('authToken') || '';
      const currentCategory = categories.find(c => c.id === categoryId);
      const categoryName = currentCategory ? currentCategory.name : 'common';

      const formData = new FormData();
      formData.append('url', icon.trim());
      formData.append('categoryName', categoryName);
      formData.append('platform', targetPlatform);

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        body: formData
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '转存失败');
      }

      const result = await response.json();
      if (result.success && result.url) {
        setIcon(result.url);
        if (targetPlatform === 'edgeone') {
          setEdgeoneBlobUrl(result.url);
          setIconType('upload-edgeone');
        } else {
          setCloudflareR2Url(result.url);
          setIconType('upload-cloudflare');
        }
        toast.success(`转存到 ${targetPlatform === 'edgeone' ? 'EdgeOne Blob' : 'Cloudflare R2'} 成功！`);
      } else {
        throw new Error('未返回有效的图标地址');
      }
    } catch (err: any) {
      console.error('转存失败:', err);
      toast.error(`转存失败: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const [customApiUrl, setCustomApiUrl] = useState('');
  const [customApiParam, setCustomApiParam] = useState<'URL' | 'DOMAIN'>('URL');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isFetchingIcon, setIsFetchingIcon] = useState(false);
  const [isFetchingMeta, setIsFetchingMeta] = useState(false);
  const [autoFetchIcon, setAutoFetchIcon] = useState(true);
  const [batchMode, setBatchMode] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [weight, setWeight] = useState(0);
  const [pinnedOrder, setPinnedOrder] = useState(0);

  useEffect(() => {
    if (!supportsUpload && (iconType === 'upload-edgeone' || iconType === 'upload-cloudflare')) {
      setIconType('origin');
      setIcon('');
    }
  }, [supportsUpload, iconType]);

  useEffect(() => {
    if (!isOpen) {
      setBatchMode(false);
      setShowSuccessMessage(false);
    }
  }, [isOpen]);

  const [mounted, setMounted] = useState(isOpen);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, onClose, panelRef);
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => { setMounted(false); setClosing(false); }, 200);
      return () => clearTimeout(t);
    }
  }, [isOpen, mounted]);

  useEffect(() => {
    if (showSuccessMessage) {
      const timer = setTimeout(() => {
        setShowSuccessMessage(false);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [showSuccessMessage]);

  const getSubCategories = (parentId: string) => {
    return categories.filter(cat => cat.parentId === parentId);
  };

  const hasSubCategories = (categoryId: string) => {
    return getSubCategories(categoryId).length > 0;
  };

  const getCategoryDisplayName = (categoryId: string) => {
    const category = categories.find(c => c.id === categoryId);
    if (!category) return '未知分类';

    if (category.isSubcategory && category.parentId) {
      const parent = categories.find(c => c.id === category.parentId);
      return parent ? `${parent.name} > ${category.name}` : category.name;
    }

    return category.name;
  };

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setTitle(initialData.title);
        setUrl(initialData.url);
        setDescription(initialData.description || '');
        setCategoryId(initialData.categoryId);
        setPinned(initialData.pinned || false);
        setIsPrivate(initialData.isPrivate || false);
        setIcon(initialData.icon || '');
        setWeight(initialData.weight || 0);
        setPinnedOrder(initialData.pinnedOrder || 0);

        let detectedType: IconSourceType = 'origin';
        if (initialData.iconType) {
          if (initialData.iconType === 'upload') {
            detectedType = 'upload-edgeone';
          } else {
            detectedType = initialData.iconType as IconSourceType;
          }
        } else {
          if (initialData.icon?.includes('faviconextractor.com')) {
            detectedType = 'faviconextractor';
          } else if (initialData.icon?.includes('google.com/s2/favicons')) {
            detectedType = 'google';
          } else if (initialData.icon?.includes('/api/favicon?domain=')) {
            detectedType = 'google';
          } else if (initialData.icon?.includes('api.xinac.net/icon')) {
            detectedType = 'xinac';
          } else if (initialData.icon?.includes('/api/favicon?key=')) {
            detectedType = 'upload-edgeone';
          } else if (initialData.icon) {
            detectedType = 'customurl';
          } else {
            detectedType = 'origin';
          }
        }
        setIconType(detectedType);

        const initialCustom = initialData.customIconUrl || (detectedType === 'customurl' ? initialData.icon : '') || '';
        const initialEdgeone = initialData.edgeoneBlobUrl || (detectedType === 'upload-edgeone' ? initialData.icon : '') || '';
        const initialCloudflare = initialData.cloudflareR2Url || (detectedType === 'upload-cloudflare' ? initialData.icon : '') || '';

        setCustomIconUrl(initialCustom);
        setEdgeoneBlobUrl(initialEdgeone);
        setCloudflareR2Url(initialCloudflare);

        if (initialData.iconType === 'customapi' && initialData.iconConfig) {
          setCustomApiUrl((initialData.iconConfig.customApiUrl as string) || '');
          setCustomApiParam((initialData.iconConfig.customApiParam as 'URL' | 'DOMAIN') || 'URL');
        } else {
          setCustomApiUrl('');
          setCustomApiParam('URL');
        }
      } else {
        setTitle('');
        setUrl('');
        setDescription('');
        setWeight(0);
        setPinnedOrder(0);
        if (defaultCategoryId && categories.find(cat => cat.id === defaultCategoryId)) {
          setCategoryId(defaultCategoryId);
        } else {
          const firstAvailableCategory = categories.find(cat =>
            !cat.isSubcategory ? !hasSubCategories(cat.id) : true
          );
          setCategoryId(firstAvailableCategory?.id || 'common');
        }
        setPinned(false);
        setIsPrivate(false);
        setIcon('');
        setIconType('origin');
        setCustomIconUrl('');
        setEdgeoneBlobUrl('');
        setCloudflareR2Url('');
        setCustomApiUrl('');
        setCustomApiParam('URL');
      }
    }
  }, [isOpen, initialData, categories, defaultCategoryId]);

  useEffect(() => {
    if (url && autoFetchIcon && !initialData) {
      const timer = setTimeout(() => {
        handleFetchIcon();
      }, 500);

      return () => clearTimeout(timer);
    }
  }, [url, autoFetchIcon, initialData]);

  const handleDelete = () => {
    if (!initialData) return;
    onDelete && onDelete(initialData.id);
    onClose();
  };

  const cacheCustomIcon = async (url: string, iconUrl: string) => {
    try {
      let domain = url;
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }

      const authToken = localStorage.getItem('authToken');
      if (authToken) {
        await fetch('/api/storage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            saveConfig: 'favicon',
            domain: domain,
            icon: iconUrl
          })
        });
        console.log(`Custom icon cached for domain: ${domain}`);
      }
    } catch (error) {
      console.log("Failed to cache custom icon", error);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !url.trim()) {
      setFormErrors({ title: !title.trim(), url: !url.trim() });
      return;
    }
    setFormErrors({ title: false, url: false });

    let finalUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      finalUrl = 'https://' + url;
    }

    onSave({
      id: initialData?.id || '',
      title,
      url: finalUrl,
      icon,
      description,
      categoryId,
      pinned,
      weight,
      pinnedOrder,
      iconType,
      iconConfig: iconType === 'customapi' ? { iconType, customApiUrl, customApiParam } : undefined,
      customIconUrl,
      edgeoneBlobUrl,
      cloudflareR2Url,
      isPrivate
    }, batchMode);

    if (icon && !icon.startsWith('/api/favicon') && !icon.includes('faviconextractor.com')) {
      cacheCustomIcon(finalUrl, icon);
    }

    if (batchMode) {
      setShowSuccessMessage(true);
      setTitle('');
      setUrl('');
      setIcon('');
      setDescription('');
      setPinned(false);
      if (autoFetchIcon && finalUrl) {
        handleFetchIcon();
      }
    } else {
      onClose();
    }
  };

  const handleAIAssist = async () => {
    if (!url || !title) return;
    if (!aiConfig.apiKey) {
        toast.warning("请先点击侧边栏左下角设置图标配置 AI API Key");
        return;
    }

    setIsGenerating(true);

    try {
        const descPromise = generateLinkDescription(title, url, aiConfig);

        let catPromise = Promise.resolve(null);
        if (!initialData) {
            catPromise = suggestCategory(title, url, categories, aiConfig);
        }

        const [desc, cat] = await Promise.all([descPromise, catPromise]);

        if (desc) setDescription(desc);
        if (cat && !initialData) {
            setCategoryId(cat);
        }

    } catch (e) {
        console.error("AI Assist failed", e);
    } finally {
        setIsGenerating(false);
    }
  };

  const handleFetchMeta = async () => {
    if (!url) return;
    setIsFetchingMeta(true);
    try {
      const res = await fetch(`/api/metadata?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        toast.warning('抓取失败，该网站可能禁止访问');
        return;
      }
      const data = await res.json();
      const gotTitle = !!(data.title && !title.trim());
      if (gotTitle) setTitle(data.title);
      if (data.description) setDescription(data.description);
      if (data.description || gotTitle) {
        toast.success('已从网页抓取标题与描述');
      } else {
        toast.warning('该网页没有提供描述信息');
      }
    } catch (e) {
      console.error('Fetch meta failed', e);
      toast.warning('抓取失败，该网站可能禁止访问');
    } finally {
      setIsFetchingMeta(false);
    }
  };

  const handleFetchIcon = async () => {
    if (!url) return;

    setIsFetchingIcon(true);
    try {
      let domain = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        domain = 'https://' + url;
      }

      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
      }

      let iconUrl = '';

      const probeImage = (src: string, timeout = 4000): Promise<boolean> => {
        return new Promise((resolve) => {
          const img = new Image();
          const timer = setTimeout(() => { img.src = ''; resolve(false); }, timeout);
          img.onload = () => { clearTimeout(timer); resolve(true); };
          img.onerror = () => { clearTimeout(timer); resolve(false); };
          img.src = src;
        });
      };

      const xinacUrl = `https://api.xinac.net/icon/?url=${encodeURIComponent(url)}`;

      switch (iconType) {
        case 'faviconextractor':
          iconUrl = `https://faviconextractor.com/favicon/${domain}`;
          break;
        case 'google':
          iconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
          break;
        case 'xinac':
          iconUrl = xinacUrl;
          break;
        case 'origin': {
          let origin = '';
          try {
            const u = new URL(url.startsWith('http') ? url : `https://${url}`);
            origin = `${u.protocol}//${u.hostname}`;
          } catch {
            origin = `https://${domain}`;
          }
          const ok = await probeImage(`${origin}/favicon.ico`);
          iconUrl = ok ? `${origin}/favicon.ico` : xinacUrl;
          break;
        }
        default:
          iconUrl = xinacUrl;
      }

      setIcon(iconUrl);
    } catch (e) {
      console.error("Failed to fetch icon", e);
      toast.error("无法获取图标，请检查URL是否正确");
    } finally {
      setIsFetchingIcon(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className={`fixed inset-0 z-[60] flex items-start sm:items-center justify-center p-2 sm:p-4 bg-black/50 backdrop-blur-sm overflow-y-auto scrollbar-hide transition-opacity duration-200 ${!closing ? 'modal-overlay' : ''} ${closing ? 'opacity-0' : 'opacity-100'}`}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="link-modal-title" className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] sm:max-h-[85dvh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700 my-auto pb-[env(safe-area-inset-bottom)] focus:outline-none transition-all duration-200 ${!closing ? 'modal-panel' : ''} ${closing ? 'opacity-0 translate-y-3 scale-95' : 'opacity-100 translate-y-0 scale-100'}`}>
        <div className="flex justify-between items-start sm:items-center p-4 border-b border-slate-200 dark:border-slate-700 gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 id="link-modal-title" className="text-lg font-semibold dark:text-white">
              {initialData ? '编辑链接' : '添加新链接'}
            </h3>
            <button
              type="button"
              onClick={() => setPinned(!pinned)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                pinned
                ? 'bg-blue-100 border-blue-200 text-blue-600 dark:bg-blue-900/40 dark:border-blue-800 dark:text-blue-300'
                : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'
              }`}
              title={pinned ? "取消置顶" : "置顶"}
            >
              <Pin size={14} className={pinned ? "fill-current" : ""} />
              <span className="text-xs font-medium">置顶</span>
            </button>
            <button
              type="button"
              onClick={() => setIsPrivate(!isPrivate)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                isPrivate
                ? 'bg-purple-100 border-purple-200 text-purple-600 dark:bg-purple-900/40 dark:border-purple-800 dark:text-purple-300'
                : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-400'
              }`}
              title={isPrivate ? "取消私人书签" : "设为私人书签"}
            >
              <span className="text-xs font-medium">{isPrivate ? '🔒 私人' : '🔓 私人'}</span>
            </button>

            {!initialData && (
              <div className="flex items-center gap-1 px-2 py-1 rounded-md border bg-slate-50 border-slate-200 dark:bg-slate-700 dark:border-slate-600">
                <input
                  type="checkbox"
                  id="batchMode"
                  checked={batchMode}
                  onChange={(e) => setBatchMode(e.target.checked)}
                  className="h-3 w-3 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
                />
                <label htmlFor="batchMode" className="text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer">
                  批量添加不关窗口
                </label>
              </div>
            )}
            {initialData && onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-all ${
                  'bg-red-50 border-red-200 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800/30 dark:text-red-400 dark:hover:bg-red-900/30'
                }`}
                title="删除链接"
              >
                <Trash2 size={14} />
                <span className="text-xs font-medium">删除</span>
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <form onSubmit={handleSave} noValidate className="p-4 space-y-4 overflow-y-auto scrollbar-hide flex-1">
          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">标题</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (formErrors.title) setFormErrors((prev) => ({ ...prev, title: false })); }}
              className={`w-full p-2 rounded-lg border dark:bg-slate-700 dark:text-white outline-none transition-all text-base focus:ring-2 ${formErrors.title ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500'}`}
              placeholder="网站名称"
            />
            {formErrors.title && <p className="mt-1 text-xs text-red-500">请填写网站名称</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">URL 链接</label>
            <div className="flex gap-2">
              <input
                type="text"
                required
                value={url}
                onChange={(e) => { setUrl(e.target.value); if (formErrors.url) setFormErrors((prev) => ({ ...prev, url: false })); }}
                className={`w-full p-2 rounded-lg border dark:bg-slate-700 dark:text-white outline-none transition-all text-base focus:ring-2 ${formErrors.url ? 'border-red-400 dark:border-red-500 focus:ring-red-500' : 'border-slate-300 dark:border-slate-600 focus:ring-blue-500'}`}
                placeholder="example.com 或 https://..."
              />
            </div>
            {formErrors.url && <p className="mt-1 text-xs text-red-500">请填写链接</p>}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">图标</label>
            <div className="space-y-2">
              <select
                value={iconType}
                  onChange={(e) => {
                    const newType = e.target.value as IconSourceType;
                    setIconType(newType);
                    if (newType === 'customurl') {
                      setIcon(customIconUrl);
                    } else if (newType === 'upload-edgeone') {
                      setIcon(edgeoneBlobUrl);
                    } else if (newType === 'upload-cloudflare') {
                      setIcon(cloudflareR2Url);
                    } else if (newType === 'xinac') {
                      setIcon('');
                    } else {
                      setIcon('');
                    }
                  }}
                  className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
                >
                  <option value="origin">原站图标 / Xinac 兜底 (默认)</option>
                  <option value="google">Google Favicon API</option>
                  <option value="faviconextractor">Favicon Extractor</option>
                  <option value="xinac">Xinac 图标 API</option>
                  <option value="customurl">自定义图片URL</option>
                  <option value="customapi">自定义API</option>
                  {supportsUpload && <option value="upload-edgeone">上传到 Edgeone Pages Blob</option>}
                  {supportsUpload && <option value="upload-cloudflare">上传到 Cloudflare R2</option>}
                </select>

              {iconType === 'customurl' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={icon}
                      onChange={(e) => {
                        setIcon(e.target.value);
                        setCustomIconUrl(e.target.value);
                      }}
                      className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
                      placeholder="https://example.com/icon.png"
                    />
                  </div>
                  {supportsUpload && icon && icon.trim() && !icon.startsWith('/api/favicon?key=') && (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => handleConvertUrlToStorage('edgeone')}
                        className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isUploading ? '正在转存...' : '📥 转存到 EdgeOne Blob'}
                      </button>
                      <button
                        type="button"
                        disabled={isUploading}
                        onClick={() => handleConvertUrlToStorage('cloudflare')}
                        className="flex-1 py-1.5 px-3 rounded-lg text-xs font-medium bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-900/20 dark:text-purple-400 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/40 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                      >
                        {isUploading ? '正在转存...' : '📥 转存到 Cloudflare R2'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {iconType === 'customapi' && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                      className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
                      placeholder="https://api.example.com/icon"
                    />
                    <select
                      value={customApiParam}
                      onChange={(e) => setCustomApiParam(e.target.value as 'URL' | 'DOMAIN')}
                      className="p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
                    >
                      <option value="URL">URL参数</option>
                      <option value="DOMAIN">DOMAIN参数</option>
                    </select>
                  </div>
                  {customApiUrl && url && (
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={icon}
                        readOnly
                        className="flex-1 p-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 dark:text-slate-400 text-base"
                        placeholder={`生成的图标地址: ${customApiUrl}?${customApiParam.toLowerCase()}=${customApiParam === 'URL' ? encodeURIComponent(url) : new URL(url).hostname}`}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const generatedUrl = `${customApiUrl}?${customApiParam.toLowerCase()}=${customApiParam === 'URL' ? encodeURIComponent(url) : new URL(url).hostname}`;
                          setIcon(generatedUrl);
                        }}
                        className="px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1 transition-colors text-sm"
                      >
                        生成地址
                      </button>
                    </div>
                  )}
                </div>
              )}

              {(iconType === 'upload-edgeone' || iconType === 'upload-cloudflare') && (
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
                    <input
                      type="url"
                      value={icon}
                      readOnly
                      className="flex-1 p-2 rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-400 text-base"
                      placeholder="上传图标后将自动生成路径"
                    />
                    <label className="cursor-pointer px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors flex items-center gap-1 font-medium shrink-0">
                      {isUploading ? '正在上传...' : '上传图标'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => handleFileUpload(e, iconType as 'upload-edgeone' | 'upload-cloudflare')}
                        disabled={isUploading}
                        className="hidden"
                      />
                    </label>
                  </div>
                  {icon && (
                    <div className="flex items-center gap-2 p-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                      <img src={icon} alt="Preview" className="w-8 h-8 object-contain rounded" />
                      <span className="text-xs text-slate-500 truncate">{icon}</span>
                    </div>
                  )}
                </div>
              )}

              {(iconType === 'faviconextractor' || iconType === 'google' || iconType === 'xinac' || iconType === 'origin') && (
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
                    placeholder="留空自动获取图标"
                  />
                  <button
                    type="button"
                    onClick={handleFetchIcon}
                    disabled={!url || isFetchingIcon}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 flex items-center gap-1 transition-colors"
                  >
                    {isFetchingIcon ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    获取图标
                  </button>
                </div>
              )}

                </div>

            <div className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                id="autoFetchIcon"
                checked={autoFetchIcon}
                onChange={(e) => setAutoFetchIcon(e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-slate-300 rounded dark:border-slate-600 dark:bg-slate-700"
              />
              <label htmlFor="autoFetchIcon" className="text-sm text-slate-700 dark:text-slate-300">
                自动获取URL链接的图标
              </label>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
                <label className="block text-sm font-medium dark:text-slate-300">描述 (选填)</label>
                {(title && url) && (
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={handleFetchMeta}
                            disabled={isFetchingMeta}
                            className="text-xs flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                            title="从网页抓取 title 和 meta description"
                        >
                            {isFetchingMeta ? <Loader2 className="w-3 h-3 animate-spin" /> : <Globe className="w-3 h-3" />}
                            抓取描述
                        </button>
                        <button
                            type="button"
                            onClick={handleAIAssist}
                            disabled={isGenerating}
                            className="text-xs flex items-center gap-1 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors"
                        >
                            {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                            AI 自动填写
                        </button>
                    </div>
                )}
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all h-20 resize-none text-base"
              placeholder="简短描述..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">分类</label>
            <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
            >
            {categories
                .filter(cat => !cat.isSubcategory ? !hasSubCategories(cat.id) : true)
                .map(cat => (
                    <option key={cat.id} value={cat.id}>
                        {cat.isSubcategory ? `└ ${getCategoryDisplayName(cat.id)}` : cat.name}
                    </option>
                ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1 dark:text-slate-300">权重 (Weight)</label>
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(parseInt(e.target.value) || 0)}
              className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
              placeholder="数值越小越靠前"
            />
            <p className="text-[10px] text-slate-400 mt-1">控制在分类中的排序，数值越小越靠前。</p>
          </div>

          {pinned && (
            <div>
              <label className="block text-sm font-medium mb-1 dark:text-slate-300">置顶权重 (Pinned Order)</label>
              <input
                type="number"
                value={pinnedOrder}
                onChange={(e) => setPinnedOrder(parseInt(e.target.value) || 0)}
                className="w-full p-2 rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all text-base"
                placeholder="数值越小越靠前"
              />
              <p className="text-[10px] text-slate-400 mt-1">控制在置顶区域的排序，数值越小越靠前。</p>
            </div>
          )}

          <div className="pt-2 relative">
            {showSuccessMessage && (
              <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10 px-4 py-2 bg-green-500 text-white rounded-lg shadow-lg transition-opacity duration-300">
                添加成功
              </div>
            )}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors shadow-lg shadow-blue-500/30"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LinkModal;
