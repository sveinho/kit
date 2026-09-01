/**
 * Kit Learning App - Part 1: Setup & Initialization
 */

const SELECTORS = {
  searchInput: '#searchInput',
  resetBtn: '#resetSearchBtn',
  articlesContainer: '#articlesContainer',
  searchCounter: '#searchCounter',
  noResults: '#noResults',
  loadMoreWrapper: '#loadMoreWrapper',
  loadMoreBtn: '#loadMoreBtn',
  globalTagCloud: '#globalTagCloud',
  filterBtn: '.filter-btn',
  tagToggleCheckbox: '#tagToggleCheckbox'
};

const CONFIG = {
  itemsPerPage: 10,
  debounceMs: 250,
  articlePath: (id) => `articles/${id}.md`,
  shareUrl: (id) => `${location.origin}${location.pathname}?id=${id}`,
};

const debounce = (fn, ms) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
};

const slugify = (text) =>
  text
    ?.trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-') ?? 'heading';

const injectHeadingIds = (container, articleId) => {
  const used = new Set();
  container.querySelectorAll('h1, h2, h3, h4').forEach((h) => {
    let base = slugify(h.textContent) || 'heading';
    let id = `${articleId}--${base}`;
    let n = 0;
    while (used.has(id)) {
      n += 1;
      id = `${articleId}--${base}-${n}`;
    }
    used.add(id);
    h.id = id;
  });
};

const rewriteAnchorLinks = (container, articleId) => {
  const prefix = `${articleId}--`;
  container.querySelectorAll('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href.length < 2) return;
    const bare = href.slice(1);
    if (bare.startsWith(prefix)) return;
    if (/^[\w-]+--/.test(bare)) return;
    a.setAttribute('href', `#${prefix}${bare}`);
  });
};

class KitApp {
  #state;
  #refs;
  #md;
  _filterButtons = [];

  constructor() {
    this.#state = {
      all: [],
      filtered: [],
      query: '',
      activeId: null,
      trackFilter: 'all',
      tagFilter: null,
      displayed: CONFIG.itemsPerPage,
    };

