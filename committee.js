/* Elsecar Club Diary: committee view.
   Plain JavaScript, no libraries. All text from the server is put on the page with
   textContent / text nodes (never innerHTML), so nothing typed into the diary can run as code.
   The server checks every request; this page is never trusted. */
(function () {
'use strict';

const CFG = window.DIARY_CONFIG || {};
const QS = new URLSearchParams(location.search);
const DEMO = QS.get('demo') === '1';
const DEMO_OFFLINE = DEMO && QS.get('offline') === '1'; // test aid: pretend there is no signal
const HAS_BACKEND = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(CFG.BACKEND_URL || '');

const CATS = {
  room:    { label: 'Function room hire', c: 'var(--c-room)' },
  club:    { label: 'Club events',        c: 'var(--c-club)' },
  cricket: { label: 'Cricket',            c: 'var(--c-cricket)' },
  meet:    { label: 'Committee',          c: 'var(--c-meet)' },
  staff:   { label: 'Bar & staffing',     c: 'var(--c-staff)' }
};
const SESS_LABEL = { aft: 'afternoon', eve: 'evening', day: 'whole day' };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const LIST_DAYS = 90; // the server allows 100 at most

/* ---------- small helpers ---------- */
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isoOf = d => iso(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return isoOf(d); };
const nice = s => { const d = parse(s); return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const short = s => { const d = parse(s); return DAYS[d.getDay()].slice(0, 3) + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3); };
const TODAY = isoOf(new Date());

/** Builds an element. Children that are strings become text nodes. */
function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'c') n.style.setProperty('--c', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  kids.flat(Infinity).forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
  return n;
}
function fill(node, ...kids) { node.replaceChildren(...kids.flat(Infinity).filter(Boolean)); }

function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) {} return null; }

/* ---------- state ---------- */
const now = new Date();
const S = {
  session: null,          // { token, name, expires }
  view: 'month',          // 'month' | 'list'
  y: now.getFullYear(), m: now.getMonth(), sel: TODAY,
  off: new Set(),         // categories hidden by the filter chips
  events: [], log: [], feed: '', loadErr: '', loading: false
};
let reqId = 0;

/* ---------- talking to the server ---------- */
class ApiError extends Error { constructor(msg, auth) { super(msg); this.auth = !!auth; } }

async function api(action, payload) {
  if (DEMO) return demoApi(action, payload || {});
  const body = Object.assign({ action }, payload || {});
  if (S.session) body.token = S.session.token;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  let data;
  try {
    // text/plain avoids a CORS preflight, which Apps Script cannot answer.
    const res = await fetch(CFG.BACKEND_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body), signal: ctrl.signal
    });
    data = await res.json();
  } catch (e) {
    if (e && e.name === 'SyntaxError') throw new ApiError("The diary didn't answer properly. Try again in a minute.");
    throw new ApiError("Can't reach the diary. Check your signal or wifi and try again. Nothing was changed.");
  } finally { clearTimeout(timer); }
  if (!data || data.ok !== true) {
    const err = new ApiError((data && data.error) || 'Something went wrong. Try again in a minute.', data && data.auth);
    if (err.auth) signOut('Please enter the diary code again.');
    throw err;
  }
  return data;
}

/* ---------- sign in / out ---------- */
function showOnly(which) {
  $('signin').hidden = which !== 'signin';
  $('noBackend').hidden = which !== 'noBackend';
  $('app').hidden = which !== 'app';
  fill($('who'));
  if (which === 'app') {
    $('who').append(h('span', null, 'Signed in as ', h('b', null, S.session.name)), h('button', { class: 'pill', onclick: () => { signOut(); toast('Signed out'); } }, 'Sign out'));
  }
}

function signOut(message) {
  S.session = null; S.events = []; S.log = []; S.feed = '';
  store('ecc-diary-session', null);
  closeModal();
  showSignin(message);
}

