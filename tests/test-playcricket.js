// Checks the Play-Cricket sync in apps-script/Code.gs against a pretend calendar and pretend Play-Cricket replies.
// No network, no token. Run from the repo folder:  node tests/test-playcricket.js
'use strict';
process.env.TZ = process.env.TZ || 'Europe/London'; // the checks must give the same answer whatever zone the script runs in
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, failed = 0;
function ok(cond, label) { if (cond) pass++; else { failed++; console.log('FAIL: ' + label); } }
function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')'); }

/* A pretend calendar event */
function fakeEvent(title, start, end, o) {
  const tags = {}; let t = title, s = start, e = end, loc = (o && o.location) || '', desc = (o && o.description) || '', allDay = !!(o && o.allDay), gone = false;
  return {
    getTitle: () => t, setTitle: x => { t = x; }, getLocation: () => loc, setLocation: x => { loc = x; },
    getDescription: () => desc, setDescription: x => { desc = x; }, isAllDayEvent: () => allDay,
    getStartTime: () => s, getEndTime: () => e,
    setTime: (a, b) => { s = a; e = b; allDay = false; }, setAllDayDate: a => { s = a; e = new Date(a.getTime() + 864e5); allDay = true; },
    getTag: k => (k in tags ? tags[k] : null), setTag: (k, v) => { tags[k] = v; },
    deleteEvent: () => { gone = true; }, isGone: () => gone, getId: () => 'id' + Math.random()
  };
}

function setup(matchesBySeason, props) {
  const events = [];
  const cal = {
    getEvents: (a, b) => events.filter(e => !e.isGone() && e.getStartTime() >= a && e.getStartTime() < b),
    createEvent: (t, s, e, o) => { const ev = fakeEvent(t, s, e, o); events.push(ev); return ev; },
    createAllDayEvent: (t, d, o) => { const ev = fakeEvent(t, d, new Date(d.getTime() + 864e5), Object.assign({ allDay: true }, o)); events.push(ev); return ev; }
  };
  const logs = [], attention = [];
  const ctx = vm.createContext({ console: { log() {}, error() {} } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
  const P = Object.assign({ PLAYCRICKET_TOKEN: 'secrettoken', PLAYCRICKET_SITE_ID: '2558' }, props || {});
  ctx.todayIso_ = () => '2026-11-18';
  ctx.prop_ = k => { if (!P[k]) throw new Error('Missing Script Property ' + k); return P[k]; };
  ctx.cal_ = () => cal;
  ctx.bumpCache_ = () => {};
  ctx.log_ = (who, what, item) => logs.push([who, what, item]);
  ctx.needsAttention_ = item => attention.push(item);
  ctx.Logger = { log() {} };
  ctx.Utilities = { formatDate: (d, tz, f) => d.toLocaleDateString('en-CA', { timeZone: tz }) };
  ctx.TZ = 'Europe/London';
  ctx.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  const fetched = [];
  const fetchOpts = [];
  ctx.UrlFetchApp = { fetch: (url, o) => {
    fetched.push(url); fetchOpts.push(o);
    const season = /season=(\d+)/.exec(url)[1];
    const r = matchesBySeason[season];
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return { getResponseCode: () => r, getContentText: () => 'nope' };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ matches: r || [] }) };
  } };
  return { ctx, events, logs, attention, fetched, fetchOpts, live: () => events.filter(e => !e.isGone()) };
}

const M = o => Object.assign({ id: 1, status: 'New', published: 'Yes', match_date: '25/04/2027', match_time: '13:00',
  competition_type: 'League', league_name: 'Yorkshire Cricket Southern Premier League', competition_name: 'Division Two', match_type: 'Limited Overs',
  ground_name: 'Elsecar Cricket Club S74 8ES', home_club_name: 'Elsecar CC', home_team_name: '1st XI', home_club_id: '2558',
  away_club_name: 'Barnsley CC', away_team_name: '2nd XI', away_club_id: '99', umpire_1_name: 'Some Person' }, o);

