/**
 * MTLL Challenger Buddies — Sign-up back end
 * File: Code.gs  (public API + shared helpers)
 *
 * The sign-up page lives on GitHub Pages (Settings > Public Page URL). It talks
 * to this script through doPost(), which can ONLY call the functions listed in
 * PUBLIC_API_ below. Admin functions live in Admin.gs, run from the Sheet's
 * Buddies menu, and every one of them checks requireAdmin_() first.
 *
 * Updating this file: Deploy > Manage deployments > pencil > Version: New version
 * > Deploy. (Keeps the same /exec link the page uses. Never "New deployment".)
 */

const TAB = {
  SETTINGS: 'Settings',
  SLOTS: 'Slots',
  SIGNUPS: 'Signups',
  LOG: 'Broadcast Log'
};

const SLOT_HEADERS   = ['Slot ID', 'Date', 'Location', 'Address', 'Start', 'End', 'Role', 'Capacity', 'Status', 'Notes'];
const SIGNUP_HEADERS = ['Signup ID', 'Submitted', 'Slot ID', 'Slot', 'Name', 'Volunteers', 'Comment', 'Email', 'Cell', 'Texts OK', 'Status', 'Updated', 'Token', 'Code'];
const LOG_HEADERS    = ['Sent', 'Type', 'Audience', 'Channels', 'Subject', 'Message', 'Emails Sent', 'Texts Sent', 'Problems'];


/* =========================================================================
 * WEB PAGE
 * ========================================================================= */

/** Old links to the Google web app (including ?t= email shortcuts) forward to the GitHub page. */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const token = String(params.t || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
  let page = '';
  try { page = String(getSettings_()['Public Page URL'] || '').trim(); } catch (err) { /* setup not run yet */ }
  if (!/^https:\/\//.test(page) || /script\.google/.test(page)) {
    return HtmlService.createHtmlOutput('<p style="font-family:Arial,sans-serif">The sign-up page address has not been set yet ' +
      '(Settings &gt; Public Page URL).</p>');
  }
  const url = page + (token ? (page.indexOf('?') >= 0 ? '&' : '?') + 't=' + token : '');
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><base target="_top"><meta charset="utf-8"></head>' +
    '<body style="font-family:Arial,sans-serif;text-align:center;padding:40px 16px;color:#1d1d2b">' +
    '<h2 style="color:#2B3187">The Buddy sign-up page has moved</h2>' +
    '<p><a href="' + esc_(url) + '" style="display:inline-block;margin-top:8px;padding:12px 22px;border-radius:6px;background:#D3202A;color:#fff;font-weight:bold;text-decoration:none">Go to the sign-up page &rarr;</a></p>' +
    '<script>try{window.top.location.replace(' + JSON.stringify(url) + ')}catch(e){}</script></body></html>')
    .setTitle('MTLL Challenger Buddies')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * The page sends {fn, args} as plain text (no CORS preflight) and gets JSON back.
 * Only these functions can be reached from the internet.
 */
const PUBLIC_API_ = {
  getPageData: getPageData, submitSignup: submitSignup, getMySignup: getMySignup,
  lookupMySignup: lookupMySignup, updateMySignup: updateMySignup, cancelMySignup: cancelMySignup
};

function doPost(e) {
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!Object.prototype.hasOwnProperty.call(PUBLIC_API_, req.fn)) throw new Error('Unknown request.');
    out = PUBLIC_API_[req.fn].apply(null, Array.isArray(req.args) ? req.args : []);
  } catch (err) {
    out = { __error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out === undefined ? null : out))
    .setMimeType(ContentService.MimeType.JSON);
}


/* =========================================================================
 * PUBLIC API  (callable from the sign-up page)
 * Never returns email addresses or phone numbers of other people.
 * ========================================================================= */

