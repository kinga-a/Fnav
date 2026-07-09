export default async function onRequest(context) {
  var request = context.request;
  var env = context.env;
  var url = new URL(request.url);
  var path = url.pathname;
  var method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token'
      }
    });
  }

  var kv = BOOKMARK_KV;

  var authCheck = async function() {
    var h = request.headers.get('X-Auth-Token');
    if (!h) return false;
    var s = await kv.get('auth_tokens');
    if (!s) return false;
    var tokens = JSON.parse(s);
    return tokens.indexOf(h) !== -1;
  };

  var body = {};
  if (method === 'POST' || method === 'PUT') {
    try { body = await request.json(); } catch (e) {}
  }

  if (path === '/api/auth') {
    var pwd = env.AUTH_PASSWORD;
    if (!pwd) {
      return new Response(JSON.stringify({ error: 'AUTH_PASSWORD not set' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    if (body.password === pwd) {
      var token = Date.now().toString(36) + Math.random().toString(36).substr(2);
      var tokens = [];
      try {
        var e = await kv.get('auth_tokens');
        if (e) tokens = JSON.parse(e);
      } catch (err) {}
      tokens.push(token);
      if (tokens.length > 50) tokens = tokens.slice(tokens.length - 50);
      await kv.put('auth_tokens', JSON.stringify(tokens));
      return new Response(JSON.stringify({ success: true, token }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: false }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (path === '/api/categories') {
    if (method === 'GET') {
      var c = ['未分类'];
      try {
        var d = await kv.get('categories');
        if (d) c = JSON.parse(d);
      } catch (e) {}
      return new Response(JSON.stringify({ categories: c }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'POST') {
      if (!(await authCheck())) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      var name = body.name;
      if (!name || !name.trim()) {
        return new Response(JSON.stringify({ error: 'Name required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      var c = ['未分类'];
      try {
        var d = await kv.get('categories');
        if (d) c = JSON.parse(d);
      } catch (e) {}
      if (c.indexOf(name.trim()) === -1) {
        c.push(name.trim());
        await kv.put('categories', JSON.stringify(c));
      }
      return new Response(JSON.stringify({ categories: c }), { headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }
// 拖拽保存分类排序
if (path === '/api/categories/sort' && method === 'PUT') {
  if (!(await authCheck())) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (!body.list || !Array.isArray(body.list)) {
    return new Response(JSON.stringify({ error: '参数错误' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  await kv.put('categories', JSON.stringify(body.list));
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

// 删除指定分类
if (path.startsWith('/api/categories/') && method === 'DELETE') {
  if (!(await authCheck())) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const name = decodeURIComponent(path.replace('/api/categories/', ''));
  if (name === '未分类') {
    return new Response(JSON.stringify({ error: '默认分类禁止删除' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  let catList = await kv.get('categories', 'json') || ['未分类'];
  catList = catList.filter(item => item !== name);
  await kv.put('categories', JSON.stringify(catList));
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}
  
  if (path === '/api/bookmarks') {
    if (method === 'GET') {
      var b = [];
      try {
        var r = await kv.list({ prefix: 'bookmark:' });
        if (r && r.keys) {
          for (var i = 0; i < r.keys.length; i++) {
            try {
              var item = await kv.get(r.keys[i].key, 'json');
              if (item) b.push(item);
            } catch (e) {}
          }
        }
      } catch (e) {}

      // 未登录过滤私有书签
      const isLogin = await authCheck();
      if (!isLogin) {
        b = b.filter(item => !item.isPrivate);
      }

      b.sort(function(a, b) {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });
      return new Response(JSON.stringify({ bookmarks: b }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'POST') {
      // 创建书签鉴权
      if (!(await authCheck())) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (!body.title || !body.url) {
        return new Response(JSON.stringify({ error: 'Title and URL required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      var bm = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        title: body.title.trim(),
        url: body.url.trim(),
        description: (body.description || '').trim(),
        category: body.category || '未分类',
        pinned: !!body.pinned,
        isPrivate: !!body.isPrivate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await kv.put('bookmark:' + bm.id, JSON.stringify(bm));
      return new Response(JSON.stringify({ bookmark: bm }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  if (path.indexOf('/api/bookmarks/') === 0 && path.length > '/api/bookmarks/'.length) {
    var id = path.substring('/api/bookmarks/'.length);
    if (method === 'GET') {
      var d = await kv.get('bookmark:' + id, 'json');
      if (!d) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      if (d.isPrivate && !(await authCheck())) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ bookmark: d }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'PUT') {
      // 编辑鉴权
      if (!(await authCheck())) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      var e = await kv.get('bookmark:' + id, 'json');
      if (!e) {
        return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
      }
      var u = {
        id: e.id,
        title: body.title !== undefined ? body.title.trim() : e.title,
        url: body.url !== undefined ? body.url.trim() : e.url,
        description: body.description !== undefined ? body.description.trim() : e.description,
        category: body.category || e.category,
        pinned: body.pinned !== undefined ? !!body.pinned : e.pinned,
        isPrivate: body.isPrivate !== undefined ? !!body.isPrivate : e.isPrivate,
        createdAt: e.createdAt,
        updatedAt: new Date().toISOString()
      };
      await kv.put('bookmark:' + id, JSON.stringify(u));
      return new Response(JSON.stringify({ bookmark: u }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'DELETE') {
      // 删除鉴权
      if (!(await authCheck())) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      await kv.delete('bookmark:' + id);
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
}
