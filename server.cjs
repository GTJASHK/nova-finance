const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const mimeTypes = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };
const localFutuBridgeUrl = 'http://127.0.0.1:6189';
let futuBridgeUrl = localFutuBridgeUrl;
let futuBridgeKey = '';
const futuSnapshotFallbackUrl = 'http://127.0.0.1:6188/market-snapshot';
const futuSearchFallbackUrl = 'http://127.0.0.1:6188/securities/search';

function loadEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (_) {
    // Configuration is optional until the user connects an LLM provider.
  }
}
loadEnvFile(path.join(root, 'market-api.env'));
futuBridgeUrl = (process.env.FUTU_BRIDGE_URL || localFutuBridgeUrl).replace(/\/$/, '');
futuBridgeKey = process.env.FUTU_BRIDGE_KEY || '';

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(payload));
}
function allowedOrigins() {
  return (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}
function allowCors(request, response) {
  const origin = String(request.headers.origin || '').replace(/\/$/, '');
  const localOrigin = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin);
  if (!origin || localOrigin || allowedOrigins().includes(origin)) {
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return true;
  }
  return false;
}
function normalizeSnapshots(payload) {
  return {
    ...payload,
    snapshots: (payload.snapshots || []).map((snapshot) => {
      const lastPrice = Number(snapshot.lastPrice);
      const previousClose = Number(snapshot.previousClose);
      const hasProviderChange = snapshot.changeRate !== null && snapshot.changeRate !== undefined && snapshot.changeRate !== '';
      const changeRate = Number(snapshot.changeRate);
      return {
        ...snapshot,
        changeRate: hasProviderChange && Number.isFinite(changeRate) ? changeRate : Number.isFinite(lastPrice) && Number.isFinite(previousClose) && previousClose !== 0 ? ((lastPrice - previousClose) / previousClose) * 100 : null,
      };
    }),
  };
}
function futuCodeFromExactInput(market, value) {
  const code = value.trim().toUpperCase();
  if (market === 'hk' && /^\d{1,5}$/.test(code)) return `HK.${code.padStart(5, '0')}`;
  if (market === 'us' && /^[A-Z][A-Z.\-]{0,9}$/.test(code)) return `US.${code}`;
  return null;
}
async function searchExactFutuCode(market, query) {
  const futuCode = futuCodeFromExactInput(market, query);
  if (!futuCode) return [];
  const payload = normalizeSnapshots(await requestFutuBridge('/market-snapshot', { codes: futuCode }));
  return (payload.snapshots || []).filter((snapshot) => snapshot.code && snapshot.name).map((snapshot) => ({
    code: snapshot.code.split('.').slice(1).join('.'),
    futuCode: snapshot.code,
    name: snapshot.name,
    exchange: snapshot.code.split('.')[0],
    market,
    source: 'Futu OpenAPI · market snapshot',
  }));
}
async function requestFutuBridge(route, params) {
  try {
    const bridge = await fetch(`${futuBridgeUrl}${route}?${new URLSearchParams(params)}`, {
      headers: futuBridgeKey ? { Authorization: `Bearer ${futuBridgeKey}` } : {},
    });
    const payload = await bridge.json();
    if (!bridge.ok) throw new Error(payload.message || `富途桥接服务响应 ${bridge.status}`);
    return payload;
  } catch (primaryError) {
    if (route !== '/market-snapshot' || futuBridgeUrl !== localFutuBridgeUrl) throw primaryError;
    const fallback = await fetch(`${futuSnapshotFallbackUrl}?${new URLSearchParams(params)}`);
    const payload = await fallback.json();
    if (!fallback.ok) throw new Error(payload.message || `富途快照桥接服务响应 ${fallback.status}`);
    return payload;
  }
}

async function requestFutuSearch(params) {
  try {
    return await requestFutuBridge('/securities/search', params);
  } catch (primaryError) {
    if (futuBridgeUrl !== localFutuBridgeUrl) throw primaryError;
    const fallback = await fetch(`${futuSearchFallbackUrl}?${new URLSearchParams(params)}`);
    const payload = await fallback.json();
    if (!fallback.ok) throw new Error(payload.message || primaryError.message || `富途搜索桥接服务响应 ${fallback.status}`);
    return payload;
  }
}