/* pure conversion */
{
  const { ctx } = setup({});
  const h = ctx.pcMatchToEvent_(M(), '2558');
  eq([h.pcid, h.date, h.start, h.title, h.home], ['1', '2027-04-25', '13:00', 'Elsecar 1st XI v Barnsley CC 2nd XI (H)', true], 'home fixture');
  ok(h.notes.indexOf('Some Person') < 0, 'no umpire name in the event');
  const a = ctx.pcMatchToEvent_(M({ id: 2, home_club_id: '99', home_club_name: 'Barnsley CC', home_team_name: '2nd XI', away_club_id: '2558', away_club_name: 'Elsecar CC', away_team_name: 'Under 13', ground_name: 'Barnsley ground' }), '2558');
  eq([a.title, a.home, a.location], ['Elsecar Under 13 v Barnsley CC 2nd XI (A)', false, 'Barnsley ground'], 'away fixture');
  eq(ctx.pcMatchToEvent_(M({ home_club_id: '5', away_club_id: '6' }), '2558'), null, 'not our match');
  eq(ctx.pcMatchToEvent_(M({ status: 'Cancelled' }), '2558'), null, 'cancelled match');
  eq(ctx.pcMatchToEvent_(M({ published: 'No' }), '2558'), null, 'unpublished match');
  eq(ctx.pcMatchToEvent_(M({ match_date: 'soon' }), '2558'), null, 'bad date');
  eq(ctx.pcMatchToEvent_(M({ match_time: '' }), '2558').start, '', 'no time means all day');
  const inside = ctx.pcMatchToEvent_(M({ away_club_id: '2558', away_team_name: 'U9 Blue', away_club_name: 'Elsecar CC' }), '2558');
  eq(inside.title, 'Elsecar 1st XI v Elsecar U9 Blue (H)', 'two Elsecar sides');
}

/* create, then re-run: no duplicates */
{
  const s = setup({ 2026: [M({ id: 10, match_date: '18/11/2026' })], 2027: [M({ id: 11 }), M({ id: 12, match_time: '' })] });
  const r1 = s.ctx.syncPlayCricket();
  eq([r1.ok, r1.created, s.live().length], [true, 3, 3], 'first run creates three');
  const ev = s.live().find(e => e.getTag('pcid') === '11');
  eq([ev.getTag('src'), ev.getTag('cat'), ev.getTag('pub'), ev.getTag('room'), ev.getTag('tea')], ['play-cricket', 'cricket', '1', null, null], 'tags (no room tags, which count as no room)');
  ok(s.ctx.roomsOfTags_('cricket', ev.getTag('room'), ev.getTag('tea')).length === 0, 'a fixture takes no room');
  ok(s.fetchOpts.every(o => o.followRedirects === false), 'redirects are not followed');
  ok(s.live().find(e => e.getTag('pcid') === '12').isAllDayEvent(), 'all day event made');
  ok(s.fetched.every(u => u.indexOf('site_id=2558') >= 0) && s.fetched.length === 2, 'asked for this season and next');
  const r2 = s.ctx.syncPlayCricket();
  eq([r2.created, r2.updated, r2.unchanged, s.live().length], [0, 0, 3, 3], 're-run changes nothing');
  eq(s.logs.length, 1, 'only the first run is logged');
}

/* update, remove, and never touch other events */
{
  const s = setup({ 2026: [], 2027: [M({ id: 11 }), M({ id: 13 })] });
  const mine = fakeEvent('Committee meeting', new Date(2027, 3, 1, 19), new Date(2027, 3, 1, 20)); mine.setTag('cat', 'meet');
  const pcNoId = fakeEvent('Hand made fixture', new Date(2027, 3, 2, 12), new Date(2027, 3, 2, 19)); pcNoId.setTag('src', 'play-cricket');
  const oldOne = fakeEvent('Old', new Date(2027, 3, 3, 12), new Date(2027, 3, 3, 19)); oldOne.setTag('src', 'play-cricket'); oldOne.setTag('pcid', '999');
  s.events.push(mine, pcNoId, oldOne);
  const r = s.ctx.syncPlayCricket();
  eq([r.ok, r.created, r.removed], [true, 2, 1], 'creates two and removes the one no longer in Play-Cricket');
  ok(!mine.isGone() && !pcNoId.isGone(), 'events the sync did not create are untouched');
  ok(oldOne.isGone(), 'removed match is gone');
  // time moves, match cancelled
  s.ctx.UrlFetchApp.fetch = (url) => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ matches: /season=2027/.test(url) ? [M({ id: 11, match_time: '14:00' }), M({ id: 13, status: 'Cancelled' })] : [] }) });
  const r2 = s.ctx.syncPlayCricket();
  eq([r2.updated, r2.removed, s.live().filter(e => e.getTag('pcid')).length], [1, 1, 1], 'time change updates, cancelled match removed');
  eq(s.live().find(e => e.getTag('pcid') === '11').getStartTime().toISOString(), '2027-04-25T13:00:00.000Z', 'moved to 2pm BST');
}