function showSignin(message) {
  showOnly('signin');
  $('inName').value = store('ecc-diary-name') || '';
  $('inCode').value = '';
  setErr($('inErr'), message || '');
  (($('inName').value) ? $('inCode') : $('inName')).focus();
}

function setErr(node, msg) { node.textContent = msg || ''; node.hidden = !msg; }

function deviceId() {
  let id = store('ecc-diary-device');
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2)); store('ecc-diary-device', id); }
  return id;
}

$('signinForm').addEventListener('submit', async ev => {
  ev.preventDefault();
  const name = $('inName').value.trim(), code = $('inCode').value;
  if (!name) return setErr($('inErr'), 'Add your first name so changes show who made them.');
  if (!code.trim()) return setErr($('inErr'), 'Enter the diary code.');
  setErr($('inErr'), ''); $('inGo').disabled = true; $('inGo').textContent = 'Checking…';
  try {
    const r = await api('login', { name, code, deviceId: deviceId() });
    S.session = { token: r.token, name: r.name, expires: r.expires };
    store('ecc-diary-name', r.name);
    if (!DEMO) store('ecc-diary-session', JSON.stringify(S.session));
    $('inCode').value = '';
    startApp();
  } catch (e) { setErr($('inErr'), e.message); }
  $('inGo').disabled = false; $('inGo').textContent = 'Open diary';
});

/* ---------- loading data ---------- */
function gridRange() {
  const lead = (new Date(S.y, S.m, 1).getDay() + 6) % 7;
  const cells = Math.ceil((lead + new Date(S.y, S.m + 1, 0).getDate()) / 7) * 7;
  const start = new Date(S.y, S.m, 1 - lead);
  const end = new Date(S.y, S.m, 1 - lead + cells - 1);
  return [start, end, cells];
}
function currentRange() {
  if (S.view === 'list') return [TODAY, addDays(TODAY, LIST_DAYS - 1)];
  const [a, b] = gridRange();
  return [isoOf(a), isoOf(b)];
}

async function load() {
  const my = ++reqId;
  const [from, to] = currentRange();
  S.loading = true; $('mainCol').classList.add('loading');
  try {
    const r = await api('list', { from, to });
    if (my !== reqId) return;
    S.events = r.events || []; S.loadErr = '';
  } catch (e) {
    if (my !== reqId) return;
    if (e.auth) return;
    S.loadErr = e.message;
  }
  S.loading = false; $('mainCol').classList.remove('loading');
  render();
}

async function loadLog() {
  try { S.log = (await api('log')).log || []; renderSide(); } catch (e) { /* the log is a nice extra; ignore */ }
}

async function loadFeed() {
  try { S.feed = (await api('check')).feed || ''; renderSide(); } catch (e) { /* ignore */ }
}

function startApp() {
  showOnly('app');
  render();
  load(); loadLog(); loadFeed();
}