    this.#refs = Object.fromEntries(
      Object.entries(SELECTORS).map(([k, sel]) => [k, document.querySelector(sel)])
    );
  }

  async init() {
    this.#bindEvents();
    this.#handleTagVisibility();
    await this.#loadArticles();
  }

  #bindEvents() {
    const { searchInput, resetBtn, loadMoreBtn, articlesContainer, globalTagCloud, tagToggleCheckbox } = this.#refs;

    searchInput?.addEventListener('input', debounce((e) => this.#onSearch(e.target.value), CONFIG.debounceMs));
    resetBtn?.addEventListener('click', () => this.#reset());
    loadMoreBtn?.addEventListener('click', () => {
      this.#state.displayed += CONFIG.itemsPerPage;
      this.#render();
    });

    globalTagCloud?.addEventListener('click', (e) => {
      const btn = e.target.closest('.global-tag-btn');
      if (btn) this.#toggleTag(btn.dataset.tag);
    });

    tagToggleCheckbox?.addEventListener('change', () => this.#handleTagVisibility());

    articlesContainer?.addEventListener('click', (e) => this.#onArticleClick(e));

    this._filterButtons = Array.from(document.querySelectorAll(SELECTORS.filterBtn));
    this._filterButtons.forEach((btn) =>
      btn.addEventListener('click', () => this.#setTrackFilter(btn.dataset.track, btn))
    );

    window.addEventListener('popstate', () => this.#applyRoute());
  }

  #handleTagVisibility() {
    const { tagToggleCheckbox, globalTagCloud } = this.#refs;
    if (!globalTagCloud || !tagToggleCheckbox) return;

    if (tagToggleCheckbox.checked) {
      globalTagCloud.classList.remove('hidden');
    } else {
      globalTagCloud.classList.add('hidden');
    }
  }

  #syncUrl(params = {}, hash = '') {
    const url = new URL(location.href);
    url.search = '';
    Object.entries(params).forEach(([k, v]) => {
      if (v != null) url.searchParams.set(k, String(v));
    });
    if (hash) {
      url.hash = hash.startsWith('#') ? hash.slice(1) : hash;
    } else {
      url.hash = '';
    }
    history.pushState({}, '', url);
  }
  
  /**
   * Kit Learning App - Part 2: Routing, Loading & Filtering Logic
   */
  
  #applyRoute() {
    const url = new URL(location.href);
    const id = url.searchParams.get('id');
    const tag = url.searchParams.get('tag');
    const track = url.searchParams.get('track');

    this.#state.trackFilter = track || 'all';
    
    this._filterButtons.forEach(btn => {
      const isTargetActive = btn.dataset.track === this.#state.trackFilter;
      btn.classList.toggle('active', isTargetActive);
    });

    if (id && this.#state.all.some((a) => a.id === id)) {
      this.#state.activeId = id;
      this.#state.tagFilter = null;
      this.#filter(false);
      this.#ensureLoadedAndScroll(id, url.hash);
    } else if (tag) {
      this.#state.activeId = null;
      this.#state.tagFilter = decodeURIComponent(tag);
      this.#filter(true);
    } else {
      this.#state.activeId = null;
      this.#state.tagFilter = null;
      this.#filter(true);
    }

    this.#renderGlobalTagCloud();
    this.#syncResetButton();
  }

  async #loadArticles() {
    const { articlesContainer } = this.#refs;
    try {
      const res = await fetch('index.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.#state.all = await res.json();
      this.#renderGlobalTagCloud();
      this.#applyRoute();
    } catch (err) {
      console.error('Failed to load article index:', err);
      if (articlesContainer) {
        articlesContainer.innerHTML = `<p class="error">Could not fetch index. Please ensure you are running via a local development server.</p>`;
      }
    }
  }

  async #loadMarkdown(article) {
    try {
      const res = await fetch(CONFIG.articlePath(article.id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      article.markdownContent = await res.text();
      this.#render();
    } catch (err) {
      console.error('Markdown load failed:', err);
      article.markdownContent = `<p class="error">Error loading document.</p>`;
      this.#render();
    }
  }

  async #ensureLoadedAndScroll(articleId, hash) {
    const article = this.#state.all.find((a) => a.id === articleId);
    if (!article) return;
    if (!article.markdownContent) {
      await this.#loadMarkdown(article);
    }
    requestAnimationFrame(() => this.#scrollToAnchor(hash));
  }

  #filter(resetPagination = false) {
    const words = this.#state.query.split(/\s+/).filter(Boolean);
    const isSearching = words.length > 0;
    const { trackFilter, tagFilter, all } = this.#state;

    let result = all.filter((a) => {
      if (trackFilter !== 'all' && a.track !== trackFilter) return false;
      if (tagFilter && !a.tags?.includes(tagFilter)) return false;
      if (!isSearching) return true;

      const haystack = `${a.title ?? ''} ${a.abstract ?? ''} ${a.tags?.join(' ') ?? ''}`.toLowerCase();
      return words.every((w) => {
        const clean = w.replace(/^\./, '');
        const safe = haystack.replace(/\./g, '');
        return haystack.includes(w) || safe.includes(clean);
      });
    });

    if (isSearching) {
      const first = words[0] ?? '';
      const scoreOf = (title) => {
        const t = title.toLowerCase().trim();
        const c = first.replace(/^\./, '');
        if (t === first || t === c) return 3;
        if (t.startsWith(first) || t.startsWith(c)) return 2;
        return 1;
      };
      result.sort((a, b) => scoreOf(b.title) - scoreOf(a.title) || a.title.localeCompare(b.title));
    } else {
      result.sort((a, b) => {
        const ta = a.track || '';
        const tb = b.track || '';
        if (ta !== tb) return ta.localeCompare(tb);
        return (a.order || 0) - (b.order || 0);
      });
    }

    this.#state.filtered = result;
    if (resetPagination) this.#state.displayed = CONFIG.itemsPerPage;
    this.#render();
  }
  
  /**
   * Kit Learning App - Part 3: UI Rendering & HTML Generation
   */
  
  #render() {
    const { articlesContainer, loadMoreWrapper } = this.#refs;
    const { filtered, displayed } = this.#state;

    this.#updateSearchUI();

    if (!articlesContainer) return;

    if (filtered.length === 0) {
      articlesContainer.innerHTML = '';
      loadMoreWrapper?.classList.add('hidden');
      return;
    }

    const page = filtered.slice(0, displayed);
    articlesContainer.innerHTML = page.map((a) => this.#articleHTML(a)).join('');

    if (this.#state.activeId) {
      const expanded = articlesContainer.querySelector(
        `[data-id="${this.#state.activeId}"] .markdown-body`
      );
      if (expanded) {
        injectHeadingIds(expanded, this.#state.activeId);
        rewriteAnchorLinks(expanded, this.#state.activeId);
      }
    }

    loadMoreWrapper?.classList.toggle('hidden', filtered.length <= displayed);
  }

  #articleHTML(article) {
    const { query, activeId } = this.#state;
    const words = query.split(/\s+/).filter(Boolean);
    const isExpanded = article.id === activeId;

    const titleHtml = this.#highlight(article.title ?? '', words);
    const abstractHtml = this.#highlight(article.abstract ?? '', words);
    const tagsHtml = (article.tags || []).map((tag) => {
      const activeCls = tag === this.#state.tagFilter ? ' active' : '';
      const tagHtml = this.#highlight(tag, words);
      return `<button class="badge tag-click-btn${activeCls}" data-tag="${tag}">#${tagHtml}</button>`;
    }).join(' ');

    let expandedHtml = '';
    if (isExpanded) {
      const md = this.#getMarkdownRenderer();
      const body = md && article.markdownContent ? md.render(article.markdownContent) : '';
      const next = this.#state.all.find(
        (a) => a.track === article.track && a.order === (article.order + 1)
      );
      const nextBtn = next
        ? `<button class="next-step-btn" data-next-id="${next.id}">Next Module →</button>`
        : '';

      expandedHtml = `
        <div class="full-content">
          <div class="markdown-body">${body}</div>
          <div class="learning-path-actions">
            ${nextBtn}
            <button class="share-btn" data-id="${article.id}">Copy share link 🔗</button>
            <button class="close-article-btn">Close Module ✕</button>
          </div>
        </div>
      `;
    }

    const badgeClass = `badge discipline-badge${isExpanded ? ' is-open' : ''}`;

    return `
      <article class="filterable" data-id="${article.id}">
        <div class="article-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:15px;">
          <h2 class="article-title-clickable" style="cursor:pointer;margin:0;">${titleHtml}</h2>
          <button class="${badgeClass}" data-id="${article.id}" style="cursor:pointer;flex-shrink:0;white-space:nowrap;">
            ${this.#escapeHtml(article.discipline || 'Unknown')}
          </button>
        </div>
        <p class="abstract-text">${abstractHtml}</p>
        ${expandedHtml}
        <div class="article-tags-bottom">${tagsHtml}</div>
      </article>
    `;
  }

  #renderGlobalTagCloud() {
    const cloud = this.#refs.globalTagCloud;
    if (!cloud) return;

    const tags = new Set();
    this.#state.all.forEach((a) => a.tags?.forEach((t) => tags.add(t.trim())));
    if (tags.size === 0) {
      cloud.innerHTML = '';
      return;
    }

    cloud.innerHTML = Array.from(tags)
      .sort()
      .map((tag) => {
        const active = tag === this.#state.tagFilter ? ' active' : '';
        return `<button class="global-tag-btn${active}" data-tag="${tag}">#${this.#escapeHtml(tag)}</button>`;
      })
      .join(' ');
  }

  #updateSearchUI() {
    const { searchCounter, noResults } = this.#refs;
    const { filtered, query, tagFilter } = this.#state;
    const isSearching = query.length > 0;
    const tagNotice = tagFilter ? ` filtered by #${tagFilter}` : '';

    if (searchCounter) {
      searchCounter.textContent = isSearching
        ? `Found ${filtered.length} matching steps sorted by relevance${tagNotice}`
        : `Track index loaded. Total modules available: ${filtered.length}${tagNotice}`;
    }
    noResults?.classList.toggle('hidden', filtered.length > 0);
  }
  
  /**
   * Kit Learning App - Part 4: Interaction Handlers, Utilities & DOM Ready
   */
  
  #onSearch(raw) {
    const cleanQuery = raw.trim().toLowerCase();
    
    // If the user has typed 1 or 2 characters, we force the search to be empty.
    // This prevents the app from filtering wildly on single letters.
    if (cleanQuery.length > 0 && cleanQuery.length < 3) {
      this.#state.query = '';
      this.#syncResetButton();
      // We don't run the filter yet, but update the counter to give a subtle message
      const { searchCounter } = this.#refs;
      if (searchCounter) {
        searchCounter.textContent = 'Type at least 3 characters to search...';
      }
      return;
    }

    // When the 3-character threshold is reached (or the field is completely emptied), we search normally
    this.#state.query = cleanQuery;
    this.#syncUrl(this.#state.trackFilter !== 'all' ? { track: this.#state.trackFilter } : {});
    this.#syncResetButton();
    this.#filter(true);
  }

  #setTrackFilter(track, activeBtn) {
    this.#state.trackFilter = track;
    this._filterButtons.forEach((b) => b.classList.toggle('active', b === activeBtn));
    
    const activeArticle = this.#state.activeId
      ? this.#state.all.find((a) => a.id === this.#state.activeId)
      : null;
      
    const targetParams = { track };
    if (this.#state.tagFilter) targetParams.tag = this.#state.tagFilter;

    if (activeArticle && track !== 'all' && activeArticle.track !== track) {
      this.#state.activeId = null;
      this.#syncUrl(targetParams);
    } else {
      if (this.#state.activeId) targetParams.id = this.#state.activeId;
      this.#syncUrl(targetParams);
    }
    
    this.#filter(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  #toggleTag(tag) {
    const isActive = this.#state.tagFilter === tag;
    this.#state.tagFilter = isActive ? null : tag;
    
    const targetParams = {};
    if (this.#state.trackFilter && this.#state.trackFilter !== 'all') {
      targetParams.track = this.#state.trackFilter;
    }
    if (this.#state.tagFilter) targetParams.tag = this.#state.tagFilter;
    if (this.#state.activeId) targetParams.id = this.#state.activeId;
    
    this.#syncUrl(targetParams);
    this.#syncResetButton();
    this.#renderGlobalTagCloud();
    this.#filter(true);
  }

  async #selectModule(id, hash = '') {
    if (this.#state.activeId === id) {
      this.#closeActive();
      return;
    }
    this.#state.activeId = id;
    
    const targetParams = { id };
    if (this.#state.trackFilter && this.#state.trackFilter !== 'all') {
      targetParams.track = this.#state.trackFilter;
    }
    if (this.#state.tagFilter) targetParams.tag = this.#state.tagFilter;
    
    this.#syncUrl(targetParams, hash);
    this.#filter(false);

    const article = this.#state.all.find((a) => a.id === id);
    if (article && !article.markdownContent) {
      await this.#loadMarkdown(article);
    }
    this.#scrollToAnchor(hash || location.hash);
  }

  #closeActive() {
    this.#state.activeId = null;
    
    const targetParams = {};
    if (this.#state.trackFilter && this.#state.trackFilter !== 'all') {
      targetParams.track = this.#state.trackFilter;
    }
    if (this.#state.tagFilter) targetParams.tag = this.#state.tagFilter;
    
    this.#syncUrl(targetParams);
    this.#filter(false);
  }

  #reset() {
    this.#state.query = '';
    if (this.#refs.searchInput) {
      this.#refs.searchInput.value = '';
      this.#refs.searchInput.classList.remove('active-search'); // Remove the color on reset
    }
    this.#state.activeId = null;
    this.#state.tagFilter = null;
    
    const targetParams = {};
    if (this.#state.trackFilter && this.#state.trackFilter !== 'all') {
      targetParams.track = this.#state.trackFilter;
    }
    
    this.#syncUrl(targetParams);
    this.#refs.resetBtn?.classList.add('invisible');
    this.#renderGlobalTagCloud();
    this.#filter(true);
  }


  async #copyShareLink(id, btn) {
    try {
      await navigator.clipboard.writeText(CONFIG.shareUrl(id));
      const original = btn.textContent;
      btn.textContent = 'Link copied! ✔';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 2000);
    } catch (err) {
      console.error('Clipboard failed:', err);
    }
  }

  #onArticleClick(e) {
    const tagBtn = e.target.closest('.tag-click-btn');
    if (tagBtn) {
      this.#toggleTag(tagBtn.dataset.tag);
      return;
    }

    const artEl = e.target.closest('.filterable');
    const artId = artEl?.dataset.id;
    if (e.target.closest('.article-title-clickable') || e.target.closest('.discipline-badge')) {
      if (artId) this.#selectModule(artId);
      return;
    }

    const nextBtn = e.target.closest('.next-step-btn');
    if (nextBtn) {
      this.#selectModule(nextBtn.dataset.nextId);
      return;
    }

    const shareBtn = e.target.closest('.share-btn');
    if (shareBtn) {
      this.#copyShareLink(shareBtn.dataset.id, shareBtn);
      return;
    }

    const closeBtn = e.target.closest('.close-article-btn');
    if (closeBtn) {
      this.#closeActive();
      return;
    }

    const a = e.target.closest('a[href]');
    if (a) this.#handleInternalLink(a, e);
  }

  #handleInternalLink(a, event) {
    const href = a.getAttribute('href') || '';

    if (href.startsWith('#')) {
      event.preventDefault();
      
      const targetParams = { id: this.#state.activeId };
      if (this.#state.trackFilter && this.#state.trackFilter !== 'all') {
        targetParams.track = this.#state.trackFilter;
      }
      if (this.#state.tagFilter) targetParams.tag = this.#state.tagFilter;
      
      this.#syncUrl(targetParams, href);
      this.#scrollToAnchor(href);
      return;
    }

    let url;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }

    const id = url.searchParams.get('id');
    const hash = url.hash || '';
    const isSamePage = url.pathname === location.pathname;

    if (isSamePage && id) {
      event.preventDefault();
      this.#selectModule(id, hash);
      return;
    }

    if (url.pathname.endsWith('.md')) {
      event.preventDefault();
      const fileId = url.pathname.split('/').pop().replace(/\.md$/, '');
      this.#selectModule(fileId, hash);
      return;
    }
  }

  #scrollToAnchor(rawHash = '') {
    const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
    const expanded = this.#refs.articlesContainer?.querySelector(
      `[data-id="${this.#state.activeId}"]`
    );
    if (!expanded) return;

    if (hash) {
      let target = document.getElementById(hash);
      if (!target && this.#state.activeId) {
        target = document.getElementById(`${this.#state.activeId}--${hash}`);
      }
      if (target && expanded.contains(target)) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }

    expanded.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  #getMarkdownRenderer() {
    if (this.#md) return this.#md;
    const ctor = typeof window.markdownit === 'function' ? window.markdownit : null;
    this.#md = ctor ? ctor({ html: true, linkify: true }) : null;
    return this.#md;
  }

  #escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  #highlight(text, words) {
    if (!words.length || !text) return this.#escapeHtml(text);
    const safeWords = words
      .map((w) => w.replace(/^\./, ''))
      .filter(Boolean)
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!safeWords.length) return this.#escapeHtml(text);

    const re = new RegExp(`(${safeWords.join('|')})`, 'gi');
    return this.#escapeHtml(text).replace(re, '<mark>$1</mark>');
  }

   #syncResetButton() {
    const { searchInput, resetBtn } = this.#refs;
    
    // Check if there is actually text in the input field right now
    const hasText = searchInput && searchInput.value.trim().length > 0;
    
    // Show or hide the delete button (✕)
    resetBtn?.classList.toggle('invisible', !hasText);
    
    // Add or remove the color highlight on the search field itself
    if (searchInput) {
      searchInput.classList.toggle('active-search', hasText);
    }
  }

}

document.addEventListener('DOMContentLoaded', () => {
  const app = new KitApp();
  app.init();
});
