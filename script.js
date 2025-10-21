// Prosty RSS aggregator — fetch -> parse XML -> render
// zastąp CORS_PROXY pojedynczym stringiem listą (jeśli używasz starego CORS_PROXY, możesz go usunąć)
const PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://thingproxy.freeboard.io/fetch/',       // alternatywa
  'https://api.rss2json.com/v1/api.json?rss_url=' // zwraca JSON (obsługiwane poniżej)
];

// Lista źródeł RSS — uzupełniona na prośbę użytkownika
const FEEDS = {
  "Polsat News": "https://www.polsatnews.pl/rss/wszystkie.xml",
  "Gazeta.pl": "http://rss.gazeta.pl/pub/rss/wiadomosci.xml",
  "Rzeczpospolita": "https://www.rp.pl/rss_main",
  "Dziennik.pl": "http://rss.dziennik.pl/Dziennik-PL/",
  // "Wirtualna Polska (WP)": "(wyszukaj na WP)", // brak bezpośredniego gotowego linku podanego
  "Interia Technologie (przykład)": "http://kanaly.rss.interia.pl/nowe_technologie.xml",
  // "Bankier.pl": "(wyszukaj na Bankierze)",
  // "Money.pl": "(wyszukaj na Money)",
  "Wirtualne Media": "https://www.wirtualnemedia.pl/rss/wirtualnemedia_rss.xml",
  "Media2.pl": "https://feeds.feedburner.com/media2",
  "Niebezpiecznik": "http://feeds.feedburner.com/niebezpiecznik",
  "Sekurak": "https://sekurak.pl/feed",
  "Chip.pl": "http://www.chip.pl/rss/arts.rss",
  "Reuters": "http://feeds.reuters.com/reuters/topNews",
  "BBC News": "http://feeds.bbci.co.uk/news/rss.xml",
  "The Guardian": "https://www.theguardian.com/world/rss",
  "AP News": "https://apnews.com/feed",
  "Al Jazeera": "https://www.aljazeera.com/xml/rss/all.xml",
  "TechCrunch": "http://feeds.feedburner.com/TechCrunch/",
  "Wired": "https://www.wired.com/feed/rss",
  "Engadget": "https://www.engadget.com/rss.xml",
};

const articlesContainer = document.getElementById('articlesContainer');
const loadingMessage = document.getElementById('loadingMessage');
const searchInput = document.getElementById('searchInput');
const refreshBtn = document.getElementById('refreshBtn');
const totalCountEl = document.getElementById('totalCount'); // may be null in simplified UI
// add-feed UI removed from HTML; dynamic management remains via code/config
const clearKnownBtn = document.getElementById('clearKnownBtn');
const proxySelect = document.getElementById('proxySelect');

// diagnostics UI removed for production

// pagination UI elements (may be null during tests)
const pageStatus = document.getElementById('pageStatus');

let allArticles = [];
let readArticles = JSON.parse(localStorage.getItem('readArticles') || '{}');
const KNOWN_GOOD_KEY = 'knownFeedUrls';
let knownGood = JSON.parse(localStorage.getItem(KNOWN_GOOD_KEY) || '{}');
const FEEDS_KEY = 'userFeeds';
// load saved FEEDS or default
let savedFeeds = JSON.parse(localStorage.getItem(FEEDS_KEY) || 'null');
if(savedFeeds && typeof savedFeeds === 'object'){
  // override FEEDS
  Object.keys(FEEDS).forEach(k => delete FEEDS[k]);
  Object.assign(FEEDS, savedFeeds);
}
// session cache for fetched xmls
const SESSION_CACHE_KEY = 'sessionFeedCache';
let sessionCache = JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) || '{}');
// pagination state
let pageSize = 20;
let currentPage = 1;
let currentFiltered = [];
let infiniteScrollEnabled = true;
let infiniteObserver = null;
const infiniteToggle = document.getElementById('infiniteToggle');
const infiniteSentinel = document.getElementById('infiniteSentinel');
const spinner = document.getElementById('spinner');

function safeText(node){
  return node ? node.textContent.trim() : '';
}

