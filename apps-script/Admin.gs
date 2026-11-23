/**
 * MTLL Challenger Buddies — Coordinator tools
 * File: Admin.gs  (the "Buddies" menu in the Sheet, broadcasts, reminders, setup)
 *
 * Every function here that isn't private (no trailing underscore) starts with
 * requireAdmin_(), so a public visitor can't run it from the sign-up page.
 */

/* =========================================================================
 * MENU + TRIGGERS
 * ========================================================================= */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Buddies')
    .addItem('Send a broadcast…', 'showBroadcast')
    .addItem('Add game dates…', 'showAddDates')
    .addSeparator()
    .addItem('Show sign-up page link', 'showPageLink')
    .addSeparator()
    .addItem('Turn reminders ON', 'enableReminders')
    .addItem('Turn reminders OFF', 'disableReminders')
    .addItem('Send reminders now', 'sendRemindersNow')
    .addSeparator()
    .addItem('Setup / repair tabs', 'setupSheet')
    .addToUi();
}

/** Simple trigger: new rows typed/pasted into Slots get an ID automatically. */
function onEdit(e) {
  try {
    const name = e && e.range ? e.range.getSheet().getName() : '';
    if (name === TAB.SLOTS) ensureSlotIds_();
    if (name === TAB.SIGNUPS) ensureCodes_();
  } catch (err) { /* ignore */ }
}

/** Only the account that owns the script (plus anyone in Settings > Admin Emails). */
function requireAdmin_() {
  const me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  let extra = [];
  try {
    extra = String(getSettings_()['Admin Emails'] || '').toLowerCase().split(/[\s,;]+/).filter(String);
  } catch (err) { /* Settings tab not created yet */ }
  if (!me || (me !== owner && extra.indexOf(me) < 0)) throw new Error('Not authorized.');
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}


/* =========================================================================
 * DIALOGS
 * ========================================================================= */

function showBroadcast() {
  requireAdmin_();
  const html = HtmlService.createHtmlOutputFromFile('Broadcast').setWidth(560).setHeight(680);
  SpreadsheetApp.getUi().showModalDialog(html, 'Send a broadcast');
}

function showAddDates() {
  requireAdmin_();
  const html = HtmlService.createHtmlOutputFromFile('AddDates').setWidth(520).setHeight(640);
  SpreadsheetApp.getUi().showModalDialog(html, 'Add game dates');
}

function showPageLink() {
  requireAdmin_();
  const s = getSettings_();
  const app = webAppUrl_(s);
  const site = String(s['Public Page URL'] || '').trim();
  const a = u => '<a href="' + esc_(u) + '" target="_blank">' + esc_(u) + '</a>';
  let body = site
    ? '<p><b>Public sign-up page (give this one out):</b><br>' + a(site) + '</p>'
    : '<p><b>No public page set yet.</b> Paste the GitHub Pages address into <b>Settings &gt; Public Page URL</b>.</p>';
  body += app
    ? '<p style="color:#666"><b>Web app link</b> (the page talks to this behind the scenes; old links forward to the public page):<br>' + a(app) + '</p>'
    : '<p>The web app has not been deployed yet: <b>Deploy &gt; New deployment &gt; Web app</b>, then paste the link into <b>Settings &gt; Web App URL</b>.</p>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput('<div style="font-family:Arial,sans-serif;font-size:14px;word-break:break-all">' + body + '</div>').setWidth(500).setHeight(240),
    'Sign-up page');
}


/* =========================================================================
 * ADD GAME DATES
 * ========================================================================= */

function getDateDefaults() {
  requireAdmin_();
  const s = getSettings_();
  return {
    location: String(s['Default Location'] || ''),
    address: String(s['Default Address'] || ''),
    role: String(s['Default Role'] || 'Buddy'),
    capacity: parseInt(s['Default Capacity'], 10) || 20,
    slots: [
      { start: timeText_(s['Slot 1 Start']), end: timeText_(s['Slot 1 End']) },
      { start: timeText_(s['Slot 2 Start']), end: timeText_(s['Slot 2 End']) }
    ]
  };
}

