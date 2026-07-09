function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getKV(env) {
  const bindingName = env.KV_BINDING || 'BOOKMARK_KV';
  return env[bindingName];
}

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

  const kv = getKV(env);
  if (!kv) {
    return errorResponse('KV storage not configured', 500);
  }

  const isAuthenticated = async () => {
    const authHeader = request.headers.get('X-Auth-Token');
    if (!authHeader) return false;
    const stored = await kv.get('auth_tokens');
    if (!stored) return false;
    const tokens = JSON.parse(stored);
    return tokens.includes(authHeader);
  };

  if (path === '/api/auth' && method === 'POST') {
    const { password } = await request.json();
    const correctPassword = env.AUTH_PASSWORD;
    if (!correctPassword) {
      return errorResponse('Auth not configured', 500);
    }
    if (password === correctPassword) {
      const token = generateId() + generateId();
      const existing = await kv.get('auth_tokens');
      const tokens = existing ? JSON.parse(existing) : [];
      tokens.push(token);
      if (tokens.length > 50) tokens.shift();
      await kv.put('auth_tokens', JSON.stringify(tokens));
      return jsonResponse({ success: true, token });
    }
    return jsonResponse({ success: false }, 401);
  }

  if (path === '/api/categories') {
    if (method === 'GET') {
      const data = await kv.get('categories');
      const categories = data ? JSON.parse(data) : ['未分类'];
      return jsonResponse({ categories });
    }
    if (method === 'POST') {
      const { name } = await request.json();
      if (!name || !name.trim()) return errorResponse('Category name required');
      const data = await kv.get('categories');
      const categories = data ? JSON.parse(data) : ['未分类'];
      if (!categories.includes(name.trim())) {
        categories.push(name.trim());
        await kv.put('categories', JSON.stringify(categories));
      }
      return jsonResponse({ categories });
    }
  }

  if (path === '/api/bookmarks') {
    if (method === 'GET') {
      const result = await kv.list({ prefix: 'bookmark:' });
      const bookmarks = [];
      for (const key of result.keys) {
        const data = await kv.get(key.key, 'json');
        if (data) bookmarks.push(data);
      }
      bookmarks.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      return jsonResponse({ bookmarks });
    }
    if (method === 'POST') {
      const data = await request.json();
      if (!data.title || !data.url) return errorResponse('Title and URL required');
      const bookmark = {
        id: generateId(),
        title: data.title.trim(),
        url: data.url.trim(),
        description: (data.description || '').trim(),
        category: data.category || '未分类',
        pinned: !!data.pinned,
        isPrivate: !!data.isPrivate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await kv.put('bookmark:' + bookmark.id, JSON.stringify(bookmark));
      const catData = await kv.get('categories');
      const categories = catData ? JSON.parse(catData) : ['未分类'];
      if (!categories.includes(bookmark.category)) {
        categories.push(bookmark.category);
        await kv.put('categories', JSON.stringify(categories));
      }
      return jsonResponse({ bookmark }, 201);
    }
  }

  const bookmarkMatch = path.match(/^\/api\/bookmarks\/(.+)$/);
  if (bookmarkMatch) {
    const id = bookmarkMatch[1];
    if (method === 'GET') {
      const data = await kv.get('bookmark:' + id, 'json');
      if (!data) return errorResponse('Bookmark not found', 404);
      if (data.isPrivate && !(await isAuthenticated())) {
        return errorResponse('Unauthorized', 403);
      }
      return jsonResponse({ bookmark: data });
    }
    if (method === 'PUT') {
      const existing = await kv.get('bookmark:' + id, 'json');
      if (!existing) return errorResponse('Bookmark not found', 404);
      const data = await request.json();
      const updated = {
        ...existing,
        title: data.title !== undefined ? data.title.trim() : existing.title,
        url: data.url !== undefined ? data.url.trim() : existing.url,
        description: data.description !== undefined ? data.description.trim() : existing.description,
        category: data.category || existing.category,
        pinned: data.pinned !== undefined ? !!data.pinned : existing.pinned,
        isPrivate: data.isPrivate !== undefined ? !!data.isPrivate : existing.isPrivate,
        updatedAt: new Date().toISOString()
      };
      await kv.put('bookmark:' + id, JSON.stringify(updated));
      const catData = await kv.get('categories');
      const categories = catData ? JSON.parse(catData) : ['未分类'];
      if (!categories.includes(updated.category)) {
        categories.push(updated.category);
        await kv.put('categories', JSON.stringify(categories));
      }
      return jsonResponse({ bookmark: updated });
    }
    if (method === 'DELETE') {
      await kv.delete('bookmark:' + id);
      return new Response(null, { status: 204 });
    }
  }

  return errorResponse('Not found', 404);
}