function extractImageFromItem(item){
  const media = item.getElementsByTagName('media:content')[0] || item.getElementsByTagName('enclosure')[0];
  if(media && media.getAttribute){
    const src = media.getAttribute('url') || media.getAttribute('href') || media.getAttribute('src');
    if(src) return src;
  }
  const thumbnail = item.getElementsByTagName('thumbnail')[0];
  if(thumbnail && thumbnail.getAttribute) return thumbnail.getAttribute('url');

  const descNode = item.querySelector('description') || item.querySelector('summary');
  const desc = descNode ? descNode.innerHTML || descNode.textContent || '' : '';
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/i);
  if(imgMatch) return imgMatch[1];

  const ogMatch = desc.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
  if(ogMatch) return ogMatch[1];

  return '';
}

function parseFeedXml(xmlText, sourceName){
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const items = doc.querySelectorAll('item, entry');
  const list = [];
  items.forEach(it => {
  let title = safeText(it.querySelector('title'));
    let link = safeText(it.querySelector('link'));
    if(!link){
      const alt = it.querySelector('link[rel="alternate"]');
      if(alt && alt.getAttribute) link = alt.getAttribute('href') || '';
    }
    // fallback: guid or id
    if(!link){
      const guid = safeText(it.querySelector('guid')) || safeText(it.querySelector('id'));
      if(guid && /https?:\/\//.test(guid)) link = guid;
    }
    // fallback: find first http(s) in description
    if(!link){
      const descNode = it.querySelector('description') || it.querySelector('summary');
      const descText = descNode ? (descNode.textContent || descNode.innerHTML || '') : '';
      const urlMatch = descText.match(/https?:\/\/[\w\-\.\/?=&%#~+]+/i);
      if(urlMatch) link = urlMatch[0];
    }
  let description = safeText(it.querySelector('description')) || safeText(it.querySelector('summary')) || '';
    const pubDate = safeText(it.querySelector('pubDate')) || safeText(it.querySelector('published')) || safeText(it.querySelector('updated')) || '';
    const imageUrl = extractImageFromItem(it) || '';
    if(title && link){
      // decode HTML entities just in case feed uses numeric/entity encoding
      try{ title = decodeHtmlEntities(title); }catch(e){}
      try{ description = decodeHtmlEntities(description); }catch(e){}
      list.push({ title, link, description, pubDate, imageUrl, source: sourceName });
    }
  });
  return list;
}

// Decode HTML entities (e.g. numeric &#x119; -> ę). Uses browser parsing which safely handles entities.
function decodeHtmlEntities(str){
  if(!str) return '';
  // Use DOM to decode entities. Textarea is widely supported.
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

async function fetchFeed(url){
  // check session cache first
  if(sessionCache[url]){
    return sessionCache[url];
  }
  for(const proxy of PROXIES){
    try{
      const full = proxy + encodeURIComponent(url);
      const res = await fetchWithTimeout(full, { timeout: 8000 });
      if(!res.ok) continue;
      const text = await res.text();
      // jeśli to rss2json (JSON), zamienimy na prosty XML-like string
      if(proxy.includes('rss2json') || text.trim().startsWith('{')){
        try{
          const j = JSON.parse(text);
          if(Array.isArray(j.items)){
            const itemsXml = j.items.map(it => `<item><title>${escapeHtml(it.title||'')}</title><link>${escapeHtml(it.link||'')}</link><description>${escapeHtml(it.description||'')}</description><pubDate>${escapeHtml(it.pubDate||'')}</pubDate></item>`).join('');
            const fake = `<?xml version="1.0"?><rss><channel>${itemsXml}</channel></rss>`;
            sessionCache[url] = fake;
            sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(sessionCache));
            return fake;
          }
        }catch(e){ }
      }
      sessionCache[url] = text;
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(sessionCache));
      return text;
    }catch(err){
      // Demote per-proxy fetch failures to debug to avoid spamming consoles when public proxies misbehave
      console.debug('Proxy fetch failed:', proxy, err && err.message);
    }
  }
  throw new Error('Wszystkie proxy nie powiodły się');
}

// fetch with timeout using AbortController
async function fetchWithTimeout(resource, { timeout = 8000 } = {}){
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try{
    const resp = await fetch(resource, { signal: controller.signal });
    clearTimeout(id);
    return resp;
  }catch(err){
    clearTimeout(id);
    throw err;
  }
}

async function fetchAllFeeds(){
  // show spinner while loading; loadingMessage may be absent in simplified UI
  showSpinner();
  if(loadingMessage){ loadingMessage.style.display = 'block'; loadingMessage.textContent = 'Ładowanie kanałów...'; }
  const entries = Object.entries(FEEDS);
  const failed = [];
  // diagnostics removed: we only update loadingMessage for errors
  const diagList = null;

  // Process feeds sequentially (avoid big parallel bursts that cause proxy failures)
  const results = [];
  const loggedProxyErrors = new Set();
  for(const [name, urls] of entries){
    let usedUrl = null;
    let xml = null;
    const candidates = [];
    if(knownGood[name]) candidates.push(knownGood[name]);
    (Array.isArray(urls) ? urls : [urls]).forEach(u => { if(!candidates.includes(u)) candidates.push(u); });
    for(const url of candidates){
      try{
        // Use public proxies via fetchFeed
        let text = await fetchFeed(url);
        // quick check for XML-like response
        if(text && text.indexOf('<') !== -1){
          usedUrl = url;
          xml = text;
          try{
            const docTmp = new DOMParser().parseFromString(text, 'text/xml');
            const nodeCount = (docTmp.querySelectorAll && docTmp.querySelectorAll('item, entry')) ? docTmp.querySelectorAll('item, entry').length : 0;
            // diagnostics removed: keep console info minimal
            console.debug(`${name}: OK — użyto ${url} — wykryto node item/entry: ${nodeCount}`);
          }catch(e){
            console.debug(`${name}: OK, ale nie udało się sparsować podglądu: ${e.message}`);
          }
          knownGood[name] = url;
          localStorage.setItem(KNOWN_GOOD_KEY, JSON.stringify(knownGood));
          break;
        } else {
          console.debug(`${name}: odpowiedź nie wygląda jak XML przy ${url}`);
        }
      }catch(e){
        // Log each proxy error only once to reduce console spam
        if(!loggedProxyErrors.has(e.message)){
          // Keep as debug to reduce console noise; aggregated warning will be shown later if all candidates fail
          console.debug('Proxy failed for', url, e.message);
          loggedProxyErrors.add(e.message);
        }
  console.debug(`${name}: błąd przy ${url} — ${e.message}`);
        // try next candidate
      }
    }
    if(!xml){
      failed.push({ name, url: Array.isArray(urls)? urls[0] : urls, reason: 'brak poprawnej odpowiedzi z kandydatów' });
      results.push([]);
      continue;
    }
    const parsed = parseFeedXml(xml, name);
    console.debug(`${name}: sparsowano ${parsed.length} elementów`);
    results.push(parsed);
  }
  allArticles = results.flat().sort((a,b) => {
    const da = new Date(a.pubDate || 0).getTime();
    const db = new Date(b.pubDate || 0).getTime();
    return db - da;
  });

  if(failed.length){
    const failedNames = failed.map(f => `${f.name} (${f.reason})`).join(', ');
    console.warn('Niektóre kanały nie odpowiedziały: ' + failedNames + '. Sprawdź konsolę (Ctrl+Shift+I) lub popraw URL.');
    console.warn('Szczegóły nieudanych feedów:', failed);
  }

  populateSourceSelect();
  // hide loading UI
  if(loadingMessage) loadingMessage.style.display = 'none';
  hideSpinner();
  // no 'all' checkbox anymore; the multi-select will be populated
  const total = allArticles.length;
  console.info(`Suma sparsowanych artykułów: ${total}`);
  
  // Aktualizuj wskaźnik ostatniego odświeżenia
  updateRefreshTime();
  
  // set current filtered to full list and render
  currentFiltered = allArticles.slice();
  renderArticles(currentFiltered);
}

// Funkcja do aktualizacji czasu ostatniego odświeżenia
function updateRefreshTime() {
  const refreshStatus = document.getElementById('refreshStatus');
  const lastRefreshTime = document.getElementById('lastRefreshTime');
  
  if(refreshStatus && lastRefreshTime) {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    lastRefreshTime.textContent = timeStr;
    refreshStatus.style.display = 'block';
  }
}

// UI handlers
// add-feed handler removed (UI removed). To add feeds, modify the FEEDS constant or use localStorage directly.

// clearKnownBtn removed from UI — keep function reachable from console if needed
window.clearKnownCache = function(){ knownGood = {}; localStorage.removeItem(KNOWN_GOOD_KEY); console.info('Wyczyszczono cache znanych URL-e (z konsoli).'); };

// pagination-aware render wrapper
const originalRenderArticles = renderArticles;
window.renderArticles = function(list){
  if(totalCountEl) totalCountEl.textContent = list ? list.length : 0;
  const totalPages = Math.max(1, Math.ceil((list ? list.length : 0) / pageSize));
  if(currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * pageSize;
  const paged = (list || []).slice(start, start + pageSize);
  // when rendering page 1, replace; when rendering subsequent pages, append
  if(currentPage === 1){
    originalRenderArticles(paged);
  } else {
    // append
    const fragment = document.createDocumentFragment();
    paged.forEach(a => fragment.appendChild(createCard(a)));
    articlesContainer.appendChild(fragment);
  }
  if(pageStatus) pageStatus.textContent = `Strona ${currentPage} / ${totalPages}`;
};

function showSpinner(){ if(spinner) spinner.style.display = 'block'; }
function hideSpinner(){ if(spinner) spinner.style.display = 'none'; }

function setupInfiniteObserver(){
  if(!infiniteSentinel || !('IntersectionObserver' in window)) return;
  // disconnect existing
  if(infiniteObserver){ infiniteObserver.disconnect(); infiniteObserver = null; }
  infiniteObserver = new IntersectionObserver((entries) => {
    entries.forEach(ent => {
      if(!ent.isIntersecting) return;
      if(!infiniteScrollEnabled) return;
      // determine if there is another page
      const totalPages = Math.max(1, Math.ceil((currentFiltered ? currentFiltered.length : 0) / pageSize));
      if(currentPage >= totalPages) return;
      // show spinner briefly and load next page
      showSpinner();
      // small delay to allow spinner to render
      setTimeout(() => {
        currentPage += 1;
        renderArticles(currentFiltered);
        hideSpinner();
      }, 200);
    });
  }, { root: null, rootMargin: '300px', threshold: 0 });
  infiniteObserver.observe(infiniteSentinel);
}

// Infinite scroll always enabled in simplified UI
infiniteScrollEnabled = true;

// create observer after DOMContentLoaded / initial render
window.addEventListener('load', () => {
  // small timeout to ensure articles are rendered
  setTimeout(() => {
    setupInfiniteObserver();
  }, 300);
});

// 'Pokaż więcej' button removed from UI; infinite scroll and pageStatus handle pagination

// old scroll-based infinite loader removed in favour of IntersectionObserver

function resetPagination(){
  currentPage = 1;
}

function populateSourceSelect(){
  const panelList = document.getElementById('sourcePanelList');
  const dropdown = document.getElementById('sourceDropdown');
  const sourcePanel = document.getElementById('sourcePanel');
  const label = document.getElementById('sourceDropdownLabel');
  const selectAllBtn = document.getElementById('selectAllBtn');
  const clearAllBtn = document.getElementById('clearAllBtn');
  const sources = [...new Set(allArticles.map(a => a.source))].sort();

  // Setup dropdown toggle
  if(dropdown && sourcePanel) {
    dropdown.addEventListener('click', () => {
      const isExpanded = sourcePanel.style.display !== 'none';
      sourcePanel.style.display = isExpanded ? 'none' : 'flex';
      dropdown.setAttribute('aria-expanded', !isExpanded);
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target) && !sourcePanel.contains(e.target)) {
        sourcePanel.style.display = 'none';
        dropdown.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if(panelList){
    // Render a two-column checkbox grid for better UX (clickable labels, nicer styling)
    panelList.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'source-grid';
    sources.forEach(s => {
      const id = 'chk_' + s.replace(/[^a-z0-9]/gi,'_');
      const item = document.createElement('label');
      item.className = 'source-grid-item';
      item.htmlFor = id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = s; cb.id = id; cb.checked = true;
      cb.addEventListener('change', () => { updateDropdownLabel(); applyFilters(); });
      const span = document.createElement('span'); span.textContent = s;
      item.appendChild(cb); item.appendChild(span);
      grid.appendChild(item);
    });
    panelList.appendChild(grid);
  }

  function updateDropdownLabel(){
    if(!panelList) return;
    // support both select-based panel and legacy checkboxes
    const sel = panelList.querySelector('select');
    let checked = [];
    if(sel){ checked = Array.from(sel.selectedOptions).map(o => o.value); }
    else { checked = Array.from(panelList.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value); }
    label.textContent = checked.length === sources.length ? 'Wszystkie źródła' : (checked.length === 0 ? 'Brak zaznaczonych' : `${checked.length} zazn.`);
  }

  // expose for external callers (global toggle handler)
  try{ window.updateDropdownLabel = updateDropdownLabel; }catch(e){}

  // dropdown toggle wiring is handled once globally (see below) — keep populate idempotent

  if(selectAllBtn && panelList){ selectAllBtn.addEventListener('click', () => {
    const sel = panelList.querySelector('select');
    if(sel){ Array.from(sel.options).forEach(o=>o.selected=true); }
    else { panelList.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true); }
    updateDropdownLabel(); applyFilters();
  }); }
  if(clearAllBtn && panelList){ clearAllBtn.addEventListener('click', () => {
    const sel = panelList.querySelector('select');
    if(sel){ Array.from(sel.options).forEach(o=>o.selected=false); }
    else { panelList.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false); }
    updateDropdownLabel(); applyFilters();
  }); }

  // initial label
  setTimeout(() => { if(typeof updateDropdownLabel === 'function') updateDropdownLabel(); }, 0);
}

// diagnostics toggle: hide by default (toggle button wiring)
// diagnostic toggle removed from UI

function createCard(a){
  const card = document.createElement('article');
  card.className = 'card' + (readArticles[a.link] ? ' read' : '');
  const inner = document.createElement('div'); inner.className = 'card-inner';

  const img = document.createElement('img');
  // inline SVG placeholder to avoid external DNS/HTTP requests
  const svgPlaceholder = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="100%" height="100%" fill="#e9eef6"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-family="Arial,Helvetica,sans-serif" font-size="16">Brak zdjęcia</text></svg>`);
  img.src = a.imageUrl || svgPlaceholder;
  img.alt = a.source || '';

  const content = document.createElement('div'); content.className = 'card-content';
  const h = document.createElement('h3'); h.className = 'card-title'; h.textContent = decodeHtmlEntities(a.title);
  const meta = document.createElement('div'); meta.className = 'card-meta';
  meta.textContent = `${a.source} • ${a.pubDate ? new Date(a.pubDate).toLocaleString() : ''}`;
  const ex = document.createElement('p'); ex.className = 'card-excerpt';
  const plain = a.description ? a.description.replace(/<\/?[^>]+(>|$)/g, "") : '';
  const decodedPlain = decodeHtmlEntities(plain);
  ex.textContent = decodedPlain.length > 200 ? decodedPlain.slice(0,200) + '…' : decodedPlain;

  content.appendChild(h); content.appendChild(meta); content.appendChild(ex);
  inner.appendChild(img); inner.appendChild(content);
  card.appendChild(inner);

  card.addEventListener('click', (e) => {
    if(e.target.closest('a')) return;
    markAsRead(a.link, card);
    window.open(a.link,'_blank');
  });

  return card;
}

function renderArticles(list){
  articlesContainer.innerHTML = '';
  if(!list || list.length===0){
    articlesContainer.innerHTML = '<p>Brak artykułów do wyświetlenia.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  list.forEach(a => fragment.appendChild(createCard(a)));
  articlesContainer.appendChild(fragment);
}

function markAsRead(link, cardEl){
  readArticles[link] = new Date().toISOString();
  localStorage.setItem('readArticles', JSON.stringify(readArticles));
  if(cardEl) cardEl.classList.add('read');
}

function applyFilters(){
  const q = (searchInput.value || '').trim().toLowerCase();
  resetPagination();
  let filtered = allArticles.slice();
  // read checked sources from the panel
  const panelList = document.getElementById('sourcePanelList');
  const selectedSources = panelList ? Array.from(panelList.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value) : [];
  if(selectedSources.length > 0) filtered = filtered.filter(a => selectedSources.includes(a.source));
  if(q) filtered = filtered.filter(a => ((a.title || '').toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q)));
  // sort by date desc
  filtered.sort((a,b) => (new Date(b.pubDate || 0).getTime()) - (new Date(a.pubDate || 0).getTime()));
  // set current filtered list and render first page
  currentFiltered = filtered;
  renderArticles(currentFiltered);
}

// helper do prostego escape HTML w stringach
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Events
searchInput.addEventListener('input', () => applyFilters());
if(refreshBtn){
  refreshBtn.addEventListener('click', async () => { resetPagination(); showSpinner(); if(loadingMessage){ loadingMessage.style.display='block'; loadingMessage.textContent='Odświeżanie...'; } await fetchAllFeeds(); hideSpinner(); });
}

// Start
window.addEventListener('DOMContentLoaded', async () => {
  try{
    // proxy selection removed from UI; always use public proxies list
    // Try loading cached articles.json for instant display (generated by server or CI)
    try{
      const cached = await fetch('articles.json', { cache: 'no-store' });
        if(cached.ok){
        const payload = await cached.json();
        const items = payload && payload.items ? payload.items : (Array.isArray(payload) ? payload : []);
        const gen = payload && payload.generatedAt ? new Date(payload.generatedAt) : null;
        const now = new Date();
  const TTL_MIN = 5; // minutes
        if(items && items.length){
          // Ensure any HTML entities in pre-generated JSON are decoded so titles/descriptions display/search correctly
          items.forEach(it => {
            try{ if(it.title) it.title = decodeHtmlEntities(it.title); }catch(e){}
            try{ if(it.description) it.description = decodeHtmlEntities(it.description); }catch(e){}
          });
          allArticles = items.slice();
          currentFiltered = allArticles.slice();
          renderArticles(currentFiltered);
          // populate the sources dropdown/panel immediately so the UI shows available sources
          try{ populateSourceSelect(); }catch(e){ console.debug('populateSourceSelect error', e && e.message); }
        }
        // If cache is stale, refresh in background; otherwise skip heavy fetches for now
        if(!gen || ((now - gen) / 60000) > TTL_MIN){
          // refresh in background
          fetchAllFeeds();
        } else {
          console.info('Using cached articles.json (fresh). Skipping full refresh.');
        }
      }
    }catch(e){
      console.warn('Failed to load cached articles.json', e && e.message);
      try{ fetchAllFeeds(); }catch(e2){}
    }
  }catch(err){
    console.error('Init error', err);
    if(loadingMessage) loadingMessage.textContent = 'Błąd podczas ładowania (sprawdź konsolę).';
    hideSpinner();
  }
});

    // Attach a single global handler to toggle the source panel. This avoids lost bindings when the panel is re-rendered.
    document.addEventListener('DOMContentLoaded', () => {
      const dropdown = document.getElementById('sourceDropdown');
      const panel = document.getElementById('sourcePanel');
      if(!dropdown || !panel) return;
      // Make sure we don't attach multiple listeners
      dropdown.addEventListener('click', (e) => { e.stopPropagation(); panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        // update label when opened
        const lbl = document.getElementById('sourceDropdownLabel'); if(lbl && typeof window.updateDropdownLabel === 'function') try{ window.updateDropdownLabel(); }catch(e){}
      });
      panel.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => { if(panel) panel.style.display = 'none'; });
    });

// Automatyczne odświeżanie artykułów co 5 minut
const AUTO_REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minut w milisekundach
let autoRefreshTimer = null;
let lastRefreshTimestamp = null;

function startAutoRefresh() {
  // Wyczyść poprzedni timer jeśli istnieje
  if(autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
  
  // Ustaw nowy timer
  autoRefreshTimer = setInterval(async () => {
    console.info('🔄 Automatyczne odświeżanie artykułów...');
    const refreshStatus = document.getElementById('refreshStatus');
    if(refreshStatus) {
      refreshStatus.style.color = '#0a66c2';
      refreshStatus.textContent = '🔄 Odświeżanie...';
    }
    
    try {
      await fetchAllFeeds();
      lastRefreshTimestamp = new Date();
      console.info('✅ Artykuły odświeżone automatycznie');
    } catch(e) {
      console.warn('⚠️ Błąd podczas automatycznego odświeżania:', e.message);
      if(refreshStatus) {
        refreshStatus.style.color = '#ef4444';
      }
    }
  }, AUTO_REFRESH_INTERVAL);
  
  console.info(`⏰ Automatyczne odświeżanie włączone (co ${AUTO_REFRESH_INTERVAL / 60000} minut)`);
}

// Uruchom automatyczne odświeżanie po załadowaniu strony
window.addEventListener('load', () => {
  startAutoRefresh();
});

// Zatrzymaj timer gdy użytkownik opuszcza stronę (opcjonalne, oszczędza zasoby)
window.addEventListener('beforeunload', () => {
  if(autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }
});