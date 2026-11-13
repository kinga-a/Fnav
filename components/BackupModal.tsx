import React, { useState, useEffect, useRef } from 'react';
import { X, Cloud, Download, Upload, CheckCircle2, AlertCircle, RefreshCw, Save, FolderUp, ChevronDown } from 'lucide-react';
import { Category, LinkItem, WebDavConfig, SearchConfig, AIConfig } from '../types';
import { checkWebDavConnection, uploadBackup, downloadBackup, listBackups, deleteBackup } from '../services/webDavService';
import { encryptBackup, decryptBackup, isEncryptedBackup } from '../src/utils/backupCrypto';
import { mergeBackup, type RestoreMode } from '../src/utils/mergeBackup';
import { generateBookmarkHtml, downloadHtmlFile } from '../services/exportService';
import { useDialogClose } from '../src/hooks/useDialogClose';
import { useModalA11y } from '../src/hooks/useModalA11y';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  links: LinkItem[];
  categories: Category[];
  onRestore: (links: LinkItem[], categories: Category[]) => void;
  webDavConfig: WebDavConfig;
  onSaveWebDavConfig: (config: WebDavConfig) => void;
  searchConfig: SearchConfig;
  onRestoreSearchConfig: (searchConfig: SearchConfig) => void;
  aiConfig: AIConfig;
  onRestoreAIConfig: (aiConfig: AIConfig) => void;
}

