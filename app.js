'use strict';

const screen = document.querySelector('#screen');
const message = document.querySelector('#message');
const mode = document.querySelector('#mode');
const full = document.querySelector('#fullscreen');
const audio = window.quizAudio;
const params = new URLSearchParams(location.search);
const host = params.has('host');
const config = window.QUIZR_CONFIG;
const db = config.url && config.anonKey ? window.supabase.createClient(config.url, config.anonKey) : null;
const symbols = ['▲', '◆', '●', '■'];
const avatars = ['🐔', '🌶️', '🍗', '⭐', '🐯', '🐱', '🐻', '🐰', '🐼', '🦊', '🐸', '🦄'];
const numeric = new Intl.NumberFormat('th-TH');
const errors = {
  ADMIN: 'บัญชีนี้ไม่มีสิทธิ์จัดเกม', SESSION: 'หมดเวลาของห้อง หรือออกจากห้องแล้ว',
  LOBBY: 'ไม่พบห้องที่เปิดรับผู้เล่น ตรวจสอบ PIN กับพิธีกร',
  NAME: 'ใช้ชื่อ 2–15 ตัวอักษร และหลีกเลี่ยงคำไม่เหมาะสม',
  DUPLICATE: 'ชื่อนี้มีคนใช้แล้ว ลองชื่ออื่น', FULL: 'ห้องนี้เต็มแล้ว',
  CLOSED: 'ปิดรับคำตอบแล้ว', EMPTY: 'รอให้มีผู้เล่นอย่างน้อย 1 คน',
  PACK: 'ตรวจสอบชุดคำถาม ตัวเลือก เฉลย เวลา และขนาดรูป'
};
let pin = '';
let token = '';
let chosenAvatar = 0;
let view;
let signature = '';
let channel;
let realtime = false;
let busyRead = false;
let readAgain = false;
let busyAnswer = false;
let offset = 0;
let lastTick = null;
let noticeTimeout;
let toolsOpen = true;
let packs = [];
let drafts = [];
let editingId = null;
let poll;
let active = false;
let connection = 0;
let networkWarning = false;

document.body.classList.toggle('host', host);
full.hidden = !host || !document.documentElement.requestFullscreen;
full.onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { notice('เบราว์เซอร์นี้ไม่สามารถเปิดเต็มจอได้'); }
};
document.querySelector('#audio').onclick = async (event) => {
  const enabled = await audio.toggle();
  event.target.setAttribute('aria-pressed', enabled);
  event.target.textContent = enabled ? 'ปิดเสียง' : 'เปิดเสียง';
};

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]);
}

function notice(text) {
  message.textContent = text;
  clearTimeout(noticeTimeout);
  if (text) noticeTimeout = setTimeout(() => { message.textContent = ''; }, 7000);
}

function errorText(error) {
  return errors[error.message] || 'ดำเนินการไม่สำเร็จ ลองอีกครั้งหรือตรวจสอบการเชื่อมต่อ';
}

async function rpc(name, args) {
  const { data, error } = await db.rpc(name, args).abortSignal(AbortSignal.timeout(7000));
  if (error) throw error;
  return data;
}

function button(text, action, style = '') {
  return `<button type="button" class="${style}" data-action="${action}">${text}</button>`;
}

function mount(markup) {
  screen.innerHTML = markup;
}

function imageTag(url) {
  return /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url || '')
    ? `<img class="media" src="${esc(url)}" alt="ภาพประกอบคำถาม">` : '';
}

function keyFor(target) { return 'quizr-player:' + target; }

