const conversation = document.querySelector('#conversation');
const promptInput = document.querySelector('#promptInput');
const composer = document.querySelector('#composer');
const toast = document.querySelector('#toast');
let toastTimer;
const apiBaseUrl = String(window.NOVA_API_BASE_URL || '').trim().replace(/\/+$/, '');
const apiUrl = (route) => `${apiBaseUrl}${route}`;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}

const chatHistory = [];

function inlineAssistantMarkup(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>');
}

function formatAssistantText(value) {
  const lines = String(value || '').replace(/\r/g, '').split('\n');
  const chunks = [];
  let listType = null;
  let codeLines = null;
  const closeList = () => {
    if (listType) { chunks.push(`</${listType}>`); listType = null; }
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (codeLines) {
        chunks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = null;
      } else {
        closeList();
        codeLines = [];
      }
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }
    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) { closeList(); chunks.push(`<${nextType}>`); listType = nextType; }
      chunks.push(`<li>${inlineAssistantMarkup((unordered || ordered)[1])}</li>`);
    } else if (/^#{1,3}\s+/.test(trimmed)) {
      closeList();
      chunks.push(`<h4>${inlineAssistantMarkup(trimmed.replace(/^#{1,3}\s+/, ''))}</h4>`);
    } else if (!trimmed) {
      closeList();
    } else {
      closeList();
      chunks.push(`<p>${inlineAssistantMarkup(trimmed)}</p>`);
    }
  }
  closeList();
  if (codeLines) chunks.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  return chunks.join('');
}

function appendMessage(text, role = 'user') {
  const row = document.createElement('div');
  row.className = `message-row ${role === 'user' ? 'user-row' : 'assistant-row'}`;
  if (role === 'assistant') {
    row.innerHTML = '<div class="assistant-avatar">N</div><div class="message-content"><span class="message-time">刚刚</span><div class="message-bubble assistant-bubble"><div class="assistant-rich-text"></div></div></div>';
  } else {
    row.innerHTML = '<div class="message-content user-content"><span class="message-time">刚刚</span><div class="message-bubble user-bubble"><p></p></div></div>';
  }
  if (role === 'assistant') row.querySelector('.assistant-rich-text').innerHTML = formatAssistantText(text);
  else row.querySelector('p').textContent = text;
  conversation.appendChild(row);
  conversation.scrollTop = conversation.scrollHeight;
  return row;
}

async function sendPrompt(text) {
  const clean = text.trim();
  if (!clean) return;
  appendMessage(clean, 'user');
  promptInput.value = '';
  promptInput.style.height = 'auto';
  chatHistory.push({ role: 'user', content: clean });
  const pending = appendMessage('正在连接金融研究模型...', 'assistant');
  try {
    const response = await fetch(apiUrl('/api/chat'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: chatHistory }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '聊天模型暂不可用');
    const answer = String(payload.text || '').trim();
    pending.querySelector('.assistant-rich-text').innerHTML = formatAssistantText(answer || '模型没有返回内容。');
    chatHistory.push({ role: 'assistant', content: answer });
  } catch (error) {
    pending.querySelector('.assistant-rich-text').textContent = error instanceof Error ? error.message : '聊天模型暂不可用';
    pending.classList.add('error-message');
  }
  conversation.scrollTop = conversation.scrollHeight;
}

composer.addEventListener('submit', (event) => { event.preventDefault(); sendPrompt(promptInput.value); });
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendPrompt(promptInput.value); }
});
promptInput.addEventListener('input', () => { promptInput.style.height = 'auto'; promptInput.style.height = `${Math.min(promptInput.scrollHeight, 90)}px`; });
document.querySelectorAll('.suggested-prompts button').forEach((button) => button.addEventListener('click', () => sendPrompt(button.dataset.prompt)));

function activateView(view) {
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  if (view === 'screener') {
    document.querySelector('[data-tab="screener"]').click();
  } else if (view === 'watchlist' || view === 'news') {
    document.querySelector('[data-tab="chat"]').click();
    const target = view === 'watchlist' ? document.querySelector('.watchlist-section') : document.querySelector('.news-section');
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(view === 'watchlist' ? '已定位到我的自选' : '已定位到新闻雷达');
  } else {
    document.querySelector('[data-tab="chat"]').click();
  }
}
document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.addEventListener('click', () => activateView(item.dataset.view)));
document.querySelectorAll('.view-tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.view-tab').forEach((item) => item.classList.toggle('active', item === tab));
  document.querySelector('#chatView').classList.toggle('active-view', tab.dataset.tab === 'chat');
  document.querySelector('#screenerView').classList.toggle('active-view', tab.dataset.tab === 'screener');
  document.querySelector('#pageTitle').innerHTML = tab.dataset.tab === 'screener' ? '找到下一只值得关注的股票 <span class="wave">✦</span>' : '早上好，Reina <span class="wave">✦</span>';
}));