/** Everything the public page needs to draw itself. */
function getPageData() {
  const s = getSettings_();
  const today = dayKey_(new Date());

  // Backup: give any newly typed Slots rows an ID (normally done by onEdit).
  const lock = LockService.getScriptLock();
  if (lock.tryLock(3000)) { try { ensureSlotIds_(); } finally { lock.releaseLock(); } }

  const counts = {}, people = {};
  activeSignups_().forEach(r => {
    const id = String(r['Slot ID']);
    const qty = qtyOf_(r);
    counts[id] = (counts[id] || 0) + qty;
    (people[id] = people[id] || []).push({
      name: String(r['Name'] || ''),
      qty: qty,
      comment: String(r['Comment'] || '')
    });
  });

  const hidePast = yes_(s['Hide Past Dates']);
  const days = [], byKey = {};
  loadSlots_().forEach(sl => {
    const past = sl.dayKey < today;
    if (past && hidePast) return;
    let day = byKey[sl.dayKey];
    if (!day) {
      day = byKey[sl.dayKey] = {
        key: sl.dayKey, date: sl.dateText, weekday: sl.weekday,
        location: sl.location, address: sl.address, past: past, slots: []
      };
      days.push(day);
    }
    const filled = counts[sl.id] || 0;
    day.slots.push({
      id: sl.id, start: sl.start, end: sl.end, role: sl.role,
      capacity: sl.capacity, filled: filled, left: Math.max(0, sl.capacity - filled),
      status: sl.status, notes: sl.notes,
      location: sl.location !== day.location ? sl.location : '',
      signups: people[sl.id] || []
    });
  });

  return {
    title: String(s['Page Title'] || 'MTLL Challenger Buddies'),
    org: String(s['Organization'] || 'MTLL Challenger'),
    description: String(s['Description'] || ''),
    coordinator: String(s['Coordinator Name'] || ''),
    contactEmail: String(s['Coordinator Email'] || ''),
    signupsOpen: !no_(s['Sign-Ups Open']),
    tzLabel: Utilities.formatDate(new Date(), tz_(), 'z'),
    days: days
  };
}

