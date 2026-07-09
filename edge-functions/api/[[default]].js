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

// Try to find KV binding from env
function getKV(env) {
  // First check if KV_BINDING env var is set (the variable NAME, not the binding itself)
  var bindingName = env.KV_BINDING;
  if (bindingName && env[bindingName]) {
    return env[bindingName];
  }
  // Try common default names
  var commonNames = ['BOOKMARK_KV', 'KV', 'MY_KV', 'kv', 'bookmark_kv'];
  for (var i = 0; i < commonNames.length; i++) {
    if (env[commonNames[i]]) {
      return env[commonNames[i]];
    }
  }
  // Last resort: iterate env keys to find something that looks like a KV binding
  var keys = Object.keys(env);
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    var val = env[key];
    // KV bindings have put/get/delete/list methods
    if (val && typeof val.put === 'function' && typeof val.get === 'function') {
      return val;
    }
  }
  return null;
}

export default async function onRequest(context) {
  try {
    var request = context.request;
    var env = context.env;
    var url = new URL(request.url);
    var path = url.pathname;
    var method = request.method;

    console.log('Request:', method, path);
    console.log('Env keys:', Object.keys(env));

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
    var kv = getKV(env);
    if (!kv) {
      console.error('KV not found. Env keys:', Object.keys(env));
      return errorResponse(
        'KV storage not found. Please: 1) Create a KV namespace, 2) Bind it to this project with variable name BOOKMARK_KV (or set KV_BINDING env var to your variable name)', 
        500
      );
    }
    console.log('KV binding found');

    // Auth check helper
    var checkAuth = async function() {
      try {
        var authHeader = request.headers.get('X-Auth-Token');
        if (!authHeader) return false;
        var stored = await kv.get('auth_tokens');
        if (!stored) return false;
        var tokens = JSON.parse(stored);
        return tokens.indexOf(authHeader) !== -1;
      } catch (e) {
        return false;
      }
    };

    // Parse request body for POST/PUT
    var body = {};
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

      var password = body.password;
      var correctPassword = env.AUTH_PASSWORD;
      if (!correctPassword) {
        return errorResponse('AUTH_PASSWORD environment variable not set', 500);
      }
      if (password === correctPassword) {
        var token = generateId() + generateId();
        var tokens = [];
        try {
          var existing = await kv.get('auth_tokens');
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
        var categories = ['未分类'];
        try {
          var data = await kv.get('categories');
          if (data) categories = JSON.parse(data);
        } catch (e) {}
        return jsonResponse({ categories });
      }
      if (method === 'POST') {
        var name = body.name;
        if (!name || !name.trim()) return errorResponse('Category name required');
        var categories = ['未分类'];
        try {
          var data = await kv.get('categories');
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
        var bookmarks = [];
        try {
          var result = await kv.list({ prefix: 'bookmark:' });
          if (result && result.keys) {
            for (var i = 0; i < result.keys.length; i++) {
              try {
                var item = await kv.get(result.keys[i].key, 'json');
                if (item) bookmarks.push(item);
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
        var bookmark = {
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
        var categories = ['未分类'];
        try {
          var catData = await kv.get('categories');
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
      var id = path.substring('/api/bookmarks/'.length);

      if (method === 'GET') {
        var data = await kv.get('bookmark:' + id, 'json');
        if (!data) return errorResponse('Bookmark not found', 404);
        if (data.isPrivate && !(await checkAuth())) {
          return errorResponse('Unauthorized', 403);
        }
        return jsonResponse({ bookmark: data });
      }

      if (method === 'PUT') {
        var existing = await kv.get('bookmark:' + id, 'json');
        if (!existing) return errorResponse('Bookmark not found', 404);
        var updated = {
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
        var categories = ['未分类'];
        try {
          var catData = await kv.get('categories');
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