function readRequestBody(request, maxBytes = 128 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('请求内容过大。'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function extractResponseText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('').trim();
}

async function answerChat(messages, { webSearch = false } = {}) {
  const ezhongzhuanKey = process.env.EZHONGZHUAN_API_KEY;
  if (!ezhongzhuanKey) {
    const error = new Error('尚未配置 EZHONGZHUAN_API_KEY');
    error.code = 'missing_api_key';
    throw error;
  }
  const model = process.env.EZHONGZHUAN_MODEL || 'gpt-5.5';
  const baseUrl = (process.env.EZHONGZHUAN_BASE_URL || 'https://api.ezhongzhuan.com/v1').replace(/\/$/, '');
  const instructions = '你是 NOVA Finance 的金融研究助理。用简洁、谨慎、可验证的中文回答；不得把演示数据当成实时行情，不构成投资建议。用户询问股价时，先说明需要以页面的富途行情为准。';
  const response = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ezhongzhuanKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
    model,
    instructions,
    input: messages,
    max_output_tokens: 900,
      ...(webSearch && process.env.EZHONGZHUAN_WEB_SEARCH !== 'false' ? { tools: [{ type: 'web_search' }] } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error?.message || `易中转模型服务响应 ${response.status}`;
    const error = new Error(detail);
    error.code = 'provider_error';
    throw error;
  }
  const text = extractResponseText(payload);
  if (!text) throw new Error('易中转模型没有返回文字内容。');
  return { text, model, apiStyle: 'responses' };
}

function parseJsonArray(text) {
  const cleaned = String(text || '').replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型没有返回可解析的列表。');
  const value = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(value)) throw new Error('模型返回格式不是列表。');
  return value;
}

function normalizedFutuCode(market, code) {
  const value = String(code || '').trim().toUpperCase();
  if ((market === 'hk' && /^HK\.\d{5}$/.test(value)) || (market === 'us' && /^US\.[A-Z][A-Z.\-]{0,9}$/.test(value))) return value;
  if (market === 'hk' && /^\d{1,5}$/.test(value)) return `HK.${value.padStart(5, '0')}`;
  if (market === 'us' && /^[A-Z][A-Z.\-]{0,9}$/.test(value)) return `US.${value}`;
  return '';
}

async function searchSecuritiesWithModel(market, query) {
  const result = await answerChat([{
    role: 'user',
    content: `请检索${market === 'hk' ? '香港' : '美国'}股票市场中与“${query}”匹配的股票候选项。若你没有联网检索能力或无法核验，请返回空数组。只返回 JSON 数组，不要 Markdown。每项字段必须是 code、name、exchange、futuCode、source；最多 8 项。futuCode 使用 Futu 格式，例如 HK.09988、US.AAPL。source 必须写明可核验的公开来源，不要编造来源。`,
  }], { webSearch: true });
  return parseJsonArray(result.text).map((item) => {
    const code = String(item.code || '').trim().toUpperCase();
    return {
      code,
      futuCode: normalizedFutuCode(market, item.futuCode || code),
      name: String(item.name || '').trim(),
      exchange: String(item.exchange || '').trim(),
      market,
      source: `易中转模型检索 · ${String(item.source || '需核验')}`,
    };
  }).filter((item) => item.code && item.name && item.futuCode);
}

function decodeXml(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function rssTag(item, tag) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return decodeXml(match?.[1] || '');
}

function newsRssQueries(region) {
  const queries = [];
  if (region !== 'us') queries.push('site:reuters.com OR site:hkexnews.hk OR site:hkex.com (Hong Kong stocks OR HKEX OR Hong Kong earnings OR Hang Seng) when:1d');
  if (region !== 'hk') queries.push('site:reuters.com OR site:sec.gov (stocks OR shares OR earnings OR markets OR "Federal Reserve" OR SEC) when:1d');
  return queries.map((query, index) => ({ query, region: region === 'all' ? (index === 0 ? 'hk' : 'us') : region }));
}