/* ---------- display ---------- */
const byTime = (a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.title.localeCompare(b.title);
const visible = () => S.events.filter(e => !S.off.has(e.cat));
const eventsOn = d => visible().filter(e => e.date === d).sort(byTime);
const timeText = e => e.allDay || !e.start ? 'All day' : e.start + ' to ' + e.end;
const isFixture = e => e.src === 'play-cricket';

function render() {
  $('vMonth').setAttribute('aria-pressed', S.view === 'month');
  $('vList').setAttribute('aria-pressed', S.view === 'list');
  $('monthNav').hidden = S.view !== 'month';
  $('listLabel').hidden = S.view !== 'list';
  $('calBox').hidden = S.view !== 'month';
  $('listBox').hidden = S.view !== 'list';
  $('monthLabel').textContent = MONTHS[S.m] + ' ' + S.y;
  setErr($('loadErr'), '');
  if (S.loadErr) {
    $('loadErr').hidden = false;
    fill($('loadErr'), S.loadErr + ' ', h('button', { class: 'btn small line', onclick: load }, 'Try again'));
  }
  renderLegend();
  if (S.view === 'month') renderGrid(); else renderList();
  renderSide();
}

function renderLegend() {
  fill($('legend'), Object.keys(CATS).map(k =>
    h('button', { class: 'chip', c: CATS[k].c, 'aria-pressed': String(!S.off.has(k)), onclick: () => { S.off.has(k) ? S.off.delete(k) : S.off.add(k); render(); } },
      h('i'), CATS[k].label)));
}

function renderGrid() {
  const [start, , cells] = gridRange();
  const cellsOut = [];
  for (let i = 0; i < cells; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = isoOf(d);
    const evs = eventsOn(key);
    cellsOut.push(h('button', {
      class: 'day' + (d.getMonth() !== S.m ? ' out' : '') + (key === TODAY ? ' today' : '') + (key === S.sel ? ' sel' : ''),
      'aria-label': nice(key) + ', ' + evs.length + (evs.length === 1 ? ' item' : ' items'),
      'aria-pressed': String(key === S.sel),
      onclick: () => { S.sel = key; const x = parse(key); if (x.getMonth() !== S.m) { S.y = x.getFullYear(); S.m = x.getMonth(); load(); } render(); }
    },
      h('span', { class: 'num' }, h('b', null, d.getDate())),
      h('span', { class: 'evs' },
        evs.slice(0, 3).map(e => h('span', { class: 'ev', c: CATS[e.cat].c }, h('span', { class: 't' }, e.allDay ? '' : e.start), e.title)),
        evs.length > 3 ? h('span', { class: 'more' }, '+' + (evs.length - 3) + ' more') : null)));
  }
  fill($('grid'), cellsOut);
}

function renderList() {
  const evs = visible().filter(e => e.date >= TODAY).sort(byTime);
  if (!evs.length) { fill($('listBox'), h('div', { class: 'card' }, h('p', { class: 'empty' }, S.loading ? 'Loading…' : 'Nothing in the diary for the next 3 months.'))); return; }
  const days = [];
  evs.forEach(e => { let g = days[days.length - 1]; if (!g || g.date !== e.date) days.push(g = { date: e.date, items: [] }); g.items.push(e); });
  fill($('listBox'), days.map(g =>
    h('div', { class: 'listday' + (g.date === TODAY ? ' today' : '') },
      h('h3', null, g.date === TODAY ? 'Today, ' + nice(g.date) : nice(g.date)),
      h('div', { class: 'card' }, h('ul', { class: 'list' }, g.items.map(itemEl))))));
}

function itemEl(e) {
  const tags = [];
  if (isFixture(e)) tags.push(h('span', { class: 'tag pc' }, 'Play-Cricket'));
  if (e.room && e.cat !== 'room') tags.push(h('span', { class: 'tag' }, 'Uses room'));
  if (!e.pub && e.cat !== 'room' && !isFixture(e)) tags.push(h('span', { class: 'tag' }, 'Committee only'));
  const meta = timeText(e) + (e.by ? ' · added by ' + e.by : '');
  return h('li', { class: 'item' },
    h('span', { class: 'bar', c: CATS[e.cat].c }),
    h('button', { class: 'linkish', onclick: () => openEditor(e), 'aria-label': 'Open ' + e.title + ', ' + nice(e.date) },
      h('div', { class: 'ttl' }, e.title, tags),
      h('div', { class: 'meta' }, meta),
      e.notes ? h('div', { class: 'note' }, e.notes) : null));
}

function renderSide() {
  const cards = [];
  if (S.view === 'month') {
    const evs = eventsOn(S.sel);
    cards.push(h('div', { class: 'card' },
      h('h3', null, nice(S.sel)),
      h('p', { class: 'sub' }, evs.length ? evs.length + (evs.length === 1 ? ' item. Tap one to edit.' : ' items. Tap one to edit.') : 'Nothing in the diary.'),
      evs.length ? h('ul', { class: 'list' }, evs.map(itemEl)) : null,
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn small', onclick: () => openEditor(null) }, 'Add to this day'))));
  }

  /* STAGE 3 goes here: "Needs approval" and "Latest online bookings" cards for the public function room bookings. */

  cards.push(h('div', { class: 'card' }, h('h3', null, 'Recent changes'),
    S.log.length
      ? h('ul', { class: 'log' }, S.log.slice(0, 8).map(l => h('li', null, h('b', null, l.who), ' ' + l.what.toLowerCase() + ' ', l.item, l.date ? ' (' + short(l.date) + ')' : '', ' · ' + whenText(l.when))))
      : h('p', { class: 'empty' }, 'No changes yet.')));

  if (S.feed) {
    cards.push(h('div', { class: 'card' }, h('h3', null, 'On your phone'),
      h('p', { class: 'sub' }, 'Add this link to your phone\'s calendar app once and diary changes appear there. Keep it to the committee only. See the guide for the steps.'),
      h('div', { class: 'feed' }, S.feed),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'btn line small', onclick: copyFeed }, 'Copy link'))));
  }
  fill($('side'), cards);
}