/** Create a sign-up. form = {slotId, qty, name, comment, email, phone, textsOk, website(honeypot)} */
function submitSignup(form) {
  form = form || {};
  if (form.website) return { ok: true, email: '', emailed: true }; // bot filled the hidden field

  const s = getSettings_();
  if (no_(s['Sign-Ups Open'])) throw new Error('Sign-ups are closed right now.');

  const name    = cleanText_(form.name, 60);
  const comment = cleanText_(form.comment, 200);
  const email   = String(form.email || '').trim().toLowerCase().slice(0, 120);
  const phone   = formatPhone_(form.phone);
  const qty     = parseInt(form.qty, 10);
  const textsOk = form.textsOk === true || form.textsOk === 'true' || form.textsOk === 'on';

  if (!name) throw new Error('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error('Please enter a valid email address.');
  if (!phone) throw new Error('Please enter a 10-digit cell number.');
  if (!(qty >= 1 && qty <= 99)) throw new Error('Please enter how many volunteers you are bringing.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The sign-up sheet is busy. Please try again in a moment.');
  let slot, token, code;
  try {
    slot = findSlot_(form.slotId);
    if (!slot) throw new Error('That time slot no longer exists. Please refresh the page.');
    if (slot.status !== 'Open') throw new Error('That time slot is ' + slot.status.toLowerCase() + '.');
    if (slot.dayKey < dayKey_(new Date())) throw new Error('That date has already passed.');

    const active = activeSignups_();
    const mine = active.filter(r => String(r['Slot ID']) === slot.id);
    if (mine.some(r => String(r['Email']).toLowerCase() === email)) {
      throw new Error("You're already signed up for this slot. Use the link in your confirmation email to change your count.");
    }
    const left = slot.capacity - mine.reduce((a, r) => a + qtyOf_(r), 0);
    if (left <= 0) throw new Error('Sorry, this slot just filled up. Please pick another one.');
    if (qty > left) throw new Error('Only ' + left + (left === 1 ? ' spot is' : ' spots are') + ' left in this slot.');

    token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    code = newCode_(active.concat(readTable_(TAB.SIGNUPS)));
    appendRecord_(TAB.SIGNUPS, {
      'Signup ID': newId_('S'),
      'Submitted': new Date(),
      'Slot ID': slot.id,
      'Slot': slotLabel_(slot),
      'Name': asText_(name),
      'Volunteers': qty,
      'Comment': asText_(comment),
      'Email': asText_(email),
      'Cell': asText_(phone),
      'Texts OK': textsOk ? 'Yes' : 'No',
      'Status': 'Active',
      'Updated': '',
      'Token': token,
      'Code': code
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  let emailed = true;
  try {
    sendConfirmation_(slot, { name: name, qty: qty, comment: comment, email: email, textsOk: textsOk, token: token, code: code }, s);
  } catch (err) {
    emailed = false;
    console.error('Confirmation email failed: ' + err);
  }
  return { ok: true, email: email, emailed: emailed };
}

/** Look up a sign-up from the private link in the confirmation email. */
function getMySignup(token) {
  const r = findByToken_(token);
  if (!r) return null;
  const slot = findSlot_(r['Slot ID']);
  const cancelled = /cancel/i.test(r['Status']);
  const others = activeSignups_()
    .filter(x => String(x['Slot ID']) === String(r['Slot ID']) && x._row !== r._row)
    .reduce((a, x) => a + qtyOf_(x), 0);
  const editable = !!slot && slot.status === 'Open' && slot.dayKey >= dayKey_(new Date()) && !cancelled;
  return {
    name: String(r['Name'] || ''),
    qty: qtyOf_(r),
    comment: String(r['Comment'] || ''),
    email: mask_(r['Email']),
    slotLabel: slot ? slotLabel_(slot) : String(r['Slot'] || ''),
    slotStatus: slot ? slot.status : 'Removed',
    cancelled: cancelled,
    editable: editable,
    maxQty: slot ? Math.max(1, slot.capacity - others) : qtyOf_(r)
  };
}

/**
 * "Change or cancel my sign-up" on the page: email + the 6-character code from
 * the confirmation email. Returns the private token the page uses from then on.
 * Limited to 10 tries per email per hour to stop guessing.
 */
function lookupMySignup(email, code) {
  email = String(email || '').trim().toLowerCase().slice(0, 120);
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!email || code.length !== 6) throw new Error('Please enter your email and the 6-character code from your confirmation email.');
  const cache = CacheService.getScriptCache();
  const key = 'lookup:' + email;
  const tries = parseInt(cache.get(key) || '0', 10);
  if (tries >= 10) throw new Error('Too many tries. Please wait an hour, or contact the coordinator.');
  cache.put(key, String(tries + 1), 3600);
  const r = readTable_(TAB.SIGNUPS).filter(x =>
    String(x['Code']).toUpperCase() === code && String(x['Email']).trim().toLowerCase() === email)[0];
  if (!r || !r['Token']) throw new Error("We couldn't find a sign-up with that email and code. Check your confirmation email and try again.");
  return { token: String(r['Token']) };
}

/** Change the volunteer count and/or comment. changes = {qty, comment} */
function updateMySignup(token, changes) {
  changes = changes || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The sign-up sheet is busy. Please try again in a moment.');
  try {
    const r = findByToken_(token);
    if (!r) throw new Error("We couldn't find that sign-up.");
    const info = getMySignup(token);
    if (!info.editable) throw new Error('This sign-up can no longer be changed.');
    const qty = parseInt(changes.qty, 10);
    if (!(qty >= 1)) throw new Error('Please enter how many volunteers you are bringing.');
    if (qty > info.maxQty) throw new Error('Only ' + info.maxQty + ' spots are available for you in this slot.');
    updateRecord_(TAB.SIGNUPS, r._row, {
      'Volunteers': qty,
      'Comment': asText_(cleanText_(changes.comment, 200)),
      'Updated': new Date()
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return getMySignup(token);
}

/** Cancel a sign-up from the private link. */
function cancelMySignup(token) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('The sign-up sheet is busy. Please try again in a moment.');
  let r;
  try {
    r = findByToken_(token);
    if (!r) throw new Error("We couldn't find that sign-up.");
    if (/cancel/i.test(r['Status'])) return getMySignup(token);
    updateRecord_(TAB.SIGNUPS, r._row, { 'Status': 'Cancelled', 'Updated': new Date() });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  try {
    const s = getSettings_();
    if (!no_(s['Notify Me Of Cancellations']) && s['Coordinator Email']) {
      MailApp.sendEmail({
        to: String(s['Coordinator Email']),
        subject: 'Buddy cancellation: ' + r['Name'] + ' (' + qtyOf_(r) + ')',
        htmlBody: emailShell_('<p><b>' + esc_(r['Name']) + '</b> cancelled their sign-up of <b>' + qtyOf_(r) +
          '</b> volunteer(s) for <b>' + esc_(r['Slot']) + '</b>.</p>', s),
        name: senderName_(s)
      });
    }
  } catch (err) { console.error('Cancel notice failed: ' + err); }
  return getMySignup(token);
}


/* =========================================================================
 * SHEET HELPERS
 * ========================================================================= */

function ss_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* no active sheet in this context */ }
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) throw new Error('Setup has not been run yet.');
    ss = SpreadsheetApp.openById(id);
  }
  return ss;
}

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('The "' + name + '" tab is missing. In the Sheet, run Buddies > Setup / repair tabs.');
  return sh;
}

function headers_(sh) {
  const n = sh.getLastColumn();
  return n ? sh.getRange(1, 1, 1, n).getValues()[0].map(h => String(h).trim()) : [];
}

function headerIndex_(sh) {
  const map = {};
  headers_(sh).forEach((h, i) => { if (h) map[h] = i + 1; });
  return map;
}

/** Rows as objects keyed by header name; each has _row (sheet row number). */
function readTable_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(h => String(h).trim());
  return values.map((row, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, j) => { if (h) obj[h] = row[j]; });
    return obj;
  });
}

