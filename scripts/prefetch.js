const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');

// Minimal list of FEEDS - keep in sync with client FEEDS or import from a JSON if you prefer
const FEEDS = {
  "Polsat News": "https://www.polsatnews.pl/rss/wszystkie.xml",
  "Gazeta.pl": "http://rss.gazeta.pl/pub/rss/wiadomosci.xml",
  "Rzeczpospolita": "https://www.rp.pl/rss_main",
  "Dziennik.pl": "http://rss.dziennik.pl/Dziennik-PL/",
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

const outFile = path.join(__dirname, '..', 'articles.json');
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

async function fetchText(url){
  try{
    const res = await fetch(url, { timeout: 15000 });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  }catch(e){
    console.warn('fetch failed', url, e && e.message);
    return null;
  }
}

function extractItemsFromParsed(parsed){
  // rss.channel.item or feed.entry
  if(parsed && parsed.rss && parsed.rss.channel){
    const ch = parsed.rss.channel;
    if(Array.isArray(ch.item)) return ch.item;
    if(ch.item) return [ch.item];
  }
  if(parsed && parsed.feed && parsed.feed.entry){
    if(Array.isArray(parsed.feed.entry)) return parsed.feed.entry;
    return [parsed.feed.entry];
  }
  return [];
}

(async function(){
  const results = [];
  for(const [name, url] of Object.entries(FEEDS)){
    console.log('Fetching', name, url);
    const text = await fetchText(url);
    if(!text) continue;
    let parsed;
    try{ parsed = parser.parse(text); }catch(e){ console.warn('parse error', name, e && e.message); continue; }
    const items = extractItemsFromParsed(parsed);
    items.forEach(it => {
      const title = it.title && (typeof it.title === 'string' ? it.title : it.title['#text'] || it.title['@_text']) || '';
      let link = it.link && (typeof it.link === 'string' ? it.link : it.link['@_href'] || (it.link && it.link['#text'])) || '';
      if(!link && it.guid) link = (typeof it.guid === 'string' ? it.guid : (it.guid['#text'] || ''));
      const description = (it.description && (typeof it.description === 'string' ? it.description : it.description['#text'])) || (it.summary && it.summary['#text']) || '';
      const pubDate = it.pubDate || it.published || it.updated || '';
      const image = (it.enclosure && it.enclosure['@_url']) || '';
      if(title && link){
        results.push({ title, link, description, pubDate, imageUrl: image, source: name });
      }
    });
  }
  // sort
  results.sort((a,b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  try{
    fs.writeFileSync(outFile, JSON.stringify(results, null, 2), 'utf8');
    console.log('Wrote', outFile, 'items:', results.length);
  }catch(e){
    console.error('Write failed', e && e.message);
  }
})();
