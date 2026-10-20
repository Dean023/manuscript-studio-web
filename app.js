'use strict';
const API_BASE = 'https://vpqzpfworkqudeefnnsg.supabase.co/functions/v1/manuscript-studio';
// Supabase's legacy anon JWT is intentionally public; private manuscript access is enforced by the team password.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwcXpwZndvcmtxdWRlZWZubnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzODEzOTgsImV4cCI6MjEwNzk1NzM5OH0.ilksU5QsK775a0lKqQV8_rFm2FBLfCTWuLxrS1iDfuY';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const language = code => code === 'zh' ? '中文' : '英文';
const providerUrls = {deepseek:'https://api.deepseek.com',openai:'https://api.openai.com/v1'};
const providerModels = {deepseek:['deepseek-v4-pro'],openai:['gpt-5.6-terra','gpt-5.6-luna']};
const providerKeyName = provider => `${provider}-api-key`;
const state = {books: [], book: null, tab: 'editor', page: 0, filter: 'all', search: '', dirty: new Map(), settings: {}, timer: null, busy: false};
const localAudio = new Map();
const browserVoices = {zh:['zf_001','zf_002','zm_009','zm_010'],en:['af_maple','af_sol','bf_vale']};
let browserTtsPromise;
async function browserTts(status) {
  if (!browserTtsPromise) browserTtsPromise = (async () => {
    status.textContent = '正在加载中英双语语音组件…';
    const {KokoroTTS} = await import('https://cdn.jsdelivr.net/npm/@uzen/kokoro-js@1.2.4/dist/kokoro.web.js');
    const model = 'onnx-community/Kokoro-82M-v1.1-zh-ONNX';
    const voicePath = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.1-zh-ONNX/resolve/main/voices';
    const load = (device,dtype) => KokoroTTS.from_pretrained(model,{device,dtype,voicePath,progress_callback:x=>{
      if(x.status === 'progress' && x.total) status.textContent = `正在下载语音模型 ${Math.round(x.loaded/x.total*100)}%`;
    }});
    if(navigator.gpu) {
      try { return await load('webgpu','fp32'); }
      catch { status.textContent = '正在切换兼容模式加载语音模型…'; }
    }
    return load('wasm','fp32');
  })().catch(error => { browserTtsPromise = null; throw error; });
  return browserTtsPromise;
}
let uploadedFile = null;
let toastTimer;

function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message;
  el.className = 'show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', error ? 7000 : 3500);
}

async function api(path, body) {
  const response = await apiFetch(path, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !$('#login-dialog').open) $('#login-dialog').showModal();
    throw new Error(result.error || '请求失败，请重试');
  }
  return result;
}

function apiFetch(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', 'Bearer ' + SUPABASE_ANON_KEY);
  headers.set('apikey', SUPABASE_ANON_KEY);
  const token = sessionStorage.getItem('book-session');
  if (token) headers.set('x-book-session', token);
  return fetch(API_BASE + path, {...options, headers});
}

async function perform(fn) {
  if (state.busy) return;
  state.busy = true;
  try { await fn(); } catch (error) { toast(error.message, true); }
  finally { state.busy = false; }
}

async function refreshShelf() {
  state.books = await api('/api/books');
  renderShelf();
}

function renderShelf() {
  $('#book-count').textContent = state.books.length;
  $('#shelf').innerHTML = state.books.length ? state.books.map(book => `<button class="book-link ${state.book?.id === book.id ? 'active' : ''}" data-book="${book.id}" title="${esc(book.title)}"><span class="book-icon">▤</span><span class="book-label"><strong>${esc(book.title)}</strong><small>${language(book.source_lang)} → ${language(book.target_lang)} · ${book.approved}/${book.count} 已确认</small></span></button>`).join('') : '<p class="sidebar-empty">还没有书稿。<br>导入文件，或体验内置示例。</p>';
  $$('[data-book]').forEach(button => button.onclick = () => perform(async () => {
    if (!await saveDraft()) return;
    await openBook(button.dataset.book);
  }));
}

async function openBook(id) {
  clearTimeout(state.timer);
  state.book = await api('/api/books/' + id);
  state.dirty.clear(); state.page = 0; state.search = ''; state.filter = 'all';
  localStorage.setItem('last-book', id);
  renderShelf(); render(); schedulePoll();
}