const watchlistStorageKey = 'nova-finance-watchlist-v2';
const defaultWatchlist = [
  { id: 'hk:00700', code: '00700', name: '腾讯控股', exchange: '港', market: 'hk', region: 'hk', price: 512.00, change: -0.58, badge: '腾', color: 'cyan', bars: [65, 58, 62, 48, 54, 42, 50] },
  { id: 'hk:01810', code: '01810', name: '小米集团', exchange: '港', market: 'hk', region: 'hk', price: 41.35, change: 2.98, badge: '米', color: 'orange', bars: [50, 47, 60, 56, 72, 80, 76] },
  { id: 'hk:09988', code: '09988', name: '阿里巴巴-W', exchange: '港', market: 'hk', region: 'hk', price: 107.70, change: -0.65, badge: '阿', color: 'orange', bars: [35, 40, 48, 45, 60, 66, 72] },
  { id: 'us:NVDA', code: 'NVDA', name: 'NVIDIA', exchange: 'NASDAQ', market: 'us', region: 'us', price: 176.49, change: 2.41, badge: 'N', color: 'violet', bars: [42, 55, 49, 68, 76, 71, 88] },
  { id: 'us:MSFT', code: 'MSFT', name: 'Microsoft', exchange: 'NASDAQ', market: 'us', region: 'us', price: 518.22, change: 0.86, badge: 'M', color: 'blue', bars: [62, 58, 65, 71, 66, 77, 74] },
];
const stockCatalog = [
  ...defaultWatchlist,
  { id: 'us:AAPL', code: 'AAPL', name: 'Apple', exchange: 'NASDAQ', market: 'us', region: 'us', price: 231.59, change: -0.21, badge: 'A', color: 'green', bars: [70, 64, 59, 62, 54, 58, 51] },
  { id: 'us:TSLA', code: 'TSLA', name: 'Tesla', exchange: 'NASDAQ', market: 'us', region: 'us', price: 345.78, change: 3.46, badge: 'T', color: 'red', bars: [31, 38, 44, 60, 55, 72, 86] },
];
let watchlistData;
try { watchlistData = JSON.parse(localStorage.getItem(watchlistStorageKey)) || defaultWatchlist; } catch { watchlistData = defaultWatchlist; }
watchlistData = Array.isArray(watchlistData)
  ? watchlistData.filter((stock) => stock && (stock.market === 'hk' || stock.market === 'us')).map((stock) => ({ ...stock, region: stock.market }))
  : defaultWatchlist;
localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlistData));
let activeWatchRegion = 'all';
let watchlistSort = 'manual';

