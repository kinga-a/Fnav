import { Category, LinkItem, WebDavConfig, SearchConfig, AIConfig } from "../types";

// 通过后端代理访问 WebDAV，避免浏览器 CORS 与凭据外送
// [安全] 携带管理员 Token（Authorization: Bearer），服务端认证后才允许代理请求
const callWebDavProxy = async (
  operation: 'check' | 'upload' | 'download' | 'list' | 'delete',
  config: WebDavConfig,
  payload?: unknown,
  fileName?: string,
) => {
  try {
    const token = localStorage.getItem('cloudnav_auth_token') || '';
    const response = await fetch('/api/webdav', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        operation,
        config,
        payload,
        fileName,
      }),
    });

    if (!response.ok) {
      console.error(`WebDAV Proxy Error: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (e) {
    console.error("WebDAV Proxy Network Error", e);
    return null;
  }
};

export const checkWebDavConnection = async (config: WebDavConfig): Promise<boolean> => {
  if (!config.url || !config.username || !config.password) return false;
  const result = await callWebDavProxy('check', config);
  return result?.success === true;
};

export const listBackups = async (config: WebDavConfig): Promise<Array<{ name: string }>> => {
  const result = await callWebDavProxy('list', config);
  const files = Array.isArray(result?.files) ? result.files : [];
  return files
    .filter((name: unknown): name is string => typeof name === 'string' && name.length > 0)
    .map((name: string) => ({ name }));
};

export const uploadBackup = async (
  config: WebDavConfig,
  payload: unknown,
  fileName: string,
): Promise<boolean> => {
  const result = await callWebDavProxy('upload', config, payload, fileName);
  return result?.success === true;
};

export const deleteBackup = async (config: WebDavConfig, fileName: string): Promise<boolean> => {
  const result = await callWebDavProxy('delete', config, undefined, fileName);
  return result?.success === true;
};

export const downloadBackup = async (config: WebDavConfig, fileName: string): Promise<unknown | null> => {
  const result = await callWebDavProxy('download', config, undefined, fileName);
  if (!result) return null;
  return result.data ?? result;
};