/** p = {dates:"4/11/2027, 4/25/2027", location, address, role, capacity, slots:[{start,end}]} */
function addGameDates(p) {
  requireAdmin_();
  p = p || {};
  const bad = [], dates = [];
  String(p.dates || '').split(/[\n,;]+/).map(x => x.trim()).filter(String).forEach(x => {
    const m = x.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
    if (!m) { bad.push(x); return; }
    let y = parseInt(m[3], 10); if (y < 100) y += 2000;
    const d = new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    if (isNaN(d) || d.getMonth() !== parseInt(m[1], 10) - 1) bad.push(x); else dates.push(d);
  });
  if (bad.length) throw new Error("Couldn't read these dates (use mm/dd/yyyy): " + bad.join(', '));
  if (!dates.length) throw new Error('Enter at least one date.');

  const slots = (p.slots || []).map(x => ({ start: timeText_(x.start), end: timeText_(x.end) }))
    .filter(x => x.start && x.end);
  if (!slots.length) throw new Error('Enter at least one time slot.');
  slots.forEach(x => { if (minutes_(x.start) === 9999 || minutes_(x.end) === 9999) throw new Error('Times should look like 11:45am or 1:00pm.'); });

  const capacity = parseInt(p.capacity, 10);
  if (!(capacity >= 1)) throw new Error('Capacity must be at least 1.');

  const sh = sheet_(TAB.SLOTS);
  const headers = headers_(sh);
  const rows = [];
  dates.forEach(d => slots.forEach(t => {
    const rec = {
      'Slot ID': newId_('T'), 'Date': d,
      'Location': cleanText_(p.location, 80), 'Address': cleanText_(p.address, 120),
      'Start': t.start, 'End': t.end, 'Role': cleanText_(p.role, 40) || 'Buddy',
      'Capacity': capacity, 'Status': 'Open', 'Notes': ''
    };
    rows.push(headers.map(h => (h in rec ? rec[h] : '')));
  }));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);

  const idx = headerIndex_(sh);
  if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).sort({ column: idx['Date'], ascending: true });
  return { added: rows.length, dates: dates.length };
}


/* =========================================================================
 * BROADCASTS
 * ========================================================================= */

function getBroadcastOptions() {
  requireAdmin_();
  const today = dayKey_(new Date());
  const active = activeSignups_();
  const count = id => active.filter(r => String(r['Slot ID']) === id).length;
  const days = [], byKey = {};
  loadSlots_().filter(sl => sl.dayKey >= today).forEach(sl => {
    let d = byKey[sl.dayKey];
    if (!d) {
      d = byKey[sl.dayKey] = { key: sl.dayKey, label: sl.weekday + ' ' + sl.dateText + ' — ' + sl.location, short: sl.weekday + ' ' + sl.dateText, slots: [], signups: 0 };
      days.push(d);
    }
    const n = count(sl.id);
    d.signups += n;
    d.slots.push({ id: sl.id, label: sl.start + '–' + sl.end + ' ' + sl.role + (sl.status !== 'Open' ? ' (' + sl.status + ')' : ''), time: sl.start + '–' + sl.end, signups: n });
  });
  return {
    days: days,
    smsReady: !!twilio_(),
    emailQuota: MailApp.getRemainingDailyQuota(),
    org: senderName_(getSettings_())
  };
}

function previewBroadcast(aud) {
  requireAdmin_();
  const r = recipients_(aud);
  return { signups: r.rows.length, emails: r.emails.length, texts: r.texts.length, quota: MailApp.getRemainingDailyQuota() };
}

/** aud = {type:'upcoming'|'date'|'slot', dayKey, slotId} */
function recipients_(aud) {
  aud = aud || {};
  const today = dayKey_(new Date());
  const slots = loadSlots_();
  let ids;
  if (aud.type === 'slot') ids = slots.filter(s => s.id === String(aud.slotId)).map(s => s.id);
  else if (aud.type === 'date') ids = slots.filter(s => s.dayKey === String(aud.dayKey)).map(s => s.id);
  else ids = slots.filter(s => s.dayKey >= today).map(s => s.id);
  const want = {}; ids.forEach(i => { want[i] = true; });
  const rows = activeSignups_().filter(r => want[String(r['Slot ID'])]);
  const emails = [], texts = [], seenE = {}, seenT = {};
  rows.forEach(r => {
    const e = String(r['Email'] || '').trim().toLowerCase();
    if (e && !seenE[e]) { seenE[e] = true; emails.push(e); }
    const p = String(r['Cell'] || '').replace(/\D/g, '');
    if (p.length >= 10 && yes_(r['Texts OK']) && !seenT[p]) { seenT[p] = true; texts.push(p); }
  });
  return { ids: ids, rows: rows, emails: emails, texts: texts };
}