function saveWatchlist() { localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlistData)); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
function getSortedWatchlist() {
  const stocks = [...watchlistData];
  if (watchlistSort === 'change') stocks.sort((a, b) => (Number.isFinite(b.change) ? b.change : -Infinity) - (Number.isFinite(a.change) ? a.change : -Infinity));
  if (watchlistSort === 'price') stocks.sort((a, b) => (Number.isFinite(b.price) ? b.price : -Infinity) - (Number.isFinite(a.price) ? a.price : -Infinity));
  if (watchlistSort === 'name') stocks.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  return stocks;
}
function stockPrice(stock) { return stock.quoteProvider === 'futu' && Number.isFinite(stock.price) ? stock.market === 'us' ? `$${stock.price.toFixed(2)}` : stock.price.toFixed(2) : '待接富途'; }
function stockChange(stock) { return stock.quoteProvider === 'futu' && Number.isFinite(stock.change) ? `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%` : '待接行情'; }
function stockChangeClass(stock) { return stock.quoteProvider === 'futu' && Number.isFinite(stock.change) ? stock.change >= 0 ? 'positive' : 'negative' : 'pending-price'; }
function stockBars(stock) { return stock.bars.map((height) => `<span style="--h:${height}%"></span>`).join(''); }
function futuCode(stock) {
  if (stock.futuCode) return stock.futuCode;
  if (/^(?:HK|US)\./i.test(String(stock.code || ''))) return stock.code.toUpperCase();
  if (stock.market === 'us') return `US.${stock.code}`;
  return `HK.${stock.code.padStart(5, '0')}`;
}
function displayStockCode(stock) {
  return String(stock.code || '').replace(/^(?:HK|US)\./i, '');
}
async function refreshWatchlistQuotes({ silent = false } = {}) {
  if (!watchlistData.length) return;
  const codes = watchlistData.map(futuCode).join(',');
  try {
    const response = await fetch(apiUrl(`/api/quotes/snapshot?codes=${encodeURIComponent(codes)}`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '报价服务不可用');
    const snapshots = new Map((payload.snapshots || []).map((snapshot) => [snapshot.code, snapshot]));
    let updated = 0;
    watchlistData = watchlistData.map((stock) => {
      const quote = snapshots.get(futuCode(stock));
      if (!quote || quote.lastPrice === null) return stock;
      updated += 1;
      return mergeFutuQuote(stock, quote);
    });
    if (updated) { saveWatchlist(); renderWatchlist(); }
    if (!silent) showToast(updated ? `已更新 ${updated} 只股票的富途行情` : '富途未返回可用报价');
  } catch (error) {
    if (!silent) showToast(error instanceof Error ? error.message : '富途行情暂不可用');
  }
}
function renderWatchlist() {
  const list = document.querySelector('#watchlist');
  list.innerHTML = getSortedWatchlist().map((stock) => `<div class="watch-row${activeWatchRegion !== 'all' && stock.region !== activeWatchRegion ? ' is-hidden' : ''}" data-region="${escapeHtml(stock.region)}" data-stock="${escapeHtml(stock.name)}"><button class="stock-name stock-detail-trigger" data-stock-id="${escapeHtml(stock.id)}" title="查看 ${escapeHtml(stock.name)} 详情"><span class="stock-badge ${escapeHtml(stock.color)}">${escapeHtml(stock.badge)}</span><span><b>${escapeHtml(stock.name)}</b><small>${escapeHtml(displayStockCode(stock))} · ${escapeHtml(stock.exchange)}</small></span></button><div class="stock-spark">${stockBars(stock)}</div><div class="stock-price"><b>${stockPrice(stock)}</b><span class="${stockChangeClass(stock)}">${stockChange(stock)}</span></div><button class="star-button active" data-watch-id="${escapeHtml(stock.id)}" title="从自选移除">★</button></div>`).join('');
  document.querySelectorAll('.count-label').forEach((element) => { element.textContent = watchlistData.length; });
  const navCount = document.querySelector('.nav-item[data-view="watchlist"] .nav-count');
  if (navCount) navCount.textContent = watchlistData.length;
  renderWatchlistManager();
}
function renderWatchlistManager() {
  const list = document.querySelector('#watchlistManagerList');
  if (!list) return;
  list.innerHTML = getSortedWatchlist().map((stock) => `<div class="manager-stock-row"><span class="stock-badge ${escapeHtml(stock.color)}">${escapeHtml(stock.badge)}</span><div><b>${escapeHtml(stock.name)}</b><small>${escapeHtml(stock.code)} · ${stock.market === 'us' ? '美股' : '港股'} · ${escapeHtml(stock.exchange)}</small></div><span class="manager-price ${stockChangeClass(stock)}">${stockPrice(stock)}<small>${stockChange(stock)}</small></span><button class="remove-watch-button" data-watch-id="${escapeHtml(stock.id)}" title="移除 ${escapeHtml(stock.name)}">移除</button></div>`).join('') || '<div class="watchlist-empty">还没有自选股。搜索港股或美股代码即可开始添加。</div>';
}
function removeWatchlistStock(id) {
  const stock = watchlistData.find((item) => item.id === id);
  if (!stock) return;
  watchlistData = watchlistData.filter((item) => item.id !== id);
  saveWatchlist();
  renderWatchlist();
  showToast(`已移除 ${stock.name}`);
}

document.querySelector('#watchlist').addEventListener('click', (event) => {
  const button = event.target.closest('.star-button');
  if (button) { removeWatchlistStock(button.dataset.watchId); return; }
  const detailTrigger = event.target.closest('.stock-detail-trigger');
  if (detailTrigger) openStockDetail(detailTrigger.dataset.stockId);
});
document.querySelectorAll('.row-action').forEach((button) => button.addEventListener('click', () => { button.textContent = '已加入'; button.disabled = true; showToast('已加入自选股'); }));
document.querySelector('#runScreen').addEventListener('click', () => { document.querySelector('#resultCount').textContent = '18'; showToast('筛选完成，已更新结果'); });
document.querySelector('#saveScreen').addEventListener('click', () => showToast('策略已保存到我的策略'));
document.querySelector('#refreshButton').addEventListener('click', (event) => { event.currentTarget.style.transform = 'rotate(180deg)'; setTimeout(() => event.currentTarget.style.transform = '', 350); refreshWatchlistQuotes(); });
const newsFeed = document.querySelector('#newsFeed');
function safeNewsUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? escapeHtml(url.href) : '';
  } catch (_) {
    return '';
  }
}
function renderModelNews(items, provider = 'ezhongzhuan_model') {
  newsFeed.innerHTML = items.slice(0, 10).map((item) => {
    const sourceUrl = safeNewsUrl(item.sourceUrl);
    const sourceLabel = sourceUrl ? `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.source)}</a>` : escapeHtml(item.source);
    return `<article class="news-item hot" data-news-region="${escapeHtml(item.region)}" data-source-url="${sourceUrl}"><div class="news-meta"><span class="news-tag red-tag">${escapeHtml(item.tag || '市场')}</span><time>${escapeHtml(item.time || '刚刚')}</time><span class="news-source">${sourceLabel} · AI 检索</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.summary)}</p><div class="news-related"><span>${escapeHtml(item.related || '市场影响待评估')}</span></div></article>`;
  }).join('');
  document.querySelector('.source-disclaimer').textContent = provider === 'rss_fallback' ? '模型整理超时，当前展示已抓取的原文条目；请打开来源链接核验，不构成投资建议。' : '新闻由易中转模型整理，已保留来源链接；请打开原文核验，不构成投资建议。';
  const activeFilter = document.querySelector('.news-filter.active')?.dataset.newsRegion || 'all';
  document.querySelectorAll('.news-item').forEach((item) => item.classList.toggle('is-hidden', activeFilter !== 'all' && item.dataset.newsRegion !== activeFilter));
}
async function refreshNews() {
  const button = document.querySelector('#refreshNews');
  button.disabled = true;
  button.textContent = '检索中…';
  try {
    const response = await fetch(apiUrl('/api/news?region=all'));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '新闻检索暂不可用');
    if (!payload.items?.length) {
      newsFeed.innerHTML = '<div class="news-empty-state">易中转没有返回带来源链接的可核验新闻。请在易中转后台开启联网搜索能力后重试。</div>';
      document.querySelector('.source-disclaimer').textContent = '当前没有可核验的实时新闻；页面不会展示模型猜测的新闻。';
      throw new Error('模型没有返回可核验的新闻，请检查易中转联网搜索能力');
    }
    renderModelNews(payload.items, payload.provider);
    showToast(payload.provider === 'rss_fallback' ? `已更新 ${payload.items.length} 条原文资讯，请核验链接` : `已通过易中转整理 ${payload.items.length} 条新闻，请核验原文`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : '新闻检索暂不可用');
  } finally {
    button.disabled = false;
    button.textContent = '刷新 ↻';
  }
}
document.querySelector('#refreshNews').addEventListener('click', refreshNews);
const watchlistModal = document.querySelector('#watchlistModal');
function openWatchlistModal() { renderWatchlistManager(); watchlistModal.classList.add('open'); watchlistModal.setAttribute('aria-hidden', 'false'); document.querySelector('#watchCode').focus(); }
function closeWatchlistModal() { watchlistModal.classList.remove('open'); watchlistModal.setAttribute('aria-hidden', 'true'); }
document.querySelector('#editWatchlist').addEventListener('click', openWatchlistModal);
document.querySelector('#closeWatchlistModal').addEventListener('click', closeWatchlistModal);
watchlistModal.addEventListener('click', (event) => { if (event.target === watchlistModal) closeWatchlistModal(); });
const searchStatus = document.querySelector('#securitySearchStatus');
const searchResults = document.querySelector('#securitySearchResults');
const watchMarket = document.querySelector('#watchMarket');
const watchCode = document.querySelector('#watchCode');
let remoteSearchResults = [];
let searchTimer;
function barsForCode(code) {
  const seed = [...code].reduce((total, character) => total + character.charCodeAt(0), 0);
  return Array.from({ length: 7 }, (_, index) => 34 + ((seed + index * 17) % 52));
}
function renderSecurityResults() {
  searchResults.innerHTML = remoteSearchResults.map((stock, index) => `<button type="button" class="security-result" data-result-index="${index}"><span class="stock-badge ${stock.market === 'us' ? 'violet' : stock.market === 'hk' ? 'orange' : 'blue'}">${escapeHtml(stock.code.slice(0, 1))}</span><span class="security-result-copy"><b>${escapeHtml(stock.name)}</b><small>${escapeHtml(stock.code)} · ${escapeHtml(stock.exchange)} · ${escapeHtml(stock.source)}</small></span><span class="security-result-add">加入 +</span></button>`).join('');
}
async function searchMarketSecurities() {
  const query = watchCode.value.trim();
  if (!query) { searchStatus.textContent = '输入名称或股票代码以搜索。'; searchResults.innerHTML = ''; return; }
  searchStatus.textContent = '正在通过 Futu OpenAPI 搜索证券...';
  searchResults.innerHTML = '';
  try {
    const response = await fetch(apiUrl(`/api/securities/search?market=${encodeURIComponent(watchMarket.value)}&q=${encodeURIComponent(query)}`));
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || '证券搜索暂不可用');
    remoteSearchResults = payload.results || [];
    searchStatus.textContent = remoteSearchResults.length ? `找到 ${remoteSearchResults.length} 个市场候选项，选择后加入自选。` : '没有找到匹配股票，请更换市场或关键词。';
    renderSecurityResults();
  } catch (error) {
    remoteSearchResults = [];
    searchResults.innerHTML = '';
    searchStatus.textContent = error instanceof Error ? error.message : '证券搜索暂不可用';
  }
}
document.querySelector('#watchlistAddForm').addEventListener('submit', (event) => { event.preventDefault(); searchMarketSecurities(); });
watchCode.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(searchMarketSecurities, 450);
});
watchMarket.addEventListener('change', () => {
  remoteSearchResults = [];
  searchResults.innerHTML = '';
  searchStatus.textContent = watchCode.value.trim() ? '市场已切换，正在重新搜索...' : '';
  if (watchCode.value.trim()) searchMarketSecurities();
});
searchResults.addEventListener('click', (event) => {
  const item = event.target.closest('.security-result');
  if (!item) return;
  const result = remoteSearchResults[Number(item.dataset.resultIndex)];
  if (!result) return;
  if (!['hk', 'us'].includes(result.market)) { showToast('仅支持港股和美股'); return; }
  const stock = { id: result.futuCode || `${result.market}:${result.code}`, futuCode: result.futuCode, code: result.code, name: result.name, exchange: result.exchange, market: result.market, region: result.market, price: null, change: null, badge: result.code.slice(0, 1), color: result.market === 'us' ? 'violet' : 'orange', bars: barsForCode(result.code) };
  if (watchlistData.some((watch) => watch.id === stock.id)) { showToast(`${stock.name} 已在自选股中`); return; }
  watchlistData.push(stock);
  saveWatchlist();
  renderWatchlist();
  remoteSearchResults = [];
  searchResults.innerHTML = '';
  searchStatus.textContent = `${stock.name} 已加入自选，正在获取富途行情。`;
  watchCode.value = '';
  showToast(`已将 ${stock.name} 加入自选`);
  refreshWatchlistQuotes({ silent: true });
});
document.querySelector('#watchlistManagerList').addEventListener('click', (event) => {
  const button = event.target.closest('.remove-watch-button');
  if (button) removeWatchlistStock(button.dataset.watchId);
});
document.querySelector('#watchlistSort').addEventListener('change', (event) => { watchlistSort = event.target.value; renderWatchlist(); });
document.querySelector('#newChat').addEventListener('click', () => { conversation.innerHTML = ''; chatHistory.length = 0; appendMessage('新的对话已经准备好了。今天想从哪一个市场开始？', 'assistant'); showToast('已创建新对话'); });
document.querySelectorAll('.history-item').forEach((item) => item.addEventListener('click', () => { document.querySelectorAll('.history-item').forEach((x) => x.classList.remove('selected')); item.classList.add('selected'); document.querySelector('[data-tab="chat"]').click(); showToast(`已打开：${item.querySelector('b').textContent}`); }));
newsFeed.addEventListener('click', (event) => {
  if (event.target.closest('a')) return;
  const item = event.target.closest('.news-item');
  if (!item) return;
  const headline = item.querySelector('h3').textContent;
  sendPrompt(`解读这条新闻对相关板块的影响：${headline}`);
  document.querySelector('[data-tab="chat"]').click();
});

