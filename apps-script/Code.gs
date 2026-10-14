/**
 * MK Companion : synchro Google Sheet -> Supabase.
 *
 * Installation (une fois) :
 * 1. Dans le Sheet : Extensions > Apps Script, coller ce fichier.
 * 2. Paramètres du projet (roue dentée) > Propriétés du script, ajouter :
 *      SUPABASE_URL      https://xxxx.supabase.co
 *      SUPABASE_ANON_KEY la clé "anon public" de Supabase
 *      SYNC_SECRET       le même secret que celui inséré dans app_secrets (voir README)
 * 3. Lancer une fois la fonction installTriggers (autoriser l'accès demandé).
 *
 * Ensuite : chaque réponse du Form part dans Supabase en quelques secondes,
 * et une réconciliation complète tourne chaque nuit vers 3h (le Sheet fait foi).
 */

var FORM_SHEET = 'Réponses au formulaire 1';
var ARCHIVE_SHEET = 'Archive';

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  var ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onFormSubmitSync').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('syncAll').timeBased().everyDays(1).atHour(3).create();
  syncAll();
}

/** Déclenché à chaque réponse du formulaire. */
function onFormSubmitSync(e) {
  var v = e.values; // [horodateur, 1ere, 2eme, 3eme, 4eme, ...]
  var ts = toIso_(e.range.getSheet().getRange(e.range.getRow(), 1).getValue());
  rpc_('add_race', {
    secret: prop_('SYNC_SECRET'), race_ts: ts,
    n1: String(v[1]).trim(), n2: String(v[2]).trim(), n3: String(v[3]).trim(), n4: String(v[4]).trim(),
    src: 'form'
  });
}

/** Réconciliation complète : Archive + réponses du formulaire. */
function syncAll() {
  var rows = readSheet_(ARCHIVE_SHEET, 'archive').concat(readSheet_(FORM_SHEET, 'form'));
  var seen = {};
  rows = rows.filter(function (r) { if (seen[r.ts]) return false; seen[r.ts] = true; return true; });
  var res = rpc_('sync_races', { secret: prop_('SYNC_SECRET'), rows: rows });
  console.log('Synchro : ' + rows.length + ' courses envoyées, ' + JSON.stringify(res));
}

function readSheet_(name, src) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return [];
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var ts = parseTs_(row[0]);
    if (!ts) continue;                                   // en-têtes, lignes vides, lignes de remplissage
    var p = [row[1], row[2], row[3], row[4]].map(function (x) { return String(x || '').trim(); });
    if (p.some(function (x) { return x === ''; })) continue;
    out.push({ ts: ts, p: p, src: src });
  }
  return out;
}

/** Accepte une vraie date ou un texte « jj/mm/aaaa hh:mm:ss ». Renvoie null sinon. */
function parseTs_(v) {
  if (v instanceof Date) return v.getFullYear() >= 2000 ? toIso_(v) : null;
  var m = String(v || '').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m || Number(m[3]) < 2000) return null;
  return m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] + ':' + m[6];
}

function toIso_(d) {
  return Utilities.formatDate(d, 'Europe/Paris', 'yyyy-MM-dd HH:mm:ss');
}

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('Propriété de script manquante : ' + k);
  return v;
}

function rpc_(fn, body) {
  var res = UrlFetchApp.fetch(prop_('SUPABASE_URL') + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: prop_('SUPABASE_ANON_KEY'), Authorization: 'Bearer ' + prop_('SUPABASE_ANON_KEY') },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error(fn + ' : ' + res.getResponseCode() + ' ' + res.getContentText());
  var txt = res.getContentText();
  return txt ? JSON.parse(txt) : null;
}