function whenText(w) { // "2026-11-07 16:42"
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(String(w || ''));
  if (!m) return String(w || '');
  const day = m[1] === TODAY ? 'today' : m[1] === addDays(TODAY, -1) ? 'yesterday' : short(m[1]);
  return day + ' ' + m[2];
}

async function copyFeed() {
  try { await navigator.clipboard.writeText(S.feed); toast('Link copied'); }
  catch (e) { const r = document.createRange(); r.selectNodeContents(document.querySelector('.feed')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Link selected. Press and hold to copy'); }
}

/* ---------- modal + toast ---------- */
let lastFocus = null;
function modal(title, ...body) {
  lastFocus = document.activeElement;
  const close = h('button', { class: 'iconbtn', 'aria-label': 'Close', onclick: closeModal, type: 'button' },
    h('span', { 'aria-hidden': 'true' }, '×'));
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mTitle' },
    h('header', null, h('h3', { id: 'mTitle' }, title), close), h('div', { class: 'body' }, body));
  const scrim = h('div', { class: 'scrim', onclick: e => { if (e.target === scrim) closeModal(); } }, box);
  fill($('modalRoot'), scrim);
  const f = box.querySelector('input,select,textarea,button.btn'); if (f) f.focus();
}
function closeModal() { fill($('modalRoot')); if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} } lastFocus = null; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

let toastTimer;
function toast(msg) { fill($('toastRoot'), h('div', { class: 'toast', role: 'status' }, msg)); clearTimeout(toastTimer); toastTimer = setTimeout(() => fill($('toastRoot')), 3000); }

/* ---------- add / edit / delete ---------- */
function sessionOf(e) { // which part of the day an item uses: aft, eve or day
  if (!e.start) return 'day';
  const s = +e.start.slice(0, 2); let eh = +e.end.slice(0, 2);
  if (eh === 0) eh = 24;
  if (e.end <= e.start) eh += 24;
  if (eh > 48) eh -= 24;
  const aft = s < 17, eve = eh > 18 || s >= 17;
  return aft && eve ? 'day' : aft ? 'aft' : 'eve';
}
const usesRoom = e => e.cat === 'room' || e.room;
function clashWith(data, editingId) {
  // Checked against what is on screen. The server-side check arrives with online booking (stage 3).
  const mine = sessionOf(data);
  const bad = S.events.find(e => e.id !== editingId && e.date === data.date && usesRoom(e) && (() => {
    const s = sessionOf(e); return s === 'day' || mine === 'day' || s === mine;
  })());
  return bad || null;
}