const stockDetailModal = document.querySelector('#stockDetailModal');
let activeStockDetailId = '';

function formatDetailNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '--';
}

function formatDetailAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  if (Math.abs(number) >= 100000000) return `${(number / 100000000).toFixed(2)} 亿`;
  if (Math.abs(number) >= 10000) return `${(number / 10000).toFixed(2)} 万`;
  return number.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function detailMetric(label, value, extraClass = '') {
  return `<div class="detail-metric"><span>${label}</span><b class="${extraClass}">${value}</b></div>`;
}

function formatChartTime(value) {
  const match = String(value || '').match(/(\d{2}:\d{2})(?::\d{2})?$/);
  return match ? match[1] : '--';
}

function formatChartPrice(value, market) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '--';
  const symbol = market === 'us' ? '$' : '';
  return `${symbol}${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
}

function renderDetailChart(bars, market = 'hk') {
  const chart = document.querySelector('#stockDetailChart');
  const data = (bars || []).map((bar) => ({ timeKey: String(bar.timeKey || ''), close: Number(bar.close) })).filter((bar) => Number.isFinite(bar.close));
  if (data.length < 2) {
    chart.innerHTML = '<span>暂未获取到可用分时数据</span>';
    return;
  }
  const width = 620;
  const height = 220;
  const left = 52;
  const right = 18;
  const top = 18;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = data.map((bar) => bar.close);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const padding = Math.max((rawMax - rawMin) * 0.18, Math.abs(rawMax || 1) * 0.0015, 0.01);
  const min = rawMin - padding;
  const max = rawMax + padding;
  const range = max - min || 1;
  const pointAt = (index) => ({
    x: left + (index / (data.length - 1)) * plotWidth,
    y: top + (1 - (data[index].close - min) / range) * plotHeight,
  });
  const points = data.map((_, index) => pointAt(index));
  const linePoints = points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const fillPoints = `${left},${top + plotHeight} ${linePoints} ${left + plotWidth},${top + plotHeight}`;
  const rising = values[values.length - 1] >= values[0];
  const lineColor = rising ? '#168463' : '#d1605b';
  const areaColor = rising ? '#3baa81' : '#dd756d';
  const horizontalGrid = [0, 0.5, 1].map((position) => {
    const y = top + position * plotHeight;
    const label = formatChartPrice(max - position * range, market);
    return `<g><line x1="${left}" x2="${left + plotWidth}" y1="${y}" y2="${y}"/><text x="2" y="${y + 3.5}">${label}</text></g>`;
  }).join('');
  const timeLabels = [0, Math.floor((data.length - 1) / 2), data.length - 1].map((index) => {
    const point = points[index];
    return `<text x="${point.x}" y="${height - 8}" text-anchor="middle">${formatChartTime(data[index].timeKey)}</text>`;
  }).join('');
  chart.innerHTML = `<div class="detail-chart-canvas"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="富途分时走势，悬停查看每分钟收盘价" preserveAspectRatio="none"><defs><linearGradient id="detailChartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${areaColor}" stop-opacity=".27"/><stop offset="100%" stop-color="${areaColor}" stop-opacity=".015"/></linearGradient></defs><g class="detail-chart-grid">${horizontalGrid}</g><polygon points="${fillPoints}" fill="url(#detailChartFill)"/><polyline points="${linePoints}" fill="none" stroke="${lineColor}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><g class="detail-chart-crosshair" aria-hidden="true"><line class="detail-crosshair-v"/><line class="detail-crosshair-h"/><circle r="4.5" fill="#fff" stroke="${lineColor}" stroke-width="2.5"/></g><g class="detail-chart-axis">${timeLabels}</g><rect class="detail-chart-hitarea" data-chart-plot="true" x="${left}" y="${top}" width="${plotWidth}" height="${plotHeight}"/></svg><div class="detail-chart-tooltip" role="status" aria-live="polite"><span class="detail-chart-tooltip-time"></span><strong class="detail-chart-tooltip-price"></strong><small>富途 1 分钟收盘价</small></div></div>`;

  const canvas = chart.querySelector('.detail-chart-canvas');
  const hitarea = chart.querySelector('[data-chart-plot]');
  const crosshair = chart.querySelector('.detail-chart-crosshair');
  const vertical = chart.querySelector('.detail-crosshair-v');
  const horizontal = chart.querySelector('.detail-crosshair-h');
  const marker = chart.querySelector('.detail-chart-crosshair circle');
  const tooltip = chart.querySelector('.detail-chart-tooltip');
  const tooltipTime = chart.querySelector('.detail-chart-tooltip-time');
  const tooltipPrice = chart.querySelector('.detail-chart-tooltip-price');

  const revealPoint = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left - (left / width) * rect.width) / ((plotWidth / width) * rect.width)));
    const index = Math.round(ratio * (data.length - 1));
    const point = points[index];
    vertical.setAttribute('x1', point.x); vertical.setAttribute('x2', point.x);
    vertical.setAttribute('y1', top); vertical.setAttribute('y2', top + plotHeight);
    horizontal.setAttribute('x1', left); horizontal.setAttribute('x2', left + plotWidth);
    horizontal.setAttribute('y1', point.y); horizontal.setAttribute('y2', point.y);
    marker.setAttribute('cx', point.x); marker.setAttribute('cy', point.y);
    tooltipTime.textContent = formatChartTime(data[index].timeKey);
    tooltipPrice.textContent = formatChartPrice(data[index].close, market);
    tooltip.style.left = `${Math.min(82, Math.max(4, (point.x / width) * 100))}%`;
    tooltip.style.top = `${Math.max(5, (point.y / height) * 100 - 4)}%`;
    crosshair.classList.add('is-visible');
    tooltip.classList.add('is-visible');
  };
  hitarea.addEventListener('pointermove', (event) => revealPoint(event.clientX));
  hitarea.addEventListener('pointerenter', (event) => revealPoint(event.clientX));
  hitarea.addEventListener('pointerleave', () => { crosshair.classList.remove('is-visible'); tooltip.classList.remove('is-visible'); });
}