function welcome() {
  $('#breadcrumb').textContent = '开始一本新书';
  $('#content').innerHTML = `<section class="welcome"><div class="welcome-grid"><div><span class="eyebrow">WORDS, ACROSS LANGUAGES</span><h1>让一本书，<br>拥有两种语言。</h1><p class="intro">从一份书稿，到一份准确的译文，<br>再到可以随时聆听的声音。<br>在这里，完成你的中英双语阅读作品。</p><div class="actions"><button class="primary" id="welcome-import">导入第一份书稿 <span>→</span></button><button class="quiet" id="welcome-demo">体验示例</button></div></div><div class="manuscript-preview" aria-label="中英对照书稿预览"><div class="preview-top"><span>THE READING LIFE</span><span>01 / 07</span></div><p class="preview-source">认真倾听，往往比<br>急于回答更重要。</p><p class="preview-target">Listening carefully is often more important than rushing to answer.</p><div class="preview-bottom"><span class="wave" aria-hidden="true">${'<i></i>'.repeat(19)}</span><span>中文原声 · English audio</span></div></div></div><div class="workflow"><div><span class="step-number">01</span><section><h3>导入与翻译</h3><p>上传 Word、TXT 或粘贴文字。<br>中文与英文，双向转换。</p></section></div><div><span class="step-number">02</span><section><h3>逐段对照校对</h3><p>统一术语，核对细节。<br>每一处修改都由你掌握。</p></section></div><div><span class="step-number">03</span><section><h3>把文字变成声音</h3><p>分别生成原文与译文音频，<br>带走文字稿和音频文件。</p></section></div></div><p class="welcome-note">书稿保存在团队云端。翻译需自备 DeepSeek 或 OpenAI API Key；示例译文已预先编写，音频生成首次需下载语音模型。</p></section>`;
  $('#welcome-import').onclick = () => $('#import-dialog').showModal();
  $('#welcome-demo').onclick = () => perform(async () => {
    const book = await api('/api/demo', {source_lang: 'zh'});
    await refreshShelf(); await openBook(book.id);
    toast('这是预先编写的示例译文，可以直接编辑和试听');
  });
}

function stats() {
  const segments = state.book.segments;
  return {total: segments.length, translated: segments.filter(s => s.target).length, approved: segments.filter(s => s.approved).length, chars: segments.reduce((n, s) => n + s.source.length, 0)};
}
function running() { return state.book?.job?.state === 'running'; }

function jobMarkup() {
  const job = state.book.job;
  if (!job?.state) return '';
  if (job.kind === 'audio' && job.state === 'error') return '<div class="notice" role="status">云端语音接口暂不可用；请在「双语音频」中生成并下载浏览器 MP3。</div>';
  return `<div class="job-panel ${job.state === 'error' ? 'error' : ''}" role="status"><div><div class="job-label">${esc(job.message)}</div><div class="job-detail">${({translate:'全文翻译',review:'AI 辅助复核',audio:'音频生成'})[job.kind] || '任务'}${job.total ? ` · ${job.done} / ${job.total}` : ''}</div>${job.state === 'running' ? `<progress aria-label="任务进度" max="${job.total || 1}" value="${job.done || 0}"></progress>` : ''}</div>${job.state === 'running' ? `<button class="secondary" id="cancel-job" ${job.cancel ? 'disabled' : ''}>${job.cancel ? '停止中…' : '停止任务'}</button>` : ''}</div>`;
}

function render() {
  if (!state.book) return welcome();
  const b = state.book, s = stats();
  $('#breadcrumb').textContent = b.title;
  $('#content').innerHTML = `<div class="book-heading"><div><span class="eyebrow">MANUSCRIPT / ${b.source_lang.toUpperCase()} → ${b.target_lang.toUpperCase()}</span><h1>${esc(b.title)}</h1><div class="book-meta"><span>${s.chars.toLocaleString()} 字符</span><span>${s.total} 段</span><span>${s.translated}/${s.total} 已翻译</span><span class="pill ${s.approved === s.total ? '' : 'amber'}">${s.approved}/${s.total} 已确认</span>${b.demo ? '<span class="pill">内置示例</span>' : ''}</div></div><button class="secondary" id="glossary-button" ${running() ? 'disabled' : ''}>术语与风格</button></div><div class="tabs" role="tablist">${[['editor','01','对照校对'],['audio','02','双语音频'],['export','03','导出文件']].map(([key,no,name]) => `<button class="tab ${state.tab === key ? 'active' : ''}" role="tab" aria-selected="${state.tab === key}" data-tab="${key}"><span class="tab-number">${no}</span>${name}</button>`).join('')}</div>${jobMarkup()}<div id="tab-content"></div>`;
  $('[data-tab="' + state.tab + '"]').tabIndex = 0;
  $$('[data-tab]').forEach(button => button.onclick = () => perform(async () => {
    if (!await saveDraft()) return;
    state.tab = button.dataset.tab; render();
  }));
  $('#glossary-button').onclick = () => perform(async () => {
    if (!await saveDraft()) return;
    const form = $('#glossary-form');
    form.elements.glossary.value = state.book.glossary;
    form.elements.style.value = state.book.style;
    $('#glossary-dialog').showModal();
  });
  if ($('#cancel-job')) $('#cancel-job').onclick = () => perform(async () => {
    state.book = await api(`/api/books/${b.id}/cancel`, {}); render();
  });
  if (state.tab === 'editor') renderEditor();
  else if (state.tab === 'audio') renderAudio();
  else renderExport();
}