function appendRecord_(name, rec) {
  const sh = sheet_(name);
  sh.appendRow(headers_(sh).map(h => (h in rec ? rec[h] : '')));
}

function updateRecord_(name, rowNum, changes) {
  const sh = sheet_(name);
  const idx = headerIndex_(sh);
  Object.keys(changes).forEach(k => { if (idx[k]) sh.getRange(rowNum, idx[k]).setValue(changes[k]); });
}

function getSettings_() {
  const out = {};
  sheet_(TAB.SETTINGS).getDataRange().getValues().slice(1).forEach(r => {
    if (r[0]) out[String(r[0]).trim()] = (typeof r[1] === 'string') ? r[1].trim() : r[1];
  });
  return out;
}

/** Assign an ID to any Slots row that has a date but no ID. */
function ensureSlotIds_() {
  const sh = sheet_(TAB.SLOTS);
  const idx = headerIndex_(sh);
  const last = sh.getLastRow();
  if (last < 2 || !idx['Slot ID'] || !idx['Date']) return;
  const ids = sh.getRange(2, idx['Slot ID'], last - 1, 1).getValues();
  const dates = sh.getRange(2, idx['Date'], last - 1, 1).getValues();
  let changed = false;
  ids.forEach((r, i) => { if (!r[0] && dates[i][0]) { r[0] = newId_('T'); changed = true; } });
  if (changed) sh.getRange(2, idx['Slot ID'], last - 1, 1).setValues(ids);
}

/** All slots with a valid date and ID, sorted by date then start time. */
function loadSlots_() {
  const tz = tz_();
  return readTable_(TAB.SLOTS).map(r => {
    const d = asDate_(r['Date']);
    if (!d || !r['Slot ID']) return null;
    const st = String(r['Status'] || '');
    return {
      row: r._row,
      id: String(r['Slot ID']),
      date: d,
      dayKey: dayKey_(d),
      dateText: Utilities.formatDate(d, tz, 'MM/dd/yyyy'),
      weekday: Utilities.formatDate(d, tz, 'EEEE'),
      location: String(r['Location'] || ''),
      address: String(r['Address'] || ''),
      start: timeText_(r['Start']),
      end: timeText_(r['End']),
      sort: minutes_(r['Start']),
      role: String(r['Role'] || 'Buddy'),
      capacity: Math.max(0, parseInt(r['Capacity'], 10) || 0),
      status: /cancel/i.test(st) ? 'Cancelled' : (/clos/i.test(st) ? 'Closed' : 'Open'),
      notes: String(r['Notes'] || '')
    };
  }).filter(Boolean).sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : a.sort - b.sort));
}