function renderStockDetail(stock, bars = []) {
  if (!stock) return;
  const live = stock.quoteProvider === 'futu' && Number.isFinite(stock.price);
  const marketLabel = stock.market === 'us' ? '美国市场' : '香港市场';
  const change = Number(stock.change);
  const changeClass = Number.isFinite(change) ? (change >= 0 ? 'positive' : 'negative') : 'pending-price';
  document.querySelector('#stockDetailBadge').className = `stock-badge ${escapeHtml(stock.color || 'blue')}`;
  document.querySelector('#stockDetailBadge').textContent = stock.badge || stock.code.slice(0, 1);
  document.querySelector('#stockDetailMarket').textContent = `${marketLabel} · Futu OpenAPI`;
  document.querySelector('#stockDetailName').textContent = stock.name;
  document.querySelector('#stockDetailCode').textContent = `${displayStockCode(stock)} · ${stock.exchange} · ${futuCode(stock)}`;
  document.querySelector('#stockDetailPrice').textContent = live ? stockPrice(stock) : '--';
  const changeElement = document.querySelector('#stockDetailChange');
  changeElement.textContent = live ? stockChange(stock) : '等待富途报价';
  changeElement.className = changeClass;
  document.querySelector('#stockDetailStatus').textContent = live ? (stock.suspended ? '富途行情：停牌' : '富途市场快照') : '富途未提供该标的的行情权限';
  const quoteTime = live && (stock.dataDate || stock.dataTime) ? `${stock.dataDate || ''} ${stock.dataTime || ''}`.trim() : '';
  const queryTime = stock.quoteRetrievedAt ? new Date(stock.quoteRetrievedAt).toLocaleString('zh-CN', { hour12: false }) : '';
  document.querySelector('#stockDetailUpdated').textContent = quoteTime ? `报价时间 ${quoteTime}` : queryTime ? `查询时间 ${queryTime}` : '暂无更新时间';
  document.querySelector('#stockDetailMetrics').innerHTML = [
    detailMetric('今开', formatDetailNumber(stock.openPrice)),
    detailMetric('最高', formatDetailNumber(stock.highPrice), 'positive'),
    detailMetric('最低', formatDetailNumber(stock.lowPrice), 'negative'),
    detailMetric('昨收', formatDetailNumber(stock.previousClose)),
    detailMetric('成交量', formatDetailAmount(stock.volume)),
    detailMetric('成交额', formatDetailAmount(stock.turnover)),
    detailMetric('换手率', stock.turnoverRate !== null && stock.turnoverRate !== undefined && Number.isFinite(Number(stock.turnoverRate)) ? `${formatDetailNumber(stock.turnoverRate)}%` : '--'),
    detailMetric('振幅', stock.amplitude !== null && stock.amplitude !== undefined && Number.isFinite(Number(stock.amplitude)) ? `${formatDetailNumber(stock.amplitude)}%` : '--'),
  ].join('');
  renderDetailChart(bars, stock.market);
}