function renderEditor() {
  const b = state.book, s = stats();
  $('#tab-content').innerHTML = `${b.notices.length ? `<div class="notice"><details ${b.demo ? 'open' : ''}><summary>${b.demo ? '示例说明' : '导入说明 · 请先核对原文'}</summary>${b.notices.map(n => `<p>${esc(n)}</p>`).join('')}</details></div>` : ''}<div class="toolbar"><div class="actions"><button id="translate-button" class="primary" ${running() || s.translated === s.total ? 'disabled' : ''}>${s.translated ? '继续翻译' : '开始翻译'} →</button><button id="review-button" class="secondary" ${running() || !b.segments.some(x => x.target && !x.approved && !x.reviewed) ? 'disabled' : ''}>AI 复核未确认段落</button><button id="approve-all" class="quiet" ${running() || s.translated !== s.total || s.approved === s.total ? 'disabled' : ''}>确认全稿</button></div><div class="actions"><span id="save-status" class="save-status">已保存到团队云端</span><button id="save-button" class="secondary" ${running() ? 'disabled' : ''}>保存修改</button></div></div><div class="filterbar"><input id="search-input" aria-label="搜索原文或译文" placeholder="搜索原文或译文…" value="${esc(state.search)}"><select id="filter-select" aria-label="筛选段落"><option value="all">全部段落</option><option value="pending">待确认</option><option value="warnings">有检查提示</option><option value="empty">未翻译</option></select><span class="count" id="filtered-count"></span></div><div id="editor-rows"></div><p class="footnote">提示仅检查数字与语言残留，不代表语义准确性。AI 复核不会自动确认译文；修改后请重新核对。</p>`;
  $('#filter-select').value = state.filter;
  $('#search-input').oninput = e => { state.search = e.target.value; state.page = 0; renderRows(); };
  $('#filter-select').onchange = e => { state.filter = e.target.value; state.page = 0; renderRows(); };
  $('#save-button').onclick = () => perform(async () => { if (await saveDraft()) { render(); toast('修改已保存'); } });
  $('#translate-button').onclick = () => launchJob('translate');
  $('#review-button').onclick = () => launchJob('review');
  $('#approve-all').onclick = () => $('#confirm-dialog').showModal();
  renderRows();
}

function mergedSegment(s) { return {...s, ...(state.dirty.get(s.id) || {})}; }
function setDirty(id, values) {
  const seg = mergedSegment(state.book.segments[id]);
  state.dirty.set(id, {id, target: seg.target, approved: seg.approved, ...values});
  if ($('#save-status')) $('#save-status').textContent = `${state.dirty.size} 段待保存`;
}

function renderRows() {
  const b = state.book;
  let rows = b.segments.map(mergedSegment).filter(s => !state.search || s.source.toLowerCase().includes(state.search.toLowerCase()) || s.target.toLowerCase().includes(state.search.toLowerCase()));
  rows = rows.filter(s => state.filter === 'all' || state.filter === 'pending' && !s.approved || state.filter === 'warnings' && s.warnings.length || state.filter === 'empty' && !s.target);
  const pages = Math.max(1, Math.ceil(rows.length / 16));
  state.page = Math.min(state.page, pages - 1);
  $('#filtered-count').textContent = `${rows.length} 段 · 每页 16 段`;
  $('#editor-rows').innerHTML = `<div class="editor"><div class="column-headings"><div>原文 · ${language(b.source_lang)}</div><div>译文 · ${language(b.target_lang)} <span> / 可直接编辑</span></div></div>${rows.length ? rows.slice(state.page * 16, state.page * 16 + 16).map(s => `<article class="segment-row"><div class="source-cell"><div class="segment-head"><span>${String(s.id + 1).padStart(3,'0')} / ${language(b.source_lang)}</span><span>${s.source.length} 字符</span></div><p class="source-text" lang="${b.source_lang}">${esc(s.source)}</p></div><div class="target-cell"><div class="segment-head"><span class="${s.reviewed ? 'reviewed' : ''}">${s.reviewed ? 'AI 已复核 · 待人工确认' : language(b.target_lang)}</span><label><input type="checkbox" data-approve="${s.id}" ${s.approved ? 'checked' : ''} ${running() || !s.target ? 'disabled' : ''}>已确认</label></div><textarea class="target-text" lang="${b.target_lang}" aria-label="第 ${s.id + 1} 段译文" data-edit="${s.id}" ${running() ? 'disabled' : ''} placeholder="译文将在这里出现，也可以手动填写…">${esc(s.target)}</textarea>${s.target && s.warnings.length ? `<p class="segment-warning">${s.warnings.map(esc).join(' · ')}</p>` : ''}</div></article>`).join('') : '<p class="empty-results">没有符合条件的段落</p>'}</div><div class="pagination"><span>第 ${state.page + 1} / ${pages} 页</span><div class="actions"><button class="secondary" id="prev-page" ${state.page === 0 ? 'disabled' : ''}>← 上一页</button><button class="secondary" id="next-page" ${state.page === pages - 1 ? 'disabled' : ''}>下一页 →</button></div></div>`;
  $$('[data-edit]').forEach(input => {
    input.style.height = Math.max(90, input.scrollHeight + 3) + 'px';
    input.oninput = () => {
      const id = Number(input.dataset.edit);
      setDirty(id, {target: input.value, approved: false});
      const approve = $('[data-approve="' + id + '"]');
      approve.checked = false; approve.disabled = !input.value.trim();
      input.style.height = 'auto'; input.style.height = Math.max(90, input.scrollHeight + 3) + 'px';
    };
  });
  $$('[data-approve]').forEach(input => input.onchange = () => setDirty(Number(input.dataset.approve), {approved: input.checked}));
  $('#prev-page').onclick = () => { state.page--; renderRows(); };
  $('#next-page').onclick = () => { state.page++; renderRows(); };
}

