// Fnav Bookmark Manager - Main Script

class FnavExtension {
  constructor() {
    this.config = {
      apiUrl: '',
      platform: 'edgeone',
      password: '',
      token: ''
    };
    this.categories = [];
    this.categoryTree = {}; // 分类树结构
    this.loadedCategories = new Set(); // 已加载书签的分类
    this.currentTab = null;
    this.linkType = 'current';
    this.categoriesCache = null;
    this.categoriesCacheTime = 0;
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    this.statusTimer = null; // 结果提示回到「等待操作」状态前的定时
    this.STATUS_HOLD = 2600; // 结果提示停留时长(ms)
    this.init();
  }

  async init() {
    try {
      await this.getCurrentTab();
      await this.loadConfig();
      this.bindEvents();
      this.updatePageInfo();
      this.showIdle();
      
      if (this.isConfigured()) {
        await this.loadCategories();
        this.loadCategoryTree();
      }
    } catch (error) {
      console.error('Init failed:', error);
      this.showStatus('初始化失败，请刷新重试', 'error');
    }
  }

  // ========== Utility Methods ==========
  sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/[<>]/g, '').trim().slice(0, 1000);
  }

  async fetchWithTimeout(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return response;
    } catch (error) {
      clearTimeout(timer);
      if (error.name === 'AbortError') {
        throw new Error('请求超时，请检查网络连接');
      }
      throw error;
    }
  }

  getApiUrl() {
    const baseUrl = this.config.apiUrl.replace(/\/$/, '');
    return `${baseUrl}/api/storage`;
  }

  getLinkApiUrl() {
    const baseUrl = this.config.apiUrl.replace(/\/$/, '');
    return `${baseUrl}/api/link`;
  }

  createAuthHeaders() {
    const headers = new Headers();
    if (this.config.token) headers.append('Authorization', `Bearer ${this.config.token}`);
    headers.append('Content-Type', 'application/json');
    return headers;
  }

  async ensureToken(force = false) {
    if (this.config.token && !force) return this.config.token;
    const baseUrl = (this.config.apiUrl || '').replace(/\/$/, '');
    if (!baseUrl || !this.config.password) {
      throw new Error('请先在设置中填写 API 地址和管理密码');
    }
    const response = await this.fetchWithTimeout(`${baseUrl}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: this.config.password, client: 'extension' }),
    }, 10000);
    if (!response.ok) {
      if (response.status === 401) throw new Error('密码错误，请检查管理密码');
      throw new Error(`登录失败 (${response.status})`);
    }
    const data = await response.json().catch(() => ({}));
    if (!data.token) throw new Error('登录失败：服务端未返回 Token');
    this.config.token = data.token;
    try { await this.saveConfig(); } catch (e) { console.warn('Save token failed:', e); }
    return this.config.token;
  }

  async apiFetch(url, options = {}, timeout = 15000) {
    await this.ensureToken();
    const opts = { ...options, headers: new Headers(options.headers || {}) };
    opts.headers.set('Authorization', `Bearer ${this.config.token}`);
    let response = await this.fetchWithTimeout(url, opts, timeout);
    if (response.status === 401) {
      await this.ensureToken(true);
      opts.headers.set('Authorization', `Bearer ${this.config.token}`);
      response = await this.fetchWithTimeout(url, opts, timeout);
    }
    return response;
  }

  getFavicon(url) {
    try {
      const target = url.startsWith('http') ? url : `https://${url}`;
      const urlObj = new URL(target);
      const origin = `${urlObj.protocol}//${urlObj.hostname}`;
      const faviconUrl = `${origin}/favicon.ico`;
      const xinacUrl = `https://api.xinac.net/icon/?url=${encodeURIComponent(urlObj.hostname)}&size=32`;

      // 返回 Promise，由调用方 await；探测成功则用原站图标，失败则 fallback 到 Xinac
      return new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => {
          img.src = '';
          resolve(xinacUrl);
        }, 2500);

        img.onload = () => {
          clearTimeout(timer);
          resolve(faviconUrl);
        };

        img.onerror = () => {
          clearTimeout(timer);
          resolve(xinacUrl);
        };

        img.src = faviconUrl;
      });
    } catch {
      return Promise.resolve('');
    }
  }

  // ========== Tab ==========
  async getCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      this.currentTab = tab;
    } catch (error) {
      console.error('Failed to get current tab:', error);
    }
  }

  // ========== Config ==========
  async loadConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['fnavConfig'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to load config:', chrome.runtime.lastError);
          resolve();
          return;
        }
        if (result.fnavConfig) {
          this.config = { ...this.config, ...result.fnavConfig };
          this.updateConfigUI();
        }
        resolve();
      });
    });
  }

  saveConfig() {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set({ fnavConfig: this.config }, () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to save config:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  updateConfigUI() {
    const apiUrlEl = document.getElementById('apiUrl');
    const passwordEl = document.getElementById('password');
    
    if (apiUrlEl) apiUrlEl.value = this.config.apiUrl || '';
    if (passwordEl) passwordEl.value = this.config.password || '';
    
    const platformRadio = document.querySelector(`input[name="platform"][value="${this.config.platform}"]`);
    if (platformRadio) platformRadio.checked = true;
  }

  updatePageInfo() {
    if (this.currentTab) {
      document.getElementById('pageTitle').textContent = this.currentTab.title || '无标题';
      document.getElementById('pageUrl').textContent = this.currentTab.url || '';
    }
  }

  isConfigured() {
    return this.config.apiUrl && this.config.password;
  }

  // ========== API ==========
  async testApiConnection() {
    const apiUrl = this.getApiUrl();
    
    try {
      const response = await this.apiFetch(
        `${apiUrl}?getConfig=true&readOnly=true`,
        { method: 'GET' },
        8000
      );

      if (!response.ok) {
        if (response.status === 401) throw new Error('密码验证失败，请检查密码是否正确');
        if (response.status === 404) throw new Error('API 地址不存在，请检查地址是否正确');
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this.categories = data.categories || [];
      return true;
    } catch (error) {
      console.error('Connection test failed:', error);
      throw error;
    }
  }

  async loadCategories() {
    const loadingEl = document.getElementById('categoryLoading');
    
    // Check cache
    const now = Date.now();
    if (this.categoriesCache && (now - this.categoriesCacheTime) < this.CACHE_TTL) {
      this.categories = this.categoriesCache;
      this.updateCategoryUI();
      return;
    }

    if (loadingEl) loadingEl.style.display = 'flex';

    try {
      const apiUrl = this.getApiUrl();
      const response = await this.apiFetch(
        `${apiUrl}?getConfig=true&readOnly=true`,
        { method: 'GET' },
        8000
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this.categories = data.categories || [];
      
      // Update cache
      this.categoriesCache = this.categories;
      this.categoriesCacheTime = Date.now();
      
      this.updateCategoryUI();
      this.showStatus(`成功加载 ${this.categories.length} 个分类`, 'success');
    } catch (error) {
      console.error('Failed to load categories:', error);
      this.showStatus(`加载分类失败：${error.message}`, 'error');
    } finally {
      if (loadingEl) loadingEl.style.display = 'none';
    }
  }

  updateCategoryUI() {
    const categorySelect = document.getElementById('categorySelect');
    const categoryFilter = document.getElementById('categoryFilter');
    
    if (categorySelect) {
      categorySelect.innerHTML = '<option value="">请选择分类</option>';
      
      // 构建分类树：显示顶级分类和二级分类
      const topCategories = this.categories.filter(cat => !cat.parentId);
      const subcategories = this.categories.filter(cat => cat.parentId);
      
      topCategories.sort((a, b) => {
        if (a.id === 'common') return -1;
        if (b.id === 'common') return 1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });

      topCategories.forEach(cat => {
        // 添加顶级分类选项
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        categorySelect.appendChild(option);

        // 添加该分类下的二级分类
        const subs = subcategories.filter(sub => sub.parentId === cat.id);
        subs.forEach(sub => {
          const subOption = document.createElement('option');
          subOption.value = sub.id;
          subOption.textContent = `└─ ${sub.name}`;
          categorySelect.appendChild(subOption);
        });
      });
    }

    if (categoryFilter) {
      categoryFilter.innerHTML = '<option value="">全部分类</option>';
      const sortedCategories = [...this.categories].sort((a, b) => a.name.localeCompare(b.name));
      
      sortedCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.name;
        categoryFilter.appendChild(option);
      });
    }
  }

  // ========== Category Tree View ==========
  buildCategoryTree() {
    const tree = {};
    const topCategories = this.categories.filter(cat => !cat.parentId);
    
    topCategories.forEach(cat => {
      const subs = this.categories.filter(sub => sub.parentId === cat.id);
      tree[cat.id] = {
        ...cat,
        subcategories: subs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
        loaded: false,
        loading: false
      };
    });
    
    return tree;
  }

  loadCategoryTree() {
    const categoryTree = document.getElementById('categoryTree');
    if (!categoryTree) return;

    this.categoryTree = this.buildCategoryTree();
    const topCategories = Object.values(this.categoryTree);

    if (topCategories.length === 0) {
      categoryTree.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
          </svg>
          <p>暂无分类</p>
        </div>
      `;
      return;
    }

    categoryTree.innerHTML = topCategories.map(cat => {
      const hasSubs = cat.subcategories.length > 0;
      return `
        <div class="category-group" data-category-id="${cat.id}">
          <div class="category-header" data-category-id="${cat.id}">
            <div class="category-toggle">
              <svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9,18 15,12 9,6"/>
              </svg>
            </div>
            <div class="category-info">
              <div class="category-name">${this.escapeHtml(cat.name)}</div>
              <div class="category-count" data-category-id="${cat.id}">展开</div>
            </div>
          </div>
          ${hasSubs ? `
            <div class="subcategory-list" data-parent-id="${cat.id}">
              ${cat.subcategories.map(sub => `
                <div class="subcategory-item" data-category-id="${sub.id}" data-parent-id="${cat.id}">
                  <div class="subcategory-toggle">
                    <svg class="arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="9,18 15,12 9,6"/>
                    </svg>
                  </div>
                  <div class="category-info">
                    <div class="category-name">${this.escapeHtml(sub.name)}</div>
                    <div class="category-count" data-category-id="${sub.id}">展开</div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    // Use event delegation to avoid duplicate bindings
    categoryTree.onclick = (e) => {
      const header = e.target.closest('.category-header');
      const subItem = e.target.closest('.subcategory-item');
      
      if (header) {
        const categoryId = header.dataset.categoryId;
        this.toggleCategory(categoryId);
      } else if (subItem) {
        const categoryId = subItem.dataset.categoryId;
        const parentId = subItem.dataset.parentId;
        this.toggleCategory(categoryId, parentId);
      }
    };
  }

  async toggleCategory(categoryId, parentId = null) {
    const isSubcategory = !!parentId;
    const treeKey = isSubcategory ? parentId : categoryId;
    
    // Find the clicked element
    const selector = isSubcategory 
      ? `.subcategory-item[data-category-id="${categoryId}"]`
      : `.category-header[data-category-id="${categoryId}"]`;
    const clickedEl = document.querySelector(selector);
    if (!clickedEl) return;

    const targetTree = this.categoryTree[treeKey];
    if (!targetTree) return;

    // If loading, do nothing
    if (targetTree.loading) return;

    // Toggle collapse
    const isExpanded = clickedEl.classList.contains('expanded');
    
    if (isExpanded) {
      // Collapse - remove expanded class and hide bookmark list
      clickedEl.classList.remove('expanded');
      
      // 移除该行展开出来的内容：书签列表 + 搜索结果里的分组小标题
      let listEl = clickedEl.nextElementSibling;
      while (listEl && (listEl.classList.contains('bookmark-list') || listEl.classList.contains('bookmark-group-title'))) {
        const nextList = listEl.nextElementSibling;
        listEl.remove();
        listEl = nextList;
      }
      
      // If top category, also collapse subcategories and hide subcategory list
      if (!isSubcategory) {
        const subList = clickedEl.nextElementSibling;
        if (subList && subList.classList.contains('subcategory-list')) {
          subList.classList.remove('show');
          // Collapse all expanded subcategories
          subList.querySelectorAll('.subcategory-item.expanded').forEach(sub => {
            sub.classList.remove('expanded');
            let subListEl = sub.nextElementSibling;
            while (subListEl && (subListEl.classList.contains('bookmark-list') || subListEl.classList.contains('bookmark-group-title'))) {
              const nextSubList = subListEl.nextElementSibling;
              subListEl.remove();
              subListEl = nextSubList;
            }
          });
        }
      }
      return;
    }

    // Expand
    clickedEl.classList.add('expanded');
    targetTree.loading = true;
    
    // For top categories, also show subcategory list
    if (!isSubcategory) {
      const subList = clickedEl.nextElementSibling;
      if (subList && subList.classList.contains('subcategory-list')) {
        subList.classList.add('show');
      }
    }

    // Find or create bookmark list container
    let listEl = clickedEl.nextElementSibling;
    if (!listEl || !listEl.classList.contains('bookmark-list')) {
      listEl = document.createElement('div');
      listEl.className = 'bookmark-list show';
      clickedEl.insertAdjacentElement('afterend', listEl);
    } else {
      listEl.classList.add('show');
    }
    
    listEl.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>加载书签中...</span>
      </div>
    `;

    try {
      await this.loadBookmarksForCategory(categoryId, listEl);
      targetTree.loaded = true;
      // Update count badge
      const countEl = document.querySelector(`.category-count[data-category-id="${categoryId}"]`);
      if (countEl) {
        const itemCount = listEl.querySelectorAll('.bookmark-item').length;
        const topCat = this.categoryTree[categoryId];
        const hasSubs = topCat && topCat.subcategories && topCat.subcategories.length > 0;
        if (itemCount > 0 || !hasSubs) {
          countEl.textContent = itemCount;
          countEl.classList.add('loaded');
        }
      }
    } catch (error) {
      listEl.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
          <p>加载失败：${error.message}</p>
        </div>
      `;
    } finally {
      targetTree.loading = false;
    }
  }

  async loadBookmarksForCategory(categoryId, container) {
    const apiUrl = this.getApiUrl();
    
    const response = await this.apiFetch(
      `${apiUrl}?getConfig=links&category=${encodeURIComponent(categoryId)}`,
      { method: 'GET' },
      15000
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    let links = await response.json();
    if (!Array.isArray(links)) links = [];

    if (links.length === 0) {
      // Only show "no bookmarks" hint when the top-level category has no subcategories
      const topCat = this.categoryTree[categoryId];
      const hasSubs = topCat && topCat.subcategories && topCat.subcategories.length > 0;
      if (hasSubs) {
        container.innerHTML = '';
      } else {
        container.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <p>该分类下暂无书签</p>
          </div>
        `;
      }
      return;
    }

    // Sort by createdAt desc
    links.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    container.innerHTML = links.map(link => {
      const favicon = link.icon || (() => {
        try {
          const domain = new URL(link.url).hostname;
          return `https://api.xinac.net/icon/?url=${encodeURIComponent(domain)}&size=32`;
        } catch {
          return '';
        }
      })();
      
      return `
        <div class="bookmark-item" data-id="${link.id}" data-url="${this.escapeHtml(link.url)}">
          <div class="bookmark-icon">
            <img src="${favicon}" alt="">
            <div class="icon-placeholder" style="display: none;">
              ${link.title.charAt(0).toUpperCase()}
            </div>
          </div>
          <div class="bookmark-content">
            <div class="bookmark-title">${this.escapeHtml(link.title)}</div>
            <div class="bookmark-url">${this.escapeHtml(link.url)}</div>
          </div>
          <div class="bookmark-actions">
            <button class="open-btn" title="打开链接">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15,3 21,3 21,9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </button>
            <button class="copy-btn" title="复制链接">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Bind bookmark events
    container.querySelectorAll('.bookmark-item').forEach(item => {
      const img = item.querySelector('.bookmark-icon img');
      if (img) {
        img.addEventListener('error', () => {
          img.style.display = 'none';
          const ph = img.nextElementSibling;
          if (ph) ph.style.display = 'flex';
        });
      }
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.bookmark-actions')) {
          const url = item.dataset.url;
          if (url) {
            chrome.tabs.create({ url });
          }
        }
      });

      item.querySelector('.open-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url) {
          chrome.tabs.create({ url });
        }
      });

      item.querySelector('.copy-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url) {
          try {
            await navigator.clipboard.writeText(url);
            this.showStatus('链接已复制', 'success');
          } catch (error) {
            this.showStatus('复制失败', 'error');
          }
        }
      });
    });
  }

  escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ========== Bookmark Operations ==========
  async saveBookmark() {
    let linkData;
    const categoryId = document.getElementById('categorySelect').value;

    if (!categoryId) {
      this.showStatus('请选择分类', 'error');
      return;
    }

    if (this.linkType === 'current') {
      if (!this.currentTab || !this.currentTab.url) {
        this.showStatus('无法获取当前页面信息', 'error');
        return;
      }

      linkData = {
        title: this.sanitize(this.currentTab.title || '无标题'),
        url: this.currentTab.url,
        description: '',
        categoryId: categoryId,
        icon: await this.getFavicon(this.currentTab.url)
      };
    } else {
      const title = document.getElementById('customTitle').value.trim();
      const url = document.getElementById('customUrl').value.trim();
      const description = document.getElementById('customDescription').value.trim();

      if (!title || !url) {
        this.showStatus('请填写标题和 URL', 'error');
        return;
      }

      linkData = {
        title: this.sanitize(title),
        url: url,
        description: this.sanitize(description),
        categoryId: categoryId,
        icon: await this.getFavicon(url)
      };
    }

    const saveBtn = document.getElementById('saveBookmarkBtn');

    // 重复链接校验：精确 URL 已存在时阻止保存
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px;"></div><span>检查中...</span>';
    this.showStatus('正在检查是否重复...', 'testing');
    const isDuplicate = await this.checkDuplicateLink(linkData.url);
    if (isDuplicate) {
      this.showStatus('链接已存在', 'error');
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z"/>
          <polyline points="9,11 12,14 22,4"/>
        </svg>
        保存书签
      `;
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px;"></div><span>保存中...</span>';
    this.showStatus('正在保存...', 'testing');

    try {
      const apiUrl = this.getLinkApiUrl();
      const response = await this.apiFetch(apiUrl, {
        method: 'POST',
        body: JSON.stringify(linkData)
      }, 15000);

      if (response.ok) {
        const result = await response.json();
        const categoryName = result.categoryName || '默认分类';
        this.showStatus(`已保存到「${categoryName}」`, 'success');
        
        // Reset form
        if (this.linkType === 'custom') {
          document.getElementById('customTitle').value = '';
          document.getElementById('customUrl').value = '';
          document.getElementById('customDescription').value = '';
        }

        // Refresh category tree
        this.refreshCategoryTree(categoryId);
      } else {
        const error = await response.json().catch(() => ({ message: '保存失败' }));
        throw new Error(error.message || `保存失败 (${response.status})`);
      }
    } catch (error) {
      console.error('Save bookmark failed:', error);
      this.showStatus(`保存失败：${error.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2z"/>
          <polyline points="9,11 12,14 22,4"/>
        </svg>
        保存书签
      `;
    }
  }

  async refreshCategoryTree(categoryId) {
    // Mark the category as not loaded so it will refresh next time
    if (this.categoryTree[categoryId]) {
      this.categoryTree[categoryId].loaded = false;
    }
    
    // Also check if it's a subcategory
    for (const [parentId, parentCat] of Object.entries(this.categoryTree)) {
      if (parentCat.subcategories.some(sub => sub.id === categoryId)) {
        // Find the subcategory and mark its parent's related tree entry
        const sub = parentCat.subcategories.find(s => s.id === categoryId);
        if (sub) {
          // Mark parent as not loaded if we need to refresh
          this.categoryTree[parentId].loaded = false;
        }
      }
    }
    
    // Reload the tree
    this.loadCategoryTree();
  }

  // ========== Events ==========
  bindEvents() {
    // Tab switching
    document.getElementById('viewTab')?.addEventListener('click', () => {
      this.switchTab('view');
    });
    document.getElementById('addTab')?.addEventListener('click', () => {
      this.switchTab('add');
    });
    document.getElementById('settingsTab')?.addEventListener('click', () => {
      this.switchTab('settings');
    });

    // Search
    document.getElementById('searchInput')?.addEventListener('input', (e) => {
      this.searchBookmarks(e.target.value);
    });

    // Category filter
    document.getElementById('categoryFilter')?.addEventListener('change', (e) => {
      this.filterBookmarks(e.target.value);
    });

    // Refresh
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      this.categoriesCache = null;
      this.categoriesCacheTime = 0;
      this.loadedCategories.clear();
      this.loadCategoryTree();
    });

    // Link type switch
    document.querySelectorAll('input[name="linkType"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.linkType = e.target.value;
          document.getElementById('currentPageSection').classList.toggle('hidden', this.linkType !== 'current');
          document.getElementById('customLinkSection').classList.toggle('hidden', this.linkType !== 'custom');
          this.refreshIdle();
        }
      });
    });

    // Clean URL
    document.getElementById('cleanUrlBtn')?.addEventListener('click', () => {
      if (!this.currentTab || !this.currentTab.url) return;
      const cleaned = this.cleanUrl(this.currentTab.url);
      this.currentTab.url = cleaned;
      document.getElementById('pageUrl').textContent = cleaned;
      this.showStatus('已去除追踪参数', 'success');
    });

    // Save bookmark
    document.getElementById('saveBookmarkBtn')?.addEventListener('click', () => {
      this.saveBookmark();
    });

    // Validate save form
    document.getElementById('customTitle')?.addEventListener('input', () => this.validateSaveForm());
    document.getElementById('customUrl')?.addEventListener('input', () => this.validateSaveForm());
    document.getElementById('categorySelect')?.addEventListener('change', () => this.validateSaveForm());

    // Test connection
    document.getElementById('testBtn')?.addEventListener('click', () => {
      this.testConnection();
    });

    // Save config
    document.getElementById('saveConfigBtn')?.addEventListener('click', () => {
      this.saveConfigFromForm();
    });
  }

  switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.section').forEach(sec => sec.classList.remove('active'));
    
    document.getElementById(`${tabName}Tab`)?.classList.add('active');
    const activeSection = document.getElementById(`${tabName}Section`);
    activeSection?.classList.add('active');

    // Move status element into the active section, right before form-actions
    const statusEl = document.getElementById('status');
    if (statusEl && activeSection) {
      const formActions = activeSection.querySelector('.form-actions');
      if (formActions) {
        activeSection.insertBefore(statusEl, formActions);
      } else {
        activeSection.appendChild(statusEl);
      }
    }
    this.refreshIdle();

    if (tabName === 'view') {
      this.loadCategoryTree();
    } else if (tabName === 'add') {
      this.updatePageInfo();
    }
  }

  validateSaveForm() {
    const saveBtn = document.getElementById('saveBookmarkBtn');
    if (!saveBtn) return;

    let isValid = false;
    if (this.linkType === 'current') {
      isValid = !!(this.currentTab && this.currentTab.url);
    } else {
      const title = document.getElementById('customTitle')?.value.trim();
      const url = document.getElementById('customUrl')?.value.trim();
      isValid = !!(title && url);
    }

    const categoryId = document.getElementById('categorySelect')?.value;
    isValid = isValid && !!categoryId;

    saveBtn.disabled = !isValid;
  }

  // ========== Config Actions ==========
  async testConnection() {
    const testBtn = document.getElementById('testBtn');
    const originalText = testBtn.innerHTML;
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const password = document.getElementById('password').value.trim();
    const platform = document.querySelector('input[name="platform"]:checked')?.value || 'edgeone';

    if (!apiUrl || !password) {
      this.showStatus('请填写完整的 API 地址和密码', 'error');
      return;
    }

    testBtn.disabled = true;
    testBtn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px;"></div><span>测试中...</span>';
    this.showStatus('正在测试连接...', 'testing');

    const originalConfig = { ...this.config };

    try {
      this.config.apiUrl = apiUrl;
      this.config.password = password;
      this.config.platform = platform;
      this.config.token = '';

      const success = await this.testApiConnection();
      
      if (success) {
        this.config = { apiUrl, password, platform, token: this.config.token };
        this.showStatus('连接成功', 'success');
        await this.loadCategories();
      }
    } catch (error) {
      this.config = originalConfig;
      this.showStatus(`连接失败：${error.message}`, 'error');
    } finally {
      testBtn.disabled = false;
      testBtn.innerHTML = originalText;
    }
  }

  async saveConfigFromForm() {
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const originalText = saveConfigBtn.innerHTML;
    const apiUrl = document.getElementById('apiUrl').value.trim();
    const password = document.getElementById('password').value.trim();
    const platform = document.querySelector('input[name="platform"]:checked')?.value || 'edgeone';

    if (!apiUrl || !password) {
      this.showStatus('请填写完整的 API 地址和密码', 'error');
      return;
    }

    saveConfigBtn.disabled = true;
    saveConfigBtn.innerHTML = '<div class="spinner" style="width: 14px; height: 14px;"></div><span>保存中...</span>';
    this.showStatus('正在验证配置...', 'testing');

    const originalConfig = { ...this.config };

    try {
      this.config.apiUrl = apiUrl;
      this.config.password = password;
      this.config.platform = platform;
      this.config.token = '';

      const success = await this.testApiConnection();
      
      if (success) {
        this.config = { apiUrl, password, platform, token: this.config.token };
        try {
          await this.saveConfig();
        } catch (e) {
          console.warn('Config save failed:', e);
        }
        
        this.showStatus('配置保存成功', 'success');
        setTimeout(() => this.switchTab('view'), 1500);
      }
    } catch (error) {
      this.config = originalConfig;
      this.showStatus(`配置验证失败：${error.message}`, 'error');
    } finally {
      saveConfigBtn.disabled = false;
      saveConfigBtn.innerHTML = originalText;
    }
  }

  // ========== Search & Filter ==========
  searchBookmarks(query) {
    if (!query.trim()) {
      this.loadCategoryTree();
      return;
    }

    const lowerQuery = query.toLowerCase();
    // Collapse all first
    document.querySelectorAll('.category-header.expanded, .subcategory-item.expanded').forEach(el => {
      el.classList.remove('expanded');
    });
    document.querySelectorAll('.bookmark-list').forEach(el => el.remove());

    // Show loading in tree area
    const treeEl = document.getElementById('categoryTree');
    treeEl.innerHTML = '<div class="loading"><div class="spinner"></div><span>搜索中...</span></div>';

    // Search across all categories
    this.searchAllCategories(lowerQuery, treeEl);
  }

  async searchAllCategories(query, container) {
    const apiUrl = this.getApiUrl();
    const topCategories = this.categories.filter(c => !c.parentId);

    // Get all categories grouped by parent
    const getSubs = (parentId) => this.categories.filter(c => c.parentId === parentId);

    // Build search tasks for all categories
    const tasks = [];
    for (const cat of topCategories) {
      const subs = getSubs(cat.id);
      const catsToSearch = [cat, ...subs];

      for (const c of catsToSearch) {
        tasks.push({
          category: c,
          isTop: c.id === cat.id,
        });
      }
    }

    // Fetch all in parallel
    const results = await Promise.all(
      tasks.map(async ({ category, isTop }) => {
        try {
          const response = await this.apiFetch(
            `${apiUrl}?getConfig=links&category=${encodeURIComponent(category.id)}`,
            { method: 'GET' },
            15000
          );
          if (!response.ok) return { category, links: [] };

          const links = await response.json();
          if (!Array.isArray(links)) return { category, links: [] };

          // Filter by query
          const matched = links.filter(link =>
            link.title?.toLowerCase().includes(query) ||
            link.url?.toLowerCase().includes(query)
          );

          return { category, links: matched, isTop };
        } catch {
          return { category, links: [], isTop };
        }
      })
    );

    // Group results by top category
    const groupedByTop = {};
    for (const top of topCategories) {
      groupedByTop[top.id] = {
        topCategory: top,
        items: [],
      };
    }

    for (const r of results) {
      if (r.links.length === 0) continue;

      // Find top-level parent
      let topId = r.category.parentId;
      while (topId && !topCategories.find(t => t.id === topId)) {
        const parent = this.categories.find(c => c.id === topId);
        topId = parent ? parent.parentId : null;
      }
      if (!topId) topId = r.category.id;

      if (!groupedByTop[topId]) {
        groupedByTop[topId] = {
          topCategory: this.categories.find(c => c.id === topId) || r.category,
          items: [],
        };
      }

      groupedByTop[topId].items.push({
        category: r.category,
        links: r.links,
        isTop: r.isTop,
      });
    }

    // Render results
    let html = '';
    for (const group of Object.values(groupedByTop)) {
      if (group.items.length === 0) continue;

      // Top category header
      html += `
        <div class="category-group">
          <div class="category-header expanded" data-category-id="${group.topCategory.id}">
            <div class="category-toggle">
              <svg class="arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9,18 15,12 9,6"/>
              </svg>
            </div>
            <div class="category-info">
              <div class="category-name">${this.escapeHtml(group.topCategory.name)}</div>
              <div class="category-count loaded">${group.items.reduce((sum, i) => sum + i.links.length, 0)}</div>
            </div>
          </div>
      `;

      for (const item of group.items) {
        const categoryName = item.isTop ? '' : item.category.name;
        if (categoryName) {
          html += `
            <div class="bookmark-group-title">${this.escapeHtml(categoryName)}</div>
          `;
        }

        html += `<div class="bookmark-list show">`;
        html += item.links.map(link => {
          const favicon = link.icon || (() => {
            try {
              const domain = new URL(link.url).hostname;
              return `https://api.xinac.net/icon/?url=${encodeURIComponent(domain)}&size=32`;
            } catch {
              return '';
            }
          })();
          return `
            <div class="bookmark-item" data-id="${link.id}" data-url="${this.escapeHtml(link.url)}">
              <div class="bookmark-icon">
                <img src="${favicon}" alt="">
                <div class="icon-placeholder" style="display: none;">
                  ${link.title.charAt(0).toUpperCase()}
                </div>
              </div>
              <div class="bookmark-content">
                <div class="bookmark-title">${this.escapeHtml(link.title)}</div>
                <div class="bookmark-url">${this.escapeHtml(link.url)}</div>
              </div>
              <div class="bookmark-actions">
                <button class="open-btn" title="打开链接">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                    <polyline points="15,3 21,3 21,9"/>
                    <line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </button>
                <button class="copy-btn" title="复制链接">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            </div>
          `;
        }).join('');
        html += `</div>`;
      }

      html += `</div>`;
    }

    if (!html) {
      html = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
          <p>未找到匹配的书签</p>
        </div>
      `;
    }

    container.innerHTML = html;

    // Bind bookmark events
    container.querySelectorAll('.bookmark-item').forEach(item => {
      const img = item.querySelector('.bookmark-icon img');
      if (img) {
        img.addEventListener('error', () => {
          img.style.display = 'none';
          const ph = img.nextElementSibling;
          if (ph) ph.style.display = 'flex';
        });
      }
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.bookmark-actions')) {
          const url = item.dataset.url;
          if (url) chrome.tabs.create({ url });
        }
      });
      item.querySelector('.open-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url) chrome.tabs.create({ url });
      });
      item.querySelector('.copy-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const url = item.dataset.url;
        if (url) {
          try {
            await navigator.clipboard.writeText(url);
            this.showStatus('链接已复制', 'success');
          } catch {
            this.showStatus('复制失败', 'error');
          }
        }
      });
    });
  }

  filterBookmarks(categoryId) {
    if (!categoryId) {
      this.loadCategoryTree();
      return;
    }

    // Expand and scroll to the category
    this.loadCategoryTree();
    setTimeout(() => {
      const header = document.querySelector(`[data-category-id="${categoryId}"]`);
      if (header) {
        header.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  async checkDuplicateLink(urlToCheck) {
    const cleaned = this.cleanUrl(urlToCheck);
    if (!cleaned) return false;

    const apiUrl = this.getApiUrl();

    const checks = this.categories.map(async (cat) => {
      try {
        const response = await this.apiFetch(
          `${apiUrl}?getConfig=links&category=${encodeURIComponent(cat.id)}`,
          { method: 'GET' },
          8000
        );
        if (!response.ok) return false;
        const links = await response.json();
        if (!Array.isArray(links)) return false;
        return links.some(link => this.cleanUrl(link.url || '') === cleaned);
      } catch {
        return false;
      }
    });

    const results = await Promise.all(checks);
    return results.some(Boolean);
  }

  // ========== URL Utils ==========
  cleanUrl(url) {
    try {
      const urlObj = new URL(url);
      let cleaned = urlObj.origin + urlObj.pathname;
      if (cleaned.endsWith('/') && cleaned !== urlObj.origin + '/') {
        cleaned = cleaned.slice(0, -1);
      }
      return cleaned;
    } catch {
      return url;
    }
  }

  // ========== Status ==========
  // 状态条常驻：不自动隐藏。无操作时回到「等待操作」，进行操作时显示对应提示。
  showStatus(message, type = 'idle') {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;

    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }

    const state = type || 'idle';
    statusEl.className = `status show ${state}`;
    statusEl.textContent = message;
    void statusEl.offsetWidth; // 强制回流，让状态切换的入场动画可重播
    statusEl.classList.add('flash');

    // 结果类提示停留一段时间后回到等待状态，而不是消失
    if (state === 'success' || state === 'error') {
      this.statusTimer = setTimeout(() => this.showIdle(), this.STATUS_HOLD);
    }
  }

  idleMessage() {
    if (!this.isConfigured()) return '等待操作 · 请先在「设置」中配置 Fnav 信息';

    const activeTab = document.querySelector('.tab-btn.active')?.id;
    if (activeTab === 'viewTab') return '等待操作 · 可搜索、展开分类或复制链接';
    if (activeTab === 'settingsTab') return '等待操作 · 可测试连接或保存配置';
    if (this.linkType === 'custom') return '等待操作 · 填写标题和 URL 后保存';
    return '等待操作 · 选择分类后保存当前页面';
  }

  showIdle() {
    this.showStatus(this.idleMessage(), 'idle');
  }

  // 仅在等待状态下刷新提示文案，不打断进行中的操作提示
  refreshIdle() {
    const statusEl = document.getElementById('status');
    if (statusEl && statusEl.classList.contains('idle')) {
      statusEl.textContent = this.idleMessage();
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  new FnavExtension();
});