function mergeFutuQuote(stock, quote) {
  return {
    ...stock,
    futuCode: quote.code || futuCode(stock),
    quoteCode: quote.code,
    name: quote.name || stock.name,
    price: quote.lastPrice,
    change: quote.changeRate,
    previousClose: quote.previousClose,
    openPrice: quote.openPrice,
    highPrice: quote.highPrice,
    lowPrice: quote.lowPrice,
    volume: quote.volume,
    turnover: quote.turnover,
    turnoverRate: quote.turnoverRate,
    amplitude: quote.amplitude,
    dataDate: quote.dataDate,
    dataTime: quote.dataTime,
    quoteRetrievedAt: new Date().toISOString(),
    suspended: quote.suspended,
    quoteProvider: 'futu',
  };
}

async function loadStockDetail() {
  const original = watchlistData.find((stock) => stock.id === activeStockDetailId);
  if (!original) return;
  renderStockDetail(original);
  const code = futuCode(original);
  const [quoteResult, klineResult] = await Promise.allSettled([
    fetch(apiUrl(`/api/quotes/snapshot?codes=${encodeURIComponent(code)}`)).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || '报价服务不可用');
      return payload.snapshots?.[0] || null;
    }),
    fetch(apiUrl(`/api/kline?code=${encodeURIComponent(code)}&count=60`)).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || '分时服务不可用');
      return payload.bars || [];
    }),
  ]);
  if (!stockDetailModal.classList.contains('open') || activeStockDetailId !== original.id) return;
  let current = original;
  if (quoteResult.status === 'fulfilled' && quoteResult.value?.lastPrice !== null) {
    current = mergeFutuQuote(original, quoteResult.value);
    watchlistData = watchlistData.map((stock) => stock.id === current.id ? current : stock);
    saveWatchlist();
    renderWatchlist();
  }
  renderStockDetail(current, klineResult.status === 'fulfilled' ? klineResult.value : []);
}