async function saveDraft() {
  if (!state.dirty.size || !state.book) return true;
  const result = await api(`/api/books/${state.book.id}/save`, {revision: state.book.revision, segments: [...state.dirty.values()]});
  state.book = result; state.dirty.clear(); await refreshShelf();
  return true;
}

function launchJob(kind, options = {}) {
  perform(async () => {
    if (!await saveDraft()) return;
    if ((kind === 'translate' || kind === 'review') && !state.settings.has_key) { toast('请先在「服务设置」填写所选服务的 API Key', true); return; }
    state.book = await api(`/api/books/${state.book.id}/job`, {kind, revision: state.book.revision, ...(kind === 'translate' || kind === 'review' ? {provider:state.settings.provider,model:state.settings.model} : {}), ...options});
    render(); schedulePoll();
  });
}

function schedulePoll() {
  clearTimeout(state.timer);
  if (!running()) return;
  const id = state.book.id;
  state.timer = setTimeout(async () => {
    try {
      const provider = state.book.job.provider || 'deepseek';
      const book = await api('/api/books/' + id + '/step', {api_key: sessionStorage.getItem(providerKeyName(provider)) || ''});
      if (state.book?.id !== id) return;
      state.book = book;
      // Keep the active page and filter; editing is locked during a background task.
      render();
      if (!running()) { await refreshShelf(); toast(book.job.message, book.job.state === 'error'); }
      schedulePoll();
    } catch (error) { toast(error.message, true); state.timer = setTimeout(schedulePoll, 4000); }
  }, 1800);
}

const voiceNames = {'zf_001':'普通话女声 1','zf_002':'普通话女声 2','zm_009':'普通话男声 1','zm_010':'普通话男声 2','af_maple':'美式英语 · Maple','af_sol':'美式英语 · Sol','bf_vale':'英式英语 · Vale','zh-CN-XiaoxiaoNeural':'晓晓 · 普通话女声','zh-CN-YunxiNeural':'云希 · 普通话男声','en-US-JennyNeural':'Jenny · 美式女声','en-US-GuyNeural':'Guy · 美式男声','en-GB-SoniaNeural':'Sonia · 英式女声','en-GB-RyanNeural':'Ryan · 英式男声'};

function renderAudio() {
  const b = state.book, s = stats();
  $('#tab-content').innerHTML = `<div class="section-intro"><h2>让文字，读给你听。</h2><p>原文与译文分别生成，分别保存。原文可以直接生成；译文需要全稿确认后生成。</p></div><div class="audio-grid">${['source','target'].map(side => {
    const lang = side === 'source' ? b.source_lang : b.target_lang;
    const ready = side === 'source' || s.approved === s.total;
    const audio = b.audio[side];
    return `<section class="audio-card"><div class="audio-title"><div><h3>${language(lang)}${side === 'source' ? '原文' : '译文'}</h3><small>${side === 'source' ? '直接从原始书稿生成' : `${s.approved} / ${s.total} 段译文已确认`}</small></div><span class="language">${lang === 'zh' ? '中' : 'En'}</span></div><label for="voice-${side}">朗读音色<select id="voice-${side}">${browserVoices[lang].map(v => `<option value="${v}">${voiceNames[v]}</option>`).join('')}</select></label><label for="rate-${side}">朗读速度<select id="rate-${side}"><option value="-20%">0.8 倍 · 舒缓</option><option value="-10%">0.9 倍 · 稍慢</option><option value="+0%" selected>1.0 倍 · 标准</option><option value="+10%">1.1 倍 · 稍快</option><option value="+20%">1.2 倍 · 较快</option></select></label><p class="field-note">${ready ? '生成需要联网。长书稿会分段处理。' : '请先到「对照校对」完成翻译并确认全稿，确保音频采用正确的定稿。'}</p><button class="primary" data-audio="${side}" ${running() || !ready ? 'disabled' : ''}>${audio ? '重新生成' : '生成'}${language(lang)}音频</button>${audio ? `<div class="player"><button class="secondary" data-load-audio="${side}">加载试听与下载</button><div class="audio-loaded"></div><small>${esc(voiceNames[audio.voice] || audio.voice)} · ${esc(audio.rate)}</small></div>` : '<div class="player-empty">音频生成后，可以在这里<br>试听与下载。</div>'}</section>`;
  }).join('')}</div><p class="footnote">音频由 AI 合成。请抽听专有名词、数字和段落衔接。Edge 语音服务需要网络可用，暂不支持离线生成。</p>`;
  $$('[data-audio]').forEach(button => button.onclick = () => {
    const side = button.dataset.audio;
    launchJob('audio', {side, voice: $('#voice-' + side).value, rate: $('#rate-' + side).value});
  });
  $$('[data-load-audio]').forEach(button => button.onclick = () => perform(async () => {
    const side = button.dataset.loadAudio, lang = side === 'source' ? b.source_lang : b.target_lang;
    button.disabled = true; button.textContent = '正在加载音频…';
    try {
      const response = await apiFetch(`/api/books/${b.id}/audio?side=${side}`);
      if (!response.ok) throw new Error((await response.json()).error || '音频加载失败');
      const url = URL.createObjectURL(await response.blob());
      const area = button.parentElement.querySelector('.audio-loaded');
      area.innerHTML = `<audio controls preload="metadata" src="${url}"></audio><br><a class="download-link" href="${url}" download="${esc(b.title)}-${lang}.mp3">↓ 下载 ${language(lang)} MP3</a>`;
      button.remove();
    } catch (error) { button.disabled = false; button.textContent = '重试加载音频'; throw error; }
  }));
  attachLocalAudio();
}