function findSlot_(id) {
  id = String(id || '');
  return loadSlots_().filter(x => x.id === id)[0] || null;
}

function activeSignups_() {
  return readTable_(TAB.SIGNUPS).filter(r => r['Slot ID'] && !/cancel/i.test(r['Status']));
}

/** 6-character code (no look-alike letters/numbers), unique among existing rows. */
function newCode_(rows) {
  const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const used = {};
  (rows || []).forEach(r => { if (r['Code']) used[String(r['Code']).toUpperCase()] = true; });
  for (let i = 0; i < 50; i++) {
    const hex = Utilities.getUuid().replace(/-/g, '');
    let c = '';
    for (let j = 0; j < 6; j++) c += ABC[parseInt(hex.substr(j * 2, 2), 16) % ABC.length];
    if (!used[c]) return c;
  }
  throw new Error('Could not create a sign-up code. Please try again.');
}

/** Give a code to any sign-up row that doesn't have one (rows from before codes existed). */
function ensureCodes_() {
  const sh = sheet_(TAB.SIGNUPS);
  const idx = headerIndex_(sh);
  const last = sh.getLastRow();
  if (last < 2 || !idx['Code']) return;
  const rows = readTable_(TAB.SIGNUPS);
  const range = sh.getRange(2, idx['Code'], last - 1, 1);
  const vals = range.getValues();
  let changed = false;
  vals.forEach((v, i) => {
    if (!v[0] && rows[i] && rows[i]['Slot ID']) { v[0] = newCode_(rows); rows[i]['Code'] = v[0]; changed = true; }
  });
  if (changed) range.setValues(vals);
}

function findByToken_(token) {
  token = String(token || '').replace(/[^A-Za-z0-9]/g, '');
  if (token.length < 20) return null;
  return readTable_(TAB.SIGNUPS).filter(r => String(r['Token']) === token)[0] || null;
}


/* =========================================================================
 * EMAIL
 * ========================================================================= */

function senderName_(s) {
  return String(s['Organization'] || 'MTLL Challenger') + ' Buddies';
}

function webAppUrl_(s) {
  let base = String((s || getSettings_())['Web App URL'] || '').trim();
  if (!base) { try { base = ScriptApp.getService().getUrl() || ''; } catch (e) { /* not deployed */ } }
  return base;
}

/** The address people should use: the GitHub page if set, otherwise the /exec link. */
function publicUrl_(s) {
  const site = String((s || getSettings_())['Public Page URL'] || '').trim();
  return site || webAppUrl_(s);
}

function manageUrl_(token, s) {
  const base = publicUrl_(s);
  return base ? base + (base.indexOf('?') >= 0 ? '&' : '?') + 't=' + token : '';
}

function mailOptions_(s, opts) {
  opts.name = senderName_(s);
  // A plain-text copy alongside the HTML helps stricter providers (Yahoo/Verizon/AOL) accept the message.
  if (!opts.body && opts.htmlBody) opts.body = htmlToText_(opts.htmlBody);
  if (s['Coordinator Email']) opts.replyTo = String(s['Coordinator Email']);
  return opts;
}

function sendConfirmation_(slot, rec, s) {
  const link = manageUrl_(rec.token, s);
  const body =
    '<p>Hi ' + esc_(rec.name) + ',</p>' +
    '<p>Thanks for signing up to be a <b>' + esc_(slot.role) + '</b>! Here are your details:</p>' +
    detailsTable_(slot, rec.qty, rec.comment) +
    manageBlock_(rec.code, link, s) +
    '<p>If a game is cancelled or moved (weather, field conditions), we\'ll email you' +
    (rec.textsOk ? ' and send a text' : '') + '.</p>' +
    '<p>Thank you for helping our Challenger athletes!</p>';
  MailApp.sendEmail(mailOptions_(s, {
    to: rec.email,
    subject: "You're signed up: " + slot.weekday + ' ' + slot.dateText + ', ' + slot.start,
    htmlBody: emailShell_(body, s)
  }));
}