function openStockDetail(id) {
  const stock = watchlistData.find((item) => item.id === id);
  if (!stock) return;
  activeStockDetailId = id;
  stockDetailModal.classList.add('open');
  stockDetailModal.setAttribute('aria-hidden', 'false');
  loadStockDetail();
}

function closeStockDetail() {
  stockDetailModal.classList.remove('open');
  stockDetailModal.setAttribute('aria-hidden', 'true');
  activeStockDetailId = '';
}

document.querySelector('#closeStockDetailModal').addEventListener('click', closeStockDetail);
stockDetailModal.addEventListener('click', (event) => { if (event.target === stockDetailModal) closeStockDetail(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && stockDetailModal.classList.contains('open')) closeStockDetail(); });

const loginModal = document.querySelector('#loginModal');
function openLogin() { loginModal.classList.add('open'); loginModal.setAttribute('aria-hidden', 'false'); }
function closeLogin() { loginModal.classList.remove('open'); loginModal.setAttribute('aria-hidden', 'true'); }
document.querySelector('#profileButton').addEventListener('click', openLogin);
document.querySelector('#topProfile').addEventListener('click', openLogin);
document.querySelector('#closeModal').addEventListener('click', closeLogin);
loginModal.addEventListener('click', (event) => { if (event.target === loginModal) closeLogin(); });
document.querySelector('#togglePassword').addEventListener('click', (event) => { const input = event.currentTarget.previousElementSibling; input.type = input.type === 'password' ? 'text' : 'password'; event.currentTarget.textContent = input.type === 'password' ? '显示' : '隐藏'; });
document.querySelector('#loginForm').addEventListener('submit', (event) => { event.preventDefault(); closeLogin(); showToast('登录成功，欢迎回来'); });
document.querySelector('#searchButton').addEventListener('click', () => { promptInput.focus(); showToast('已聚焦对话搜索'); });