const BackupModal: React.FC<BackupModalProps> = ({ 
  isOpen, onClose, links, categories, onRestore, webDavConfig, onSaveWebDavConfig, searchConfig, onRestoreSearchConfig, aiConfig, onRestoreAIConfig 
}) => {
  const [config, setConfig] = useState<WebDavConfig>(webDavConfig);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'uploading' | 'downloading' | 'success' | 'error'>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [importMsg, setImportMsg] = useState('');
  const [localExportPassword, setLocalExportPassword] = useState('');
  const [localImportPassword, setLocalImportPassword] = useState('');
  const [backupFiles, setBackupFiles] = useState<Array<{ name: string }>>([]);
  const [isListing, setIsListing] = useState(false);
  const [listLoaded, setListLoaded] = useState(false);
  const [restoreModes, setRestoreModes] = useState<Record<string, RestoreMode>>({});
  const [localRestoreMode, setLocalRestoreMode] = useState<RestoreMode>('merge');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshBackupList = async (target: WebDavConfig = webDavConfig) => {
    if (!target.enabled || !target.url || !target.username || !target.password) {
      setBackupFiles([]);
      setListLoaded(false);
      return;
    }
    setIsListing(true);
    const files = await listBackups(target);
    setBackupFiles(files.slice(0, 5));
    setListLoaded(true);
    setIsListing(false);
  };

  const { closing, close } = useDialogClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y(isOpen, close, panelRef);

  useEffect(() => {
    if(isOpen) {
        setConfig(webDavConfig);
        setTestResult(null);
        setSyncStatus('idle');
        setImportStatus('idle');
        setImportMsg('');
        setLocalExportPassword('');
        setLocalImportPassword('');
        setBackupFiles([]);
        setListLoaded(false);
        setRestoreModes({});
        setLocalRestoreMode('merge');
    }
  }, [isOpen, webDavConfig]);

  const fetchIconsAsBase64 = async (linksList: LinkItem[], onProgress?: (current: number, total: number) => void) => {
    const uploadedIcons: Array<{ key: string, platform: 'edgeone' | 'cloudflare', data: string }> = [];
    
    const iconUrls = new Set<string>();
    linksList.forEach(l => {
      if (l.edgeoneBlobUrl && l.edgeoneBlobUrl.startsWith('/api/favicon?key=')) {
        iconUrls.add(l.edgeoneBlobUrl);
      }
      if (l.cloudflareR2Url && l.cloudflareR2Url.startsWith('/api/favicon?key=')) {
        iconUrls.add(l.cloudflareR2Url);
      }
      if (l.icon && l.icon.startsWith('/api/favicon?key=')) {
        iconUrls.add(l.icon);
      }
    });

    const total = iconUrls.size;
    let current = 0;

    for (const iconUrl of iconUrls) {
      current++;
      if (onProgress) onProgress(current, total);
      
      try {
        const urlObj = new URL(iconUrl, window.location.origin);
        const key = urlObj.searchParams.get('key');
        if (!key) continue;

        const res = await fetch(iconUrl);
        if (!res.ok) continue;

        const blob = await res.blob();
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        let platform: 'edgeone' | 'cloudflare' = 'edgeone';
        const matchingLink = linksList.find(l => l.cloudflareR2Url === iconUrl || (l.icon === iconUrl && l.iconType === 'upload-cloudflare'));
        if (matchingLink) {
          platform = 'cloudflare';
        }

        uploadedIcons.push({
          key,
          platform,
          data: base64
        });
      } catch (e) {
        console.error(`Failed to export icon: ${iconUrl}`, e);
      }
    }

    return uploadedIcons;
  };

  const restoreUploadedIcons = async (
    uploadedIcons: Array<{ key: string, platform: 'edgeone' | 'cloudflare', data: string }>,
    linksList: LinkItem[],
    onProgress?: (current: number, total: number) => void
  ) => {
    const updatedLinks = [...linksList];
    const total = uploadedIcons.length;
    let current = 0;

    const authToken = localStorage.getItem('cloudnav_auth_token') || localStorage.getItem('authToken') || '';

    for (const icon of uploadedIcons) {
      current++;
      if (onProgress) onProgress(current, total);

      try {
        const res = await fetch(icon.data);
        const blob = await res.blob();
        const filename = icon.key.split('/').pop() || 'icon.png';
        const file = new File([blob], filename, { type: blob.type });

        const categoryName = icon.key.split('/')[0] || 'common';

        const formData = new FormData();
        formData.append('file', file);
        formData.append('categoryName', categoryName);
        formData.append('platform', icon.platform);

        const uploadRes = await fetch('/api/upload', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`
          },
          body: formData
        });

        if (uploadRes.ok) {
          const result = await uploadRes.json();
          if (result.success && result.url) {
            const oldUrl = `/api/favicon?key=${icon.key}`;
            const newUrl = result.url;

            updatedLinks.forEach(l => {
              if (l.icon === oldUrl) l.icon = newUrl;
              if (l.edgeoneBlobUrl === oldUrl) l.edgeoneBlobUrl = newUrl;
              if (l.cloudflareR2Url === oldUrl) l.cloudflareR2Url = newUrl;
            });
          }
        }
      } catch (e) {
        console.error(`Failed to restore icon: ${icon.key}`, e);
      }
    }

    return updatedLinks;
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    const success = await checkWebDavConnection(config);
    setTestResult(success ? 'success' : 'fail');
    setIsTesting(false);
  };

  const handleSaveConfig = () => {
    onSaveWebDavConfig(config);
    setSyncStatus('success');
    setStatusMsg('配置已保存');
  };

  const handleBackupNow = async () => {
    if (!config.enabled) return;
    if (!(config.backupPassword || '').trim()) {
      setSyncStatus('error');
      setStatusMsg('请先填写备份密码（用于加密备份）');
      return;
    }

    setSyncStatus('uploading');
    setStatusMsg('正在打包本地图标...');
    const uploadedIcons = await fetchIconsAsBase64(links, (curr, tot) => {
      setStatusMsg(`正在打包本地图标 (${curr}/${tot})...`);
    });

    const payload = { links, categories, searchConfig, aiConfig, uploadedIcons };
    setStatusMsg('正在加密备份...');
    let encrypted;
    try {
      encrypted = await encryptBackup(payload, (config.backupPassword || '').trim());
    } catch {
      setSyncStatus('error');
      setStatusMsg('备份加密失败，请重试。');
      return;
    }

    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const fileName = `cloudnav_backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;

    setStatusMsg('正在上传到云端...');
    const success = await uploadBackup(config, encrypted, fileName);
    if (success) {
      setSyncStatus('success');
      setStatusMsg('备份成功！点击“加载备份”可刷新列表。');
    } else {
      setSyncStatus('error');
      setStatusMsg('上传失败，请检查配置或网络。');
    }
  };

const handleRestoreFromCloudFile = async (fileName: string) => {
    const mode = restoreModes[fileName] || 'merge';
    const modeLabel = mode === 'merge' ? '合并' : '覆盖';
    const modeHint = mode === 'merge'
      ? '将保留本地数据，仅追加备份中不存在的书签与分类。'
      : '这将覆盖当前的所有本地数据。';
    if (!confirm(`确定要${modeLabel}备份 ${fileName} 吗？\n\n${modeHint}`)) return;

    let password = (config.backupPassword || '').trim();
    if (!password) {
      password = window.prompt('请输入该备份的加密密码') || '';
      if (!password) return;
    }

    setSyncStatus('downloading');
    setStatusMsg('正在下载...');
    const raw = await downloadBackup(config, fileName);
    if (!raw) {
      setSyncStatus('error');
      setStatusMsg('下载失败：WebDAV 连接超时或网络异常（已自动重试），请稍后再试。');
      return;
    }

    let data: any;
    try {
      data = isEncryptedBackup(raw) ? await decryptBackup<any>(raw, password) : raw;
    } catch {
      setSyncStatus('error');
      setStatusMsg('备份密码错误或文件已损坏。');
      return;
    }

    if (!Array.isArray(data?.links) || !Array.isArray(data?.categories)) {
      setSyncStatus('error');
      setStatusMsg('备份文件格式不正确。');
      return;
    }

    let backupLinks = data.links;
    if (data.uploadedIcons && Array.isArray(data.uploadedIcons) && data.uploadedIcons.length > 0) {
      setStatusMsg('正在还原云端图标文件...');
      backupLinks = await restoreUploadedIcons(data.uploadedIcons, data.links, (curr, tot) => {
        setStatusMsg(`正在还原图标 (${curr}/${tot})...`);
      });
    }

    let finalLinks = backupLinks;
    let finalCategories = data.categories;
    if (mode === 'merge') {
      const merged = mergeBackup(links, categories, backupLinks, data.categories);
      finalLinks = merged.links;
      finalCategories = merged.categories;
    }

    onRestore(finalLinks, finalCategories);
    if (mode === 'overwrite') {
      if (data.searchConfig) onRestoreSearchConfig(data.searchConfig);
      if (data.aiConfig) onRestoreAIConfig(data.aiConfig);
    }
    setSyncStatus('success');
    if (mode === 'merge') {
      setStatusMsg(`合并成功！新增 ${Math.max(0, finalLinks.length - links.length)} 个链接、${Math.max(0, finalCategories.length - categories.length)} 个分类。`);
    } else {
      setStatusMsg('恢复成功！');
    }
  };

  const handleDeleteBackupFile = async (fileName: string) => {
    if (!confirm(`确定要删除云端备份 ${fileName} 吗？此操作不可恢复。`)) return;
    setSyncStatus('downloading');
    setStatusMsg('正在删除...');
    const success = await deleteBackup(config, fileName);
    if (success) {
      setSyncStatus('success');
      setStatusMsg('删除成功。');
      await refreshBackupList(config);
    } else {
      setSyncStatus('error');
      setStatusMsg('删除失败，请检查配置或网络。');
    }
  };

  const handleDownloadBackupFile = async (fileName: string) => {
    setSyncStatus('downloading');
    setStatusMsg('正在下载备份文件...');
    const raw = await downloadBackup(config, fileName);
    if (!raw) {
      setSyncStatus('error');
      setStatusMsg('下载失败：WebDAV 连接超时或网络异常（已自动重试），请稍后再试。');
      return;
    }
    const blob = new Blob([JSON.stringify(raw, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSyncStatus('success');
    setStatusMsg('下载完成，可通过本地导入并输入密码恢复。');
  };

  const handleExportHtml = () => {
    const html = generateBookmarkHtml(links, categories);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadHtmlFile(html, `bookmarks_${dateStr}.html`);
  };

  const handleExportJson = async () => {
    setImportStatus('idle');
    setImportMsg('正在读取并打包本地图标...');
    
    const uploadedIcons = await fetchIconsAsBase64(links, (curr, tot) => {
      setImportMsg(`正在读取本地图标 (${curr}/${tot})...`);
    });

    let appConfig = null;
    try {
      // [安全] key=config 读取需认证：携带管理员 Token（VULN-01 后该接口已强制鉴权）
      const token = localStorage.getItem('cloudnav_auth_token') || localStorage.getItem('authToken') || '';
      const res = await fetch('/api/storage?key=config', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : undefined,
      });
      if (res.ok) {
        const data = await res.json();
        if (data.value) appConfig = JSON.parse(data.value);
      }
    } catch (e) { /* ignore */ }

    const data = { links, categories, searchConfig, aiConfig, config: appConfig, uploadedIcons };
    const password = localExportPassword.trim();
    let content: string;
    let fileName = 'cloudnav_backup.json';

    if (password) {
      setImportMsg('正在加密备份...');
      try {
        const encrypted = await encryptBackup(data, password);
        content = JSON.stringify(encrypted, null, 2);
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, '0');
        fileName = `cloudnav_backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;
      } catch {
        setImportStatus('error');
        setImportMsg('备份加密失败，请重试。');
        return;
      }
    } else {
      content = JSON.stringify(data, null, 2);
    }

    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setImportStatus('success');
    setImportMsg(password ? '本地备份导出成功（已加密）。' : '本地备份导出成功，已包含所有自定义图标文件！');
  };

  const handleImportJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        let data = JSON.parse(e.target?.result as string);

        if (isEncryptedBackup(data)) {
          const password = localImportPassword.trim();
          if (!password) {
            setImportStatus('error');
            setImportMsg('该备份已加密，请输入备份密码后再导入。');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
          try {
            data = await decryptBackup<any>(data, password);
          } catch {
            setImportStatus('error');
            setImportMsg('备份密码错误或备份文件已损坏。');
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
        }

        if (!Array.isArray(data.links) || !Array.isArray(data.categories)) {
          setImportStatus('error');
          setImportMsg('无效的备份文件：缺少 links 或 categories 数据。');
          return;
        }

        const mode = localRestoreMode;
        const modeLabel = mode === 'merge' ? '合并' : '覆盖';
        const modeHint = mode === 'merge'
          ? '将保留本地数据，仅追加备份中不存在的书签与分类。'
          : '这将覆盖当前的所有本地数据。';

        if (!confirm(
          `确定要${modeLabel}导入备份吗？\n\n` +
          `将读取 ${data.links.length} 个链接和 ${data.categories.length} 个分类。\n\n` +
          modeHint
        )) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        setImportStatus('idle');
        setImportMsg('正在准备导入...');
        
        let backupLinks = data.links;
        if (data.uploadedIcons && Array.isArray(data.uploadedIcons) && data.uploadedIcons.length > 0) {
          setImportMsg('正在导入并还原本地图标...');
          backupLinks = await restoreUploadedIcons(data.uploadedIcons, data.links, (curr, tot) => {
            setImportMsg(`正在还原图标 (${curr}/${tot})...`);
          });
        }

        let finalLinks = backupLinks;
        let finalCategories = data.categories;
        if (mode === 'merge') {
          const merged = mergeBackup(links, categories, backupLinks, data.categories);
          finalLinks = merged.links;
          finalCategories = merged.categories;
        }

        onRestore(finalLinks, finalCategories);

        if (mode === 'overwrite') {
          if (data.searchConfig) {
            onRestoreSearchConfig(data.searchConfig);
          }
          if (data.aiConfig) {
            onRestoreAIConfig(data.aiConfig);
          }
        }

        setImportStatus('success');
        if (mode === 'merge') {
          setImportMsg(`合并成功！新增 ${Math.max(0, finalLinks.length - links.length)} 个链接、${Math.max(0, finalCategories.length - categories.length)} 个分类。`);
        } else {
          setImportMsg(`导入成功！已恢复 ${data.links.length} 个链接、${data.categories.length} 个分类以及关联的自定义图标。`);
        }
      } catch (err) {
        setImportStatus('error');
        setImportMsg('解析备份文件失败，请确认文件格式正确。');
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.readAsText(file);
  };

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center px-4 py-[5dvh] bg-black/50 backdrop-blur-sm ${closing ? 'modal-overlay-out' : 'modal-overlay'}`}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="backup-modal-title" className={`bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 dark:border-slate-700 h-full flex flex-col focus:outline-none ${closing ? 'modal-panel-out' : 'modal-panel'}`}>
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <h3 id="backup-modal-title" className="text-lg font-semibold dark:text-white flex items-center gap-2">
            <Cloud className="text-blue-500" /> 备份与恢复
          </h3>
          <button onClick={close} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors">
            <X className="w-5 h-5 dark:text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide p-6 space-y-8">
            
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-slate-800 dark:text-slate-200">WebDAV 设置 (坚果云/<a href="https://infini-cloud.net/en/modules/mypage/usage/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600 underline">InfiniCloud</a>等)</h4>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                            type="checkbox" 
                            checked={config.enabled}
                            onChange={(e) => setConfig({...config, enabled: e.target.checked})}
                            className="rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-slate-600 dark:text-slate-400">启用 WebDAV</span>
                    </label>
                </div>

                <div className={`space-y-3 transition-opacity ${!config.enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">服务器地址 (URL)</label>
                            <input 
                                type="text" 
                                value={config.url}
                                onChange={(e) => setConfig({...config, url: e.target.value})}
                                placeholder="https://dav.jianguoyun.com/dav/"
                                className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">备份路径</label>
                            <input 
                                type="text" 
                                value={config.path || ''}
                                onChange={(e) => setConfig({...config, path: e.target.value})}
                                placeholder="fnav/backups"
                                className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">用户名</label>
                            <input 
                                type="text" 
                                value={config.username}
                                onChange={(e) => setConfig({...config, username: e.target.value})}
                                className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">应用密码</label>
                            <input 
                                type="password" 
                                value={config.password}
                                onChange={(e) => setConfig({...config, password: e.target.value})}
                                className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1">备份密码</label>
                            <input 
                                type="password" 
                                value={config.backupPassword || ''}
                                onChange={(e) => setConfig({ ...config, backupPassword: e.target.value })}
                                placeholder="用于加密备份"
                                className="w-full p-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                        <button 
                            onClick={handleTestConnection}
                            disabled={isTesting}
                            className="flex-1 sm:flex-none justify-center px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors"
                        >
                            {isTesting ? '连接中...' : '测试连接'}
                        </button>
                        <button 
                            onClick={handleSaveConfig}
                            className="flex-1 sm:flex-none justify-center px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors flex items-center gap-1"
                        >
                            <Save size={12} /> 保存配置
                        </button>
                        <button 
                            onClick={handleBackupNow}
                            disabled={!config.enabled || syncStatus === 'uploading'}
                            className="w-full sm:w-auto justify-center px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50"
                        >
                            <Upload size={12} /> 立即备份
                        </button>
                        {testResult === 'success' && <span className="text-xs text-green-500 flex items-center gap-1"><CheckCircle2 size={12}/> 连接成功</span>}
                        {testResult === 'fail' && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12}/> 连接失败</span>}
                    </div>
                </div>
            </section>

            <hr className="border-slate-200 dark:border-slate-700" />

            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-slate-800 dark:text-slate-200">云端同步操作</h4>
                    <button
                        onClick={() => refreshBackupList(config)}
                        disabled={isListing || !config.enabled}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50"
                    >
                        <RefreshCw size={12} className={isListing ? 'animate-spin' : ''} /> {isListing ? '加载中...' : '加载备份'}
                    </button>
                </div>
                <p className="text-xs text-slate-500">最近备份（最多展示 5 条，云端历史文件不自动删除）</p>

                {backupFiles.length === 0 ? (
                    <div className="text-sm text-center text-slate-500 p-4 rounded-lg border border-dashed border-slate-300 dark:border-slate-600">
                        {isListing ? '正在读取备份列表...' : (listLoaded ? '暂无备份，点击“立即备份”创建' : '点击“加载备份”读取云端备份列表')}
                    </div>
                ) : (
                    <ul className="space-y-2">
                        {backupFiles.map((file) => (
                            <li key={file.name} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                                <span className="text-sm text-slate-700 dark:text-slate-200 truncate min-w-0">{file.name}</span>
                                <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
                                    <div className="relative">
                                        <select
                                            value={restoreModes[file.name] || 'merge'}
                                            onChange={(e) => setRestoreModes((prev) => ({ ...prev, [file.name]: e.target.value as RestoreMode }))}
                                            className="h-7 appearance-none pl-2 pr-6 text-xs rounded-md border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option value="merge">合并</option>
                                            <option value="overwrite">覆盖</option>
                                        </select>
                                        <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                    </div>
                                    <button
                                        onClick={() => handleDownloadBackupFile(file.name)}
                                        className="h-7 px-3 inline-flex items-center justify-center text-xs font-medium rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-blue-500 transition-colors"
                                    >
                                        下载
                                    </button>
                                    <button
                                        onClick={() => handleRestoreFromCloudFile(file.name)}
                                        className="h-7 px-3 inline-flex items-center justify-center text-xs font-medium rounded-md bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                                    >
                                        恢复
                                    </button>
                                    <button
                                        onClick={() => handleDeleteBackupFile(file.name)}
                                        className="h-7 px-3 inline-flex items-center justify-center text-xs font-medium rounded-md bg-white dark:bg-slate-800 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                    >
                                        删除
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                
                {syncStatus !== 'idle' && (
                    <div className={`text-sm text-center p-2 rounded ${
                        syncStatus === 'success' ? 'bg-green-50 text-green-600 dark:bg-green-900/20' : 
                        syncStatus === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-900/20' : 
                        'bg-blue-50 text-blue-600 dark:bg-blue-900/20'
                    }`}>
                        {statusMsg}
                    </div>
                )}
            </section>

            <hr className="border-slate-200 dark:border-slate-700" />

             <section className="space-y-4">
                <h4 className="font-medium text-slate-800 dark:text-slate-200">本地导出与恢复</h4>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                        <h5 className="text-sm font-medium dark:text-slate-200">导出 HTML 书签文件</h5>
                        <p className="text-xs text-slate-500 mt-1">兼容 Chrome, Edge, Firefox 导入格式，保留目录结构</p>
                    </div>
                    <button 
                        onClick={handleExportHtml}
                        className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-blue-500 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 w-full sm:w-auto whitespace-nowrap"
                    >
                        <Download size={16} /> 导出 HTML
                    </button>
                </div>
                
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-700/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                        <h5 className="text-sm font-medium dark:text-slate-200">导出 cloudnav_backup.json 文件</h5>
                        <p className="text-xs text-slate-500 mt-1">与 WebDAV 备份格式一致，便于数据迁移</p>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                        <input
                            type="password"
                            value={localExportPassword}
                            onChange={(e) => setLocalExportPassword(e.target.value)}
                            placeholder="备份密码（可留空）"
                            className="w-full sm:w-40 p-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button 
                            onClick={handleExportJson}
                            className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:border-blue-500 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 w-full sm:w-auto whitespace-nowrap"
                        >
                            <Download size={16} /> 导出 JSON
                        </button>
                    </div>
                </div>

                <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="min-w-0">
                        <h5 className="text-sm font-medium dark:text-slate-200">导入 cloudnav_backup.json 恢复</h5>
                        <p className="text-xs text-slate-500 mt-1">从本地 JSON 备份文件恢复所有数据（链接、分类、搜索和 AI 配置）</p>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
                        <input
                            type="password"
                            value={localImportPassword}
                            onChange={(e) => setLocalImportPassword(e.target.value)}
                            placeholder="备份密码（可留空）"
                            className="h-9 w-full sm:w-40 px-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <div className="relative w-full sm:w-[76px]">
                            <select
                                value={localRestoreMode}
                                onChange={(e) => setLocalRestoreMode(e.target.value as RestoreMode)}
                                className="h-9 w-full appearance-none pl-2 pr-6 text-xs rounded-lg border border-slate-300 dark:border-slate-600 dark:bg-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="merge">合并</option>
                                <option value="overwrite">覆盖</option>
                            </select>
                            <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept=".json"
                            onChange={handleImportJson}
                            className="hidden"
                            id="import-json-input"
                        />
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 w-full sm:w-auto whitespace-nowrap"
                        >
                            <FolderUp size={16} /> 导入 JSON
                        </button>
                    </div>
                </div>

                {importStatus !== 'idle' && (
                    <div className={`text-sm text-center p-2 rounded ${
                        importStatus === 'success' ? 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400' : 
                        'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                    }`}>
                        {importMsg}
                    </div>
                )}
             </section>

        </div>
      </div>
    </div>
  );
};

export default BackupModal;