/** p = {audience, subject, message, email:bool, sms:bool, markCancelled:bool} */
function sendBroadcast(p) {
  requireAdmin_();
  p = p || {};
  const s = getSettings_();
  const subject = cleanText_(p.subject, 120) || (senderName_(s) + ' update');
  const message = String(p.message || '').trim().slice(0, 2000);
  if (!message) throw new Error('Please write a message.');
  if (!p.email && !p.sms) throw new Error('Choose email, text, or both.');

  const r = recipients_(p.audience);
  if (!r.rows.length) throw new Error('No one is signed up for that selection.');

  // Optionally mark the date/slot Cancelled on the public page first.
  if (p.markCancelled && p.audience && p.audience.type !== 'upcoming') {
    const sh = sheet_(TAB.SLOTS);
    const col = headerIndex_(sh)['Status'];
    const want = {}; r.ids.forEach(i => { want[i] = true; });
    loadSlots_().forEach(sl => { if (want[sl.id]) sh.getRange(sl.row, col).setValue('Cancelled'); });
  }

  const problems = [];
  let sentE = 0, sentT = 0;

  // Texts first: they're the fastest way to reach people and have no daily Google limit.
  if (p.sms) {
    const tw = twilio_();
    if (!tw) problems.push('Texting is not set up yet, so no texts were sent.');
    else {
      const body = senderName_(s) + ': ' + message;
      r.texts.forEach(ph => {
        try { sendSms_(tw, ph, body); sentT++; }
        catch (err) { problems.push('...' + ph.slice(-4) + ': ' + err.message); }
      });
    }
  }

  // Emails go out up to Google's daily limit; anyone over the limit is listed so you can follow up.
  if (p.email) {
    const quota = MailApp.getRemainingDailyQuota();
    const sendTo = r.emails.slice(0, Math.max(0, quota));
    const skipped = r.emails.slice(sendTo.length);
    const html = emailShell_('<p>' + esc_(message).replace(/\n/g, '<br>') + '</p>', s);
    sendTo.forEach(to => {
      try { MailApp.sendEmail(mailOptions_(s, { to: to, subject: subject, htmlBody: html })); sentE++; }
      catch (err) { problems.push(to + ': ' + err.message); }
    });
    if (skipped.length) problems.push('Google\'s daily email limit was reached, so these ' + skipped.length +
      ' were NOT emailed: ' + skipped.join(', '));
  }

  appendRecord_(TAB.LOG, {
    'Sent': new Date(), 'Type': 'Broadcast', 'Audience': audienceLabel_(p.audience),
    'Channels': [p.email ? 'Email' : '', p.sms ? 'Text' : ''].filter(String).join(' + '),
    'Subject': asText_(subject), 'Message': asText_(message),
    'Emails Sent': sentE, 'Texts Sent': sentT, 'Problems': asText_(problems.join('; '))
  });
  return { emails: sentE, texts: sentT, problems: problems };
}

function audienceLabel_(aud) {
  aud = aud || {};
  if (aud.type === 'slot') { const sl = findSlot_(aud.slotId); return sl ? slotLabel_(sl) : 'Slot ' + aud.slotId; }
  if (aud.type === 'date') return 'All slots on ' + aud.dayKey;
  return 'Everyone on upcoming dates';
}


/* =========================================================================
 * TEXT MESSAGES (optional — Twilio)
 * Add these in Apps Script > Project Settings > Script Properties:
 *   TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM (e.g. +16105551234)
 * ========================================================================= */

function twilio_() {
  const p = PropertiesService.getScriptProperties();
  const sid = p.getProperty('TWILIO_SID'), tok = p.getProperty('TWILIO_TOKEN'), from = p.getProperty('TWILIO_FROM');
  return sid && tok && from ? { sid: sid, tok: tok, from: from } : null;
}

