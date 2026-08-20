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

  // Initialize the engine, check URL deep-links and tags
  async function loadArticles() {
    try {
      const response = await fetch('index.json');
      if (!response.ok) throw new Error('Failed to load JSON registry data');
      allArticles = await response.json();
      
      renderGlobalTagCloud();
      
      const urlParams = new URLSearchParams(window.location.search);
      const urlId = urlParams.get('id');
      const urlTag = urlParams.get('tag'); 
      
      if (urlId && allArticles.some(a => a.id === urlId)) {
        activeArticleId = urlId;
        filterArticles(false); 
        await triggerDirectLinkFetch(urlId);
      } else if (urlTag) {
        activeTagFilter = decodeURIComponent(urlTag);
        filterArticles(true);
      } else {
        filterArticles(true); 
      }

      // Aktiver klikk-lytteren for interne lenker
      installInternalAnchorHandler();
    } catch (error) {
      console.error(error);
      if (articlesContainer) {
        articlesContainer.innerHTML = '<p style="color: red;">Could not fetch index. Please verify running via local development server.</p>';
      }
    }
  }

  // Auto-fetch Markdown for deep-linked modules
  async function triggerDirectLinkFetch(articleId) {
    const targetArticle = allArticles.find(a => a.id === articleId);
    if (targetArticle && !targetArticle.markdownContent) {
      try {
        const res = await fetch(`articles/${articleId}.md`);
        if (!res.ok) throw new Error('Markdown file not found');
        const mdText = await res.text();
        
        targetArticle.markdownContent = mdText;
        filterArticles(false); // Dette vil tegne ut og trigge den nye rulle-funksjonen
      } catch (err) {
        console.error("Could not load direct link markdown:", err);
      }
    }
  }

  // Create and reuse a single clean markdown-it renderer instance (No anchor plugin needed)
  function getMarkdownRenderer() {
    if (window.__mdInstance) return window.__mdInstance;
    const mdCtor = (typeof window.markdownit === 'function') ? window.markdownit : null;
    const md = mdCtor ? mdCtor({ html: true, linkify: true }) : null;
    if (md) {
      window.__mdInstance = md;
    }
    return md;
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
  // NY forenklet rulle-funksjon: Velger anker hvis det finnes i URL, ellers toppen av modulen
  function scrollToHashInExpanded() {
    try {
      const hash = window.location.hash;
      const expandedEl = articlesContainer.querySelector(`[data-id="${activeArticleId}"]`);
      if (!expandedEl) return;

      // 1. Hvis vi har en hash i URL-en, prøv å finne overskriften som matcher
      if (hash) {
        const anchorId = hash.startsWith('#') ? hash.slice(1) : hash;
        
        // Hent alle overskrifter inni den åpnede modulen
        const overskrifter = expandedEl.querySelectorAll('h1, h2, h3, h4');
        let target = null;

        overskrifter.forEach(el => {
          // Generer en virtuell ID basert på overskriftsteksten (akkurat slik slugify gjør)
          const vasketTekst = el.textContent.trim().toLowerCase()
            .replace(/[^\w\s-]/g, '')
            .replace(/\s+/g, '-');
          
          if (el.id === anchorId || vasketTekst === anchorId) {
            target = el;
          }
        });

        // Hvis vi fant overskriften, scroll til den og stopp
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          console.log(`Rullet direkte til avsnitt: #${anchorId}`);
          return; 
        }
      }

      // 2. FALLBACK: Hvis ingen hash finnes (eller den ikke ble funnet), rull til toppen av modulen
      expandedEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      console.log(`Rullet til toppen av modulen: ${activeArticleId}`);

    } catch (err) {
      console.warn('Feil under scrolling:', err);
    }
  }

  // Search Engine: Filters and sorts elements by track order, tags or relevance search
  function filterArticles(isNewQuery = false) {
    if (!articlesContainer) return;
    
    const searchWords = searchQuery.split(' ').filter(Boolean);
    const isSearching = searchWords.length > 0;

    if (isSearching) {
      filteredArticles = allArticles.filter(article => {
        if (activeTrackFilter !== 'all' && article.track !== activeTrackFilter) return false;
        if (activeTagFilter && (!article.tags || !article.tags.includes(activeTagFilter))) return false;

        const titleText = (article.title || '').toLowerCase();
        const abstractText = (article.abstract || '').toLowerCase();
        const tagsText = (article.tags || []).join(' ').toLowerCase(); 
        const combinedSearchText = `${titleText} ${abstractText} ${tagsText}`;

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
      const displayTitle = isSearching ? getHighlightedHTML(article.title || '', searchWords) : article.title;
      const displayAbstract = isSearching ? getHighlightedHTML(article.abstract || '', searchWords) : (article.abstract || '');
      
      const disciplineValue = article.discipline || 'Unknown';
      const tagsArray = article.tags || [];

      const tagsHTML = tagsArray.map(tag => {
        const isActive = tag === activeTagFilter ? 'active' : '';
        const displayTagText = isSearching ? getHighlightedHTML(tag, searchWords) : tag;
        return `<button class="badge status-${tag.toLowerCase().trim()} tag-click-btn ${isActive}" data-tag="${tag}">#${displayTagText}</button>`;
      }).join(' ');

      let expandedHTML = '';
      if (isExpanded) {
        const md = getMarkdownRenderer();
        let htmlContent = article.markdownContent && md ? md.render(article.markdownContent) : 'Loading module text...';

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
      }

  

      return `
        <article class="filterable" data-id="${article.id}">
          <div class="article-header" style="display: flex; justify-content: space-between; align-items: flex-start; gap: 15px;">
            <h2 class="article-title-clickable" style="cursor: pointer; margin: 0;">${displayTitle}</h2>
            <button class="${badgeClass}" data-id="${article.id}" style="cursor: pointer; flex-shrink: 0; white-space: nowrap;">
              ${disciplineValue}${toggleIcon}
            </button>
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

    // Kjør den kombinerte rulle-funksjonen etter en bitteliten kunstig forsinkelse (DOM sync)
    if (activeArticleId) {
      setTimeout(() => {
        scrollToHashInExpanded();
      }, 60);
    }
  }
  // Delegated click handler for internal anchor links inside rendered markdown
  let _anchorHandlerInstalled = false;
  function installInternalAnchorHandler() {
    if (_anchorHandlerInstalled || !articlesContainer) return;

    articlesContainer.addEventListener('click', async function(e) {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('href') || '';

      if (href.startsWith('#')) {
        e.preventDefault();
        const anchor = href.slice(1);
        const articleEl = a.closest('.filterable') || articlesContainer.querySelector(`.filterable[data-id="${activeArticleId}"]`);
        if (!articleEl) return;
        
        // Oppdater adressefeltet i nettleseren med ny hash
        history.pushState({}, '', `${window.location.pathname}?id=${articleEl.dataset.id}#${anchor}`);
        // Trigger den smarte rullefunksjonen manuelt etterpå
        scrollToHashInExpanded();
        return;
      }

      try {
        const url = new URL(href, window.location.href);
        const hash = url.hash || '';
        const idParam = url.searchParams.get('id');

        if (url.pathname === window.location.pathname && idParam) {
          e.preventDefault();
          if (activeArticleId !== idParam) {
            await handleModuleSelection(idParam);
          } else {
            const targ = allArticles.find(a => a.id === idParam);
            if (targ && !targ.markdownContent) await triggerDirectLinkFetch(idParam);
          }
          if (hash) {
            window.location.hash = hash;
            setTimeout(scrollToHashInExpanded, 100);
            history.pushState({}, '', `${window.location.pathname}?id=${idParam}${hash}`);
          }
          return;
        }

        if (url.pathname.endsWith('.md')) {
          e.preventDefault();
          const parts = url.pathname.split('/');
          const file = parts.pop();
          const idFromFile = file.replace(/\.md$/, '');
          if (activeArticleId !== idFromFile) {
            await handleModuleSelection(idFromFile);
          } else {
            const targ = allArticles.find(a => a.id === idFromFile);
            if (targ && !targ.markdownContent) await triggerDirectLinkFetch(idFromFile);
          }
          if (hash) {
            window.location.hash = hash;
            setTimeout(scrollToHashInExpanded, 100);
            history.pushState({}, '', `${window.location.pathname}?id=${idFromFile}${hash}`);
          }
          return;
        }
      } catch (err) {
        // Fallback for eksterne lenker
      }
    }, false);

    _anchorHandlerInstalled = true;
  }

  // Async loaders, navigation logic, and clipboard event handling
  function attachArticleClickEvents() {
    articlesContainer.querySelectorAll('.filterable').forEach(articleEl => {
      const articleId = articleEl.dataset.id;
      
      // 1. Klikk på tag-badges i bunnen
      articleEl.querySelectorAll('.tag-click-btn').forEach(tagBtn => {
        tagBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          handleTagSelection(this.dataset.tag);
        });
      });

      // 2. Klikk på den interaktive disiplin-badgen (øverst til høyre)
      const disciplineBtn = articleEl.querySelector('.discipline-badge');
      if (disciplineBtn) {
        disciplineBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          handleModuleSelection(articleId);
        });
      }

      // 3. Klikk på selve tittelen (øverst til venstre)
      const titleEl = articleEl.querySelector('.article-title-clickable');
      if (titleEl) {
        titleEl.addEventListener('click', function(e) {
          e.stopPropagation();
          handleModuleSelection(articleId);
        });
      }

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
    const currentHash = window.location.hash || '';
    history.pushState({id: articleId}, '', `?id=${articleId}${currentHash}`); 
    filterArticles(false);

    if (targetArticle && !targetArticle.markdownContent) {
      try {
        const res = await fetch(`articles/${articleId}.md`);
        if (!res.ok) throw new Error('Markdown file not found');
        const mdText = await res.text();
        
        targetArticle.markdownContent = mdText;
        filterArticles(false); // Dette rendrer og lar renderArticles ta seg av scrolling
      } catch (err) {
        console.error("Could not load markdown details:", err);
        const contentEl = articlesContainer.querySelector(`[data-id="${articleId}"] .full-content`);
        if (contentEl) contentEl.innerHTML = '<p style="color:red;">Error loading document details.</p>';
        return;
      }
    }
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

  // Start programmet
  loadArticles();
});
