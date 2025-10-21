const https = require('https');
const http = require('http');
const fs = require('fs');
const { DOMParser } = require('xmldom');
const path = require('path');

// Używamy tych samych źródeł co w głównej aplikacji
const FEEDS = {
  "Polsat News": "https://www.polsatnews.pl/rss/wszystkie.xml",
  "Gazeta.pl": "http://rss.gazeta.pl/pub/rss/wiadomosci.xml",
  "Rzeczpospolita": "https://www.rp.pl/rss_main",
  "Dziennik.pl": "http://rss.dziennik.pl/Dziennik-PL/",
  "Interia Technologie": "http://kanaly.rss.interia.pl/nowe_technologie.xml",
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

// Publiczne proxy CORS do użycia
const PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://thingproxy.freeboard.io/fetch/',
  'https://api.rss2json.com/v1/api.json?rss_url='
];

// Funkcje pomocnicze
function fetchWithTimeout(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const req = client.get(url, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Status Code: ${res.statusCode}`));
      }
      
      const data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data).toString()));
    });
    
    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.abort();
      reject(new Error(`Request timeout after ${timeout}ms`));
    });
  });
}

async function fetchFeed(url) {
  // Próbuj każde proxy po kolei
  for (const proxy of PROXIES) {
    try {
      const proxyUrl = proxy + encodeURIComponent(url);
      const data = await fetchWithTimeout(proxyUrl);
      
      // Dla api.rss2json.com, format jest inny
      if (proxy.includes('api.rss2json.com')) {
        const json = JSON.parse(data);
        if (json.status === 'ok' && json.items) {
          // Konwertuj format JSON na XML
          let xml = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>';
          xml += `<title>${json.feed.title}</title>`;
          
          for (const item of json.items) {
            xml += '<item>';
            xml += `<title>${item.title}</title>`;
            xml += `<link>${item.link}</link>`;
            xml += `<pubDate>${item.pubDate}</pubDate>`;
            if (item.thumbnail) xml += `<enclosure url="${item.thumbnail}" type="image/jpeg"/>`;
            xml += `<description>${item.description || item.content}</description>`;
            xml += '</item>';
          }
          
          xml += '</channel></rss>';
          return xml;
        }
      } else if (data && data.includes('<')) {
        // Wygląda na XML
        return data;
      }
    } catch (e) {
      console.error(`Proxy ${proxy} failed for ${url}:`, e.message);
      // Kontynuuj z następnym proxy
    }
  }
  
  throw new Error(`All proxies failed for ${url}`);
}

function safeText(node) {
  return node ? (node.textContent || '').trim() : '';
}

function extractImageFromItem(item) {
  // Media content
  const mediaContent = item.getElementsByTagName('media:content');
  if (mediaContent && mediaContent.length > 0) {
    const url = mediaContent[0].getAttribute('url');
    if (url) return url;
  }
  
  // Enclosure
  const enclosure = item.getElementsByTagName('enclosure');
  if (enclosure && enclosure.length > 0) {
    const url = enclosure[0].getAttribute('url');
    if (url) return url;
  }
  
  // Thumbnail
  const thumbnail = item.getElementsByTagName('thumbnail');
  if (thumbnail && thumbnail.length > 0) {
    const url = thumbnail[0].getAttribute('url');
    if (url) return url;
  }
  
  // Description image
  const description = item.getElementsByTagName('description');
  if (description && description.length > 0) {
    const content = description[0].textContent;
    const imgMatch = content.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgMatch) return imgMatch[1];
  }
  
  return '';
}

function parseFeedXml(xmlText, sourceName) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const items = doc.getElementsByTagName('item');
    const entries = doc.getElementsByTagName('entry');
    
    const results = [];
    
    // Process standard RSS items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const title = safeText(item.getElementsByTagName('title')[0]);
      const link = safeText(item.getElementsByTagName('link')[0]);
      const pubDate = safeText(item.getElementsByTagName('pubDate')[0]) || 
                     safeText(item.getElementsByTagName('date')[0]);
      const description = safeText(item.getElementsByTagName('description')[0]) ||
                         safeText(item.getElementsByTagName('content')[0]) ||
                         safeText(item.getElementsByTagName('summary')[0]);
      
      const imageUrl = extractImageFromItem(item);
      
      results.push({
        title,
        link,
        pubDate,
        description,
        source: sourceName,
        imageUrl
      });
    }
    
    // Process Atom entries
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const title = safeText(entry.getElementsByTagName('title')[0]);
      
      // Atom links have rel attribute
      let link = '';
      const links = entry.getElementsByTagName('link');
      for (let j = 0; j < links.length; j++) {
        const rel = links[j].getAttribute('rel');
        if (!rel || rel === 'alternate') {
          link = links[j].getAttribute('href');
          break;
        }
      }
      
      const pubDate = safeText(entry.getElementsByTagName('published')[0]) ||
                     safeText(entry.getElementsByTagName('updated')[0]);
      const description = safeText(entry.getElementsByTagName('content')[0]) ||
                         safeText(entry.getElementsByTagName('summary')[0]);
      
      const imageUrl = extractImageFromItem(entry);
      
      results.push({
        title,
        link,
        pubDate,
        description,
        source: sourceName,
        imageUrl
      });
    }
    
    return results;
  } catch (e) {
    console.error(`Error parsing feed for ${sourceName}:`, e.message);
    return [];
  }
}

// Główna funkcja do pobrania wszystkich feedów
async function fetchAllFeeds() {
  console.log('Rozpoczynam pobieranie artykułów...');
  
  const entries = Object.entries(FEEDS);
  const results = [];
  const failed = [];
  
  for (const [name, url] of entries) {
    try {
      console.log(`Pobieranie: ${name}`);
      const xml = await fetchFeed(url);
      const parsed = parseFeedXml(xml, name);
      console.log(`Pobrano ${parsed.length} artykułów z ${name}`);
      results.push(...parsed);
    } catch (e) {
      console.error(`Błąd dla ${name}:`, e.message);
      failed.push(name);
    }
  }
  
  // Sortuj wg daty (od najnowszych)
  results.sort((a, b) => {
    const dateA = new Date(a.pubDate || 0).getTime();
    const dateB = new Date(b.pubDate || 0).getTime();
    return dateB - dateA;
  });
  
  // Zapisz do pliku
  const outputPath = path.join(process.cwd(), 'articles.json');
  const outputData = {
    generatedAt: new Date().toISOString(),
    items: results,
    failedSources: failed
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
  
  console.log(`Zapisano ${results.length} artykułów do articles.json`);
  console.log(`Nie udało się pobrać z: ${failed.join(', ') || 'wszystkie OK'}`);
  
  return results;
}

// Uruchom
fetchAllFeeds().catch(console.error);