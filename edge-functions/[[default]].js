// ============================================
// EdgeOne Pages Bookmark Manager
// File: edge-functions/[[default]].js
// KV Namespace: BOOKMARK_KV (bind in console)
// Env Var: AUTH_PASSWORD
// ============================================

// --- Auth Helpers (no btoa/atob in Edge Runtime) ---

function encodeToken(str) {
  return str.split('').map(c => String.fromCharCode(c.charCodeAt(0) + 1)).join('');
}

function decodeToken(str) {
  return str.split('').map(c => String.fromCharCode(c.charCodeAt(0) - 1)).join('');
}

function getCookieValue(cookieStr, name) {
  if (!cookieStr) return null;
  const match = cookieStr.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function isAuthenticated(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const token = getCookieValue(cookie, 'auth_token');
  if (!token) return false;
  try {
    return decodeToken(token) === (env.AUTH_PASSWORD || '');
  } catch {
    return false;
  }
}

// --- Response Helpers ---

function jsonResponse(data, status, extraHeaders) {
  const headers = { 'Content-Type': 'application/json; charset=UTF-8' };
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
  }
  return new Response(JSON.stringify(data), { status: status || 200, headers });
}

function htmlResponse(html, status) {
  return new Response(html, {
    status: status || 200,
    headers: { 'Content-Type': 'text/html; charset=UTF-8' }
  });
}

function unauthorizedResponse() {
  return jsonResponse({ error: 'Unauthorized' }, 401);
}

function generateId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 10);
  return ts + rand;
}

// --- API Handlers ---