document.querySelectorAll('.market-switch-button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.market-switch-button').forEach((item) => item.classList.toggle('active', item === button));
  const isUS = button.dataset.market === 'us';
  document.querySelector('#sessionLabel').textContent = isUS ? 'MONDAY, SEPTEMBER 13, 2026 · US MARKET OPEN' : 'MONDAY, SEPTEMBER 13, 2026 · HK MARKET OPEN';
  document.querySelector('.market-big span').textContent = isUS ? 'S&P 500' : '恒生指数';
  document.querySelector('.market-big strong').textContent = isUS ? '+0.64%' : '+0.42%';
  showToast(isUS ? '已切换至美股市场' : '已切换至港股市场');
}));

document.querySelectorAll('.watch-tab[data-region]').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.watch-tab[data-region]').forEach((item) => item.classList.toggle('active', item === tab));
  activeWatchRegion = tab.dataset.region;
  renderWatchlist();
}));

document.querySelectorAll('.news-filter').forEach((filter) => filter.addEventListener('click', () => {
  document.querySelectorAll('.news-filter').forEach((item) => item.classList.toggle('active', item === filter));
  const region = filter.dataset.newsRegion;
  document.querySelectorAll('.news-item').forEach((item) => item.classList.toggle('is-hidden', region !== 'all' && item.dataset.newsRegion !== region));
}));

const marketClock = document.querySelector('.market-time');
let clockSeconds = 9 * 3600 + 41 * 60 + 26;
setInterval(() => {
  clockSeconds = (clockSeconds + 1) % 86400;
  const hours = String(Math.floor(clockSeconds / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((clockSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(clockSeconds % 60).padStart(2, '0');
  marketClock.textContent = `${hours}:${minutes}:${seconds}`;
}, 1000);

renderWatchlist();
refreshWatchlistQuotes({ silent: true });
refreshNews();
setInterval(() => refreshWatchlistQuotes({ silent: true }), 60000);