function renderJoin(initialPin = params.get('pin') || '') {
  mode.textContent = 'BONCHON NPD QUIZ';
  mount(`<section class="entry card">
    <p class="eyebrow">BONCHON NPD QUIZ</p><h1>เข้าเกม</h1>
    <p>สแกน QR หรือกรอก PIN จากจอพิธีกร</p>
    <form id="join" class="stack">
      <label>Game PIN<input name="pin" required pattern="[0-9]{6}" inputmode="numeric" maxlength="6" placeholder="กรอกเลข 6 หลัก" value="${esc(initialPin)}"></label>
      <label>ชื่อเล่น<input name="nickname" required maxlength="30" autocomplete="off" placeholder="2–15 ตัวอักษร"></label>
      <fieldset><legend>เลือกอวตาร</legend><div class="avatars">
      ${avatars.map((icon, i) => `<button type="button" data-avatar="${i}" aria-label="อวตาร ${i + 1}" aria-pressed="${i === chosenAvatar}">${icon}</button>`).join('')}
      </div></fieldset>
      <button>เข้าห้องเกม</button>
    </form></section><a class="action-link" href="?host=1">สำหรับพิธีกร</a>`);
  screen.querySelector('#join').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const target = form.get('pin');
    const nickname = form.get('nickname').trim();
    const submit = event.submitter;
    if ([...nickname.normalize('NFKC')].length > 15 || [...nickname].length < 2) {
      notice(errors.NAME);
      return;
    }
    submit.disabled = true;
    try {
      const existing = localStorage.getItem(keyFor(target));
      if (existing) {
        try {
          await rpc('get_view', { p_pin: target, p_token: existing });
          connect(target, existing);
          return;
        } catch (error) {
          if (error.message !== 'SESSION') throw error;
          localStorage.removeItem(keyFor(target));
        }
      }
      const joined = await rpc('join_game', { p_pin: target, p_name: nickname, p_avatar: chosenAvatar });
      localStorage.setItem(keyFor(target), joined.token);
      connect(target, joined.token);
    } catch (error) { notice(errorText(error)); }
    finally { submit.disabled = false; }
  };
}

function renderLogin() {
  mount(`<section class="card stack" style="max-width:31rem">
    <h1>เข้าสู่ระบบพิธีกร</h1>
    <form class="stack" id="login">
      <label>ชื่อผู้ใช้หรืออีเมล<input type="text" name="login" required autocomplete="username" autocapitalize="none" spellcheck="false"></label>
      <label>รหัสผ่าน<input type="password" name="password" required autocomplete="current-password"></label>
      <button>เข้าสู่ระบบ</button>
    </form><a class="action-link" href="./">กลับหน้าเข้าเกม</a></section>`);
  screen.querySelector('#login').onsubmit = async (event) => {
    event.preventDefault();
    event.submitter.disabled = true;
    const form = new FormData(event.target);
    const login = String(form.get('login')).trim().toLowerCase();
    const email = login === 'elle' ? 'elle@quizr.example.com' : login;
    try {
      const { error } = await db.auth.signInWithPassword({email, password: form.get('password')});
      if (error) { notice('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'); return; }
      await dashboard();
    } catch (error) { notice(errorText(error)); }
    finally { event.submitter.disabled = false; }
  };
}

