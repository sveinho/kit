document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('searchInput');
  const resetBtn = document.getElementById('resetSearchBtn');
  const articlesContainer = document.getElementById('articlesContainer');
  const searchCounter = document.getElementById('searchCounter');
  const noResults = document.getElementById('noResults');

  const loadMoreWrapper = document.getElementById('loadMoreWrapper');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  let allArticles = [];
  let filteredArticles = [];
  let searchQuery = '';
  let activeArticleId = null;
  let activeTrackFilter = 'all';
  let activeTagFilter = null;

  const ITEMS_PER_PAGE = 10;
  let displayedCount = ITEMS_PER_PAGE;

  // FlexSearch index (Document)
  let flexIndex = null;

  // Helper: create a file-friendly slug from various @id forms
  function slugifyId(raw) {
    if (!raw) return '';
    let s = raw.toString();
    s = s.replace(/^.*[\/:]/, ''); // last segment after slash or colon
    s = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return s;
  }

  // Try several registry filenames so the app works regardless of which one exists
  async function loadRegistry() {
    const candidates = ['registry.jsonld', 'index.jsonld', 'index.json', 'modules.jsonld'];
    for (const path of candidates) {
      try {
        const res = await fetch(path, { cache: 'no-cache' });
        if (!res.ok) {
          console.info(`Registry not found at ${path} (status ${res.status})`);
          continue;
        }
        console.info(`Loaded registry from ${path}`);
        return await res.json();
      } catch (err) {
        console.warn(`Error fetching ${path}:`, err);
        continue;
      }
    }
    throw new Error('Could not load any registry file (tried: registry.jsonld, index.jsonld, index.json, modules.jsonld)');
  }

  // Build FlexSearch Document index for fast full-text search
  function buildSearchIndex() {
    try {
      if (!window.FlexSearch) {
        console.warn('FlexSearch not found — search will fall back to substring matching.');
        flexIndex = null;
        return;
      }

      flexIndex = new window.FlexSearch.Document({
        document: {
          id: 'id',
          index: ['title', 'abstract', 'tags', 'content'],
          store: ['title', 'abstract', 'tags', 'content']
        },
        tokenize: 'forward',
        cache: true,
        optimize: true
      });

      allArticles.forEach(a => {
        flexIndex.add({
          id: a.id,
          title: a.title || '',
          abstract: a.abstract || '',
          tags: (a.tags || []).join(' '),
          content: (a.markdownContent || (a.raw && (a.raw.content || a.raw['schema:text'] || a.raw.text)) || '')
        });
      });
      console.info('FlexSearch index built with', allArticles.length, 'documents');
    } catch (err) {
      console.warn('Could not build FlexSearch index:', err);
      flexIndex = null;
    }
  }

  // Normalize registry nodes and populate allArticles
  function normalizeNodes(rawNodes) {
    allArticles = rawNodes.map(node => {
      const title = node.title || node.name || node['schema:name'] || '';
      const abstract = node.abstract || node.description || node['schema:description'] || '';
      let tags = node.tags || node.keywords || node['schema:keywords'] || [];
      if (typeof tags === 'string') tags = tags.split(',').map(t => t.trim()).filter(Boolean);
      if (tags && !Array.isArray(tags)) tags = [tags];
      const track = (node.track || node.educationalRole || node['schema:educationalRole'] || node.track || 'all').toString();

      // Determine id: prefer @id or id, normalize to slug for file lookups, but keep raw stored
      let rawId = node['@id'] || node.id || title || '';
      const id = slugifyId(rawId);

      // Prefer inline content from registry
      const markdownContent = node.content || node.text || node['schema:text'] || node.markdownContent || null;

      return {
        id,
        title,
        abstract,
        tags,
        track,
        discipline: node.discipline || track,
        order: node.order || null,
        markdownContent,
        raw: node
      };
    });
  }

  // Initialize the engine, check URL deep-links and tags
  async function loadArticles() {
    try {
      const data = await loadRegistry();
      const raw = Array.isArray(data) ? data : (data['@graph'] || data.items || []);
      normalizeNodes(raw);

      // Build tag cloud & search index
      renderGlobalTagCloud();
      buildSearchIndex();

      const urlParams = new URLSearchParams(window.location.search);
      const urlRawId = urlParams.get('id');
      const urlTag = urlParams.get('tag');

      if (urlRawId) {
        const normalized = slugifyId(urlRawId);
        const matched = allArticles.find(a =>
          a.id === normalized ||
          a.id === urlRawId ||
          (a.raw && (a.raw['@id'] === urlRawId || a.raw.id === urlRawId))
        );
        if (matched) {
          activeArticleId = matched.id;
          filterArticles(false);
          triggerDirectLinkFetch(matched.id);
          return;
        } else {
          console.info('No registry node matched id=', urlRawId);
        }
      }

      if (urlTag) {
        activeTagFilter = decodeURIComponent(urlTag);
        filterArticles(true);
      } else {
        filterArticles(true);
      }
    } catch (error) {
      console.error(error);
      if (articlesContainer) {
        articlesContainer.innerHTML = '<p style="color: red;">Could not fetch registry. Please verify running via local development server.</p>';
      }
    }
  }

  // Auto-fetch Markdown for deep-linked modules if needed (only if no inline content)
  async function triggerDirectLinkFetch(articleId) {
    const targetArticle = allArticles.find(a => a.id === articleId);
    if (!targetArticle) return;
    if (targetArticle.markdownContent) {
      filterArticles(false);
      return;
    }

    try {
      const res = await fetch(`articles/${articleId}.md`);
      if (!res.ok) throw new Error('Markdown file not found');
      const mdText = await res.text();

      targetArticle.markdownContent = mdText;
      // If FlexSearch exists, update index entry for this document's content (best-effort)
      if (flexIndex) {
        try {
          flexIndex.add({
            id: targetArticle.id,
            title: targetArticle.title || '',
            abstract: targetArticle.abstract || '',
            tags: (targetArticle.tags || []).join(' '),
            content: mdText
          });
        } catch (err) {
          console.warn('Failed to update flex index for', targetArticle.id, err);
        }
      }

      filterArticles(false);

      setTimeout(() => {
        const el = articlesContainer.querySelector(`[data-id="${articleId}"]`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch (err) {
      console.error('Could not load direct link markdown:', err);
    }
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getHighlightedHTML(text, words) {
    if (words.length === 0 || !text) return text;
    let html = text;
    words.forEach(word => {
      const cleanWord = word.replace(/^\./, '');
      const regex = new RegExp(`(${escapeRegExp(cleanWord)})`, 'gi');
      html = html.replace(regex, '<mark>$1</mark>');
    });
    return html;
  }

  function debounce(func, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }

  // Helper: scroll to hash inside expanded module (used for anchor deep-links)
  function scrollToHashInExpanded() {
    try {
      const hash = window.location.hash;
      if (!hash || !activeArticleId) return;
      const anchor = hash.startsWith('#') ? hash.slice(1) : hash;
      const expandedEl = articlesContainer.querySelector(`.filterable[data-id="${activeArticleId}"]`);
      if (!expandedEl) return;
      const target = expandedEl.querySelector(`#${CSS.escape(anchor)}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.warn('Could not scroll to hash:', err);
    }
  }

  // Search Engine: use FlexSearch when available, otherwise fallback to substring search
  function filterArticles(isNewQuery = false) {
    if (!articlesContainer) return;

    const searchWords = searchQuery.split(' ').filter(Boolean);
    const isSearching = searchWords.length > 0;

    // Tag auto-detection logic (unchanged)
    if (isSearching) {
      const uniqueTags = Array.from(new Set(allArticles.flatMap(a => (a.tags || []).map(t => t.trim()))));
      let matchedTag = null;
      for (const w of searchWords) {
        const lw = w.toLowerCase();
        const exact = uniqueTags.find(t => t.toLowerCase() === lw);
        if (exact) { matchedTag = exact; break; }
      }
      if (!matchedTag) {
        for (const w of searchWords) {
          const lw = w.toLowerCase();
          const partial = uniqueTags.find(t => t.toLowerCase().includes(lw));
          if (partial) { matchedTag = partial; break; }
        }
      }
      if (matchedTag && activeTagFilter !== matchedTag) {
        activeTagFilter = matchedTag;
        history.pushState({ tag: matchedTag }, '', `?tag=${encodeURIComponent(matchedTag)}`);
        if (resetBtn) resetBtn.classList.remove('invisible');
        renderGlobalTagCloud();
      }
    }

    // If we have a search query, use the index when available
    if (isSearching) {
      let candidateArticles = [...allArticles];

      if (flexIndex) {
        try {
          // FlexSearch returns array of result groups (per field); flatten while preserving order
          const results = flexIndex.search(searchQuery, { enrich: true });
          const orderedIds = [];
          for (const group of results) {
            for (const hit of group.result) {
              if (!orderedIds.includes(hit)) orderedIds.push(hit);
            }
          }
          candidateArticles = orderedIds.map(id => allArticles.find(a => a.id === id)).filter(Boolean);
        } catch (err) {
          console.warn('FlexSearch query failed, falling back to substring search:', err);
          candidateArticles = [...allArticles];
        }
      } else {
        // basic substring filter (pre-filter by track/tag too)
        candidateArticles = allArticles.filter(a => {
          if (activeTrackFilter !== 'all' && a.track !== activeTrackFilter) return false;
          if (activeTagFilter && (!a.tags || !a.tags.includes(activeTagFilter))) return false;
          const combined = `${(a.title||'')} ${(a.abstract||'')} ${(a.tags||[]).join(' ')} ${(a.markdownContent || (a.raw && (a.raw.content || a.raw['schema:text'] || a.raw.text)) || '')}`.toLowerCase();
          return searchWords.every(word => {
            const w = word.toLowerCase();
            if (combined.includes(w)) return true;
            const cleanW = w.replace(/^\./, '');
            const cleanCombined = combined.replace(/\./g, '');
            return combined.includes(cleanW) || cleanCombined.includes(cleanW);
          });
        });
      }

      // final track/tag filtering (apply even if flexIndex returned results)
      filteredArticles = candidateArticles.filter(article => {
        if (activeTrackFilter !== 'all' && article.track !== activeTrackFilter) return false;
        if (activeTagFilter && (!article.tags || !article.tags.includes(activeTagFilter))) return false;
        return true;
      });

      // if no flexIndex, apply title heuristics sorting (preserves previous behavior)
      if (!flexIndex) {
        filteredArticles.sort((a, b) => {
          const titleA = (a.title || '').toLowerCase().trim();
          const titleB = (b.title || '').toLowerCase().trim();
          const firstWord = searchWords[0] || '';
          let scoreA = (titleA === firstWord) ? 3 : (firstWord && titleA.startsWith(firstWord) ? 2 : 1);
          let scoreB = (titleB === firstWord) ? 3 : (firstWord && titleB.startsWith(firstWord) ? 2 : 1);
          if (scoreB !== scoreA) return scoreB - scoreA;
          return titleA.localeCompare(titleB);
        });
      }
    } else {
      // no search text: apply track/tag filters and default sorting
      filteredArticles = [...allArticles];
      if (activeTrackFilter !== 'all') filteredArticles = filteredArticles.filter(article => article.track === activeTrackFilter);
      if (activeTagFilter) filteredArticles = filteredArticles.filter(article => article.tags && article.tags.includes(activeTagFilter));
      filteredArticles.sort((a, b) => {
        const trackA = a.track || '';
        const trackB = b.track || '';
        if (trackA !== trackB) return trackA.localeCompare(trackB);
        return (a.order || 0) - (b.order || 0);
      });
    }

    if (isNewQuery) displayedCount = ITEMS_PER_PAGE;
    renderArticles();
  }

  // Renders learning modules and controls pagination slicing
  function renderArticles() {
    const searchWords = searchQuery.split(' ').filter(Boolean);
    const isSearching = searchWords.length > 0;

    updateSearchUI(filteredArticles.length, isSearching);

    if (filteredArticles.length === 0) {
      articlesContainer.innerHTML = '';
      if (loadMoreWrapper) loadMoreWrapper.classList.add('hidden');
      return;
    }

    const itemsToRender = filteredArticles.slice(0, displayedCount);

    articlesContainer.innerHTML = itemsToRender.map(article => {
      const isExpanded = article.id === activeArticleId;

      // Build markdown-it with optional anchor plugin support when rendering expanded content
      let htmlContent = '';
      if (isExpanded) {
        let md = null;
        if (typeof window.markdownit === 'function') {
          md = new window.markdownit({ html: true, linkify: true });
        } else if (window.markdownit) {
          md = window.markdownit({ html: true, linkify: true });
        }

        // If anchor plugin is available globally, try to use it
        try {
          if (md && typeof window.markdownitAnchor === 'function') {
            md.use(window.markdownitAnchor, {
              permalink: true,
              permalinkBefore: false,
              permalinkClass: 'anchor',
              permalinkSymbol: '#'
            });
          }
        } catch (err) {
          console.warn('markdown-it-anchor plugin not applied:', err);
        }

        // Prefer inline registry content, fall back to article.markdownContent
        const mdSource = article.markdownContent || (article.raw && (article.raw.content || article.raw['schema:text'] || article.raw.text)) || null;
        htmlContent = mdSource && md ? md.render(mdSource) : (mdSource ? mdSource : 'Loading module text...');
      }

      const displayTitle = isSearching ? getHighlightedHTML(article.title || '', searchWords) : article.title;
      const displayAbstract = isSearching ? getHighlightedHTML(article.abstract || '', searchWords) : (article.abstract || '');
      const disciplineValue = article.discipline || (article.track || 'Unknown');
      const tagsArray = article.tags || [];

      const tagsHTML = tagsArray.map(tag => {
        const isActive = tag === activeTagFilter ? 'active' : '';
        const displayTagText = isSearching ? getHighlightedHTML(tag, searchWords) : tag;
        return `<button class="badge status-${tag.toLowerCase().trim()} tag-click-btn ${isActive}" data-tag="${tag}">#${displayTagText}</button>`;
      }).join(' ');

      let expandedHTML = '';
      if (isExpanded) {
        const nextArticle = allArticles.find(a => a.track === article.track && a.order === (article.order + 1));
        let nextBtnHTML = '';
        if (nextArticle) {
          nextBtnHTML = `<button class="next-step-btn" data-next-id="${nextArticle.id}">Next Module: ${nextArticle.title} ➔</button>`;
        }

        expandedHTML = `
          <div class="full-content">
            <div class="markdown-body">${htmlContent}</div>
            <div class="learning-path-actions">
              ${nextBtnHTML}
              <button class="share-btn" data-id="${article.id}">Copy share link 🔗</button>
              <button class="close-article-btn">Close Module ✕</button>
            </div>
          </div>
        `;
      } else {
        expandedHTML = ``;
      }

      return `
        <article class="filterable" data-id="${article.id}">
          <div class="article-header">
            <h2>${displayTitle}</h2>
            <div class="article-meta-inline">
              <span class="badge discipline-badge">${disciplineValue}</span>
            </div>
          </div>
          <p class="abstract-text">${displayAbstract}</p>
          ${expandedHTML}
          <div class="article-tags-bottom">
            ${tagsHTML}
          </div>
        </article>
      `;
    }).join('');

    attachArticleClickEvents();

    if (loadMoreWrapper) {
      if (filteredArticles.length > displayedCount) {
        loadMoreWrapper.classList.remove('hidden');
      } else {
        loadMoreWrapper.classList.add('hidden');
      }
    }

    // After rendering, if an expanded module exists and the URL has a hash, scroll to the anchor
    scrollToHashInExpanded();
  }

  // Async loaders, navigation logic, and clipboard event handling
  function attachArticleClickEvents() {
    articlesContainer.querySelectorAll('.filterable').forEach(articleEl => {
      articleEl.addEventListener('click', async function(e) {
        if (e.target.classList.contains('tag-click-btn')) {
          e.stopPropagation();
          const selectedTag = e.target.dataset.tag;
          handleTagSelection(selectedTag);
          return;
        }

        if (
          e.target.classList.contains('close-article-btn') ||
          e.target.classList.contains('share-btn') ||
          e.target.classList.contains('next-step-btn') ||
          e.target.type === 'checkbox'
        ) return;

        const articleId = this.dataset.id;
        handleModuleSelection(articleId);
      });

      const nextBtn = articleEl.querySelector('.next-step-btn');
      if (nextBtn) {
        nextBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const nextId = this.dataset.nextId;
          handleModuleSelection(nextId);
        });
      }

      const shareBtn = articleEl.querySelector('.share-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          const articleId = this.dataset.id;
          const shareUrl = `${window.location.origin}${window.location.pathname}?id=${articleId}`;

          navigator.clipboard.writeText(shareUrl).then(() => {
            this.textContent = 'Link copied! ✔';
            this.classList.add('copied');

            setTimeout(() => {
              this.textContent = 'Copy share link 🔗';
              this.classList.remove('copied');
            }, 2000);
          }).catch(err => {
            console.error('Could not copy link: ', err);
          });
        });
      }

      const closeBtn = articleEl.querySelector('.close-article-btn');
      if (closeBtn) {
        closeBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          activeArticleId = null;
          history.pushState({}, '', window.location.pathname);
          filterArticles(false);
        });
      }
    });
  }

  // Generate a global tag cloud based on available data
  function renderGlobalTagCloud() {
    const cloudContainer = document.getElementById('globalTagCloud');
    if (!cloudContainer) return;

    const uniqueTags = new Set();
    allArticles.forEach(article => {
      if (article.tags && Array.isArray(article.tags)) {
        article.tags.forEach(tag => uniqueTags.add(tag.trim()));
      }
    });

    if (uniqueTags.size === 0) {
      cloudContainer.innerHTML = '';
      return;
    }

    cloudContainer.innerHTML = Array.from(uniqueTags).sort().map(tag => {
      const isActive = tag === activeTagFilter ? 'active' : '';
      return `<button class="global-tag-btn ${isActive}" data-tag="${tag}">#${tag}</button>`;
    }).join(' ');

    cloudContainer.querySelectorAll('.global-tag-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        handleTagSelection(this.dataset.tag);
      });
    });
  }

  function handleTagSelection(tagName) {
    if (activeTagFilter === tagName) {
      activeTagFilter = null;
      history.pushState({}, '', window.location.pathname);
    } else {
      activeTagFilter = tagName;
      history.pushState({ tag: tagName }, '', `?tag=${encodeURIComponent(tagName)}`);
      if (resetBtn) resetBtn.classList.remove('invisible');
    }

    renderGlobalTagCloud();
    filterArticles(true);
  }

  async function handleModuleSelection(articleId) {
    const targetArticle = allArticles.find(a => a.id === articleId);

    if (activeArticleId === articleId) {
      activeArticleId = null;
      history.pushState({}, '', window.location.pathname);
      filterArticles(false);
      return;
    }

    activeArticleId = articleId;
    history.pushState({id: articleId}, '', `?id=${articleId}`);
    filterArticles(false);

    if (targetArticle && !targetArticle.markdownContent) {
      try {
        const res = await fetch(`articles/${articleId}.md`);
        if (!res.ok) throw new Error('Markdown file not found');
        const mdText = await res.text();

        targetArticle.markdownContent = mdText;
        if (flexIndex) {
          try {
            flexIndex.add({
              id: targetArticle.id,
              title: targetArticle.title || '',
              abstract: targetArticle.abstract || '',
              tags: (targetArticle.tags || []).join(' '),
              content: mdText
            });
          } catch (err) {
            console.warn('Failed to update flex index for', targetArticle.id, err);
          }
        }
        filterArticles(false);
      } catch (err) {
        console.error("Could not load markdown details:", err);
        const contentEl = articlesContainer.querySelector(`[data-id="${articleId}"] .full-content`);
        if (contentEl) contentEl.innerHTML = '<p style="color:red;">Error loading document details.</p>';
        return;
      }
    }

    const newRenderedEl = articlesContainer.querySelector(`[data-id="${articleId}"]`);
    if (newRenderedEl) newRenderedEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Internal anchor handler
  let _anchorHandlerInstalled = false;
  function installInternalAnchorHandler() {
    if (_anchorHandlerInstalled || !articlesContainer) return;

    articlesContainer.addEventListener('click', function(e) {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';

      if (href.startsWith('#')) {
        e.preventDefault();
        const anchor = href.slice(1);
        const articleEl = a.closest('.filterable') || articlesContainer.querySelector(`.filterable[data-id="${activeArticleId}"]`);
        if (!articleEl) return;
        const target = articleEl.querySelector(`#${CSS.escape(anchor)}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.pushState({}, '', `${window.location.pathname}?id=${articleEl.dataset.id}#${anchor}`);
        }
      }
    }, false);

    _anchorHandlerInstalled = true;
  }

  function updateSearchUI(count, isSearching) {
    if (searchCounter) {
      const filterNotice = activeTagFilter ? ` filtered by #${activeTagFilter}` : '';
      searchCounter.textContent = isSearching
        ? `Found ${count} matching steps sorted by relevance${filterNotice}`
        : `Track index loaded. Total modules available: ${count}${filterNotice}`;
    }
    if (noResults) noResults.classList.toggle('hidden', count > 0);
  }

  function resetEntireRegistry() {
    if (searchInput) searchInput.value = '';
    searchQuery = '';
    activeArticleId = null;
    activeTagFilter = null;
    history.pushState({}, '', window.location.pathname);
    if (resetBtn) resetBtn.classList.add('invisible');
    renderGlobalTagCloud();
    filterArticles(true);
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', function() {
      displayedCount += ITEMS_PER_PAGE;
      renderArticles();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', debounce(function(e) {
      const currentInput = e.target.value.trim();
      searchQuery = currentInput.toLowerCase();

      if (resetBtn) {
        if (currentInput.length > 0 || activeTagFilter) {
          resetBtn.classList.remove('invisible');
        } else {
          resetBtn.classList.add('invisible');
        }
      }
      filterArticles(true);
    }, 250));
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', resetEntireRegistry);
  }

  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      filterButtons.forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      activeTrackFilter = this.dataset.track;
      filterArticles(true);
    });
  });

  installInternalAnchorHandler();
  loadArticles();
});
