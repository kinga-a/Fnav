function jsonResponse(data, status) {
  status = status || 200;
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

function errorResponse(message, status) {
  status = status || 400;
  return jsonResponse({ error: message }, status);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export default async function onRequest(context) {
  try {
    const request = context.request;
    const env = context.env;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    console.log('Request:', method, path);

    // CORS preflight
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

    // Get KV binding
    const kv = env.BOOKMARK_KV;
    if (!kv) {
      console.error('KV not found in env. Available keys:', Object.keys(env));
      return errorResponse('KV storage not configured. Bind KV namespace with variable name BOOKMARK_KV', 500);
    }

    console.log('KV binding found');

    // Auth check helper
    const checkAuth = async function() {
      try {
        const authHeader = request.headers.get('X-Auth-Token');
        if (!authHeader) return false;
        const stored = await kv.get('auth_tokens');
        if (!stored) return false;
        const tokens = JSON.parse(stored);
        return tokens.indexOf(authHeader) !== -1;
      } catch (e) {
        return false;
      }
    };

    // Parse request body for POST/PUT
    let body = {};
    if (method === 'POST' || method === 'PUT') {
      try {
        body = await request.json();
      } catch (e) {
        body = {};
      }
    }

    // Route: /api/auth
    if (path === '/api/auth') {
      if (method !== 'POST') return errorResponse('Method not allowed', 405);

      const password = body.password;
      const correctPassword = env.AUTH_PASSWORD;
      if (!correctPassword) {
        return errorResponse('AUTH_PASSWORD environment variable not set', 500);
      }
      if (password === correctPassword) {
        const token = generateId() + generateId();
        let tokens = [];
        try {
          const existing = await kv.get('auth_tokens');
          if (existing) tokens = JSON.parse(existing);
        } catch (e) {}
        tokens.push(token);
        if (tokens.length > 50) tokens = tokens.slice(tokens.length - 50);
        await kv.put('auth_tokens', JSON.stringify(tokens));
        return jsonResponse({ success: true, token });
      }
      return jsonResponse({ success: false }, 401);
    }

    // Route: /api/categories
    if (path === '/api/categories') {
      if (method === 'GET') {
        let categories = ['未分类'];
        try {
          const data = await kv.get('categories');
          if (data) categories = JSON.parse(data);
        } catch (e) {}
        return jsonResponse({ categories });
      }
      if (method === 'POST') {
        const name = body.name;
        if (!name || !name.trim()) return errorResponse('Category name required');
        let categories = ['未分类'];
        try {
          const data = await kv.get('categories');
          if (data) categories = JSON.parse(data);
        } catch (e) {}
        if (categories.indexOf(name.trim()) === -1) {
          categories.push(name.trim());
          await kv.put('categories', JSON.stringify(categories));
        }
        return jsonResponse({ categories });
      }
      return errorResponse('Method not allowed', 405);
    }

    // Route: /api/bookmarks
    if (path === '/api/bookmarks') {
      if (method === 'GET') {
        const bookmarks = [];
        try {
          const result = await kv.list({ prefix: 'bookmark:' });
          if (result && result.keys) {
            for (let i = 0; i < result.keys.length; i++) {
              try {
                const data = await kv.get(result.keys[i].key, 'json');
                if (data) bookmarks.push(data);
              } catch (e) {}
            }
          }
        } catch (e) {
          console.error('List error:', e.message);
        }
        bookmarks.sort(function(a, b) {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });
        return jsonResponse({ bookmarks });
      }
      if (method === 'POST') {
        if (!body.title || !body.url) return errorResponse('Title and URL required');
        const bookmark = {
          id: generateId(),
          title: body.title.trim(),
          url: body.url.trim(),
          description: (body.description || '').trim(),
          category: body.category || '未分类',
          pinned: !!body.pinned,
          isPrivate: !!body.isPrivate,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        await kv.put('bookmark:' + bookmark.id, JSON.stringify(bookmark));
        let categories = ['未分类'];
        try {
          const catData = await kv.get('categories');
          if (catData) categories = JSON.parse(catData);
        } catch (e) {}
        if (categories.indexOf(bookmark.category) === -1) {
          categories.push(bookmark.category);
          await kv.put('categories', JSON.stringify(categories));
        }
        return jsonResponse({ bookmark }, 201);
      }
      return errorResponse('Method not allowed', 405);
    }

    // Route: /api/bookmarks/:id
    if (path.indexOf('/api/bookmarks/') === 0 && path.length > '/api/bookmarks/'.length) {
      const id = path.substring('/api/bookmarks/'.length);

      if (method === 'GET') {
        const data = await kv.get('bookmark:' + id, 'json');
        if (!data) return errorResponse('Bookmark not found', 404);
        if (data.isPrivate && !(await checkAuth())) {
          return errorResponse('Unauthorized', 403);
        }
        return jsonResponse({ bookmark: data });
      }

      if (method === 'PUT') {
        const existing = await kv.get('bookmark:' + id, 'json');
        if (!existing) return errorResponse('Bookmark not found', 404);
        const updated = {
          id: existing.id,
          title: body.title !== undefined ? body.title.trim() : existing.title,
          url: body.url !== undefined ? body.url.trim() : existing.url,
          description: body.description !== undefined ? body.description.trim() : existing.description,
          category: body.category || existing.category,
          pinned: body.pinned !== undefined ? !!body.pinned : existing.pinned,
          isPrivate: body.isPrivate !== undefined ? !!body.isPrivate : existing.isPrivate,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString()
        };
        await kv.put('bookmark:' + id, JSON.stringify(updated));
        let categories = ['未分类'];
        try {
          const catData = await kv.get('categories');
          if (catData) categories = JSON.parse(catData);
        } catch (e) {}
        if (categories.indexOf(updated.category) === -1) {
          categories.push(updated.category);
          await kv.put('categories', JSON.stringify(categories));
        }
        return jsonResponse({ bookmark: updated });
      }

      if (method === 'DELETE') {
        await kv.delete('bookmark:' + id);
        return new Response(null, { status: 204 });
      }

      return errorResponse('Method not allowed', 405);
    }

    return errorResponse('Not found: ' + path, 404);
  } catch (err) {
    console.error('Fatal Error:', err.message);
    console.error('Stack:', err.stack);
    return errorResponse('Internal server error: ' + err.message, 500);
  }
}