function openEditor(ev) {
  const isNew = !ev;
  const e = ev || { date: S.view === 'month' ? S.sel : TODAY, start: '19:00', end: '21:00', title: '', cat: 'club', pub: false, notes: '', room: false };
  const readOnly = isFixture(e);
  const dis = readOnly;

  const title = h('input', { id: 'eTitle', maxlength: '100', value: e.title, placeholder: 'e.g. Quiz night', disabled: dis });
  const cat = h('select', { id: 'eCat', disabled: dis }, Object.keys(CATS).map(k => h('option', { value: k, selected: k === e.cat }, CATS[k].label)));
  const date = h('input', { id: 'eDate', type: 'date', value: e.date, disabled: dis });
  const start = h('input', { id: 'eStart', type: 'time', value: e.start, disabled: dis });
  const end = h('input', { id: 'eEnd', type: 'time', value: e.end, disabled: dis });
  const notes = h('textarea', { id: 'eNotes', maxlength: '1000', disabled: dis }, e.notes || '');
  const room = h('input', { type: 'checkbox', id: 'eRoom', checked: !!(e.room || e.cat === 'room'), disabled: dis });
  const pub = h('input', { type: 'checkbox', id: 'ePub', checked: !!e.pub, disabled: dis });
  const err = h('p', { class: 'err full', role: 'alert', hidden: true });
  const lockRoom = () => { // room hire always uses the room and always shows publicly, as "Private party"
    const r = cat.value === 'room';
    if (r) { room.checked = true; pub.checked = true; }
    if (!readOnly) { room.disabled = r; pub.disabled = r; }
  };
  cat.addEventListener('change', lockRoom); lockRoom();

  const submit = h('button', { class: 'btn', type: 'submit' }, isNew ? 'Add to diary' : 'Save changes');
  const buttons = [submit];
  if (!isNew && !readOnly) {
    let armed = false;
    const del = h('button', { class: 'btn line', type: 'button' }, 'Delete');
    del.addEventListener('click', async () => {
      if (!armed) { armed = true; del.textContent = 'Tap again to delete'; del.className = 'btn danger'; return; }
      del.disabled = true; submit.disabled = true; del.textContent = 'Deleting…';
      try { await api('delete', { id: ev.id }); closeModal(); toast('Deleted'); afterChange(); }
      catch (x) { if (x.auth) return; setErr(err, x.message); del.disabled = false; submit.disabled = false; armed = false; del.textContent = 'Delete'; del.className = 'btn line'; }
    });
    buttons.push(del);
  }

  const form = h('form', { class: 'fgrid', novalidate: true },
    h('div', { class: 'f full' }, h('label', { for: 'eTitle' }, "What's happening"), title),
    h('div', { class: 'f' }, h('label', { for: 'eCat' }, 'Type'), cat),
    h('div', { class: 'f' }, h('label', { for: 'eDate' }, 'Date'), date),
    h('div', { class: 'f' }, h('label', { for: 'eStart' }, 'Start'), start),
    h('div', { class: 'f' }, h('label', { for: 'eEnd' }, 'Finish'), end),
    h('div', { class: 'f full' }, h('label', { for: 'eNotes' }, 'Notes for the committee'), notes),
    h('label', { class: 'check full' }, room, 'Uses the function room (stops the public booking it for those times)'),
    h('label', { class: 'check full' }, pub, 'Show on the public website (room hire always shows as "Private party" with no names)'),
    err,
    h('div', { class: 'row full' }, readOnly ? h('button', { class: 'btn', type: 'button', onclick: closeModal }, 'Close') : buttons));

  form.addEventListener('submit', async x => {
    x.preventDefault();
    if (readOnly) return;
    const data = { title: title.value.trim(), cat: cat.value, date: date.value, start: start.value, end: end.value,
      notes: notes.value.trim(), pub: pub.checked, room: room.checked };
    if (ev) data.id = ev.id;
    const bad = !data.title ? 'Give it a name so people know what it is.'
      : !data.date ? 'Choose a date.'
      : (!data.start || !data.end) ? 'Add a start and finish time.' : '';
    if (bad) return setErr(err, bad);
    if (data.room) {
      const c = clashWith(data, ev && ev.id);
      if (c) return setErr(err, 'The function room is already in use that ' + SESS_LABEL[sessionOf(c)] + ' on ' + nice(data.date) + ' (' + c.title + '). Check the day first.');
    }
    setErr(err, ''); submit.disabled = true; submit.textContent = 'Saving…';
    try {
      const r = await api('save', { event: data });
      closeModal(); toast(isNew ? 'Added to the diary' : 'Saved');
      goToDate(r.event ? r.event.date : data.date);
    } catch (e2) { if (e2.auth) return; setErr(err, e2.message); submit.disabled = false; submit.textContent = isNew ? 'Add to diary' : 'Save changes'; }
  });

  modal(isNew ? 'Add to the diary' : (readOnly ? 'Fixture' : 'Edit diary item'),
    readOnly ? h('p', { class: 'hint' }, 'This fixture comes from Play-Cricket. Change it there and the diary updates the next morning.') : null,
    form);
}

