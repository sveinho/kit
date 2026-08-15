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

  // helper: normalize various forms of ids into a file-friendly slug
  function slugifyId(raw) {
    if (!raw) return '';
    let s = raw.toString();
    // if it's an IRI or contains namespace separators, take last segment
    s = s.replace(/^.*[\/:]/, '');
    // lower, replace non-alnum with hyphens, trim hyphens
    s = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return s;
  }

  // Load the canonical registry file: registry.jsonld
  async function loadRegistry() {
    const url = 'registry.jsonld';
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Could not load registry.jsonld');
    return await res.json();
  }

  // Initialize the engine, check URL deep-links and tags
  async function loadArticles() {
    try {
      // Fetch canonical JSON-LD registry
      const data = await loadRegistry();

      const raw = Array.isArray(data) ? data : (data['@graph'] || data.items || []);

      // Normalize nodes into the shape used by the app
      allArticles = raw.map(node => {
        const title = node.title || node.name || node['schema:name'] || '';
        const abstract = node.abstract || node.description || node['schema:description'] || '';
        let tags = node.tags || node.keywords || node['schema:keywords'] || [];
        if (typeof tags === 'string') tags = tags.split(',').map(t => t.trim()).filter(Boolean);
        if (tags && !Array.isArray(tags)) tags = [tags];
        const track = (node.track || node.educationalRole || node['schema:educationalRole'] || node.track || 'all').toString();
        // Compute a file-friendly id that matches the markdown filename
        let rawId = node['@id'] || node.id || (title || '');
        if (typeof rawId === 'string') {
          // If the id contains a namespace or path (e.g. 'module:getting-started' or a full IRI),
          // take the last segment after ':' or '/'. This yields the filename base.
          rawId = rawId.replace(/^.*[\/:]/, '');
        }
        const id = rawId.toString().toLowerCase().trim()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '');
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
      
      // Generate the global tag cloud immediately after data is fetched
      renderGlobalTagCloud();
      
      const urlParams = new URLSearchParams(window.location.search);
      const urlRawId = urlParams.get('id');
      const urlTag = urlParams.get('tag');

      if (urlRawId) {
        // normalize the incoming id so we accept both "module:getting-started" and "getting-started"
        const normalized = slugifyId(urlRawId);
        const matched = allArticles.find(a => a.id === normalized || a.id === urlRawId || (a.raw && (a.raw['@id'] === urlRawId || a.raw.id === urlRawId)));
        if (matched) {
          activeArticleId = matched.id;
          filterArticles(false);
          triggerDirectLinkFetch(matched.id);
          return;
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

  // Auto-fetch Markdown for deep-linked modules if needed
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
      // CSS.escape might not exist on very old browsers; ignore failures
      console.warn('Could not scroll to hash:', err);
    }
  }

  // Search Engine: Filters and sorts elements by track order, tags or relevance search
  function filterArticles(isNewQuery = false) {
    if (!articlesContainer) return;
    
    const searchWords = searchQuery.split(' ').filter(Boolean);
    const isSearching = searchWords.length > 0;

    // If the search query looks like a tag (exact or partial), activate that tag filter and update the URL
    if (isSearching) {
      // build unique tag list
      const uniqueTags = Array.from(new Set(allArticles.flatMap(a => (a.tags || []).map(t => t.trim()))));
      let matchedTag = null;

      // 1) exact word match first
      for (const w of searchWords) {
        const lw = w.toLowerCase();
        const exact = uniqueTags.find(t => t.toLowerCase() === lw);
        if (exact) { matchedTag = exact; break; }
      }

      // 2) then try partial match (tag contains the word)
      if (!matchedTag) {
        for (const w of searchWords) {
          const lw = w.toLowerCase();
          const partial = uniqueTags.find(t => t.toLowerCase().includes(lw));
          if (partial) { matchedTag = partial; break; }
        }
      }

      if (matchedTag) {
        // only update state if it's different
        if (activeTagFilter !== matchedTag) {
          activeTagFilter = matchedTag;
          history.pushState({ tag: matchedTag }, '', `?tag=${encodeURIComponent(matchedTag)}`);
          if (resetBtn) resetBtn.classList.remove('invisible');
          // refresh global tag UI so active class is applied
          renderGlobalTagCloud();
        }
      }

      // proceed with the existing search/filter logic (the activeTagFilter will cause tag-based filtering too)
      filteredArticles = allArticles.filter(article => {
        if (activeTrackFilter !== 'all' && article.track !== activeTrackFilter) return false;
        if (activeTagFilter && (!article.tags || !article.tags.includes(activeTagFilter))) return false;

        const titleText = (article.title || '').toLowerCase();
        const abstractText = (article.abstract || '').toLowerCase();
        const tagsText = (article.tags || []).join(' ').toLowerCase();
        const contentText = (article.markdownContent || '').toLowerCase();
        const combinedSearchText = `${titleText} ${abstractText} ${tagsText} ${contentText}`;

        return searchWords.every(word => {
          if (combinedSearchText.includes(word)) return true;
          const cleanWord = word.replace(/^\./, '');
          const cleanCombined = combinedSearchText.replace(/\./g, '');
          return combinedSearchText.includes(cleanWord) || cleanCombined.includes(cleanWord);
        });
      });

      filteredArticles.sort((a, b) => {
        const titleA = (a.title || '').toLowerCase().trim();
        const titleB = (b.title || '').toLowerCase().trim();
        const firstWord = searchWords[0] || ''; 

        let scoreA = 0;
        let scoreB = 0;

        if (titleA === firstWord || titleA === firstWord.replace(/^\./, '')) {
          scoreA = 3;
        } else if (firstWord && (titleA.startsWith(firstWord) || titleA.startsWith(firstWord.replace(/^\./, '')))) {
          scoreA = 2;
        } else {
          scoreA = 1;
        }

        if (titleB === firstWord || titleB === firstWord.replace(/^\./, '')) {
          scoreB = 3;
        } else if (firstWord && (titleB.startsWith(firstWord) || titleB.startsWith(firstWord.replace(/^\./, '')))) {
          scoreB = 2;
        } else {
          scoreB = 1;
        }

        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        } else {
          return titleA.localeCompare(titleB);
        }
      });
    } else {
      filteredArticles = [...allArticles];
      
      if (activeTrackFilter !== 'all') {
        filteredArticles = filteredArticles.filter(article => article.track === activeTrackFilter);
      }
      
      if (activeTagFilter) {
        filteredArticles = filteredArticles.filter(article => article.tags && article.tags.includes(activeTagFilter));
      }
      
      filteredArticles.sort((a, b) => {
        const trackA = a.track || '';
        const trackB = b.track || '';
        if (trackA !== trackB) return trackA.localeCompare(trackB);
        return (a.order || 0) - (b.order || 0);
      });
    }

    if (isNewQuery) {
      displayedCount = ITEMS_PER_PAGE;
    }
    
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

        // Use markdown-it-anchor plugin if available globally (from a script include)
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

        htmlContent = article.markdownContent && md ? md.render(article.markdownContent) : 'Loading module text...';
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

  // Central state control for tag selection and URL updates
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

  // Central state controller for processing learning track traversal
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

  // Delegated click handler for internal anchor links inside rendered markdown
  let _anchorHandlerInstalled = false;
  function installInternalAnchorHandler() {
    if (_anchorHandlerInstalled || !articlesContainer) return;

    articlesContainer.addEventListener('click', function(e) {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';

      // Handle fragment-only links like "#section"
      if (href.startsWith('#')) {
        e.preventDefault();
        const anchor = href.slice(1);
        // find the article containing this link (or use the active one)
        const articleEl = a.closest('.filterable') || articlesContainer.querySelector(`.filterable[data-id="${activeArticleId}"]`);
        if (!articleEl) return;
        const target = articleEl.querySelector(`#${CSS.escape(anchor)}`);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          // update URL to include module id and hash
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

  // Role Selection Button Controller
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', function() {
      filterButtons.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      activeTrackFilter = this.dataset.track;
      filterArticles(true);
    });
  });

  // Install internal anchor handler once
  installInternalAnchorHandler();

  loadArticles();
});