async function dashboard() {
  disconnect();
  mode.textContent = 'HOST CONTROL';
  try { packs = await rpc('quizr_packs'); }
  catch (error) {
    mount(`<section class="card"><h1>เปิดแผงพิธีกรไม่ได้</h1><p>${esc(errorText(error))}</p>
      <div class="row">${button('ลองอีกครั้ง', 'dashboard')}${button('ออกจากระบบ', 'logout', 'ghost')}</div></section>`);
    return;
  }
  mount(`<p class="eyebrow">BONCHON NPD QUIZ</p><h1>สร้างห้องเกม</h1>
    <section class="card stack">
      <form id="create" class="stack">
        <label>ชุดคำถาม<select name="pack" required>${packs.map(p => `<option value="${esc(p.id)}">${esc(p.title)} · ${p.questions.length} ข้อ</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="show"> แสดงคำถามและตัวเลือกบนมือถือ</label>
        <label class="check"><input type="checkbox" name="streak"> โบนัส 100 คะแนนเมื่อถูกติดกันตั้งแต่ 3 ข้อ</label>
        <label>จำนวนผู้เล่นบนโพเดียม<select name="podium">${[1,2,3,4,5].map(i => `<option ${i===3?'selected':''}>${i}</option>`).join('')}</select></label>
        <button>สร้างเกม</button>
        <div class="row">${button('แก้ไขชุดที่เลือก', 'edit', 'ghost')}${button('สร้างชุดใหม่', 'new-pack', 'ghost')}${button('ออกจากระบบ', 'logout', 'ghost')}</div>
      </form>
    </section>`);
  screen.querySelector('#create').onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    event.submitter.disabled = true;
    try {
      const newPin = await rpc('quizr_create', {
        p_pack: form.get('pack'), p_show: form.has('show'), p_streak: form.has('streak'), p_podium: Number(form.get('podium'))
      });
      localStorage.setItem('quizr-host', newPin);
      connect(newPin);
    } catch (error) { notice(errorText(error)); }
    finally { event.submitter.disabled = false; }
  };
}

function disconnect() {
  active = false;
  connection += 1;
  clearInterval(poll);
  if (channel) db.removeChannel(channel);
  channel = null;
  realtime = false;
  view = null;
  signature = '';
  audio.lobby(false);
}

function connect(target, playerToken = '') {
  disconnect();
  active = true;
  pin = target;
  token = playerToken;
  if (!host) {
    localStorage.setItem('quizr-last-player', pin);
    history.replaceState(null, '', '?pin=' + pin);
  }
  mount('<section class="card" aria-live="polite">กำลังเชื่อมต่อห้องเกม…</section>');
  let uptime = 0;
  poll = setInterval(() => {
    uptime += 1;
    if (!realtime || host && ['question','lobby'].includes(view?.phase) || uptime % 8 === 0) refresh();
  }, 2000);
  refresh();
}

function subscribe(topic) {
  const current = db.channel('quizr-' + topic);
  channel = current;
  current.on('postgres_changes', {
    event: 'UPDATE', schema: 'public', table: 'quizr_signals', filter: 'topic=eq.' + topic
  }, () => { if (channel === current) refresh(); }).subscribe(status => {
    if (channel !== current) return;
    realtime = status === 'SUBSCRIBED';
    if (realtime) refresh();
  });
}

async function refresh() {
  if (!active) return;
  if (busyRead) { readAgain = true; return; }
  const target = pin;
  const activeConnection = connection;
  busyRead = true;
  const sent = Date.now();
  try {
    const state = await rpc('get_view', { p_pin: target, p_token: token || null, p_host: host });
    if (connection !== activeConnection) return;
    if (!channel && state.topic) subscribe(state.topic);
    if (networkWarning) { networkWarning = false; notice('เชื่อมต่อแล้ว'); }
    offset = Date.parse(state.server) - (sent + Date.now()) / 2;
    const nextSignature = JSON.stringify({ ...state, server: null, answered: host ? null : state.answered, n: host ? null : state.n });
    const old = view;
    view = state;
    if (state.phase === 'ended') {
      leave();
      notice('พิธีกรปิดห้องแล้ว');
      return;
    }
    if (signature !== nextSignature) {
      signature = nextSignature;
      renderGame();
      if (state.phase === 'podium' && old?.phase !== 'podium') audio.play('podium');
      if (!host && old?.phase !== 'reveal' && state.phase === 'reveal' && state.good !== null) audio.play(state.good ? 'good' : 'bad');
      if (host && old?.phase === 'lobby' && state.phase === 'lobby' && state.n > old.n) audio.play('join');
    }
    tick();
  } catch (error) {
    if (connection !== activeConnection) return;
    if (['SESSION', 'ADMIN'].includes(error.message)) {
      leave();
      notice(errorText(error));
    } else if (!networkWarning) {
      networkWarning = true;
      notice('การเชื่อมต่อสะดุด กำลังลองเชื่อมต่อใหม่');
    }
  } finally {
    busyRead = false;
    if (readAgain) { readAgain = false; refresh(); }
  }
}

function leave() {
  disconnect();
  if (host) {
    localStorage.removeItem('quizr-host');
    dashboard();
  } else {
    localStorage.removeItem(keyFor(pin));
    localStorage.removeItem('quizr-last-player');
    history.replaceState(null, '', './');
    renderJoin(pin);
  }
}

function playerLink() {
  return new URL('?pin=' + pin, location.href).href;
}

function lobbyMarkup(s) {
  if (!host) return `<section class="card entry"><p class="eyebrow">PIN ${pin}</p><h1>เข้าห้องแล้ว!</h1>
    <p>${esc(s.name)} ดูจอหลักและรอพิธีกรเริ่มเกม</p>${button('ออกจากห้อง', 'leave', 'ghost')}</section>`;
  return `<div class="lobby">
    <section class="card entry"><p class="eyebrow">BONCHON TRAINING</p><h1>${esc(s.title)}</h1>
      <p>${s.total} คำถาม · เข้าแล้ว <strong>${s.n} คน</strong></p>
      <div class="chips">${s.players.map(p => `<button type="button" data-kick="${p.id}" title="นำผู้เล่นออก">${avatars[p.avatar]} ${esc(p.nickname)}</button>`).join('')}</div>
      <div class="toolbar"><button type="button" data-action="next" ${s.n?'':'disabled'}>เริ่มเกม</button></div>
    </section>
    <section class="card pin-card"><h2>สแกนเพื่อเข้าเกม</h2><div id="qr"></div><div class="pin">${pin}</div>
      <a href="${esc(playerLink())}" target="_blank" rel="noopener">${esc(location.host + location.pathname + '?pin=' + pin)}</a>
      ${button('คัดลอกลิงก์', 'copy', 'ghost')}</section>
    </div>`;
}

function optionsMarkup(s) {
  return `<div class="options">${symbols.slice(0,s.optionCount).map((symbol, index) => {
    const correct = s.correct?.includes(index + 1);
    const tone = `data-tone="${index}"`;
    const cls = `option ${s.options ? '' : 'symbol-only'} ${s.phase === 'reveal' ? correct ? 'correct' : 'dim' : ''}`;
    const count = s.counts?.[index];
    const width = s.answered ? 100 * count / s.answered : 0;
    const label = s.options?.[index] || ['สามเหลี่ยมสีแดง','ข้าวหลามตัดสีน้ำเงิน','วงกลมสีเหลือง','สี่เหลี่ยมสีเขียว'][index];
    const inside = `<b aria-hidden="true">${symbol}</b>
      ${s.options ? `<span class="option-copy">${esc(label)}${count !== undefined ? `<i class="bar-track" style="width:${width}%"></i>` : ''}</span>` : ''}
      ${count !== undefined ? `<span class="bar">${count}</span>` : ''}`;
    return host || s.phase === 'reveal' ? `<div class="${cls}" ${tone} aria-label="${esc(label)}${correct?' ถูกต้อง':''}">${inside}</div>`
      : `<button type="button" class="${cls}" ${tone} aria-label="${esc(label)}" data-answer="${index + 1}" ${s.paused?'disabled':''}>${inside}</button>`;
  }).join('')}</div>`;
}

function roundMarkup(s) {
  const header = `<div class="row between"><p class="eyebrow">ข้อ ${s.idx + 1} / ${s.total}</p>
    ${s.phase === 'question' ? '<span id="clock" class="timer"></span>' : '<p class="eyebrow">เฉลย</p>'}</div>`;
  if (!host && s.phase === 'reveal') {
    const heading = s.good === null ? 'ไม่ได้ตอบ' : s.good ? '✓ ถูกต้อง!' : '✗ ยังไม่ถูก';
    return `<section class="card entry">${header}<h1>${heading}</h1><div class="score">+${numeric.format(s.points)}</div>
      <p>อันดับ ${s.me?.rank} · คะแนนรวม ${numeric.format(s.me?.score || 0)}</p>
      <p>คำตอบที่ถูก ${s.correct.map(i => s.options ? esc(s.options[i-1]) : symbols[i-1]).join(' / ')}</p></section>`;
  }
  const waiting = !host && s.choice != null;
  return `<section class="card">${header}
    ${s.phase === 'question' ? '<progress id="progress" aria-label="เวลาที่เหลือ"></progress>' : ''}
    ${waiting ? '<h1>ส่งคำตอบแล้ว</h1><p>รอเฉลยจากจอหลัก</p>' : `
      <h1 class="prompt">${esc(s.text || 'เลือกคำตอบ')}</h1>
      ${imageTag(s.image)}
      ${!host && !s.text ? '<p class="muted">เลือกสีและสัญลักษณ์ให้ตรงกับจอหลัก</p>' : ''}
      ${optionsMarkup(s)}`}
    ${host ? '<p class="muted" id="tally"></p>' : ''}
  </section>`;
}

function rankingMarkup(s) {
  const podium = s.phase === 'podium';
  const heading = podium ? 'ผลการแข่งขัน' : 'อันดับ Top 5';
  if (!host) return `<section class="card entry"><p class="eyebrow">${heading}</p><h1>อันดับ ${s.me?.rank ?? '–'}</h1>
    <p>${esc(s.name)}</p><div class="score">${numeric.format(s.me?.score || 0)}</div><p>คะแนนรวม</p>
    ${podium ? button('กลับหน้าเข้าเกม','leave','ghost') : ''}</section>`;
  const ranks = s.ranks || [];
  const confetti = podium ? `<div class="confetti" aria-hidden="true">${Array.from({length:45}, (_, i) =>
    `<i style="left:${i*37%100}%;background:${['#ffd84d','#d7141a','#fff8ef'][i%3]};animation-delay:${i%9/15}s"></i>`).join('')}</div>` : '';
  const list = podium
    ? `<div class="podium">${ranks.map(p => `<article><b>#${p.rank}</b><h2>${avatars[p.avatar]} ${esc(p.nickname)}</h2><strong>${numeric.format(p.score)} คะแนน</strong></article>`).join('')}</div>`
    : `<ol class="rank-list">${ranks.map(p => `<li><strong>#${p.rank}</strong><span>${avatars[p.avatar]} ${esc(p.nickname)}</span><b>${numeric.format(p.score)}</b></li>`).join('')}</ol>`;
  return `<section class="card entry">${confetti}<p class="eyebrow">${esc(s.title)}</p><h1>${heading}</h1>${list}</section>`;
}

function renderGame() {
  const s = view;
  mode.textContent = host ? 'HOST · ' + pin : 'PIN ' + pin;
  audio.lobby(host && s.phase === 'lobby');
  let html;
  if (s.phase === 'lobby') html = lobbyMarkup(s);
  else if (['question','reveal'].includes(s.phase)) html = roundMarkup(s);
  else html = rankingMarkup(s);
  if (host) {
    const next = s.idx + 1 === s.total ? 'ขึ้นโพเดียม' : 'ข้อต่อไป';
    const controls = {
      lobby: '',
      question: button(s.paused ? 'เล่นต่อ' : 'พักเวลา', s.paused ? 'resume' : 'pause','ghost') + button('เฉลยทันที','close'),
      reveal: button('ดู Top 5','rank','ghost') + button(next,'next'),
      leaderboard: button(next,'next'),
      podium: button('ดาวน์โหลดผล Excel','export')
    };
    html += `<details class="toolbar" ${toolsOpen?'open':''}><summary>แถบควบคุมพิธีกร</summary><div class="row">
      ${controls[s.phase] || ''}${button('เริ่มเกมใหม่','reset','danger')}</div></details>`;
  }
  mount(html);
  const tools = screen.querySelector('details');
  if (tools) tools.ontoggle = () => { toolsOpen = tools.open; };
  const qrTarget = screen.querySelector('#qr');
  if (qrTarget) {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(playerLink());
      qr.make();
      qrTarget.innerHTML = qr.createImgTag(6, 24, 'QR สำหรับเข้าเกม');
      qrTarget.firstElementChild.className = 'qr';
    } catch { qrTarget.textContent = 'ใช้ PIN หรือลิงก์เพื่อเข้าเกม'; }
  }
}

function tick() {
  if (!view) return;
  const tally = screen.querySelector('#tally');
  if (tally) tally.textContent = `ตอบแล้ว ${view.answered || 0} / ${view.n || 0} คน`;
  const clock = screen.querySelector('#clock');
  if (!clock) return;
  const remaining = Math.max(0, Date.parse(view.end) - (view.paused ? Date.parse(view.paused) : Date.now() + offset));
  const seconds = Math.ceil(remaining / 1000);
  clock.textContent = view.paused ? `พักเวลา · ${seconds} วิ` : `${seconds} วิ`;
  const progress = screen.querySelector('#progress');
  progress.max = view.seconds * 1000;
  progress.value = remaining;
  const marker = pin + ':' + view.idx + ':' + seconds;
  if (host && !view.paused && seconds >= 1 && seconds <= 5 && marker !== lastTick) {
    audio.play('tick');
    lastTick = marker;
  }
  if (!remaining && !view.paused && lastTick !== marker) {
    lastTick = marker;
    refresh();
  }
  if (!remaining && !host) screen.querySelectorAll('[data-answer]').forEach(b => { b.disabled = true; });
}
setInterval(tick, 200);

async function sendAnswer(choice) {
  if (busyAnswer || !view || view.phase !== 'question') return;
  busyAnswer = true;
  let accepted = false;
  screen.querySelectorAll('[data-answer]').forEach(b => { b.disabled = true; });
  try {
    const answer = {p_pin: pin, p_token: token, p_idx: view.idx, p_choice: choice};
    try {
      await rpc('submit_answer', answer);
    } catch (error) {
      const transient = /fetch|network|abort|timeout/i.test(error.message);
      if (!transient || Date.now() + offset >= Date.parse(view?.end)) throw error;
      await rpc('submit_answer', answer);
    }
    accepted = true;
    await refresh();
  } catch (error) {
    notice(errorText(error));
    await refresh();
  } finally {
    busyAnswer = false;
    if (!accepted && view?.phase === 'question' && view.choice == null && !view.paused && Date.now() + offset < Date.parse(view.end)) {
      screen.querySelectorAll('[data-answer]').forEach(b => { b.disabled = false; });
    }
  }
}

function newQuestion() {
  return { text: '', options: ['', '', '', ''], correct: [], seconds: 20, image: '' };
}

function editPack(pack) {
  editingId = pack?.id || null;
  drafts = pack ? structuredClone(pack.questions) : [newQuestion()];
  renderEditor(pack?.title || '');
}

function renderEditor(title) {
  mount(`<h1>จัดชุดคำถาม</h1><form id="editor" class="card stack">
    <label>ชื่อชุดคำถาม<input name="title" required maxlength="100" value="${esc(title)}"></label>
    <label>นำเข้า Excel หรือ CSV<input type="file" id="import" accept=".xlsx,.csv"></label>
    <p class="muted">ใช้คอลัมน์ คำถาม, A, B, C, D, ข้อถูก, เวลา · ระบุข้อถูกด้วยเลข 1–4 คั่นด้วยจุลภาค</p>
    ${drafts.map((q, i) => `<section class="editor-row" data-editor-row="${i}">
      <label>คำถาม ${i+1}<input required maxlength="300" data-field="text" value="${esc(q.text)}"></label>
      <div class="options">${symbols.map((symbol, j) => `<label>${symbol} ตัวเลือก ${j+1}<input maxlength="160" data-option="${j}" value="${esc(q.options[j])}"></label>`).join('')}</div>
      <div class="row">
        <span>ข้อถูก</span>
        ${symbols.map((symbol, j) => `<label class="check"><input type="checkbox" data-correct="${j+1}" ${q.correct.includes(j+1)?'checked':''}> ${symbol}</label>`).join('')}
      </div>
      <label>เวลา<select data-field="seconds">${[5,10,20,30,60].map(n => `<option value="${n}" ${n===q.seconds?'selected':''}>${n} วินาที</option>`).join('')}</select></label>
      <label>ภาพ (PNG, JPG, WebP ไม่เกิน 700 KB)<input type="file" data-image accept="image/png,image/jpeg,image/webp"></label>
      <div class="row">${imageTag(q.image)}
        ${q.image ? `<button type="button" data-remove-img="${i}" class="ghost">ลบรูป</button>` : ''}
        <button type="button" data-remove="${i}" class="ghost" ${drafts.length===1?'disabled':''}>ลบคำถาม</button>
      </div></section>`).join('')}
    <div class="row">${button('เพิ่มคำถาม','add-row','ghost')}<button>บันทึกชุด</button>${button('กลับ','dashboard','ghost')}</div>
  </form>`);
  const form = screen.querySelector('#editor');
  form.oninput = event => {
    const field = event.target;
    const container = field.closest('[data-editor-row]');
    if (!container) return;
    const q = drafts[Number(container.dataset.editorRow)];
    if (field.dataset.field === 'text') q.text = field.value;
    if (field.dataset.field === 'seconds') q.seconds = Number(field.value);
    if (field.dataset.option !== undefined) q.options[Number(field.dataset.option)] = field.value;
    if (field.dataset.correct) {
      const value = Number(field.dataset.correct);
      q.correct = field.checked ? [...q.correct, value] : q.correct.filter(i => i !== value);
    }
  };
  form.onchange = async event => {
    const field = event.target;
    const file = field.files?.[0];
    if (!file) return;
    try {
      if (field.id === 'import') {
        const imported = await importQuestions(file);
        if (!form.isConnected) return;
        drafts = imported;
        renderEditor(form.elements.title.value);
      } else if (field.hasAttribute('data-image')) {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 700000) throw new Error('PACK');
        const index = Number(field.closest('[data-editor-row]').dataset.editorRow);
        const reader = new FileReader();
        reader.onload = () => {
          if (!form.isConnected) return;
          drafts[index].image = reader.result;
          renderEditor(form.elements.title.value);
        };
        reader.onerror = () => notice(errors.PACK);
        reader.readAsDataURL(file);
      }
    } catch (error) { notice(errorText(error)); }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    event.submitter.disabled = true;
    try {
      const questions = drafts.map(q => ({...q, options: q.options.map(s => s.trim())}));
      for (const q of questions) {
        while (q.options.at(-1) === '') q.options.pop();
      }
      await rpc('quizr_save_pack', {p_id: editingId, p_title: form.elements.title.value, p_questions: questions});
      await dashboard();
      notice('บันทึกชุดคำถามแล้ว');
    } catch (error) { notice(errorText(error)); }
    finally { event.submitter.disabled = false; }
  };
}

async function importQuestions(file) {
  if (file.size > 8000000) throw new Error('PACK');
  const book = /\.csv$/i.test(file.name)
    ? XLSX.read(await file.text(), {type:'string',raw:true})
    : XLSX.read(await file.arrayBuffer(), {raw:true});
  const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {header:1,defval:'',blankrows:false});
  const header = rows.findIndex(r => r.some(c => /^(คำถาม|Question\b)/i.test(String(c).trim())));
  if (header < 0) throw new Error('PACK');
  const columns = rows[header].map(c => String(c).trim());
  const col = patterns => columns.findIndex(c => patterns.some(pattern => pattern.test(c)));
  const question = col([/^คำถาม$/i, /^question\b/i]);
  const answer = col([/^ข้อถูก$/i, /^correct/i]);
  const time = col([/^เวลา/i, /^time/i]);
  const optionColumns = ['A','B','C','D'].map((letter, i) => col([new RegExp('^' + letter + '$','i'),new RegExp('^Answer ' + (i+1) + '\\b','i')]));
  if (question < 0 || answer < 0 || optionColumns.slice(0,2).some(i => i < 0)) throw new Error('PACK');
  const imported = rows.slice(header + 1).filter(r => String(r[question] || '').trim()).map(r => {
    const correct = String(r[answer]).split(/[,;\/\s]+/).filter(Boolean).map(v => /^[A-D]$/i.test(v) ? v.toUpperCase().charCodeAt(0)-64 : Number(v));
    return {
      text: String(r[question]), options: optionColumns.map(i => String(r[i] ?? '')),
      correct: [...new Set(correct)], seconds: Number(r[time] || 20), image: ''
    };
  });
  if (!imported.length || imported.length > 100 ||
      imported.some(q => ![5,10,20,30,60].includes(q.seconds) || !q.correct.length || q.correct.some(i => !Number.isInteger(i) || !q.options[i-1]))) {
    throw new Error('PACK');
  }
  return imported;
}

async function exportResults() {
  const data = await rpc('export_results', {p_pin: pin});
  const book = XLSX.utils.book_new();
  const byKey = new Map(data.answers.map(a => [a.player + ':' + a.idx, a]));
  const details = [['อันดับ','ชื่อ','คะแนน', ...data.questions.flatMap((_, i) => [`ข้อ ${i+1} คำตอบ`,`ข้อ ${i+1} เวลา (วิ)`,`ข้อ ${i+1} คะแนน`])]];
  for (const p of data.players) {
    details.push([p.rank,p.nickname,p.score,...data.questions.flatMap((q,i) => {
      const a = byKey.get(p.id + ':' + i);
      return a ? [q.options[a.choice-1],a.elapsed/1000,a.points] : ['', '', 0];
    })]);
  }
  const stats = data.questions.map((q,i) => {
    const selected = data.players.map(p => byKey.get(p.id+':'+i)).filter(Boolean);
    const correct = selected.filter(a => a.correct).length;
    return [i+1,q.text,data.players.length,selected.length,correct,data.players.length ? correct/data.players.length : 0,''];
  });
  const hardest = Math.min(...stats.map(row => row[5]));
  stats.forEach(row => { if (row[5] === hardest) row[6] = 'ยากที่สุด'; });
  const summary = XLSX.utils.aoa_to_sheet([['ข้อ','คำถาม','ผู้เล่นทั้งหมด','ส่งคำตอบ','ตอบถูก','% ตอบถูก (จากผู้เล่นทั้งหมด)','ข้อที่ยากที่สุด'],...stats]);
  stats.forEach((_,i) => { summary['F'+(i+2)].z = '0.0%'; });
  summary['!cols'] = [{wch:7},{wch:64},{wch:12},{wch:12},{wch:12},{wch:27},{wch:15}];
  const perPerson = XLSX.utils.aoa_to_sheet(details);
  perPerson['!cols'] = [{wch:8},{wch:20},{wch:12},...data.questions.flatMap(() => [{wch:26},{wch:17},{wch:14}])];
  XLSX.utils.book_append_sheet(book,perPerson,'รายคน');
  XLSX.utils.book_append_sheet(book,summary,'รายข้อ');
  XLSX.writeFile(book,'Quizr-' + pin + '.xlsx');
}

screen.onclick = async event => {
  const control = event.target.closest('button');
  if (!control) return;
  const d = control.dataset;
  if (d.avatar !== undefined) {
    chosenAvatar = Number(d.avatar);
    screen.querySelectorAll('[data-avatar]').forEach(b => b.setAttribute('aria-pressed',Number(b.dataset.avatar) === chosenAvatar));
    return;
  }
  if (d.answer) { await sendAnswer(Number(d.answer)); return; }
  if (d.action === 'leave') { leave(); return; }
  if (!host) return;
  if (!(d.action || d.kick || d.remove !== undefined || d.removeImg !== undefined)) return;
  control.disabled = true;
  try {
    const titleField = screen.querySelector('#editor input[name=title]');
    if (d.action === 'dashboard') await dashboard();
    else if (d.action === 'logout') {
      const {error} = await db.auth.signOut();
      if (error) throw error;
      disconnect();
      localStorage.removeItem('quizr-host');
      renderLogin();
    } else if (d.action === 'edit') {
      const id = screen.querySelector('[name=pack]').value;
      const pack = packs.find(p => p.id === id);
      if (pack) editPack(pack);
    } else if (d.action === 'new-pack') editPack();
    else if (d.action === 'add-row' && titleField) {
      if (drafts.length >= 100) throw new Error('PACK');
      drafts.push(newQuestion());
      renderEditor(titleField.value);
    } else if (d.remove !== undefined && titleField) {
      drafts.splice(Number(d.remove),1);
      renderEditor(titleField.value);
    } else if (d.removeImg !== undefined && titleField) {
      drafts[Number(d.removeImg)].image = '';
      renderEditor(titleField.value);
    } else if (d.action === 'copy') {
      await navigator.clipboard.writeText(playerLink());
      notice('คัดลอกลิงก์แล้ว');
    } else if (d.action === 'export') await exportResults();
    else if (view) {
      if (d.kick && !confirm('นำผู้เล่นนี้ออกจากห้อง?')) return;
      if (d.action === 'reset' && !confirm('ปิดห้องนี้แล้วกลับไปสร้างเกมใหม่?')) return;
      await rpc('host_next', {p_pin:pin,p_action:d.kick?'kick':d.action,p_idx:view.idx,p_phase:view.phase,p_player:d.kick || null});
      await refresh();
    }
  } catch (error) { notice(errorText(error)); }
  finally { control.disabled = false; }
};

async function start() {
  if (!db) {
    mount('<section class="card entry"><p class="eyebrow">BONCHON NPD QUIZ</p><h1>Quizr</h1><p>เชื่อมต่อฐานข้อมูลใน config.js เพื่อเปิดห้องและเริ่มเล่น</p></section>');
    return;
  }
  if (host) {
    const {data} = await db.auth.getSession();
    const previous = localStorage.getItem('quizr-host');
    if (!data.session) renderLogin();
    else if (previous) connect(previous);
    else await dashboard();
  } else {
    const previous = params.get('pin') || localStorage.getItem('quizr-last-player');
    const savedToken = previous && /^[0-9]{6}$/.test(previous) ? localStorage.getItem(keyFor(previous)) : null;
    if (savedToken) connect(previous, savedToken);
    else renderJoin(previous || '');
  }
}

start().catch(error => notice(errorText(error)));
