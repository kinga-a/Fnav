export default async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

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

  const kv = BOOKMARK_KV;

  const authCheck = async () => {
    const h = request.headers.get('X-Auth-Token');
    if (!h) return false;
    const s = await kv.get('auth_tokens');
    return s ? JSON.parse(s).includes(h) : false;
  };

  let body = {};
  if (method === 'POST' || method === 'PUT') {
    try { body = await request.json(); } catch (e) {}
  }

  if (path === '/api/auth') {
    const pwd = env.AUTH_PASSWORD;
    if (!pwd) return Response.json({ error: 'AUTH_PASSWORD env var not set' }, { status: 500 });
    if (body.password === pwd) {
      const token = Date.now().toString(36) + Math.random().toString(36).slice(2);
      let tokens = [];
      try { const e = await kv.get('auth_tokens'); if (e) tokens = JSON.parse(e); } catch (e) {}
      tokens.push(token);
      await kv.put('auth_tokens', JSON.stringify(tokens.slice(-50)));
      return Response.json({ success: true, token });
    }
    return Response.json({ success: false }, { status: 401 });
  }

  if (path === '/api/categories') {
    if (method === 'GET') {
      let c = ['未分类'];
      try { const d = await kv.get('categories'); if (d) c = JSON.parse(d); } catch (e) {}
      return Response.json({ categories: c });
    }
    if (method === 'POST') {
      if (!body.name || !body.name.trim()) return Response.json({ error: 'Name required' }, { status: 400 });
      let c = ['未分类'];
      try { const d = await kv.get('categories'); if (d) c = JSON.parse(d); } catch (e) {}
      if (!c.includes(body.name.trim())) { c.push(body.name.trim()); await kv.put('categories', JSON.stringify(c)); }
      return Response.json({ categories: c });
    }
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (path === '/api/bookmarks') {
    if (method === 'GET') {
      const b = [];
      try {
        const r = await kv.list({ prefix: 'bookmark:' });
        for (const k of r.keys) {
          try { const d = await kv.get(k.key, 'json'); if (d) b.push(d); } catch (e) {}
        }
      } catch (e) {}
      b.sort((a, b) => (b.pinned - a.pinned) || (new Date(b.createdAt) - new Date(a.createdAt)));
      return Response.json({ bookmarks: b });
    }
    if (method === 'POST') {
      if (!body.title || !body.url) return Response.json({ error: 'Title and URL required' }, { status: 400 });
      const bm = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
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
      return Response.json({ bookmark: bm }, { status: 201 });
    }
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  const m = path.match(/^\/api\/bookmarks\/(.+)$/);
  if (m) {
    const id = m[1];
    if (method === 'GET') {
      const d = await kv.get('bookmark:' + id, 'json');
      if (!d) return Response.json({ error: 'Not found' }, { status: 404 });
      if (d.isPrivate && !(await authCheck())) return Response.json({ error: 'Unauthorized' }, { status: 403 });
      return Response.json({ bookmark: d });
    }
    if (method === 'PUT') {
      const e = await kv.get('bookmark:' + id, 'json');
      if (!e) return Response.json({ error: 'Not found' }, { status: 404 });
      const u = {
        ...e,
        title: body.title !== undefined ? body.title.trim() : e.title,
        url: body.url !== undefined ? body.url.trim() : e.url,
        description: body.description !== undefined ? body.description.trim() : e.description,
        category: body.category || e.category,
        pinned: body.pinned !== undefined ? !!body.pinned : e.pinned,
        isPrivate: body.isPrivate !== undefined ? !!body.isPrivate : e.isPrivate,
        updatedAt: new Date().toISOString()
      };
      await kv.put('bookmark:' + id, JSON.stringify(u));
      return Response.json({ bookmark: u });
    }
    if (method === 'DELETE') {
      await kv.delete('bookmark:' + id);
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}