function speechPieces(text) {
  const pieces = [];
  for (const line of text.split(/\r?\n/)) {
    let rest = line.trim();
    while (rest) {
      let end = Math.min(rest.length, 150);
      if (end < rest.length) {
        const marks = [...rest.slice(0, end).matchAll(/[。！？.!?；;，,]\s*/g)];
        const last = marks.at(-1);
        if (last && last.index > 65) end = last.index + last[0].length;
      }
      const piece = rest.slice(0, end).trim();
      if (piece) pieces.push(piece);
      rest = rest.slice(end).trim();
    }
  }
  return pieces;
}

function wavBlob(chunks, sampleRate) {
  const count = chunks.reduce((sum, part) => sum + part.length, 0);
  const bytes = new ArrayBuffer(44 + count * 2), view = new DataView(bytes);
  const tag = (position, value) => { for (let i = 0; i < value.length; i++) view.setUint8(position + i, value.charCodeAt(i)); };
  tag(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, count * 2, true);
  let offset = 44;
  for (const part of chunks) for (const sample of part) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 32768 : value * 32767, true); offset += 2;
  }
  return new Blob([bytes], {type: 'audio/wav'});
}

function validateSpeechAudio(audio) {
  if (!audio?.data?.length || !Number.isFinite(audio.sampling_rate) || audio.sampling_rate <= 0) {
    throw new Error('语音模型没有返回有效音频，请重试。');
  }
  let peak = 0, energy = 0;
  for (const sample of audio.data) {
    if (!Number.isFinite(sample)) throw new Error('语音模型输出异常，已停止生成以免下载静音文件。');
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  if (peak < 0.001 || Math.sqrt(energy / audio.data.length) < 0.0001) {
    throw new Error('语音模型生成了静音，已停止生成。请改用本地版 MP3 或更换浏览器重试。');
  }
}

async function mp3Blob(chunks, sampleRate) {
  if (!window.lamejs?.Mp3Encoder) throw new Error('MP3 编码器未加载');
  const encoder = new window.lamejs.Mp3Encoder(1, sampleRate, 64);
  const frames = [];
  let count = 0;
  for (const chunk of chunks) {
    const pcm = new Int16Array(chunk.length);
    for (let i = 0; i < chunk.length; i++) {
      const value = Math.max(-1, Math.min(1, chunk[i]));
      pcm[i] = value < 0 ? value * 32768 : value * 32767;
    }
    for (let i = 0; i < pcm.length; i += 1152) {
      const encoded = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
      if (encoded.length) frames.push(new Uint8Array(encoded));
      if (++count % 64 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  const last = encoder.flush();
  if (last.length) frames.push(new Uint8Array(last));
  return new Blob(frames, {type: 'audio/mpeg'});
}

function localAudioMarkup(entry) {
  return entry.parts.map((part, i) => `<div class="player"><audio controls preload="metadata" src="${part.mp3Url || part.wavUrl}"></audio><br>${part.mp3Url ? `<a class="download-link" href="${part.mp3Url}" download="${esc(part.name)}.mp3">↓ 下载第 ${i + 1} 部分 MP3</a> · ` : ''}<a class="download-link" href="${part.wavUrl}" download="${esc(part.name)}.wav">下载 WAV</a></div>`).join('');
}

function attachLocalAudio() {
  const b = state.book, summary = stats();
  $$('.audio-card').forEach((card, index) => {
    const side = index === 0 ? 'source' : 'target', lang = side === 'source' ? b.source_lang : b.target_lang;
    const ready = side === 'source' || summary.approved === summary.total;
    const online = card.querySelector('[data-audio]');
    online.disabled = true; online.style.display = 'none';
    card.querySelector('p.field-note').textContent = ready ? '首次使用需下载约 340 MB 中英双语模型；文字在当前浏览器合成。长书稿会分成多个 MP3 文件。' : '译文音频需先确认全稿。';
    const button = document.createElement('button');
    button.className = 'primary'; button.textContent = `在本机生成${language(lang)} MP3`; button.disabled = !ready;
    online.before(button);
    const status = document.createElement('p'); status.className = 'field-note'; status.setAttribute('role', 'status');
    online.after(status);
    const area = document.createElement('div'); card.append(area);
    const text = b.segments.map(segment => segment[side]).join('\n');
    const voiceSelect = $('#voice-' + side), rateSelect = $('#rate-' + side);
    const showCached = () => {
      const cached = localAudio.get(b.id + ':' + side);
      if (cached?.text === text && cached.voice === voiceSelect.value && cached.rate === rateSelect.value) {
        area.innerHTML = `<p class="field-note">已生成：${esc(voiceNames[cached.voice])} · ${esc(cached.rate)}</p>` + localAudioMarkup(cached);
        card.querySelector('.player-empty')?.remove();
      } else area.innerHTML = '';
    };
    voiceSelect.onchange = showCached; rateSelect.onchange = showCached; showCached();
    button.onclick = () => perform(async () => {
      if (!await saveDraft()) return;
      button.disabled = true;
      try {
        const engine = await browserTts(status);
        const voice = voiceSelect.value, rateValue = rateSelect.value;
        if (!browserVoices[lang].includes(voice)) throw new Error('音色与语言不匹配');
        const pieces = speechPieces(text), parts = [], safeTitle = b.title.replace(/[\\/:*?"<>|]/g, '_');
        if (!pieces.length) throw new Error('没有可朗读的文字');
        const rate = Number(rateValue.replace('%', '')) || 0;
        let chunks = [], chars = 0, sampleRate = 0, mp3Error = '';
        const flush = async () => {
          if (!chunks.length) return;
          status.textContent = `正在压缩第 ${parts.length + 1} 部分 MP3…`;
          const wavUrl = URL.createObjectURL(wavBlob(chunks, sampleRate));
          let mp3Url = null;
          try { mp3Url = URL.createObjectURL(await mp3Blob(chunks, sampleRate)); }
          catch (error) { mp3Error = error.message; }
          parts.push({wavUrl, mp3Url, name: `${safeTitle}-${lang}-${String(parts.length + 1).padStart(2, '0')}`});
          chunks = []; chars = 0;
        };
        for (let i = 0; i < pieces.length; i++) {
          status.textContent = `正在合成 ${i + 1} / ${pieces.length} 段；已准备 ${parts.length} 个文件`;
          const audio = await engine.generate(pieces[i], {voice, speed: 1 + rate / 100});
          validateSpeechAudio(audio);
          if (sampleRate && sampleRate !== audio.sampling_rate) throw new Error('语音采样率发生变化，请重试');
          sampleRate = audio.sampling_rate; chunks.push(audio.data); chars += pieces[i].length;
          if (chars >= 1200) await flush();
        }
        await flush();
        const key = b.id + ':' + side, previous = localAudio.get(key);
        previous?.parts.forEach(part => { URL.revokeObjectURL(part.wavUrl); if (part.mp3Url) URL.revokeObjectURL(part.mp3Url); });
        localAudio.set(key, {text, voice, rate:rateValue, parts});
        area.innerHTML = `<p class="field-note">已生成：${esc(voiceNames[voice])} · ${esc(rateValue)}</p>` + localAudioMarkup({parts});
        card.querySelector('.player-empty')?.remove();
        status.textContent = mp3Error ? `MP3 压缩失败（${mp3Error}），已保留 WAV 下载。` : `已完成 ${parts.length} 个 MP3 文件。请逐个下载；刷新页面后需重新生成。`;
      } catch (error) {
        status.textContent = `生成失败：${error.message}`;
        throw error;
      } finally { button.disabled = false; }
    });
  });
  const footnote = $('#tab-content > .footnote');
  if (footnote) footnote.innerHTML = '浏览器语音模型和 MP3 压缩都在当前设备运行；请抽听中文、英文的专有名词与数字。语音引擎：<a href="https://github.com/uzen-zone/kokoro-js" target="_blank" rel="noopener noreferrer">Kokoro JS</a>；MP3 编码：<a href="https://github.com/zhuker/lamejs" target="_blank" rel="noopener noreferrer">lamejs</a>。';
}

function renderExport() {
  const b = state.book, s = stats();
  $('#tab-content').innerHTML = `<div class="section-intro"><h2>把成果带走。</h2><p>下载可继续编辑的文字稿，或保留中英对照版供团队审阅。</p></div>${s.approved !== s.total ? '<div class="notice warning">当前还有未确认的段落。完整译文可作为校对草稿导出；未翻译完整时只允许导出原文。</div>' : '<div class="notice">全部段落已确认。你可以导出定稿，并在「双语音频」生成朗读版本。</div>'}<div class="export-list">${[['target',`${language(b.target_lang)}文字稿`,'只包含译文，适合交付与继续编辑'],['bilingual','中英对照稿','原文与译文逐段排列，方便核对'],['source',`${language(b.source_lang)}原文稿`,'导出已提取的原文，检查导入内容']].map(([mode,title,desc]) => `<section class="export-row"><div class="file-symbol">DOC</div><div class="export-copy"><h3>${title}</h3><p>${desc}</p></div><div class="actions"><button class="secondary" data-export="${mode}" data-format="docx" ${mode !== 'source' && s.translated !== s.total ? 'disabled' : ''}>Word ↓</button><button class="secondary" data-export="${mode}" data-format="txt" ${mode !== 'source' && s.translated !== s.total ? 'disabled' : ''}>TXT ↓</button></div></section>`).join('')}</div><p class="footnote">Word 导出采用简洁的段落排版，不复刻原文件的图片和复杂版式。译文音频会始终对应你已确认的最新译文。</p>`;
  $$('[data-export]').forEach(button => button.onclick = () => perform(async () => {
    const response = await apiFetch(`/api/books/${b.id}/export?format=${button.dataset.format}&mode=${button.dataset.export}`);
    if (!response.ok) throw new Error((await response.json()).error);
    const blob = await response.blob(), url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${b.title}-${button.dataset.export}.${button.dataset.format}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
}

$('#new-book').onclick = () => $('#import-dialog').showModal();
$$('.close-dialog').forEach(button => button.onclick = () => button.closest('dialog').close());
function refreshProviderForm() {
  const f = $('#settings-form'), provider = f.elements.provider.value;
  const models = providerModels[provider];
  f.elements.base_url.value = providerUrls[provider];
  f.elements.model.innerHTML = models.map(model => `<option value="${model}">${model}${model === 'gpt-5.6-luna' ? ' · 低成本' : ''}</option>`).join('');
  f.elements.model.value = provider === state.settings.provider && models.includes(state.settings.model) ? state.settings.model : models[0];
  const hasKey = Boolean(sessionStorage.getItem(providerKeyName(provider))) || (provider === 'deepseek' && state.settings.server_has_key);
  f.elements.api_key.value = '';
  f.elements.api_key.placeholder = hasKey ? '已设置；留空则保留现有 Key' : '只保存在当前浏览器会话中';
  f.elements.clear_key.checked = false;
}
$('#settings-form').elements.provider.onchange = refreshProviderForm;
$('#settings-button').onclick = () => {
  const f = $('#settings-form');
  f.elements.provider.value = state.settings.provider || 'deepseek';
  refreshProviderForm();
  $('#settings-dialog').showModal();
};
$('#settings-form').onsubmit = e => {
  e.preventDefault(); perform(async () => {
    const f = e.target;
    const provider = f.elements.provider.value, model = f.elements.model.value;
    if (!providerModels[provider]?.includes(model)) throw new Error('请选择受支持的翻译服务与模型');
    if (f.elements.clear_key.checked) sessionStorage.removeItem(providerKeyName(provider));
    if (f.elements.api_key.value.trim()) sessionStorage.setItem(providerKeyName(provider), f.elements.api_key.value.trim());
    state.settings.provider = provider;
    state.settings.model = model;
    state.settings.base_url = providerUrls[provider];
    state.settings.has_key = Boolean(sessionStorage.getItem(providerKeyName(provider))) || (provider === 'deepseek' && state.settings.server_has_key);
    sessionStorage.setItem('translation-provider', provider);
    sessionStorage.setItem('translation-model', model);
    f.elements.api_key.value = '';
    $('#settings-dialog').close(); updateConnection(); toast('设置已保存；首次翻译时会验证连接');
  });
};
function updateConnection() { $('#connection-dot').classList.toggle('connected', Boolean(state.settings.model && state.settings.has_key)); }

$('#glossary-form').onsubmit = e => {
  e.preventDefault(); perform(async () => {
    state.book = await api(`/api/books/${state.book.id}/save`, {revision:state.book.revision,glossary:e.target.elements.glossary.value,style:e.target.elements.style.value});
    $('#glossary-dialog').close(); render(); toast('术语与风格已保存');
  });
};
$('#confirm-form').onsubmit = e => {
  e.preventDefault(); perform(async () => {
    if (!await saveDraft()) return;
    state.book = await api(`/api/books/${state.book.id}/save`, {revision:state.book.revision,approve_all:true});
    $('#confirm-dialog').close(); await refreshShelf(); render(); toast('全稿已确认，可以生成译文音频');
  });
};

async function readZipEntry(buffer, wanted) {
  const data = new Uint8Array(buffer), view = new DataView(buffer);
  let end = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('Word 文件结构不完整');
  let at = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('Word 文件目录损坏');
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true), expanded = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    const name = new TextDecoder().decode(data.slice(at + 46, at + 46 + nameLength));
    const local = view.getUint32(at + 42, true);
    if (name === wanted) {
      if (expanded > 8_000_000) throw new Error('Word 正文过大，请分章导入');
      if (view.getUint32(local, true) !== 0x04034b50) throw new Error('Word 文件内容损坏');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = data.slice(start, start + compressed);
      if (method === 0) return new TextDecoder().decode(raw);
      if (method !== 8) throw new Error('Word 文件使用了不支持的压缩方式');
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const content = await new Response(stream).arrayBuffer();
      if (content.byteLength !== expanded) throw new Error('Word 正文解压不完整');
      return new TextDecoder().decode(content);
    }
    at += 46 + nameLength + extra + comment;
  }
  return null;
}
function wordText(node) {
  let result = '';
  for (const child of node.childNodes) {
    const type = child.localName;
    if (type === 't') result += child.textContent;
    else if (type === 'tab') result += '\t';
    else if (type === 'br') result += '\n';
    else result += wordText(child);
  }
  return result;
}
async function extractFile(file) {
  const raw = await file.arrayBuffer(), ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'txt' || ext === 'md') {
    const bytes = new Uint8Array(raw);
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
    let text;
    try { text = new TextDecoder(encoding, {fatal: true}).decode(raw); }
    catch { text = new TextDecoder('gb18030', {fatal: true}).decode(raw); }
    return {text, notices:[]};
  }
  if (ext !== 'docx') throw new Error('请使用 .docx、.txt 或 .md 文件');
  const documentXml = await readZipEntry(raw, 'word/document.xml');
  if (!documentXml) throw new Error('Word 文件没有可读取的正文');
  const doc = new DOMParser().parseFromString(documentXml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Word 正文 XML 无法解析');
  const body = [...doc.documentElement.childNodes].find(x => x.localName === 'body');
  const parts = [];
  for (const block of body?.childNodes || []) {
    if (block.localName === 'p') parts.push(wordText(block));
    else if (block.localName === 'tbl') for (const row of block.childNodes) if (row.localName === 'tr') {
      const cells = [...row.childNodes].filter(x => x.localName === 'tc').map(x => [...x.childNodes].filter(y => y.localName === 'p').map(wordText).join(' '));
      parts.push(cells.join(' | '));
    }
  }
  const notes = ['已提取正文和表格文字；图片、文本框、页眉页脚及原有排版不保留。请先核对原文。'];
  if (await readZipEntry(raw, 'word/footnotes.xml') || await readZipEntry(raw, 'word/endnotes.xml')) notes.push('检测到脚注或尾注；请将需要翻译的注释移入正文后重新导入。');
  return {text:parts.join('\n'), notices:notes};
}

function selectFile(file) {
  if (!file) return;
  if (file.size > 15000000) return toast('文件不能超过 15 MB', true);
  if (!/\.(docx|txt|md)$/i.test(file.name)) return toast('请使用 .docx、.txt 或 .md 文件', true);
  uploadedFile = file;
  $('#file-label').textContent = file.name;
  $('#paste-text').value = ''; $('#paste-text').disabled = true;
  if (!$('#import-form').elements.title.value) $('#import-form').elements.title.value = file.name.replace(/\.[^.]+$/, '');
}
$('#file-input').onchange = e => selectFile(e.target.files[0]);
$('#upload-zone').ondragover = e => { e.preventDefault(); $('#upload-zone').classList.add('dragging'); };
$('#upload-zone').ondragleave = () => $('#upload-zone').classList.remove('dragging');
$('#upload-zone').ondrop = e => { e.preventDefault(); $('#upload-zone').classList.remove('dragging'); selectFile(e.dataTransfer.files[0]); };
$('#import-dialog').addEventListener('close', () => { uploadedFile = null; $('#import-form').reset(); $('#paste-text').disabled = false; $('#file-label').textContent = '选择或拖入书稿'; });
$('#import-form').onsubmit = e => {
  e.preventDefault(); perform(async () => {
    if (!await saveDraft()) return;
    const f = e.target;
    const payload = {title:f.elements.title.value,source_lang:f.elements.source_lang.value,text:f.elements.text.value};
    if (uploadedFile) { payload.filename = uploadedFile.name; Object.assign(payload, await extractFile(uploadedFile)); }
    $('#import-submit').disabled = true;
    try {
      const book = await api('/api/books',payload);
      $('#import-dialog').close(); state.tab = 'editor'; await refreshShelf(); await openBook(book.id); toast('书稿已导入，请先核对原文');
    } finally { $('#import-submit').disabled = false; }
  });
};
$('#login-dialog').addEventListener('cancel', e => e.preventDefault());
$('#login-form').onsubmit = e => {
  e.preventDefault(); perform(async () => { const result = await api('/api/login',{password:e.target.elements.password.value}); sessionStorage.setItem('book-session', result.token); e.target.reset(); $('#login-dialog').close(); await boot(); });
};
window.addEventListener('beforeunload', e => { if (state.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); perform(async () => { if (await saveDraft()) { render(); toast('修改已保存'); } }); } });

async function boot() {
  const session = await api('/api/session');
  if (!session.authenticated) { welcome(); if (!$('#login-dialog').open) $('#login-dialog').showModal(); return; }
  state.settings = await api('/api/settings');
  state.settings.server_has_key = Boolean(state.settings.has_key);
  const savedProvider = sessionStorage.getItem('translation-provider');
  state.settings.provider = providerModels[savedProvider] ? savedProvider : 'deepseek';
  const savedModel = sessionStorage.getItem('translation-model');
  state.settings.model = providerModels[state.settings.provider].includes(savedModel) ? savedModel : providerModels[state.settings.provider][0];
  state.settings.base_url = providerUrls[state.settings.provider];
  state.settings.has_key = Boolean(sessionStorage.getItem(providerKeyName(state.settings.provider))) || (state.settings.provider === 'deepseek' && state.settings.server_has_key);
  updateConnection();
  await refreshShelf();
  const last = localStorage.getItem('last-book');
  if (state.books.some(b => b.id === last)) await openBook(last);
  else if (state.books.length) await openBook(state.books[0].id);
  else welcome();
}
boot().catch(error => { toast(error.message, true); $('#content').innerHTML = '<div class="loading">无法连接团队云端服务。请检查网络，稍后刷新页面。</div>'; });