async function handleApiBookmarks(request, env) {
  const kv = env.BOOKMARK_KV;
  const authenticated = isAuthenticated(request, env);

  if (request.method === 'GET') {
    const result = await kv.list({ prefix: 'bm:' });
    const bookmarks = [];
    for (const key of result.keys) {
      const data = await kv.get(key.key, 'json');
      if (data && (!data.isPrivate || authenticated)) {
        bookmarks.push({ id: key.key.replace('bm:', ''), ...data });
      }
    }
    bookmarks.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return jsonResponse({ bookmarks, authenticated });
  }

  if (request.method === 'POST') {
    if (!authenticated) return unauthorizedResponse();
    const body = await request.json();
    const id = generateId();
    const bookmark = {
      title: (body.title || '').trim(),
      url: (body.url || '').trim(),
      description: (body.description || '').trim(),
      category: (body.category || '未分类').trim(),
      isPrivate: !!body.isPrivate,
      isPinned: !!body.isPinned,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await kv.put('bm:' + id, JSON.stringify(bookmark));
    return jsonResponse({ id, ...bookmark });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleApiBookmarkDetail(request, env, id) {
  const kv = env.BOOKMARK_KV;
  const authenticated = isAuthenticated(request, env);
  const key = 'bm:' + id;

  if (request.method === 'GET') {
    const data = await kv.get(key, 'json');
    if (!data) return jsonResponse({ error: 'Not found' }, 404);
    if (data.isPrivate && !authenticated) return unauthorizedResponse();
    return jsonResponse({ id, ...data });
  }

  if (request.method === 'PUT') {
    if (!authenticated) return unauthorizedResponse();
    const existing = await kv.get(key, 'json');
    if (!existing) return jsonResponse({ error: 'Not found' }, 404);
    const body = await request.json();
    const updated = {
      ...existing,
      title: body.title !== undefined ? (body.title || '').trim() : existing.title,
      url: body.url !== undefined ? (body.url || '').trim() : existing.url,
      description: body.description !== undefined ? (body.description || '').trim() : existing.description,
      category: body.category !== undefined ? (body.category || '未分类').trim() : existing.category,
      isPrivate: body.isPrivate !== undefined ? !!body.isPrivate : existing.isPrivate,
      isPinned: body.isPinned !== undefined ? !!body.isPinned : existing.isPinned,
      updatedAt: Date.now()
    };
    await kv.put(key, JSON.stringify(updated));
    return jsonResponse({ id, ...updated });
  }

  if (request.method === 'DELETE') {
    if (!authenticated) return unauthorizedResponse();
    await kv.delete(key);
    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleApiCategories(request, env) {
  const kv = env.BOOKMARK_KV;
  const authenticated = isAuthenticated(request, env);

  if (request.method === 'GET') {
    const result = await kv.list({ prefix: 'bm:' });
    const categories = new Set(['未分类']);
    for (const key of result.keys) {
      const data = await kv.get(key.key, 'json');
      if (data && (!data.isPrivate || authenticated)) {
        categories.add(data.category || '未分类');
      }
    }
    return jsonResponse({ categories: Array.from(categories).sort() });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleApiAuth(request, env) {
  if (request.method === 'POST') {
    const body = await request.json();
    const password = env.AUTH_PASSWORD || '';
    if (!password) {
      return jsonResponse({ error: 'Auth not configured' }, 500);
    }
    if (body.password === password) {
      const token = encodeToken(password);
      const cookie = 'auth_token=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400';
      return jsonResponse({ success: true }, 200, { 'Set-Cookie': cookie });
    }
    return jsonResponse({ error: 'Invalid password' }, 401);
  }

  if (request.method === 'DELETE') {
    const cookie = 'auth_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';
    return jsonResponse({ success: true }, 200, { 'Set-Cookie': cookie });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}

async function handleApiAuthStatus(request, env) {
  return jsonResponse({ authenticated: isAuthenticated(request, env) });
}

// --- HTML Template ---

function getHtmlTemplate() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>书签管理器</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#0f172a;--bg2:#1e293b;--bg3:#334155;--text:#f1f5f9;--text2:#94a3b8;--text3:#64748b;--accent:#3b82f6;--accent2:#60a5fa;--danger:#ef4444;--success:#22c55e;--warn:#f59e0b;--border:#334155;--shadow:0 4px 20px rgba(0,0,0,0.4)}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;overflow-x:hidden}
  .topbar{position:fixed;top:0;left:0;right:0;height:56px;background:var(--bg2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:center;padding:0 16px;z-index:100;gap:12px}
  .menu-btn{position:absolute;left:16px;background:none;border:none;color:var(--text2);font-size:22px;cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center}
  .menu-btn:hover{color:var(--text)}
  .search-box{display:flex;align-items:center;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:0 12px;width:100%;max-width:480px;height:36px}
  .search-box input{background:none;border:none;color:var(--text);outline:none;flex:1;font-size:14px;padding:0 8px}
  .search-box input::placeholder{color:var(--text3)}
  .search-box .clear-btn{background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;display:none}
  .search-box .clear-btn.visible{display:block}
  .auth-btn{position:absolute;right:16px;background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer;font-weight:500;transition:opacity .2s}
  .auth-btn:hover{opacity:.85}
  .auth-btn.logout{background:var(--bg3);color:var(--text2)}
  .sidebar{position:fixed;top:56px;left:0;bottom:0;width:240px;background:var(--bg2);border-right:1px solid var(--border);transform:translateX(-100%);transition:transform .3s ease;z-index:90;overflow-y:auto;padding:16px 0}
  .sidebar.open{transform:translateX(0)}
  .sidebar-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:85;opacity:0;pointer-events:none;transition:opacity .3s}
  .sidebar-overlay.open{opacity:1;pointer-events:auto}
  .sidebar-title{padding:0 20px 12px;font-size:12px;color:var(--text3);text-transform:uppercase;letter-spacing:1px;font-weight:600}
  .sidebar-item{display:flex;align-items:center;padding:10px 20px;cursor:pointer;transition:background .15s;gap:10px;color:var(--text2);font-size:14px;border-left:3px solid transparent}
  .sidebar-item:hover{background:var(--bg3);color:var(--text)}
  .sidebar-item.active{background:rgba(59,130,246,0.15);color:var(--accent2);border-left-color:var(--accent)}
  .sidebar-item .icon{font-size:16px;width:20px;text-align:center}
  .sidebar-item .count{margin-left:auto;font-size:11px;background:var(--bg3);padding:2px 8px;border-radius:10px}
  .sidebar-divider{height:1px;background:var(--border);margin:12px 16px}
  .main{margin-top:56px;padding:24px;min-height:calc(100vh - 56px);transition:margin-left .3s}
  .main.sidebar-open{margin-left:240px}
  .page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
  .page-title{font-size:24px;font-weight:700}
  .page-subtitle{color:var(--text2);font-size:14px;margin-top:4px}
  .btn-primary{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:opacity .2s}
  .btn-primary:hover{opacity:.85}
  .btn-primary:disabled{opacity:.5;cursor:not-allowed}
  .bookmarks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .bookmark-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;transition:transform .15s,box-shadow .15s;position:relative}
  .bookmark-card:hover{transform:translateY(-2px);box-shadow:var(--shadow);border-color:var(--accent)}
  .bookmark-card.pinned{border-left:3px solid var(--warn)}
  .bookmark-card.private{border-left:3px solid var(--danger)}
  .bookmark-card-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px}
  .bookmark-title{font-size:15px;font-weight:600;color:var(--text);text-decoration:none;display:flex;align-items:center;gap:6px;word-break:break-all}
  .bookmark-title:hover{color:var(--accent2)}
  .bookmark-title .favicon{width:16px;height:16px;border-radius:3px;flex-shrink:0}
  .bookmark-badges{display:flex;gap:4px;flex-shrink:0}
  .badge{font-size:10px;padding:2px 6px;border-radius:4px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
  .badge-pinned{background:rgba(245,158,11,0.2);color:var(--warn)}
  .badge-private{background:rgba(239,68,68,0.2);color:var(--danger)}
  .bookmark-url{font-size:12px;color:var(--text3);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .bookmark-desc{font-size:13px;color:var(--text2);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:12px}
  .bookmark-footer{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text3)}
  .bookmark-category{display:inline-flex;align-items:center;gap:4px;background:var(--bg3);padding:3px 10px;border-radius:6px;font-size:11px}
  .bookmark-actions{display:flex;gap:6px}
  .bookmark-actions button{background:var(--bg3);border:none;color:var(--text2);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:12px;transition:all .15s}
  .bookmark-actions button:hover{background:var(--accent);color:#fff}
  .bookmark-actions button.danger:hover{background:var(--danger)}
  .empty-state{text-align:center;padding:60px 20px;color:var(--text3)}
  .empty-state .icon{font-size:48px;margin-bottom:16px}
  .empty-state h3{color:var(--text2);margin-bottom:8px}
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .2s}
  .modal-overlay.open{opacity:1;pointer-events:auto}
  .modal{background:var(--bg2);border:1px solid var(--border);border-radius:16px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;box-shadow:var(--shadow);transform:scale(0.95);transition:transform .2s}
  .modal-overlay.open .modal{transform:scale(1)}
  .modal-header{padding:20px 24px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between}
  .modal-title{font-size:18px;font-weight:600}
  .modal-close{background:none;border:none;color:var(--text3);font-size:24px;cursor:pointer;line-height:1}
  .modal-close:hover{color:var(--text)}
  .modal-body{padding:24px}
  .form-group{margin-bottom:16px}
  .form-group label{display:block;font-size:13px;color:var(--text2);margin-bottom:6px;font-weight:500}
  .form-group input,.form-group textarea,.form-group select{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:14px;outline:none;transition:border-color .15s}
  .form-group input:focus,.form-group textarea:focus,.form-group select:focus{border-color:var(--accent)}
  .form-group textarea{resize:vertical;min-height:80px}
  .form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .checkbox-group{display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0}
  .checkbox-group input[type="checkbox"]{width:18px;height:18px;accent-color:var(--accent);cursor:pointer}
  .checkbox-group label{margin:0;cursor:pointer;color:var(--text)}
  .modal-footer{padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px}
  .btn-secondary{background:var(--bg3);color:var(--text);border:none;border-radius:8px;padding:10px 18px;font-size:14px;cursor:pointer;font-weight:500}
  .btn-secondary:hover{background:var(--border)}
  .auth-input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 14px;color:var(--text);font-size:15px;outline:none;margin-bottom:16px}
  .auth-input:focus{border-color:var(--accent)}
  .toast-container{position:fixed;bottom:24px;right:24px;z-index:300;display:flex;flex-direction:column;gap:8px}
  .toast{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px 18px;box-shadow:var(--shadow);display:flex;align-items:center;gap:10px;animation:slideIn .3s ease;font-size:14px;max-width:320px}
  .toast.success{border-left:3px solid var(--success)}
  .toast.error{border-left:3px solid var(--danger)}
  @keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}
  .loading{display:flex;align-items:center;justify-content:center;padding:60px}
  .spinner{width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  @media(max-width:768px){.main.sidebar-open{margin-left:0}.bookmarks-grid{grid-template-columns:1fr}.form-row{grid-template-columns:1fr}.search-box{max-width:200px}}
</style>
</head>
<body>
<div class="topbar">
  <button class="menu-btn" id="menuBtn" title="切换侧边栏">&#9776;</button>
  <div class="search-box">
    <span>&#128269;</span>
    <input type="text" id="searchInput" placeholder="搜索书签..." autocomplete="off">
    <button class="clear-btn" id="clearSearch">&#10005;</button>
  </div>
  <button class="auth-btn" id="authBtn">登录</button>
</div>
<div class="sidebar-overlay" id="sidebarOverlay"></div>
<div class="sidebar" id="sidebar">
  <div class="sidebar-title">分类</div>
  <div id="sidebarContent"></div>
</div>
<div class="main" id="main">
  <div class="page-header">
    <div>
      <div class="page-title" id="pageTitle">全部书签</div>
      <div class="page-subtitle" id="pageSubtitle">加载中...</div>
    </div>
    <button class="btn-primary" id="addBtn" style="display:none;"><span>+</span> 新建书签</button>
  </div>
  <div class="bookmarks-grid" id="bookmarksGrid"></div>
</div>
<div class="modal-overlay" id="bookmarkModal">
  <div class="modal">
    <div class="modal-header">
      <div class="modal-title" id="modalTitle">新建书签</div>
      <button class="modal-close" id="closeModal">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group"><label>标题 *</label><input type="text" id="bmTitle" placeholder="输入书签标题"></div>
      <div class="form-group"><label>链接 *</label><input type="url" id="bmUrl" placeholder="https://example.com"></div>
      <div class="form-group"><label>描述</label><textarea id="bmDesc" placeholder="简短描述..." rows="2"></textarea></div>
      <div class="form-row">
        <div class="form-group"><label>分类</label><select id="bmCategory"><option value="未分类">未分类</option></select></div>
        <div class="form-group"><label>&nbsp;</label><div style="padding:6px 0;"><div class="checkbox-group"><input type="checkbox" id="bmPinned"><label for="bmPinned">&#128285; 置顶</label></div><div class="checkbox-group"><input type="checkbox" id="bmPrivate"><label for="bmPrivate">&#128274; 私有</label></div></div></div>
      </div>
    </div>
    <div class="modal-footer"><button class="btn-secondary" id="cancelBtn">取消</button><button class="btn-primary" id="saveBtn">保存</button></div>
  </div>
</div>
<div class="modal-overlay" id="authModal">
  <div class="modal" style="max-width:380px;">
    <div class="modal-header"><div class="modal-title">&#128272; 管理员登录</div><button class="modal-close" id="closeAuthModal">&times;</button></div>
    <div class="modal-body">
      <p style="color:var(--text2);font-size:13px;margin-bottom:16px;">输入密码以解锁创建、编辑和删除书签的权限。</p>
      <input type="password" class="auth-input" id="authPassword" placeholder="输入密码">
      <button class="btn-primary" id="loginBtn" style="width:100%;">登录</button>
    </div>
  </div>
</div>
<div class="toast-container" id="toastContainer"></div>
<script>
let bookmarks=[],categories=[],authenticated=false,currentCategory='all',editingId=null,sidebarOpen=false;
const API_BASE='/api';
const $=id=>document.getElementById(id);
async function apiGet(p){const r=await fetch(API_BASE+p);return r.json()}
async function apiPost(p,d){const r=await fetch(API_BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});return r.json()}
async function apiPut(p,d){const r=await fetch(API_BASE+p,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});return r.json()}
async function apiDel(p){const r=await fetch(API_BASE+p,{method:'DELETE'});return r.json()}
function showToast(m,t='success'){const e=document.createElement('div');e.className='toast '+t;e.innerHTML=(t==='success'?'&#9989; ':'&#10060; ')+m;$('toastContainer').appendChild(e);setTimeout(()=>e.remove(),3000)}
function toggleSidebar(){sidebarOpen=!sidebarOpen;$('sidebar').classList.toggle('open',sidebarOpen);$('sidebarOverlay').classList.toggle('open',sidebarOpen);$('main').classList.toggle('sidebar-open',sidebarOpen)}
function openModal(isEdit){$('modalTitle').textContent=isEdit?'编辑书签':'新建书签';$('bookmarkModal').classList.add('open');$('bmTitle').focus()}
function closeBmModal(){editingId=null;$('bookmarkModal').classList.remove('open');$('bmTitle').value='';$('bmUrl').value='';$('bmDesc').value='';$('bmCategory').value='未分类';$('bmPinned').checked=false;$('bmPrivate').checked=false}
function openAuthModal(){$('authModal').classList.add('open');$('authPassword').focus()}
function closeAuthModalFn(){$('authModal').classList.remove('open');$('authPassword').value=''}
function getFavicon(u){try{const x=new URL(u);return'https://www.google.com/s2/favicons?domain='+x.hostname+'&sz=32'}catch{return''}}
function getDomain(u){try{const x=new URL(u);return x.hostname}catch{return u}}
function renderSidebar(){const c={};bookmarks.forEach(b=>{const k=b.category||'未分类';c[k]=(c[k]||0)+1});let h='';h+='<div class="sidebar-item'+(currentCategory==='all'?' active':'')+'" data-cat="all"><span class="icon">&#128209;</span><span>全部书签</span><span class="count">'+bookmarks.length+'</span></div>';h+='<div class="sidebar-divider"></div><div class="sidebar-title">按分类</div>';categories.forEach(cat=>{h+='<div class="sidebar-item'+(currentCategory===cat?' active':'')+'" data-cat="'+cat+'"><span class="icon">&#128193;</span><span>'+cat+'</span><span class="count">'+(c[cat]||0)+'</span></div>'});$('sidebarContent').innerHTML=h;$('sidebarContent').querySelectorAll('.sidebar-item').forEach(item=>{item.addEventListener('click',()=>{currentCategory=item.dataset.cat;renderSidebar();renderBookmarks();if(window.innerWidth<768)toggleSidebar()})})}
function renderBookmarks(){const s=$('searchInput').value.trim().toLowerCase();let f=bookmarks.filter(b=>{if(currentCategory!=='all'&&b.category!==currentCategory)return false;if(!s)return true;const t=(b.title+' '+b.description+' '+b.url+' '+b.category).toLowerCase();return t.includes(s)});f.sort((a,b)=>{if(a.isPinned&&!b.isPinned)return-1;if(!a.isPinned&&b.isPinned)return 1;return(b.updatedAt||0)-(a.updatedAt||0)});$('pageTitle').textContent=currentCategory==='all'?'全部书签':currentCategory;$('pageSubtitle').textContent='共 '+f.length+' 个书签'+(authenticated?' (已登录)':' (访客模式)');if(f.length===0){$('bookmarksGrid').innerHTML='<div class="empty-state"><div class="icon">&#128236;</div><h3>暂无书签</h3><p>点击右上角「新建书签」添加第一个书签</p></div>';return}$('bookmarksGrid').innerHTML=f.map(bm=>{const fv=getFavicon(bm.url),dm=getDomain(bm.url);return'<div class="bookmark-card'+(bm.isPinned?' pinned':'')+(bm.isPrivate?' private':'')+'"><div class="bookmark-card-header"><a class="bookmark-title" href="'+bm.url+'" target="_blank" rel="noopener">'+(fv?'<img class="favicon" src="'+fv+'" alt="">':'')+bm.title+'</a><div class="bookmark-badges">'+(bm.isPinned?'<span class="badge badge-pinned">置顶</span>':'')+(bm.isPrivate?'<span class="badge badge-private">私有</span>':'')+'</div></div><div class="bookmark-url">'+dm+'</div><div class="bookmark-desc">'+(bm.description||'暂无描述')+'</div><div class="bookmark-footer"><span class="bookmark-category">&#128193; '+(bm.category||'未分类')+'</span>'+(authenticated?'<div class="bookmark-actions"><button onclick="window.editBookmark(''+bm.id+'')">&#9999;&#65039; 编辑</button><button class="danger" onclick="window.deleteBookmark(''+bm.id+'')">&#128465;&#65039; 删除</button></div>':'')+'</div></div>'}).join('')}
async function loadData(){try{const[bmData,catData,authData]=await Promise.all([apiGet('/bookmarks'),apiGet('/categories'),apiGet('/auth/status')]);bookmarks=bmData.bookmarks||[];categories=catData.categories||[];authenticated=authData.authenticated||bmData.authenticated||false;if(authenticated){$('authBtn').textContent='退出';$('authBtn').classList.add('logout');$('addBtn').style.display='inline-flex'}else{$('authBtn').textContent='登录';$('authBtn').classList.remove('logout');$('addBtn').style.display='none'}$('bmCategory').innerHTML=categories.map(c=>'<option value="'+c+'">'+c+'</option>').join('');renderSidebar();renderBookmarks()}catch(err){showToast('加载数据失败: '+err.message,'error')}}
async function saveBookmark(){const d={title:$('bmTitle').value.trim(),url:$('bmUrl').value.trim(),description:$('bmDesc').value.trim(),category:$('bmCategory').value,isPinned:$('bmPinned').checked,isPrivate:$('bmPrivate').checked};if(!d.title||!d.url){showToast('请填写标题和链接','error');return}$('saveBtn').disabled=true;try{if(editingId){await apiPut('/bookmarks/'+editingId,d);showToast('书签已更新')}else{await apiPost('/bookmarks',d);showToast('书签已创建')}closeBmModal();await loadData()}catch(err){showToast('保存失败: '+err.message,'error')}finally{$('saveBtn').disabled=false}}
window.editBookmark=async function(id){const bm=bookmarks.find(b=>b.id===id);if(!bm)return;editingId=id;$('bmTitle').value=bm.title;$('bmUrl').value=bm.url;$('bmDesc').value=bm.description||'';$('bmCategory').value=bm.category||'未分类';$('bmPinned').checked=bm.isPinned;$('bmPrivate').checked=bm.isPrivate;openModal(true)}
window.deleteBookmark=async function(id){if(!confirm('确定要删除这个书签吗？'))return;try{await apiDel('/bookmarks/'+id);showToast('书签已删除');await loadData()}catch(err){showToast('删除失败: '+err.message,'error')}}
async function login(){const pwd=$('authPassword').value.trim();if(!pwd)return;try{const res=await apiPost('/auth',{password:pwd});if(res.success){closeAuthModalFn();showToast('登录成功');await loadData()}else{showToast(res.error||'密码错误','error')}}catch(err){showToast('登录失败: '+err.message,'error')}}
async function logout(){try{await apiDel('/auth');showToast('已退出登录');await loadData()}catch(err){showToast('退出失败','error')}}
$('menuBtn').addEventListener('click',toggleSidebar);$('sidebarOverlay').addEventListener('click',toggleSidebar);$('searchInput').addEventListener('input',()=>{$('clearSearch').classList.toggle('visible',$('searchInput').value.length>0);renderBookmarks()});$('clearSearch').addEventListener('click',()=>{$('searchInput').value='';$('clearSearch').classList.remove('visible');renderBookmarks()});$('authBtn').addEventListener('click',()=>{if(authenticated)logout();else openAuthModal()});$('addBtn').addEventListener('click',()=>{editingId=null;openModal(false)});$('saveBtn').addEventListener('click',saveBookmark);$('cancelBtn').addEventListener('click',closeBmModal);$('closeModal').addEventListener('click',closeBmModal);$('closeAuthModal').addEventListener('click',closeAuthModalFn);$('loginBtn').addEventListener('click',login);$('authPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('bookmarkModal').addEventListener('click',e=>{if(e.target===$('bookmarkModal'))closeBmModal()});$('authModal').addEventListener('click',e=>{if(e.target===$('authModal'))closeAuthModalFn()});loadData();
</script>
</body>
</html>`;
}

// --- Main Handler ---

export default async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // API routes
  if (pathname === '/api/bookmarks') {
    return handleApiBookmarks(request, env);
  }
  if (pathname.startsWith('/api/bookmarks/')) {
    const id = pathname.replace('/api/bookmarks/', '');
    return handleApiBookmarkDetail(request, env, id);
  }
  if (pathname === '/api/categories') {
    return handleApiCategories(request, env);
  }
  if (pathname === '/api/auth') {
    return handleApiAuth(request, env);
  }
  if (pathname === '/api/auth/status') {
    return handleApiAuthStatus(request, env);
  }

  // SPA fallback - serve HTML for all other routes
  return htmlResponse(getHtmlTemplate());
}
