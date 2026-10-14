// F-Nav Docker 部署服务器
// 零新增依赖，仅用 Node 原生能力：
//  1. 文件系统 KV（FileKV）：替代 EdgeOne / Cloudflare / Vercel 的云 KV
//  2. 复用 functions/api/* 的全部 Worker handler（构造标准 Web Request 调用 onRequest）
//  3. 托管前端构建产物 dist/（SPA fallback 到 index.html）
//
// 环境变量：
//  - PASSWORD          管理员密码（必设，不设则网站无鉴权）
//  - ALLOWED_ORIGIN    跨源白名单（逗号分隔，同源访问无需设置）
//  - DATA_DIR          KV 数据目录（默认 ./data，生产建议挂载 volume）
//  - DIST_DIR          前端构建产物目录（默认 ./dist）
//  - PORT              监听端口（默认 8080）
//  - HOST              监听地址（默认 0.0.0.0）
//  - STORAGE_BACKEND   固定为 filesystem，通知 Worker handler 走文件存储分支

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(process.env.DIST_DIR || path.join(ROOT, 'dist'));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';
const STORAGE_BACKEND = 'filesystem';

// ============ 文件系统 KV（兼容 Cloudflare KV 接口子集） ============
class FileKV {
  constructor(dir) {
    this.dir = dir;
  }

  // key -> 安全文件名（base64url，可逆且无路径风险）
  _keyToFile(key) {
    return Buffer.from(String(key), 'utf-8').toString('base64url');
  }

  async _ensureDir() {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /**
   * 读取 KV
   * @param {string} key
   * @param {{type?: 'text'|'arrayBuffer'|'json'|'stream'}} [opts]
   */
  async get(key, opts = {}) {
    const file = path.join(this.dir, this._keyToFile(key));
    try {
      const buf = await fs.readFile(file);
      // TTL 过期检查
      try {
        const meta = JSON.parse(await fs.readFile(file + '.meta', 'utf-8'));
        if (meta.exp && Date.now() > meta.exp) {
          await this.delete(key);
          return null;
        }
      } catch {}
      if (opts.type === 'arrayBuffer') {
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      if (opts.type === 'json') {
        return JSON.parse(buf.toString('utf-8'));
      }
      return buf.toString('utf-8');
    } catch {
      return null;
    }
  }

  /**
   * 写入 KV
   * @param {string} key
   * @param {string|Buffer|ArrayBuffer|Uint8Array} value
   * @param {{expirationTtl?: number}} [opts]
   */
  async put(key, value, opts = {}) {
    await this._ensureDir();
    const file = path.join(this.dir, this._keyToFile(key));
    let buf;
    if (Buffer.isBuffer(value)) {
      buf = value;
    } else if (value instanceof ArrayBuffer) {
      buf = Buffer.from(value);
    } else if (ArrayBuffer.isView(value)) {
      buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    } else {
      buf = Buffer.from(String(value), 'utf-8');
    }
    await fs.writeFile(file, buf);
    // TTL 元数据：expirationTtl 单位为秒
    const metaFile = file + '.meta';
    if (opts.expirationTtl) {
      await fs.writeFile(metaFile, JSON.stringify({ exp: Date.now() + opts.expirationTtl * 1000 }));
    } else {
      await fs.unlink(metaFile).catch(() => {});
    }
  }

  /**
   * 删除 KV（不存在时静默成功，与 Cloudflare 语义一致）
   */
  async delete(key) {
    const file = path.join(this.dir, this._keyToFile(key));
    await Promise.all([
      fs.unlink(file).catch(() => {}),
      fs.unlink(file + '.meta').catch(() => {}),
    ]);
  }

  /**
   * 按前缀列出 KV key（兼容 Cloudflare KV list）
   * @returns {Promise<{keys: {name: string}[]}>}
   */
  async list({ prefix = '' } = {}) {
    let names = [];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return { keys: [] };
    }
    const keys = names
      .filter((n) => !n.endsWith('.meta'))
      .map((n) => Buffer.from(n, 'base64url').toString('utf-8'))
      .filter((k) => k.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys };
  }
}

// ============ Worker 环境模拟 ============
const kv = new FileKV(DATA_DIR);

function buildEnv() {
  return {
    PASSWORD: process.env.PASSWORD || '',
    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || '',
    STORAGE_BACKEND,
    UPLOAD_PLATFORM: process.env.UPLOAD_PLATFORM || '',
    CLOUDNAV_KV: kv,
  };
}

// ============ HTTP 请求/响应转换 ============
async function toWebRequest(req, url) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const init = { method: req.method, headers };
  if (body && body.length > 0) {
    // 传 Buffer 给 Request 是"已完整读取"，无需 duplex 标记
    init.body = new Uint8Array(body);
  }
  return new Request(url, init);
}

async function sendWebResponse(res, webResponse) {
  res.writeHead(webResponse.status, Object.fromEntries(webResponse.headers.entries()));
  const body = await webResponse.arrayBuffer();
  res.end(Buffer.from(body));
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ============ API 路由（映射到 functions/api/* 的 onRequest） ============
const HANDLERS = {
  '/api/storage': 'storage.js',
  '/api/auth': 'auth.js',
  '/api/favicon': 'favicon.js',
  '/api/link': 'link.js',
  '/api/metadata': 'metadata.js',
  '/api/migrate-icons': 'migrate-icons.js',
  '/api/upload': 'upload.js',
  '/api/webdav': 'webdav.js',
  '/api/debug': 'debug.js',
};

async function handleApi(req, res, url, pathname) {
  const handlerFile = HANDLERS[pathname];
  if (!handlerFile) {
    return sendJson(res, 404, { error: 'Not Found' });
  }
  const { onRequest } = await import(path.join(ROOT, 'functions', 'api', handlerFile));
  const request = await toWebRequest(req, url);
  const response = await onRequest({ request, env: buildEnv() });
  await sendWebResponse(res, response);
}

// ============ 静态文件服务（SPA fallback） ============
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

async function serveStatic(req, res, url, pathname) {
  // 防路径穿越：规范化后必须仍在 DIST_DIR 内
  let filePath = path.normalize(path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!filePath.startsWith(DIST_DIR)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      await fs.stat(filePath);
    }
  } catch {
    // 文件不存在：SPA fallback 到 index.html（排除带扩展名的资源请求）
    if (path.extname(pathname)) {
      return sendJson(res, 404, { error: 'Not Found' });
    }
    filePath = path.join(DIST_DIR, 'index.html');
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(data);
  } catch {
    return sendJson(res, 404, { error: 'Not Found' });
  }
}

// ============ 启动 ============
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, url, pathname);
      return;
    }

    await serveStatic(req, res, url, pathname);
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Internal Server Error' });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[F-Nav] server listening on http://${HOST}:${PORT}`);
  console.log(`[F-Nav] static dir: ${DIST_DIR}`);
  console.log(`[F-Nav] kv data dir: ${DATA_DIR}`);
  console.log(`[F-Nav] PASSWORD set: ${!!process.env.PASSWORD}`);
});

const shutdown = () => {
  console.log('[F-Nav] shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