/** How to change/cancel: the sign-up code (works from the Google Site) plus a direct link. */
function manageBlock_(code, link, s) {
  const page = publicUrl_(s);
  let h = '';
  if (code) {
    h += '<div style="margin:20px 0;padding:12px 14px;background:#eef0fa;border-radius:8px">' +
      '<div style="font-size:13px;color:#555">Your sign-up code</div>' +
      '<div style="font-size:24px;font-weight:bold;letter-spacing:3px;color:#2B3187">' + esc_(code) + '</div>' +
      '<div style="font-size:13px;color:#555;margin-top:4px">To change or cancel, go to the ' +
      (page ? '<a href="' + esc_(page) + '">sign-up page</a>' : 'sign-up page') +
      ', tap <b>Change or cancel my sign-up</b>, and enter this email address and code.</div></div>';
  }
  if (link) h += '<p style="font-size:13px;color:#555">Shortcut: <a href="' + link + '">open my sign-up directly</a></p>';
  return h;
}

function detailsTable_(slot, qty, comment) {
  const row = (k, v) => '<tr><td style="padding:4px 12px 4px 0;color:#666">' + k + '</td><td style="padding:4px 0"><b>' + v + '</b></td></tr>';
  return '<table style="border-collapse:collapse;font-size:15px">' +
    row('Date', esc_(slot.weekday + ', ' + slot.dateText)) +
    row('Time', esc_(slot.start + ' – ' + slot.end)) +
    row('Where', esc_(slot.location) + (slot.address ? '<br><span style="font-weight:normal">' + esc_(slot.address) + '</span>' : '')) +
    (qty ? row('Volunteers', esc_(qty)) : '') +
    (comment ? row('Comment', esc_(comment)) : '') +
    '</table>';
}

function emailShell_(inner, s) {
  const who = s && s['Coordinator Name'] ? esc_(s['Coordinator Name']) + ', Buddy Coordinator' : 'Buddy Coordinator';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1d1d2b;max-width:560px">' +
    '<div style="border-top:5px solid #2B3187;padding-top:12px;margin-bottom:12px;color:#2B3187;font-weight:bold;font-size:17px">' +
    esc_((s && s['Organization']) || 'MTLL Challenger') + ' Buddies</div>' +
    inner +
    '<p style="color:#666;font-size:13px;margin-top:24px">— ' + who + '</p></div>';
}


/* =========================================================================
 * SMALL UTILITIES
 * ========================================================================= */

function tz_() { return Session.getScriptTimeZone() || 'America/New_York'; }
function dayKey_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function newId_(prefix) { return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase(); }
function yes_(v) { return /^\s*(y|true)/i.test(String(v)); }
function no_(v) { return /^\s*(n|false)/i.test(String(v)); }
function qtyOf_(r) { return Math.max(1, parseInt(r['Volunteers'], 10) || 1); }

function asDate_(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (v) { const d = new Date(v); if (!isNaN(d)) return d; }
  return null;
}

/** "11:45am" style text from a cell that may hold text or a time value. */
function timeText_(v) {
  if (v instanceof Date) {
    let h = v.getHours(); const m = v.getMinutes();
    const ap = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return h + ':' + ('0' + m).slice(-2) + ap;
  }
  return String(v || '').replace(/^'/, '').trim().toLowerCase().replace(/\s+/g, '');
}

function minutes_(v) {
  const m = timeText_(v).match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return 9999;
  let h = parseInt(m[1], 10) % 12;
  if (m[3] && m[3][0] === 'p') h += 12;
  return h * 60 + parseInt(m[2] || '0', 10);
}

function slotLabel_(sl) {
  return sl.weekday.slice(0, 3) + ' ' + sl.dateText + ', ' + sl.start + '–' + sl.end + ' @ ' + sl.location;
}

function cleanText_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Force Sheets to store user input as plain text (blocks formulas like =IMPORT...). */
function asText_(v) { v = String(v == null ? '' : v); return v ? "'" + v : ''; }

function formatPhone_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length !== 10) return '';
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}

function mask_(email) {
  const e = String(email || ''); const at = e.indexOf('@');
  return at > 1 ? e[0] + '•••' + e.slice(at) : e;
}

function htmlToText_(html) {
  return String(html)
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2: $1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|div|table|h\d)>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<hr[^>]*>/gi, '\n----\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function esc_(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
