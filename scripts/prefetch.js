const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');
const he = require('he');
const iconv = require('iconv-lite');

// Minimal list of FEEDS - keep in sync with client FEEDS or import from a JSON if you prefer
const FEEDS = {
  // Wiadomości ogólne
  "Polsat News": "https://www.polsatnews.pl/rss/wszystkie.xml",
  "Gazeta.pl": "http://rss.gazeta.pl/pub/rss/wiadomosci.xml",
  "Onet": "https://wiadomosci.onet.pl/rss",
  "Interia": "https://fakty.interia.pl/feed",
  "Wirtualna Polska": "https://wp.pl/rss/wiadomosci.xml",
  "Rzeczpospolita": "https://www.rp.pl/rss_main",
  "Dziennik.pl": "http://rss.dziennik.pl/Dziennik-PL/",
  "TVN24": "https://tvn24.pl/najnowsze.xml",
  "Newsweek Polska": "https://www.newsweek.pl/rss.xml",
  "Press.pl": "https://www.press.pl/rss/",
  
  // Technologia i IT
  "Niebezpiecznik": "http://feeds.feedburner.com/niebezpiecznik",
  "Sekurak": "https://sekurak.pl/feed",
  "Spider's Web": "https://www.spidersweb.pl/feed",
  "Antyweb": "https://antyweb.pl/feed",
  "Benchmark.pl": "https://www.benchmark.pl/feed",
  "Interia Technologie": "http://kanaly.rss.interia.pl/nowe_technologie.xml",
  "Tabletowo": "https://www.tabletowo.pl/feed/",
  "Android.com.pl": "https://android.com.pl/feed",
  "GeekWeek": "https://geekweek.pl/feed/",
  
  // Biznes i Finanse
  "Bankier.pl": "https://www.bankier.pl/rss/wiadomosci.xml",
  "Money.pl": "https://www.money.pl/rss/",
  "Biznes.interia.pl": "https://biznes.interia.pl/feed",
  "Stooq": "https://stooq.pl/rss/",
  
  // Media
  "Wirtualne Media": "https://www.wirtualnemedia.pl/rss/wirtualnemedia_rss.xml",
  "Media2.pl": "https://feeds.feedburner.com/media2",
  
  // Polityka i Społeczeństwo
  "OKO.press": "https://oko.press/feed/",
  "Krytyka Polityczna": "https://krytykapolityczna.pl/feed/",
  
  // Kultura i Lifestyle
  "Interia Kultura": "http://kultura.interia.pl/feed",
  
  // Sport
  "Eurosport": "https://www.eurosport.pl/rss.xml",
  
  // Międzynarodowe
  "BBC News": "http://feeds.bbci.co.uk/news/rss.xml",
  "The Guardian": "https://www.theguardian.com/world/rss",
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
    // read as buffer so we can detect/handle charset
    const buffer = await res.arrayBuffer();
    const buf = Buffer.from(buffer);
    // try to get charset from content-type header
    const ct = res.headers.get('content-type') || '';
    let m = /charset=([^;]+)/i.exec(ct);
    let encoding = m ? m[1].toLowerCase().trim() : null;
    let text;
    if(!encoding){
      // try to detect from XML prolog: <?xml version="1.0" encoding="windows-1250"?>
      const start = buf.slice(0, 512).toString('ascii');
      const pm = /encoding=[\"']?([^\"'>\s]+)[\"']?/i.exec(start);
      if(pm) encoding = pm[1].toLowerCase();
    }
    try{
      text = encoding ? iconv.decode(buf, encoding) : buf.toString('utf8');
    }catch(e){
      // fallback
      text = buf.toString('utf8');
    }
    return text;
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
      // extract raw values (some feeds use objects, some strings)
      const rawTitle = it.title && (typeof it.title === 'string' ? it.title : it.title['#text'] || it.title['@_text']) || '';
      let link = it.link && (typeof it.link === 'string' ? it.link : it.link['@_href'] || (it.link && it.link['#text'])) || '';
      if(!link && it.guid) link = (typeof it.guid === 'string' ? it.guid : (it.guid['#text'] || ''));
      const rawDescription = (it.description && (typeof it.description === 'string' ? it.description : it.description['#text'])) || (it.summary && it.summary['#text']) || '';
      const pubDate = it.pubDate || it.published || it.updated || '';
      
      // Extract image from multiple sources
      let image = '';
      // 1. Try enclosure
      if(it.enclosure && it.enclosure['@_url']) image = it.enclosure['@_url'];
      // 2. Try media:content (multiple variations)
      if(!image && it['media:content']){
        const mc = Array.isArray(it['media:content']) ? it['media:content'][0] : it['media:content'];
        image = mc['@_url'] || '';
      }
      // 3. Try media:thumbnail
      if(!image && it['media:thumbnail']){
        const mt = Array.isArray(it['media:thumbnail']) ? it['media:thumbnail'][0] : it['media:thumbnail'];
        image = mt['@_url'] || '';
      }
      // 4. Try thumbnail
      if(!image && it.thumbnail){
        if(typeof it.thumbnail === 'string') image = it.thumbnail;
        else image = it.thumbnail['@_url'] || '';
      }
      // 5. Try media:group (some feeds wrap media:content in media:group)
      if(!image && it['media:group'] && it['media:group']['media:content']){
        const mc = Array.isArray(it['media:group']['media:content']) ? it['media:group']['media:content'][0] : it['media:group']['media:content'];
        image = mc['@_url'] || '';
      }
      // 6. Extract from description HTML
      if(!image && rawDescription){
        const imgMatch = rawDescription.match(/<img[^>]+src=["']([^"']+)["']/i);
        if(imgMatch) image = imgMatch[1];
      }

      // decode HTML entities in title and description
      const title = rawTitle ? he.decode(rawTitle) : '';
      const description = rawDescription ? he.decode(rawDescription) : '';

      if(title && link){
        results.push({ title, link, description, pubDate, imageUrl: image, source: name });
      }
    });
  }
  // sort
  results.sort((a,b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
  try{
    const payload = { generatedAt: new Date().toISOString(), items: results };
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log('Wrote', outFile, 'items:', results.length);
  }catch(e){
    console.error('Write failed', e && e.message);
  }
})();