/* past fixtures are ignored and past events are left alone */
{
  const s = setup({ 2026: [M({ id: 30, match_date: '17/11/2026' }), M({ id: 31, match_date: '18/11/2026' })], 2027: [] });
  const old = fakeEvent('Old fixture', new Date(2026, 8, 1, 12), new Date(2026, 8, 1, 19)); old.setTag('src', 'play-cricket'); old.setTag('pcid', '555');
  s.events.push(old);
  const r = s.ctx.syncPlayCricket();
  eq([r.created, r.removed, old.isGone()], [1, 0, false], 'yesterday ignored, today added, past event kept');
  eq(s.live().filter(e => e.getTag('pcid') === '30').length, 0, 'finished match not added');
  // safety check counts future fixtures only: 7 past ones missing from the feed do not trigger it
  const s2 = setup({ 2026: [], 2027: [M({ id: 41 })] });
  const past = [1, 2, 3, 4, 5, 6, 7].map(i => { const e = fakeEvent('P' + i, new Date(2026, 5, i, 12), new Date(2026, 5, i, 19)); e.setTag('src', 'play-cricket'); e.setTag('pcid', String(200 + i)); return e; });
  s2.events.push(...past);
  const r2 = s2.ctx.syncPlayCricket();
  ok(r2.ok && r2.created === 1 && past.every(e => !e.isGone()), 'past events never removed or counted');
}

/* failures leave the calendar alone */
{
  const keep = (label, matches, props, wantText) => {
    const s = setup(matches, props);
    const e = fakeEvent('Existing', new Date(2027, 3, 1, 12), new Date(2027, 3, 1, 19)); e.setTag('src', 'play-cricket'); e.setTag('pcid', '5');
    s.events.push(e);
    const r = s.ctx.syncPlayCricket();
    ok(r.ok === false && !e.isGone() && s.live().length === 1, label + ': calendar unchanged');
    ok(s.attention.length === 1 && /Play-Cricket sync did not run/.test(s.attention[0]), label + ': logged for the committee');
    ok(s.attention.join(' ').indexOf('secrettoken') < 0 && r.error.indexOf('secrettoken') < 0, label + ': token not in the message');
    if (wantText) ok(r.error.indexOf(wantText) >= 0, label + ': message says ' + wantText + ' (' + r.error + ')');
  };
  keep('401', { 2026: 401, 2027: [] }, null, 'code 401');
  keep('network error mentioning the address', { 2026: [], 2027: new Error('Exception: DNS error: https://x/?api_token=secrettoken') }, null, 'could not reach');
  keep('missing token', { 2026: [], 2027: [] }, { PLAYCRICKET_TOKEN: '' }, 'PLAYCRICKET_TOKEN');
  keep('second season fails after first worked', { 2026: [M({ id: 5, match_date: '05/12/2026' })], 2027: 500 }, null, 'code 500');
  // a feed that wipes most fixtures
  const s = setup({ 2026: [], 2027: [] });
  const evs = [1, 2, 3, 4, 5, 6, 7].map(i => { const e = fakeEvent('F' + i, new Date(2027, 3, i, 12), new Date(2027, 3, i, 19)); e.setTag('src', 'play-cricket'); e.setTag('pcid', String(100 + i)); return e; });
  s.events.push(...evs);
  const r = s.ctx.syncPlayCricket();
  ok(r.ok === false && evs.every(e => !e.isGone()), 'an empty feed does not wipe the fixtures');
}

/* dry run changes nothing */
{
  const s = setup({ 2026: [], 2027: [M({ id: 21 })] });
  const r = s.ctx.dryRunPlayCricket();
  eq([r.ok, r.created, s.live().length, s.logs.length], [true, 1, 0, 0], 'dry run reports but creates nothing');
}

/* result codes, odd ids, links, 00:00 */
{
  const { ctx } = setup({});
  ['C', 'A', 'CON', 'c'].forEach(c => eq(ctx.pcMatchToEvent_(M({ result: c }), '2558'), null, 'result ' + c + ' is gone'));
  ok(ctx.pcMatchToEvent_(M({ result: 'W' }), '2558') !== null, 'a result of W is not gone');
  eq(ctx.pcMatchToEvent_(M({ status: 'Deleted' }), '2558'), null, 'deleted status');
  ['__proto__', 'abc', '12345678901234', '', '1; drop'].forEach(i => eq(ctx.pcMatchToEvent_(M({ id: i }), '2558'), null, 'odd id ' + i));
  const l = ctx.pcMatchToEvent_(M({ ground_name: 'Pitch http://evil.example/x see www.evil.example now', away_team_name: 'XI https://a.b' }), '2558');
  ok(!/http|www.|evil/.test(l.title + l.location + l.notes), 'links are stripped (' + l.location + ' | ' + l.title + ')');
  eq(ctx.pcMatchToEvent_(M({ match_time: '00:00' }), '2558').start, '', '00:00 is all day');
}