function sendSms_(tw, phone, body) {
  const to = '+1' + String(phone).replace(/\D/g, '').slice(-10);
  const res = UrlFetchApp.fetch('https://api.twilio.com/2010-04-01/Accounts/' + tw.sid + '/Messages.json', {
    method: 'post',
    payload: { To: to, From: tw.from, Body: body },
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(tw.sid + ':' + tw.tok) },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('Twilio ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 150));
}


/* =========================================================================
 * REMINDERS (X days before each game — see Settings > Reminder Days Before)
 * ========================================================================= */

function enableReminders() {
  requireAdmin_();
  removeReminderTriggers_();
  let hour = parseInt(getSettings_()['Reminder Hour'], 10);
  if (!(hour >= 0 && hour <= 23)) hour = 18;
  ScriptApp.newTrigger('runDailyReminders').timeBased().everyDays(1).atHour(hour).create();
  const days = reminderDays_(getSettings_());
  alert_('Reminders are ON. Every day around ' + ((hour % 12) || 12) + (hour < 12 ? 'am' : 'pm') +
    ', everyone signed up for the date ' + days + ' day(s) ahead gets a reminder.');
}

function disableReminders() {
  requireAdmin_();
  removeReminderTriggers_();
  alert_('Reminders are OFF.');
}

function sendRemindersNow() {
  requireAdmin_();
  const days = reminderDays_(getSettings_());
  const n = sendReminders_();
  alert_(n ? 'Sent ' + n + ' reminder email(s) for the date ' + days + ' day(s) from today.'
    : 'No one is signed up for the date ' + days + ' day(s) from today, so nothing was sent.');
}

/** Called by the daily time trigger. */
function runDailyReminders(e) {
  const fromTrigger = e && e.triggerUid &&
    ScriptApp.getProjectTriggers().some(t => t.getUniqueId() === String(e.triggerUid));
  if (!fromTrigger) requireAdmin_();
  sendReminders_();
}

function reminderDays_(s) {
  const n = parseInt(s['Reminder Days Before'], 10);
  return n >= 0 && n <= 14 ? n : 3;
}

function removeReminderTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runDailyReminders')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function sendReminders_() {
  const s = getSettings_();
  const target = new Date();
  target.setDate(target.getDate() + reminderDays_(s));
  const targetKey = dayKey_(target);
  const slots = {};
  loadSlots_().filter(sl => sl.dayKey === targetKey && sl.status === 'Open').forEach(sl => { slots[sl.id] = sl; });
  const rows = activeSignups_().filter(r => slots[String(r['Slot ID'])]);
  if (!rows.length) return 0;

  // One email per address, listing every slot that person is in on that date.
  const byEmail = {};
  rows.forEach(r => {
    const e = String(r['Email'] || '').trim().toLowerCase();
    if (e) (byEmail[e] = byEmail[e] || []).push(r);
  });

  const tw = yes_(s['Text Reminders']) ? twilio_() : null;
  const textedPhones = {};
  const problems = [];
  let sentE = 0, sentT = 0;

  Object.keys(byEmail).forEach(email => {
    const list = byEmail[email];
    const first = list[0];
    const parts = list.map(r => {
      const sl = slots[String(r['Slot ID'])];
      const link = manageUrl_(r['Token'], s);
      return detailsTable_(sl, qtyOf_(r), r['Comment']) +
        manageBlock_(r['Code'], link, s);
    }).join('<hr style="border:none;border-top:1px solid #ddd">');
    const sl0 = slots[String(first['Slot ID'])];
    try {
      MailApp.sendEmail(mailOptions_(s, {
        to: email,
        subject: 'Reminder: you\'re a Buddy on ' + sl0.weekday + ' ' + sl0.dateText,
        htmlBody: emailShell_('<p>Hi ' + esc_(first['Name']) + ',</p><p>Just a reminder that you\'re signed up to help on <b>' + esc_(sl0.weekday + ', ' + sl0.dateText) + '</b>:</p>' + parts +
          '<p>If your plans have changed, please use the link above so another Buddy can take your spot. Thank you, see you at the field!</p>', s)
      }));
      sentE++;
    } catch (err) { problems.push(email + ': ' + err.message); }

    if (tw) {
      list.forEach(r => {
        const ph = String(r['Cell'] || '').replace(/\D/g, '');
        if (!yes_(r['Texts OK']) || ph.length < 10 || textedPhones[ph]) return;
        textedPhones[ph] = true;
        const sl = slots[String(r['Slot ID'])];
        try {
          sendSms_(tw, ph, senderName_(s) + ': Reminder, you\'re a Buddy on ' + sl.weekday + ' ' + sl.dateText.slice(0, 5) + ', ' + sl.start + '–' + sl.end + ' at ' + sl.location + '. Thank you!');
          sentT++;
        } catch (err) { problems.push('...' + ph.slice(-4) + ': ' + err.message); }
      });
    }
  });

  appendRecord_(TAB.LOG, {
    'Sent': new Date(), 'Type': 'Reminder', 'Audience': 'Signed up for ' + targetKey,
    'Channels': tw ? 'Email + Text' : 'Email', 'Subject': reminderDays_(s) + '-day reminder', 'Message': '',
    'Emails Sent': sentE, 'Texts Sent': sentT, 'Problems': asText_(problems.join('; '))
  });
  return sentE;
}


/* =========================================================================
 * SETUP  (safe to run again — it only adds what's missing)
 * ========================================================================= */

function setupSheet() {
  requireAdmin_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());

  // --- Settings ---
  const set = ensureTab_(ss, TAB.SETTINGS, ['Setting', 'Value', 'Notes']);
  set.getRange('B:B').setNumberFormat('@').setWrap(true).setVerticalAlignment('top');
  set.getRange('A:A').setFontWeight('bold').setVerticalAlignment('top');
  set.getRange('C:C').setFontColor('#666666').setWrap(true).setVerticalAlignment('top');
  set.setColumnWidth(1, 190); set.setColumnWidth(2, 420); set.setColumnWidth(3, 320);
  const haveKeys = set.getLastRow() > 1 ? set.getRange(2, 1, set.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  const missing = SETTINGS_DEFAULTS_().filter(r => haveKeys.indexOf(r[0]) < 0);
  if (missing.length) set.getRange(set.getLastRow() + 1, 1, missing.length, 3).setValues(missing.map(r => [r[0], String(r[1]), r[2]]));
  set.getRange(1, 1, 1, 3).setFontColor('#ffffff');

  // --- Slots ---
  const sl = ensureTab_(ss, TAB.SLOTS, SLOT_HEADERS);
  const si = headerIndex_(sl);
  col_(sl, si['Date']).setNumberFormat('ddd mm/dd/yyyy');
  col_(sl, si['Start']).setNumberFormat('@');
  col_(sl, si['End']).setNumberFormat('@');
  col_(sl, si['Capacity']).setNumberFormat('0');
  col_(sl, si['Status']).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Open', 'Closed', 'Cancelled'], true).build());
  sl.setColumnWidth(si['Slot ID'], 95); sl.setColumnWidth(si['Date'], 130); sl.setColumnWidth(si['Address'], 260);
  if (sl.getLastRow() < 2) seedSampleSlots_(sl);

  // --- Signups ---
  const su = ensureTab_(ss, TAB.SIGNUPS, SIGNUP_HEADERS);
  const ui = headerIndex_(su);
  col_(su, ui['Submitted']).setNumberFormat('mm/dd/yyyy h:mm am/pm');
  col_(su, ui['Updated']).setNumberFormat('mm/dd/yyyy h:mm am/pm');
  col_(su, ui['Cell']).setNumberFormat('@');
  col_(su, ui['Texts OK']).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Yes', 'No'], true).build());
  col_(su, ui['Status']).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Active', 'Cancelled'], true).build());
  su.setColumnWidth(ui['Slot'], 280); su.setColumnWidth(ui['Comment'], 220); su.setColumnWidth(ui['Email'], 210);
  su.hideColumns(ui['Token']);
  ensureCodes_();

  // --- Broadcast Log ---
  const lg = ensureTab_(ss, TAB.LOG, LOG_HEADERS);
  col_(lg, headerIndex_(lg)['Sent']).setNumberFormat('mm/dd/yyyy h:mm am/pm');
  lg.setColumnWidth(headerIndex_(lg)['Message'], 320);

  // Tidy up: order tabs, drop the empty default tab.
  [TAB.SLOTS, TAB.SIGNUPS, TAB.LOG, TAB.SETTINGS].forEach((n, i) => { ss.setActiveSheet(ss.getSheetByName(n)); ss.moveActiveSheet(i + 1); });
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  ensureSlotIds_();
  ss.setActiveSheet(ss.getSheetByName(TAB.SETTINGS));
  ss.toast('Tabs are ready. Next: fill in Settings, then deploy the web app.', 'Buddies setup', 8);
}

function ensureTab_(ss, name, headers) {
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  const have = headers_(sh);
  headers.forEach(h => {
    if (have.indexOf(h) < 0) { have.push(h); sh.getRange(1, have.length).setValue(h); }
  });
  sh.getRange(1, 1, 1, have.length).setFontWeight('bold').setBackground('#2B3187').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  return sh;
}

function col_(sh, c) { return sh.getRange(2, c, Math.max(1, sh.getMaxRows() - 1), 1); }

function seedSampleSlots_(sh) {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
  const d1 = new Date(year, 3, 10);            // first Sunday on/after April 10
  d1.setDate(d1.getDate() + ((7 - d1.getDay()) % 7));
  const d2 = new Date(d1.getTime()); d2.setDate(d2.getDate() + 14);
  const headers = headers_(sh);
  const rows = [];
  [d1, d2].forEach(d => [['11:45am', '1:00pm'], ['1:00pm', '2:30pm']].forEach(t => {
    const rec = { 'Slot ID': newId_('T'), 'Date': d, 'Location': 'Thomas Field', 'Address': '2460 Highland Ave, Broomall, PA 19008',
      'Start': t[0], 'End': t[1], 'Role': 'Buddy', 'Capacity': 20, 'Status': 'Open', 'Notes': 'SAMPLE ROW: replace with real dates' };
    rows.push(headers.map(h => (h in rec ? rec[h] : '')));
  }));
  sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function SETTINGS_DEFAULTS_() {
  return [
    ['Page Title', 'MTLL Challenger Athlete Buddies ' + (new Date().getMonth() >= 6 ? new Date().getFullYear() + 1 : new Date().getFullYear()), 'Big heading at the top of the page'],
    ['Organization', 'MTLL Challenger', 'Small heading above the title; also the email sender name'],
    ['Description',
      'The fundamental goal of the MTLL Challenger League is to provide an opportunity for individuals with intellectual and physical challenges to enjoy the benefits of Little League in an environment structured to their abilities.\n\n' +
      'The league is asking for volunteers as buddies to the players in the Challenger League. The goal is to pair a buddy with each Challenger athlete to assist them, help teach them and have fun! Due to higher enrollment, we will be holding 2 games and will be separating the buddies into two time groups.\n\n' +
      'If you have any questions, please reach out to either Corey Ruff @ 484-459-9085 or Mike Noonan @ 484-888-8780.',
      'Intro text. Press Ctrl+Enter inside the cell for a new line.'],
    ['Coordinator Name', 'Corey Ruff', 'Shown at the top of the page and in email signatures'],
    ['Coordinator Email', '', 'The "Contact" link on the page; replies to all emails go here'],
    ['Admin Emails', '', 'Optional: other Google accounts (comma-separated) allowed to use the Buddies menu'],
    ['Sign-Ups Open', 'Yes', 'Yes or No. No shows the page but hides the Sign Up buttons'],
    ['Hide Past Dates', 'No', 'Yes removes dates that have passed from the page'],
    ['Default Location', 'Thomas Field', 'Pre-fills Buddies > Add game dates'],
    ['Default Address', '2460 Highland Ave, Broomall, PA 19008', ''],
    ['Default Role', 'Buddy', ''],
    ['Default Capacity', '20', 'Buddies per time slot'],
    ['Slot 1 Start', '11:45am', ''],
    ['Slot 1 End', '1:00pm', ''],
    ['Slot 2 Start', '1:00pm', ''],
    ['Slot 2 End', '2:30pm', ''],
    ['Reminder Days Before', '3', 'How many days before a game the reminder goes out (3 = Thursday for a Sunday game)'],
    ['Reminder Hour', '18', 'Hour of day (0–23) reminders go out. 18 = 6pm'],
    ['Text Reminders', 'No', 'Yes also texts reminders (only after texting is set up)'],
    ['Notify Me Of Cancellations', 'Yes', 'Email the coordinator when someone cancels'],
    ['Web App URL', '', 'Paste your web app link (ends in /exec) here after deploying'],
    ['Public Page URL', '', 'The GitHub Pages address (https://yourname.github.io/mtll-buddies/). This is the link people are given, and email change/cancel links point here.']
  ];
}