function goToDate(d) {
  S.sel = d;
  if (S.view === 'month') { const x = parse(d); S.y = x.getFullYear(); S.m = x.getMonth(); }
  afterChange();
}
function afterChange() { load(); loadLog(); }

/* ---------- top controls ---------- */
function setMonth(y, m) { S.y = y; S.m = m; S.sel = (y === now.getFullYear() && m === now.getMonth()) ? TODAY : iso(y, m, 1); load(); render(); }
$('prev').addEventListener('click', () => setMonth(S.m === 0 ? S.y - 1 : S.y, (S.m + 11) % 12));
$('next').addEventListener('click', () => setMonth(S.m === 11 ? S.y + 1 : S.y, (S.m + 1) % 12));
$('todayBtn').addEventListener('click', () => setMonth(now.getFullYear(), now.getMonth()));
$('vMonth').addEventListener('click', () => { S.view = 'month'; load(); render(); });
$('vList').addEventListener('click', () => { S.view = 'list'; S.events = []; load(); render(); });
$('addBtn').addEventListener('click', () => openEditor(null));

/* ---------- demo mode: sample data kept in memory ---------- */
const demo = { events: [], log: [], fails: 0, n: 0 };
function demoSeed() {
  const t = TODAY;
  const mk = (off, start, end, title, cat, o) => Object.assign({ id: 'demo' + (++demo.n), date: addDays(t, off), start, end, allDay: false, title, cat,
    src: '', status: 'confirmed', notes: '', pub: cat === 'room' || cat === 'club' || cat === 'cricket', room: cat === 'room', by: 'Amanda' }, o || {});
  demo.events = [
    mk(1, '19:30', '21:00', 'Committee meeting', 'meet', { notes: 'Agenda: Christmas rota, roof quote, function room prices.' }),
    mk(2, '20:00', '23:00', 'Quiz night', 'club', { notes: 'One pound a head, teams of up to 6.' }),
    mk(3, '18:00', '00:00', '40th birthday party', 'room', { notes: 'Own DJ. Buffet from 8pm.', by: 'Sarah' }),
    mk(3, '17:00', '00:00', 'Bar cover needed: 40th birthday', 'staff', { pub: false, notes: 'Two on the bar.' }),
    mk(4, '10:00', '12:00', 'Junior winter nets', 'cricket', { notes: 'Sports hall. U11 to U15.' }),
    mk(6, '11:00', '15:00', 'Christmas craft fair', 'club', { room: true, notes: 'Stalls in the function room and bar.' }),
    mk(6, '13:00', '17:00', '1st XI v Hoyland Town (H)', 'cricket', { src: 'play-cricket', by: '' }),
    mk(9, '19:30', '23:00', 'Presentation night', 'cricket', { room: true, pub: true }),
    mk(10, '12:00', '17:00', 'Christening', 'room', { by: 'Website' }),
    mk(10, '', '', 'Brewery delivery', 'staff', { allDay: true, pub: false }),
    mk(21, '19:30', '21:00', 'Committee meeting', 'meet'),
    mk(35, '20:00', '01:00', 'Christmas party night', 'club', { room: true })
  ];
  demo.log = [
    { when: addDays(t, -1) + ' 16:42', who: 'Amanda', what: 'Added', item: 'Quiz night', date: addDays(t, 2) },
    { when: addDays(t, -1) + ' 09:20', who: 'Sarah', what: 'Edited', item: '40th birthday party', date: addDays(t, 3) }
  ];
}
demoSeed();