async function fetchNewsRss(region) {
  // Request the two regional feeds independently so one feed's transient failure never hides the other market.
  if (region === 'all') {
    const hongKongItems = await fetchNewsRss('hk').catch(() => []);
    const usItems = await fetchNewsRss('us').catch(() => []);
    return [...hongKongItems, ...usItems];
  }
  const feeds = await Promise.all(newsRssQueries(region).map(async ({ query, region: itemRegion }) => {
    const url = new URL('https://news.google.com/rss/search');
    url.searchParams.set('q', query);
    url.searchParams.set('hl', itemRegion === 'hk' ? 'zh-HK' : 'en-US');
    url.searchParams.set('gl', itemRegion === 'hk' ? 'HK' : 'US');
    url.searchParams.set('ceid', itemRegion === 'hk' ? 'HK:zh-Hant' : 'US:en');
    const response = await fetch(url, { headers: { 'User-Agent': 'NOVA Finance news reader/1.0' } });
    if (!response.ok) throw new Error(`新闻 RSS 响应 ${response.status}`);
    const xml = await response.text();
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
      const item = match[1];
      return {
        title: rssTag(item, 'title'),
        source: rssTag(item, 'source') || 'Google News 聚合来源',
        sourceUrl: rssTag(item, 'link'),
        time: rssTag(item, 'pubDate'),
        region: itemRegion,
      };
    }).filter((item) => item.title && item.sourceUrl);
  }));
  const seen = new Set();
  const newestAllowed = Date.now() + 24 * 60 * 60 * 1000;
  const oldestAllowed = Date.now() - 8 * 24 * 60 * 60 * 1000;
  return feeds.flat().filter((item) => {
    const key = `${item.title}|${item.sourceUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const publishedAt = Date.parse(item.time);
    return !Number.isFinite(publishedAt) || (publishedAt >= oldestAllowed && publishedAt <= newestAllowed);
  }).sort((left, right) => (Date.parse(right.time) || 0) - (Date.parse(left.time) || 0)).slice(0, 12);
}

async function fetchNewsWithModel(region) {
  const sourceItems = await fetchNewsRss(region);
  if (!sourceItems.length) return { items: [], provider: 'rss_fallback' };
  const allowedUrls = new Set(sourceItems.map((item) => item.sourceUrl));
  const displayItems = region === 'all'
    ? [...sourceItems.filter((item) => item.region === 'hk').slice(0, 5), ...sourceItems.filter((item) => item.region === 'us').slice(0, 5)]
    : sourceItems.slice(0, 10);
  const rawFallback = displayItems.map((item) => ({
    ...item,
    summary: `原文来自 ${item.source}，请点击来源链接查看全文。`,
    tag: '实时资讯',
    related: '待模型分析',
  }));
  let result;
  try {
    result = await Promise.race([
      answerChat([{
        role: 'user',
        content: `请根据下面已经抓取的真实新闻 RSS 条目整理最近影响港股或美股的新闻。只能使用给定条目，不能新增事实或链接。只返回 JSON 数组，不要 Markdown。每项字段为 title、summary、time、source、sourceUrl、region（hk 或 us）、tag、related；sourceUrl 必须原样复制给定条目中的链接，最多 10 项。\n\n${JSON.stringify(sourceItems)}`,
      }]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('模型新闻整理超时')), 4000)),
    ]);
  } catch (_) {
    return { items: rawFallback, provider: 'rss_fallback' };
  }
  const summarized = parseJsonArray(result.text).map((item) => ({
    title: String(item.title || '').trim(),
    summary: String(item.summary || '').trim(),
    time: String(item.time || '').trim(),
    source: String(item.source || '').trim(),
    sourceUrl: String(item.sourceUrl || '').trim(),
    region: item.region === 'us' ? 'us' : 'hk',
    tag: String(item.tag || '市场').trim(),
    related: String(item.related || '').trim(),
  })).filter((item) => item.title && item.summary && item.source && allowedUrls.has(item.sourceUrl));
  return summarized.length ? { items: summarized, provider: 'ezhongzhuan_model' } : { items: rawFallback, provider: 'rss_fallback' };
}

const server = http.createServer(async (request, response) => {
  if (!allowCors(request, response)) {
    sendJson(response, 403, { error: 'origin_not_allowed', message: '此站点未获 API 访问授权。' });
    return;
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/api/health') {
    sendJson(response, 200, {
      status: 'ok',
      futuBridge: futuBridgeUrl === localFutuBridgeUrl ? 'local' : 'remote',
      futuBridgeKeyConfigured: Boolean(futuBridgeKey),
    });
    return;
  }
  if (url.pathname === '/api/quotes/snapshot') {
    const codes = (url.searchParams.get('codes') || '').trim();
    if (!codes || codes.length > 3000) {
      sendJson(response, 400, { error: 'invalid_request', message: '请提供有效的富途股票代码。' });
      return;
    }
    try {
      sendJson(response, 200, normalizeSnapshots(await requestFutuBridge('/market-snapshot', { codes })));
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误';
      sendJson(response, 503, { error: 'futu_opend_unavailable', message: `富途行情未连接：${reason}` });
    }
    return;
  }
  if (url.pathname === '/api/securities/search') {
    const market = url.searchParams.get('market');
    const query = (url.searchParams.get('q') || '').trim();
    if (!['hk', 'us'].includes(market) || query.length < 1 || query.length > 32) {
      sendJson(response, 400, { error: 'invalid_request', message: '请输入有效市场与股票代码或名称。' });
      return;
    }
    try {
      // Exact codes work with the already-verified snapshot bridge even when the full search bridge is offline.
      const exactResults = await searchExactFutuCode(market, query);
      if (exactResults.length) {
        sendJson(response, 200, { results: exactResults, fallback: 'market_snapshot' });
        return;
      }
      const futuResults = await requestFutuSearch({ market, q: query });
      if (futuResults.results?.length) {
        sendJson(response, 200, futuResults);
        return;
      }
      const modelResults = await searchSecuritiesWithModel(market, query);
      sendJson(response, 200, { results: modelResults, fallback: 'ezhongzhuan_model' });
    } catch (error) {
      try {
        const results = await searchSecuritiesWithModel(market, query);
        sendJson(response, 200, { results, fallback: 'ezhongzhuan_model' });
        return;
      } catch (modelError) {
        const reason = modelError instanceof Error ? modelError.message : error instanceof Error ? error.message : '未知错误';
        sendJson(response, 503, { error: 'security_search_unavailable', message: `股票搜索不可用：${reason}` });
      }
    }
    return;
  }
  if (url.pathname === '/api/news') {
    const region = url.searchParams.get('region') || 'all';
    if (!['all', 'hk', 'us'].includes(region)) {
      sendJson(response, 400, { error: 'invalid_request', message: '请输入有效新闻市场。' });
      return;
    }
    try {
      const news = await fetchNewsWithModel(region);
      sendJson(response, 200, { items: news.items, provider: news.provider, generatedAt: new Date().toISOString() });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误';
      sendJson(response, 503, { error: 'news_search_unavailable', message: `新闻检索不可用：${reason}` });
    }
    return;
  }
  if (url.pathname === '/api/chat') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: 'method_not_allowed', message: '聊天接口只接受 POST 请求。' });
      return;
    }
    try {
      const body = JSON.parse(await readRequestBody(request));
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const safeMessages = messages.slice(-20).map((message) => ({
        role: ['user', 'assistant', 'system'].includes(message?.role) ? message.role : 'user',
        content: String(message?.content || '').trim().slice(0, 8000),
      })).filter((message) => message.content);
      if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== 'user') {
        sendJson(response, 400, { error: 'invalid_request', message: '请提供至少一条用户消息。' });
        return;
      }
      const answer = await answerChat(safeMessages);
      sendJson(response, 200, answer);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误';
      if (error?.code === 'missing_api_key') {
        sendJson(response, 503, { error: 'llm_not_configured', message: '聊天模型尚未配置 API Key，请在服务端 market-api.env 填写 EZHONGZHUAN_API_KEY。' });
      } else if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: 'invalid_json', message: '聊天请求格式无效。' });
      } else {
        sendJson(response, 502, { error: 'llm_request_failed', message: `聊天模型请求失败：${reason}` });
      }
    }
    return;
  }
  if (url.pathname === '/api/market/state') {
    try { sendJson(response, 200, await requestFutuBridge('/market-state', {})); }
    catch (error) { sendJson(response, 503, { error: 'futu_opend_unavailable', message: `富途市场状态未连接：${error.message}` }); }
    return;
  }
  if (url.pathname === '/api/kline') {
    const code = (url.searchParams.get('code') || '').trim();
    if (!code) { sendJson(response, 400, { error: 'invalid_request', message: '请提供富途股票代码。' }); return; }
    try { sendJson(response, 200, await requestFutuBridge('/kline', { code, count: url.searchParams.get('count') || '30' })); }
    catch (error) { sendJson(response, 503, { error: 'futu_opend_unavailable', message: `富途 K 线未连接：${error.message}` }); }
    return;
  }
  const requestPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(root, `.${requestPath}`);
  if (!filePath.startsWith(root) || !Object.prototype.hasOwnProperty.call(mimeTypes, path.extname(filePath))) { response.writeHead(404); response.end('Not found'); return; }
  fs.readFile(filePath, (error, content) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error'); return; }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(content);
  });
});

const port = Number(process.env.PORT || 4183);
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`NOVA Finance API: http://127.0.0.1:${port}/`));