/* London time whatever the zone */
{
  const { ctx } = setup({});
  const at = (d, t) => ctx.pcTimes_({ date: d, start: t }).start.toISOString();
  eq(at('2027-04-25', '13:00'), '2027-04-25T12:00:00.000Z', 'BST date');
  eq(at('2026-12-05', '13:00'), '2026-12-05T13:00:00.000Z', 'winter date');
  eq(at('2027-03-27', '13:00'), '2027-03-27T13:00:00.000Z', 'day before clocks go forward');
  eq(at('2027-03-28', '13:00'), '2027-03-28T12:00:00.000Z', 'clocks go forward day');
  eq(at('2026-10-24', '12:00'), '2026-10-24T11:00:00.000Z', 'day before clocks go back');
  eq(at('2026-10-25', '12:00'), '2026-10-25T12:00:00.000Z', 'clocks go back day');
  eq(ctx.pcTimes_({ date: '2027-04-25', start: '13:00' }).end.toISOString(), '2027-04-25T19:00:00.000Z', 'long match is 7 hours');
  const ad = ctx.pcTimes_({ date: '2027-04-25', start: '' });
  ok(ad.allDay && ad.start.getFullYear() === 2027 && ad.start.getDate() === 25, 'all day fixture');
  // a fixture moving to another date is updated in place
  const s = setup({ 2026: [], 2027: [M({ id: 50, match_date: '25/04/2027' })] });
  s.ctx.syncPlayCricket();
  s.ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ matches: [M({ id: 50, match_date: '02/05/2027' })] }) });
  const r = s.ctx.syncPlayCricket();
  eq([r.updated, r.created, s.live().length, s.live()[0].getStartTime().toISOString()], [1, 0, 1, '2027-05-02T12:00:00.000Z'], 'moved date updates, no duplicate');
}

/* safety limits and the time budget */
{
  // feed that is non-empty but drops 25 of 60: allowed by the half rule, capped at 20 removals
  const have = n => Array.from({ length: n }, (_, i) => { const e = fakeEvent('F' + i, new Date(2027, 5, 1 + (i % 28), 12), new Date(2027, 5, 1 + (i % 28), 19)); e.setTag('src', 'play-cricket'); e.setTag('pcid', String(1000 + i)); return e; });
  const keep = Array.from({ length: 35 }, (_, i) => M({ id: 1000 + i, match_date: String(1 + (i % 28)).padStart(2, '0') + '/06/2027' }));
  const s = setup({ 2026: [], 2027: keep });
  s.events.push(...have(60));
  const r = s.ctx.syncPlayCricket();
  eq([r.ok, r.removed, r.partial], [true, 20, true], 'removals capped at 20 a run');
  ok(/partly done: 0 created, [0-9]+ updated, 20 removed, then stopped because/.test(s.logs[0][2]), 'partial run is logged (' + s.logs[0][2] + ')');
  // time budget: the clock jumps 5 minutes after the first write
  const s2 = setup({ 2026: [], 2027: [M({ id: 61 }), M({ id: 62 }), M({ id: 63 })] });
  let clock = 0; s2.ctx.pcNow_ = () => clock;
  const mk = s2.ctx.pcWriteEvent_; s2.ctx.pcWriteEvent_ = (e, w) => { clock += 5 * 60 * 1000; return mk(e, w); };
  const r2 = s2.ctx.syncPlayCricket();
  eq([r2.created, r2.partial, s2.live().length], [1, true, 1], 'stops writing after the time budget');
  ok(/partly done: 1 created, 0 updated, 0 removed, then stopped because the time limit/.test(s2.logs[0][2]), 'time stop is logged');
  const r3 = (() => { s2.ctx.pcNow_ = () => 0; s2.ctx.pcWriteEvent_ = mk; return s2.ctx.syncPlayCricket(); })();
  eq([r3.created, r3.unchanged, s2.live().length], [2, 1, 3], 'the next run carries on');
}

console.log(pass + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