const wait = ms => new Promise(r => setTimeout(r, ms));
function demoLog(what, item, date) { demo.log.unshift({ when: TODAY + ' ' + pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()), who: S.session ? S.session.name : 'Demo', what, item, date }); }

async function demoApi(action, p) {
  await wait(120);
  if (DEMO_OFFLINE) throw new ApiError("Can't reach the diary. Check your signal or wifi and try again. Nothing was changed.");
  if (action === 'login') {
    if (demo.fails >= 5) throw new ApiError('Too many wrong attempts. Try again in 15 minutes.');
    if (!String(p.name || '').trim()) throw new ApiError('Add your first name so changes show who made them.');
    if (String(p.code).trim() !== 'demo') { demo.fails++; throw new ApiError("That code isn't right. Check with the club secretary."); }
    demo.fails = 0;
    return { ok: true, token: 'demo-token', name: String(p.name).trim().slice(0, 40), expires: Date.now() + 30 * 864e5 };
  }
  if (action === 'check') return { ok: true, name: S.session.name, feed: 'https://example.invalid/this-is-a-demo-link.ics' };
  if (action === 'list') return { ok: true, events: demo.events.filter(e => e.date >= p.from && e.date <= p.to).map(e => Object.assign({}, e)), pending: [] };
  if (action === 'log') return { ok: true, log: demo.log.slice(0, 20) };
  if (action === 'save') {
    const x = p.event || {};
    if (!String(x.title || '').trim()) throw new ApiError('Give it a name so people know what it is.');
    if (!CATS[x.cat]) throw new ApiError('Choose a type for this item.');
    if (!x.date) throw new ApiError('Choose a date.');
    if (!x.start || !x.end) throw new ApiError('Add a start and finish time.');
    const rec = { date: x.date, start: x.start, end: x.end, allDay: false, title: x.title.trim().slice(0, 100), cat: x.cat, src: '', status: 'confirmed',
      notes: String(x.notes || '').slice(0, 1000), pub: x.cat === 'room' ? true : !!x.pub, room: x.cat === 'room' || !!x.room, by: S.session.name };
    if (x.id) {
      const cur = demo.events.find(e => e.id === x.id);
      if (!cur) throw new ApiError('Someone else has deleted this item.');
      Object.assign(cur, rec); demoLog('Edited', rec.title, rec.date); return { ok: true, event: Object.assign({}, cur) };
    }
    rec.id = 'demo' + (++demo.n); demo.events.push(rec); demoLog('Added', rec.title, rec.date);
    return { ok: true, event: Object.assign({}, rec) };
  }
  if (action === 'delete') {
    const i = demo.events.findIndex(e => e.id === p.id);
    if (i < 0) throw new ApiError('Someone else has already deleted this item.');
    const e = demo.events.splice(i, 1)[0]; demoLog('Deleted', e.title, e.date); return { ok: true };
  }
  throw new ApiError('Unknown action.');
}

/* ---------- start ---------- */
function boot() {
  if (DEMO) $('demoBar').hidden = false;
  if (!DEMO && !HAS_BACKEND) return showOnly('noBackend');
  if (!DEMO) {
    try {
      const s = JSON.parse(store('ecc-diary-session') || 'null');
      if (s && s.token && s.expires > Date.now()) { S.session = s; return startApp(); }
    } catch (e) {}
    store('ecc-diary-session', null);
  }
  showSignin();
}
boot();
})();
