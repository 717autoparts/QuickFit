const EBAY_KEY = 'quickfit_ebay_config';

export function getEbayConfig() {
  try { return JSON.parse(localStorage.getItem(EBAY_KEY)) || {}; } catch(e) { return {}; }
}

export function saveEbayConfig(cfg) {
  localStorage.setItem(EBAY_KEY, JSON.stringify(cfg));
}

export function extractItemId(url) {
  const m = url.match(/\/itm\/(\d+)/);
  return m ? m[1] : null;
}

function ebayHeaders(callName, cfg) {
  return {
    'Content-Type': 'text/xml',
    'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
    'X-EBAY-API-CALL-NAME': callName,
    'X-EBAY-API-APP-NAME': cfg.appId || '',
    'X-EBAY-API-DEV-NAME': cfg.devId || '',
    'X-EBAY-API-CERT-NAME': cfg.certId || '',
    'X-EBAY-API-SITEID': '0'
  };
}

async function ebayProxy(callName, xml, cfg) {
  const proxyUrl = cfg.proxyUrl || '/api/ebay';
  const endpoint = cfg.sandbox
    ? 'https://api.sandbox.ebay.com/ws/api.dll'
    : 'https://api.ebay.com/ws/api.dll';
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, xml, headers: ebayHeaders(callName, cfg) })
  });
  if (!res.ok) throw new Error('Proxy error ' + res.status);
  return res.text();
}

export async function getItem(itemId, cfg) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${cfg.token}</eBayAuthToken></RequesterCredentials>
  <ItemID>${itemId}</ItemID>
  <IncludeItemCompatibilityList>true</IncludeItemCompatibilityList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetItemRequest>`;
  return parseGetItem(await ebayProxy('GetItem', xml, cfg));
}

export async function getMyListings(cfg) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${cfg.token}</eBayAuthToken></RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
    <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
  </ActiveList>
  <ScheduledList>
    <Include>true</Include>
    <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
  </ScheduledList>
  <DetailLevel>ReturnAll</DetailLevel>
</GetMyeBaySellingRequest>`;
  const text = await ebayProxy('GetMyeBaySelling', xml, cfg);
  return parseMyListings(text);
}

function parseMyListings(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const listings = [];
  const processItems = (selector) => {
    doc.querySelectorAll(selector).forEach(item => {
      listings.push({
        ebay_item_id: item.querySelector('ItemID')?.textContent || '',
        title: item.querySelector('Title')?.textContent || '',
        url: `https://www.ebay.com/itm/${item.querySelector('ItemID')?.textContent}`,
        price: parseFloat(item.querySelector('CurrentPrice')?.textContent || 0),
        quantity: parseInt(item.querySelector('Quantity')?.textContent || 0),
        has_fitment: (item.querySelectorAll('Compatibility').length > 0),
        status: selector.includes('Active') ? 'active' : 'scheduled',
        thumbnail_url: item.querySelector('GalleryURL')?.textContent || ''
      });
    });
  };
  processItems('ActiveList Item');
  processItems('ScheduledList Item');
  return listings;
}

function parseGetItem(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const title = doc.querySelector('Title')?.textContent || '';
  const itemId = doc.querySelector('ItemID')?.textContent || '';
  const compatibilities = [];
  doc.querySelectorAll('Compatibility').forEach(node => {
    const entry = {};
    node.querySelectorAll('NameValueList').forEach(nvl => {
      const n = nvl.querySelector('Name')?.textContent;
      const v = nvl.querySelector('Value')?.textContent;
      if (n && v) entry[n] = v;
    });
    if (Object.keys(entry).length) compatibilities.push(entry);
  });
  return { title, itemId, compatibilities };
}

export async function reviseItem(itemId, compatibilities, cfg) {
  const compatXml = compatibilities.map(c =>
    '<Compatibility>' +
    Object.entries(c).map(([k,v]) => `<NameValueList><Name>${k}</Name><Value>${v}</Value></NameValueList>`).join('') +
    '</Compatibility>'
  ).join('');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseFixedPriceItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${cfg.token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <ItemID>${itemId}</ItemID>
    <ItemCompatibilityList><ReplaceAll>true</ReplaceAll>${compatXml}</ItemCompatibilityList>
  </Item>
</ReviseFixedPriceItemRequest>`;
  const text = await ebayProxy('ReviseFixedPriceItem', xml, cfg);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  return doc.querySelector('Ack')?.textContent === 'Success' || doc.querySelector('Ack')?.textContent === 'Warning';
}

export async function testEbayConnection(cfg) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayOfficialTimeRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${cfg.token}</eBayAuthToken></RequesterCredentials>
</GeteBayOfficialTimeRequest>`;
  const text = await ebayProxy('GeteBayOfficialTime', xml, cfg);
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  return doc.querySelector('Ack')?.textContent === 'Success';
}

export function extractKeywords(title) {
  const stop = new Set(['the','a','an','and','or','for','with','to','of','in','on','at','fits','oem','new','used','pair','set','left','right','front','rear','upper','lower','driver','passenger','side']);
  return [...new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g,'').split(/\s+/).filter(w => w.length > 2 && !stop.has(w))
  )];
}

export function scoreMatch(titleKeywords, donorKeywords) {
  if (!donorKeywords?.length) return 0;
  const matches = titleKeywords.filter(k => donorKeywords.includes(k));
  return Math.round((matches.length / Math.max(titleKeywords.length, donorKeywords.length)) * 100);
}
