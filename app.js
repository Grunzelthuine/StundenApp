/* Stundenzettel App — Logik
   Speicherung: localStorage (rein lokal auf dem Gerät)
*/

const STORE_KEY = 'stundenzettel_v1';

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (!s.archive) s.archive = []; // Migration für ältere gespeicherte Daten
      return s;
    }
  } catch (e) { /* ignore */ }
  return { entries: [], customers: {}, employeeName: '', archive: [] };
}

function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

// ---------- Hilfsfunktionen ----------

function isoFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return isoFromDate(d);
}

function shiftDateISO(iso, deltaDays) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + deltaDays);
  return isoFromDate(d);
}

function parseHM(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function computeNetMinutes(entry) {
  let mins;
  if (entry.timeMode === 'range') {
    let s = parseHM(entry.start);
    let e = parseHM(entry.end);
    if (e < s) e += 24 * 60; // über Mitternacht
    mins = e - s;
  } else {
    mins = Math.round(entry.durationHours * 60);
  }
  mins -= (entry.breakMinutes || 0);
  if (mins < 0) mins = 0;
  return mins;
}

function minutesToHoursDecimal(mins) {
  return mins / 60;
}

function formatHoursDE(hoursFloat) {
  // z.B. 4.25 -> "4,25" ; 2 -> "2" ; 2.5 -> "2,5"
  let rounded = Math.round(hoursFloat * 100) / 100;
  let s = rounded.toFixed(2);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace('.', ',');
  if (s === '' || s === '-0') s = '0';
  return s;
}

function formatDateShort(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.`;
}

function formatDateLong(iso) {
  const d = new Date(iso + 'T00:00:00');
  const weekdays = ['So','Mo','Di','Mi','Do','Fr','Sa'];
  const [y, m, day] = iso.split('-');
  return `${weekdays[d.getDay()]} ${day}.${m}.${y}`;
}

const MONATE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

function monthKey(iso) { return iso.slice(0, 7); } // YYYY-MM

function uid() { return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---------- Klartext-Erfassung (Freitext-Parser) ----------

// Deutsche Zahlwörter 0–59, für den Fall, dass die Diktierfunktion Zeiten/Minuten
// als Wort statt als Ziffer ausgibt (z. B. "fünfundvierzig" statt "45").
const GER_NUM_WORDS = {
  'null':0,'ein':1,'eine':1,'eins':1,'zwei':2,'drei':3,'vier':4,'fünf':5,'sechs':6,'sieben':7,'acht':8,'neun':9,
  'zehn':10,'elf':11,'zwölf':12,'dreizehn':13,'vierzehn':14,'fünfzehn':15,'sechzehn':16,'siebzehn':17,'achtzehn':18,'neunzehn':19,
  'zwanzig':20,'einundzwanzig':21,'zweiundzwanzig':22,'dreiundzwanzig':23,'vierundzwanzig':24,'fünfundzwanzig':25,
  'sechsundzwanzig':26,'siebenundzwanzig':27,'achtundzwanzig':28,'neunundzwanzig':29,
  'dreißig':30,'einunddreißig':31,'zweiunddreißig':32,'dreiunddreißig':33,'vierunddreißig':34,'fünfunddreißig':35,
  'sechsunddreißig':36,'siebenunddreißig':37,'achtunddreißig':38,'neununddreißig':39,
  'vierzig':40,'einundvierzig':41,'zweiundvierzig':42,'dreiundvierzig':43,'vierundvierzig':44,'fünfundvierzig':45,
  'sechsundvierzig':46,'siebenundvierzig':47,'achtundvierzig':48,'neunundvierzig':49,
  'fünfzig':50,'einundfünfzig':51,'zweiundfünfzig':52,'dreiundfünfzig':53,'vierundfünfzig':54,'fünfundfünfzig':55,
  'sechsundfünfzig':56,'siebenundfünfzig':57,'achtundfünfzig':58,'neunundfünfzig':59
};
const NUMWORD_PATTERN = Object.keys(GER_NUM_WORDS).sort((a, b) => b.length - a.length).join('|');

function numToken(str) {
  if (str == null) return null;
  const s = String(str).trim().toLowerCase();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return Object.prototype.hasOwnProperty.call(GER_NUM_WORDS, s) ? GER_NUM_WORDS[s] : null;
}

function parseTimeExpr(str) {
  if (!str) return null;
  str = str.trim();
  let m = str.match(/^(\d{1,2})[:.](\d{2})/);
  if (m) return { h: +m[1], m: +m[2] };
  m = str.match(new RegExp(`^(${NUMWORD_PATTERN}|\\d{1,2})\\s*uhr\\s*(${NUMWORD_PATTERN}|\\d{1,2})?`, 'i'));
  if (m) {
    const h = numToken(m[1]);
    const mm = m[2] ? numToken(m[2]) : 0;
    if (h != null) return { h, m: mm || 0 };
  }
  m = str.match(new RegExp(`^(${NUMWORD_PATTERN}|\\d{1,2})$`, 'i'));
  if (m) {
    const h = numToken(m[1]);
    if (h != null) return { h, m: 0 };
  }
  return null;
}

function parseFreeText(rawText) {
  const text = (rawText || '').trim();
  const result = { date: null, timeMode: null, start: null, end: null, durationHours: null,
    breakMinutes: null, customer: null, aufmass: null, desc: '', recognized: [] };
  if (!text) return result;

  const removeRanges = [];

  // Datum
  let m = text.match(/\bvorgestern\b/i);
  if (m) { result.date = todayISO(-2); removeRanges.push([m.index, m.index + m[0].length]); result.recognized.push('Datum: vorgestern'); }
  else if ((m = text.match(/\bgestern\b/i))) { result.date = todayISO(-1); removeRanges.push([m.index, m.index + m[0].length]); result.recognized.push('Datum: gestern'); }
  else if ((m = text.match(/\bheute\b/i))) { result.date = todayISO(0); removeRanges.push([m.index, m.index + m[0].length]); result.recognized.push('Datum: heute'); }
  else if ((m = text.match(/\bam\s+(\d{1,2})\.(\d{1,2})\.(\d{4})?/i))) {
    const day = m[1].padStart(2, '0'), month = m[2].padStart(2, '0');
    const year = m[3] || String(new Date().getFullYear());
    result.date = `${year}-${month}-${day}`;
    removeRanges.push([m.index, m.index + m[0].length]);
    result.recognized.push(`Datum: ${day}.${month}.${year}`);
  }

  // Zeitspanne "von X bis Y"
  m = text.match(/\bvon\s+(.+?)\s+bis\s+(.+?)(?=\s+bei\b|\s+und\b|,|\.|$)/i);
  if (m) {
    const t1 = parseTimeExpr(m[1]);
    const t2 = parseTimeExpr(m[2]);
    if (t1 && t2) {
      result.timeMode = 'range';
      result.start = `${String(t1.h).padStart(2, '0')}:${String(t1.m).padStart(2, '0')}`;
      result.end = `${String(t2.h).padStart(2, '0')}:${String(t2.m).padStart(2, '0')}`;
      removeRanges.push([m.index, m.index + m[0].length]);
      result.recognized.push(`Zeit: ${result.start}–${result.end}`);
    }
  }
  if (!result.timeMode) {
    // Feste Stundenzahl, z. B. "3 Stunden gearbeitet" (aber nicht "3 Stunden Pause")
    m = text.match(new RegExp(`\\b(${NUMWORD_PATTERN}|\\d{1,2}(?:[.,]\\d+)?)\\s*stunden?\\b(?!\\s*pause)`, 'i'));
    if (m) {
      const raw = m[1].replace(',', '.');
      const val = /^\d/.test(raw) ? parseFloat(raw) : numToken(raw);
      if (val != null && val > 0) {
        result.timeMode = 'duration';
        result.durationHours = val;
        removeRanges.push([m.index, m.index + m[0].length]);
        result.recognized.push(`Dauer: ${formatHoursDE(val)} Std`);
      }
    }
  }

  // Pause
  m = text.match(new RegExp(`(${NUMWORD_PATTERN}|\\d{1,3})\\s*(?:minuten|min)\\.?\\s*pause`, 'i'))
    || text.match(new RegExp(`pause\\s*(?:von|:)?\\s*(${NUMWORD_PATTERN}|\\d{1,3})\\s*(?:minuten|min)`, 'i'));
  if (m) {
    const v = /^\d/.test(m[1]) ? parseInt(m[1], 10) : numToken(m[1]);
    if (v != null) { result.breakMinutes = v; result.recognized.push(`Pause: ${v} Min`); }
  } else if ((m = text.match(/eine\s+halbe\s+stunde\s+pause/i))) {
    result.breakMinutes = 30; result.recognized.push('Pause: 30 Min');
  } else if ((m = text.match(new RegExp(`(${NUMWORD_PATTERN}|\\d{1,2})\\s*stunden?\\s*pause`, 'i')))) {
    const v = /^\d/.test(m[1]) ? parseInt(m[1], 10) : numToken(m[1]);
    if (v != null) { result.breakMinutes = v * 60; result.recognized.push(`Pause: ${v * 60} Min`); }
  }
  if (result.breakMinutes != null) {
    // Den ganzen Satz-/Teilsatz rund um "Pause" aus der späteren Beschreibung entfernen
    // (z.B. "Dabei habe ich 45 Minuten Pause gemacht"), nicht nur die reine Zahl.
    // Grenzen sind Satzzeichen ODER Kommas, damit bei Aufzählungen ("…, 30 Minuten Pause.")
    // nicht versehentlich der ganze vorherige Satzteil mitgelöscht wird.
    const sentenceMatch = text.match(/[^.!?,]*\bpause\b[^.!?,]*[.,!?]?/i);
    if (sentenceMatch) removeRanges.push([sentenceMatch.index, sentenceMatch.index + sentenceMatch[0].length]);
    else removeRanges.push([m.index, m.index + m[0].length]);
  }

  // Kunde
  m = text.match(/\bbei\s+(?:der\s+|den\s+)?(?:familie|firma|kunden?)?\s*([^\n,]+?)(?=\s+(?:und|war|habe)\b|,|\.|$)/i);
  if (m) {
    const name = m[1].trim().replace(/^(familie|firma|kunden?)\s+/i, '');
    if (name) {
      result.customer = name;
      removeRanges.push([m.index, m.index + m[0].length]);
      result.recognized.push(`Kunde: ${name}`);
    }
  }

  // Aufmaß (Sonderzeichen "ß" wird von \b in JS nicht als Wortzeichen erkannt,
  // daher Grenzen manuell über Lookaround statt \b prüfen)
  if (/(?<![a-zäöü])aufmaß(?![a-zäöü])/i.test(text)) { result.aufmass = 'ja'; result.recognized.push('Aufmaß: Ja'); }

  // Rest als Arbeitsbeschreibung: erkannte Abschnitte herausschneiden, Reste aufräumen
  removeRanges.sort((a, b) => b[0] - a[0]);
  let desc = text;
  removeRanges.forEach(([s, e]) => { desc = desc.slice(0, s) + ' ' + desc.slice(e); });
  desc = desc
    .replace(/\bich\s+war\b/gi, ' ')
    .replace(/\bund\s+habe\b/gi, ' ')
    .replace(/\bhabe\s+ich\b/gi, ' ')
    .replace(/\bdabei\b/gi, ' ')
    .replace(/^\s*und\b/i, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/^[\s,.\-]+/, '')
    .replace(/[\s,.\-]+$/, '')
    .trim();
  if (desc) desc = desc.charAt(0).toUpperCase() + desc.slice(1);
  result.desc = desc;

  return result;
}

function applyFreeTextResult(result) {
  if (result.date) { $('f-date').value = result.date; }
  updateTimeDefaults();

  if (result.timeMode === 'range') {
    timeMode = 'range';
    document.querySelectorAll('#timeModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'range'));
    $('rangeFields').style.display = 'block';
    $('durationFields').style.display = 'none';
    setStartSliderHHMM(result.start);
    setEndSliderHHMM(result.end);
  } else if (result.timeMode === 'duration') {
    timeMode = 'duration';
    document.querySelectorAll('#timeModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'duration'));
    $('rangeFields').style.display = 'none';
    $('durationFields').style.display = 'block';
    $('f-duration').value = result.durationHours;
  }

  if (result.breakMinutes != null) {
    breakMinutes = result.breakMinutes;
    $('f-break-custom').value = '';
    let matched = false;
    document.querySelectorAll('#breakBtns .qbtn').forEach(b => {
      const isMatch = parseInt(b.dataset.break, 10) === breakMinutes;
      b.classList.toggle('active', isMatch);
      if (isMatch) matched = true;
    });
    if (!matched) $('f-break-custom').value = breakMinutes;
  }

  if (result.customer) {
    $('f-customer').value = result.customer;
    $('f-customer').dispatchEvent(new Event('input'));
  }

  if (result.desc) $('f-desc').value = result.desc;

  if (result.aufmass) {
    aufmass = result.aufmass;
    document.querySelectorAll('#aufmassSeg button').forEach(b => b.classList.toggle('active', b.dataset.aufmass === result.aufmass));
  }

  updateComputedHint();
}

// ---------- Formular-Logik ----------

const $ = (id) => document.getElementById(id);

let timeMode = 'range';
let breakMinutes = 0;
let aufmass = 'nein';

const QUARTER_MAX = 95; // Schieberegler-Index für 23:45 (letzter 15-Minuten-Schritt des Tages)

function quarterIndexToHHMM(idx) {
  const mins = idx * 15;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hhmmToQuarterIndex(hhmm) {
  const mins = parseHM(hhmm);
  return Math.min(QUARTER_MAX, Math.max(0, Math.round(mins / 15)));
}

function roundUpToQuarterIndex(date) {
  const mins = date.getHours() * 60 + date.getMinutes();
  return Math.min(QUARTER_MAX, Math.ceil(mins / 15));
}

function lastEndTimeForDate(dateISO) {
  // Sucht rückwärts den zuletzt erfassten Eintrag desselben Datums mit Uhrzeit-von-bis
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i];
    if (e.date === dateISO && e.timeMode === 'range' && e.end) return e.end;
  }
  return null;
}

function setStartSliderHHMM(hhmm) {
  const idx = hhmmToQuarterIndex(hhmm);
  $('f-start').value = idx;
  $('f-start-label').textContent = quarterIndexToHHMM(idx);
}

function setEndSliderHHMM(hhmm) {
  const idx = hhmmToQuarterIndex(hhmm);
  $('f-end').value = idx;
  $('f-end-label').textContent = quarterIndexToHHMM(idx);
}

// Verhindert, dass eine Berührung/Klick an einer beliebigen Stelle des Schiebereglers
// (außerhalb des Reglerknopfs) den Wert springen lässt — nur ein Ziehen am Knopf selbst
// soll die Uhrzeit verändern.
function isPointerOnThumb(inputEl, clientX) {
  const rect = inputEl.getBoundingClientRect();
  const min = parseFloat(inputEl.min) || 0;
  const max = parseFloat(inputEl.max) || 100;
  const val = parseFloat(inputEl.value);
  const thumbSize = 26; // an unsere CSS-Reglergröße angepasst
  const usableWidth = Math.max(0, rect.width - thumbSize);
  const fraction = max > min ? (val - min) / (max - min) : 0;
  const thumbCenterX = rect.left + thumbSize / 2 + fraction * usableWidth;
  const hitRadius = thumbSize / 2 + 10; // etwas Toleranz für ungenaues Antippen
  return Math.abs(clientX - thumbCenterX) <= hitRadius;
}

function restrictSliderToThumbDrag(inputEl) {
  inputEl.addEventListener('pointerdown', (e) => {
    if (!isPointerOnThumb(inputEl, e.clientX)) {
      e.preventDefault();
    }
  });
}

// Sorgt dafür, dass "Von" nie gleich oder später als "Bis" stehen kann (und umgekehrt),
// damit keine unmöglichen Zeiten wie "von 15:00 bis 11:30" entstehen können.
function clampTimeSliders(startEl, endEl, movedEl) {
  let startVal = parseInt(startEl.value, 10);
  let endVal = parseInt(endEl.value, 10);
  if (movedEl === startEl && startVal >= endVal) {
    startVal = Math.max(0, endVal - 1);
    startEl.value = startVal;
  } else if (movedEl === endEl && endVal <= startVal) {
    endVal = Math.min(QUARTER_MAX, startVal + 1);
    endEl.value = endVal;
  }
  return { startVal, endVal };
}

function updateTimeDefaults() {
  const dateVal = $('f-date').value || todayISO();
  const lastEnd = lastEndTimeForDate(dateVal);
  setStartSliderHHMM(lastEnd || '07:30');
  setEndSliderHHMM(quarterIndexToHHMM(roundUpToQuarterIndex(new Date())));
  updateComputedHint();
}

function initForm() {
  $('f-date').value = todayISO();
  $('f-employee').value = state.employeeName || '';
  refreshCustomerList();
  updateTimeDefaults();

  document.querySelectorAll('[data-date-shift]').forEach(btn => {
    btn.addEventListener('click', () => {
      $('f-date').value = todayISO(parseInt(btn.dataset.dateShift, 10));
      updateTimeDefaults();
    });
  });

  $('datePrevBtn').addEventListener('click', () => {
    const cur = $('f-date').value || todayISO();
    $('f-date').value = shiftDateISO(cur, -1);
    updateTimeDefaults();
  });
  $('dateNextBtn').addEventListener('click', () => {
    const cur = $('f-date').value || todayISO();
    $('f-date').value = shiftDateISO(cur, 1);
    updateTimeDefaults();
  });
  $('f-date').addEventListener('change', updateTimeDefaults);

  $('timeModeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    timeMode = btn.dataset.mode;
    document.querySelectorAll('#timeModeSeg button').forEach(b => b.classList.toggle('active', b === btn));
    $('rangeFields').style.display = timeMode === 'range' ? 'flex' : 'none';
    $('durationFields').style.display = timeMode === 'duration' ? 'block' : 'none';
    updateComputedHint();
  });

  $('breakBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-break]');
    if (!btn) return;
    breakMinutes = parseInt(btn.dataset.break, 10);
    $('f-break-custom').value = '';
    document.querySelectorAll('#breakBtns .qbtn').forEach(b => b.classList.toggle('active', b === btn));
    updateComputedHint();
  });

  $('f-break-custom').addEventListener('input', () => {
    const v = parseFloat($('f-break-custom').value);
    if (!isNaN(v)) {
      breakMinutes = v;
      document.querySelectorAll('#breakBtns .qbtn').forEach(b => b.classList.remove('active'));
    }
    updateComputedHint();
  });

  $('aufmassSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-aufmass]');
    if (!btn) return;
    aufmass = btn.dataset.aufmass;
    document.querySelectorAll('#aufmassSeg button').forEach(b => b.classList.toggle('active', b === btn));
  });

  restrictSliderToThumbDrag($('f-start'));
  restrictSliderToThumbDrag($('f-end'));

  $('f-start').addEventListener('input', () => {
    const { startVal } = clampTimeSliders($('f-start'), $('f-end'), $('f-start'));
    $('f-start-label').textContent = quarterIndexToHHMM(startVal);
    updateComputedHint();
  });
  $('f-end').addEventListener('input', () => {
    const { endVal } = clampTimeSliders($('f-start'), $('f-end'), $('f-end'));
    $('f-end-label').textContent = quarterIndexToHHMM(endVal);
    updateComputedHint();
  });
  $('f-duration').addEventListener('input', updateComputedHint);

  $('f-customer').addEventListener('input', () => {
    const name = $('f-customer').value.trim();
    if (!name) { $('newCustomerBox').style.display = 'none'; return; }
    $('newCustomerBox').style.display = 'block';
    const known = state.customers[name.toLowerCase()];
    if (known) {
      $('f-customer-address').value = known.address || '';
      document.querySelector('label[for="f-customer-address"]').textContent = 'Adresse (bekannter Kunde – bei Bedarf anpassen)';
    } else {
      document.querySelector('label[for="f-customer-address"]').textContent = 'Adresse (Neukunde) — Straße/Ort, Telefon';
    }
  });

  $('parseFreeTextBtn').addEventListener('click', () => {
    const text = $('f-freetext').value.trim();
    if (!text) { showToast('Bitte zuerst einen Satz eingeben oder diktieren.'); return; }
    const result = parseFreeText(text);
    applyFreeTextResult(result);
    if (result.recognized.length) {
      showToast('Erkannt: ' + result.recognized.join(' · ') + ' — bitte prüfen.');
    } else {
      showToast('Konnte nichts Eindeutiges erkennen — bitte Felder unten manuell ausfüllen.');
    }
  });

  $('saveEntryBtn').addEventListener('click', saveEntry);
  $('clearAllBtn').addEventListener('click', () => {
    if (state.entries.length === 0) return;
    if (confirm('Wirklich alle erfassten Einträge löschen? Das kann nicht rückgängig gemacht werden.')) {
      state.entries = [];
      saveState();
      renderEntries();
      showToast('Alle Einträge gelöscht.');
    }
  });
  $('exportBtn').addEventListener('click', exportPdf);

  $('f-employee').addEventListener('change', () => {
    state.employeeName = $('f-employee').value.trim();
    saveState();
  });

  updateComputedHint();
}

function updateComputedHint() {
  const entry = readFormAsEntry(true);
  if (!entry) { $('computedHint').textContent = ''; return; }
  const mins = computeNetMinutes(entry);
  const h = minutesToHoursDecimal(mins);
  const brk = entry.breakMinutes ? ` (nach Abzug ${entry.breakMinutes} Min Pause)` : '';
  $('computedHint').textContent = `→ ${formatHoursDE(h)} Std${brk}`;
}

function readFormAsEntry(preview = false) {
  const date = $('f-date').value;
  const customer = $('f-customer').value.trim();
  const desc = $('f-desc').value.trim();
  const address = $('f-customer-address').value.trim();

  if (!preview && (!date || !customer)) return null;

  let entry = {
    id: uid(),
    date, customer, address, desc,
    aufmass,
    timeMode,
    breakMinutes: breakMinutes || 0
  };
  if (timeMode === 'range') {
    entry.start = quarterIndexToHHMM(parseInt($('f-start').value, 10) || 0);
    entry.end = quarterIndexToHHMM(parseInt($('f-end').value, 10) || 0);
  } else {
    entry.durationHours = parseFloat($('f-duration').value) || 0;
  }
  return entry;
}

function saveEntry() {
  const date = $('f-date').value;
  const customer = $('f-customer').value.trim();
  const desc = $('f-desc').value.trim();

  if (!date) { showToast('Bitte ein Datum wählen.'); return; }
  if (!customer) { showToast('Bitte einen Kunden angeben.'); $('f-customer').focus(); return; }
  if (!desc) { showToast('Bitte eine Arbeitsbeschreibung angeben.'); $('f-desc').focus(); return; }
  if (timeMode === 'duration' && (!$('f-duration').value || parseFloat($('f-duration').value) <= 0)) {
    showToast('Bitte eine Stundenzahl angeben.'); $('f-duration').focus(); return;
  }

  const entry = readFormAsEntry(false);
  state.entries.push(entry);

  const address = $('f-customer-address').value.trim();
  state.customers[customer.toLowerCase()] = { name: customer, address };

  saveState();
  renderEntries();
  refreshCustomerList();
  showToast('Eintrag gespeichert.');

  resetEntryFormFields();
}

function resetEntryFormFields() {
  // Datum bleibt stehen (für weitere Einträge am selben Tag), alle anderen Felder werden geleert
  $('f-freetext').value = '';
  $('f-customer').value = '';
  $('f-customer-address').value = '';
  $('newCustomerBox').style.display = 'none';
  document.querySelector('label[for="f-customer-address"]').textContent = 'Adresse (Neukunde) — Straße/Ort, Telefon';
  $('f-desc').value = '';

  timeMode = 'range';
  document.querySelectorAll('#timeModeSeg button').forEach(b => b.classList.toggle('active', b.dataset.mode === 'range'));
  $('rangeFields').style.display = 'block';
  $('durationFields').style.display = 'none';
  $('f-duration').value = '';

  breakMinutes = 0;
  $('f-break-custom').value = '';
  document.querySelectorAll('#breakBtns .qbtn').forEach(b => b.classList.toggle('active', b.dataset.break === '0'));

  aufmass = 'nein';
  document.querySelectorAll('#aufmassSeg button').forEach(b => b.classList.toggle('active', b.dataset.aufmass === 'nein'));

  updateTimeDefaults(); // Von = letztes Bis desselben Tages (oder 07:30), Bis = jetzt aufgerundet
}

function refreshCustomerList() {
  const dl = $('customerList');
  dl.innerHTML = '';
  Object.values(state.customers).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    dl.appendChild(opt);
  });
}

// ---------- Eintragsliste ----------

function groupedEntriesByDate() {
  const map = {};
  state.entries.forEach(e => {
    if (!map[e.date]) map[e.date] = [];
    map[e.date].push(e);
  });
  return Object.keys(map).sort().map(date => ({ date, entries: map[date] }));
}

function dailyTotalHours(entries) {
  return entries.reduce((sum, e) => sum + minutesToHoursDecimal(computeNetMinutes(e)), 0);
}

function renderEntries() {
  $('entryCountBadge').textContent = state.entries.length;
  const wrap = $('entryListWrap');
  if (state.entries.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Noch keine Einträge erfasst.</div>';
    return;
  }
  const groups = groupedEntriesByDate();
  wrap.innerHTML = '';
  groups.forEach(g => {
    const total = dailyTotalHours(g.entries);
    const gDiv = document.createElement('div');
    gDiv.className = 'entry-group';
    gDiv.innerHTML = `<div class="entry-group-date"><span>${formatDateLong(g.date)}</span><span class="total">Gesamt: ${formatHoursDE(total)} Std</span></div>`;
    const list = document.createElement('div');
    g.entries.forEach(e => {
      const mins = computeNetMinutes(e);
      const timeLabel = e.timeMode === 'range' ? `${e.start}–${e.end}` : `${formatHoursDE(e.durationHours)} Std`;
      const item = document.createElement('div');
      item.className = 'entry-item';
      item.innerHTML = `
        <div class="info">
          <div class="customer">${escapeHtml(e.customer)} ${e.aufmass === 'ja' ? '<span class="badge">Aufmaß</span>' : ''}</div>
          <div class="desc">${escapeHtml(e.desc)}</div>
          <div class="meta">${timeLabel}${e.breakMinutes ? ` · ${e.breakMinutes} Min Pause` : ''} · ${formatHoursDE(minutesToHoursDecimal(mins))} Std</div>
        </div>
        <div class="actions">
          <button class="icon-btn edit" title="Bearbeiten">✏️</button>
          <button class="icon-btn del" title="Löschen">🗑️</button>
        </div>`;
      item.querySelector('.edit').addEventListener('click', () => openEditModal(e.id));
      item.querySelector('.del').addEventListener('click', () => deleteEntry(e.id));
      list.appendChild(item);
    });
    gDiv.appendChild(list);
    wrap.appendChild(gDiv);
  });
}

function deleteEntry(id) {
  if (!confirm('Diesen Eintrag löschen?')) return;
  state.entries = state.entries.filter(e => e.id !== id);
  saveState();
  renderEntries();
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

function openEditModal(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  const modal = $('editModal');
  modal.innerHTML = `
    <h3>Eintrag bearbeiten</h3>
    <label>Datum</label>
    <input type="date" id="m-date" value="${e.date}">
    <label>Kunde</label>
    <input type="text" id="m-customer" value="${escapeHtml(e.customer)}">
    <label>Arbeitsbeschreibung</label>
    <textarea id="m-desc" rows="3">${escapeHtml(e.desc)}</textarea>
    <label>Zeit</label>
    <div class="segmented" id="m-timeSeg">
      <button type="button" data-mode="range" class="${e.timeMode==='range'?'active':''}">Uhrzeit</button>
      <button type="button" data-mode="duration" class="${e.timeMode==='duration'?'active':''}">Stunden</button>
    </div>
    <div id="m-rangeFields" style="margin-top:10px; display:${e.timeMode==='range'?'block':'none'};">
      <div class="time-slider-group">
        <label>Von <span class="time-value" id="m-start-label">${e.start||'07:30'}</span></label>
        <input type="range" id="m-start" min="0" max="95" step="1" value="${hhmmToQuarterIndex(e.start||'07:30')}">
      </div>
      <div class="time-slider-group">
        <label>Bis <span class="time-value" id="m-end-label">${e.end||'16:15'}</span></label>
        <input type="range" id="m-end" min="0" max="95" step="1" value="${hhmmToQuarterIndex(e.end||'16:15')}">
      </div>
    </div>
    <div id="m-durationFields" style="margin-top:10px; display:${e.timeMode==='duration'?'block':'none'};">
      <label>Stunden</label><input type="number" id="m-duration" step="0.25" value="${e.durationHours||''}">
    </div>
    <label>Pause (Minuten)</label>
    <input type="number" id="m-break" value="${e.breakMinutes||0}">
    <label>Aufmaß</label>
    <div class="segmented" id="m-aufmassSeg">
      <button type="button" data-aufmass="nein" class="${e.aufmass==='nein'?'active':''}">Nein</button>
      <button type="button" data-aufmass="ja" class="${e.aufmass==='ja'?'active':''}">Ja</button>
    </div>
    <div class="btn-block-row" style="margin-top:16px;">
      <button class="btn btn-secondary" id="m-cancel">Abbrechen</button>
      <button class="btn btn-primary" id="m-save">Speichern</button>
    </div>
  `;
  let mTimeMode = e.timeMode, mAufmass = e.aufmass;
  modal.querySelector('#m-timeSeg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-mode]'); if (!btn) return;
    mTimeMode = btn.dataset.mode;
    modal.querySelectorAll('#m-timeSeg button').forEach(b => b.classList.toggle('active', b===btn));
    modal.querySelector('#m-rangeFields').style.display = mTimeMode==='range' ? 'block':'none';
    modal.querySelector('#m-durationFields').style.display = mTimeMode==='duration' ? 'block':'none';
  });
  const mStartEl = modal.querySelector('#m-start');
  const mEndEl = modal.querySelector('#m-end');
  restrictSliderToThumbDrag(mStartEl);
  restrictSliderToThumbDrag(mEndEl);
  mStartEl.addEventListener('input', () => {
    const { startVal } = clampTimeSliders(mStartEl, mEndEl, mStartEl);
    modal.querySelector('#m-start-label').textContent = quarterIndexToHHMM(startVal);
  });
  mEndEl.addEventListener('input', () => {
    const { endVal } = clampTimeSliders(mStartEl, mEndEl, mEndEl);
    modal.querySelector('#m-end-label').textContent = quarterIndexToHHMM(endVal);
  });
  modal.querySelector('#m-aufmassSeg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-aufmass]'); if (!btn) return;
    mAufmass = btn.dataset.aufmass;
    modal.querySelectorAll('#m-aufmassSeg button').forEach(b => b.classList.toggle('active', b===btn));
  });
  modal.querySelector('#m-cancel').addEventListener('click', closeEditModal);
  modal.querySelector('#m-save').addEventListener('click', () => {
    e.date = modal.querySelector('#m-date').value;
    e.customer = modal.querySelector('#m-customer').value.trim();
    e.desc = modal.querySelector('#m-desc').value.trim();
    e.timeMode = mTimeMode;
    if (mTimeMode === 'range') {
      e.start = quarterIndexToHHMM(parseInt(modal.querySelector('#m-start').value, 10));
      e.end = quarterIndexToHHMM(parseInt(modal.querySelector('#m-end').value, 10));
    } else {
      e.durationHours = parseFloat(modal.querySelector('#m-duration').value) || 0;
    }
    e.breakMinutes = parseFloat(modal.querySelector('#m-break').value) || 0;
    e.aufmass = mAufmass;
    saveState();
    renderEntries();
    closeEditModal();
    showToast('Eintrag aktualisiert.');
  });
  $('editModalBackdrop').classList.add('show');
}

function closeEditModal() {
  $('editModalBackdrop').classList.remove('show');
}
$('editModalBackdrop').addEventListener('click', (e) => {
  if (e.target === $('editModalBackdrop')) closeEditModal();
});

// ---------- Toast ----------

let toastTimer = null;
function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

// ---------- PDF Export ----------

function topToPdfY(topY) {
  return TEMPLATE.pageHeight - topY;
}

function buildExportPages() {
  // 1) nach Monat gruppieren (chronologisch), 2) innerhalb des Monats nach Datum gruppieren,
  // 3) Datums-Gruppen so auf Blätter packen, dass eine Datums-Gruppe NIE über zwei Blätter
  //    gesplittet wird (Vorgabe: reicht der Platz nicht, kommt ein komplett neues Blatt).
  const dateGroups = groupedEntriesByDate(); // sortiert nach Datum
  const byMonth = {};
  dateGroups.forEach(g => {
    const mk = monthKey(g.date);
    if (!byMonth[mk]) byMonth[mk] = [];
    byMonth[mk].push(g);
  });

  const pages = [];
  Object.keys(byMonth).sort().forEach(mk => {
    const groups = byMonth[mk];
    let current = [];
    let currentCount = 0;
    groups.forEach(g => {
      const n = g.entries.length;
      if (currentCount > 0 && currentCount + n > TEMPLATE.entriesPerPage) {
        pages.push({ monthKey: mk, groups: current });
        current = [];
        currentCount = 0;
      }
      if (n > TEMPLATE.entriesPerPage) {
        // Einzelner Tag mit mehr als 8 Einträgen: eigenes Blatt, ggf. mit Überlauf (Sonderfall)
        if (currentCount > 0) { pages.push({ monthKey: mk, groups: current }); current = []; currentCount = 0; }
        pages.push({ monthKey: mk, groups: [g] });
        return;
      }
      current.push(g);
      currentCount += n;
    });
    if (current.length) pages.push({ monthKey: mk, groups: current });
  });
  return pages;
}

function fitOneLine(font, baseSize, text, maxWidth, minSize = 6) {
  // Versucht die Schrift zu verkleinern, bevor mit Ellipse gekürzt wird.
  let size = baseSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return { text, size };
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t + ' …', size) > maxWidth) t = t.slice(0, -1);
  return { text: t ? t + ' …' : '…', size };
}

function wrapTwoLines(font, size, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  let line1 = '', line2 = '';
  let i = 0;
  while (i < words.length) {
    const test = line1 ? line1 + ' ' + words[i] : words[i];
    if (font.widthOfTextAtSize(test, size) <= maxWidth) { line1 = test; i++; }
    else break;
  }
  while (i < words.length) {
    const test = line2 ? line2 + ' ' + words[i] : words[i];
    if (font.widthOfTextAtSize(test, size) <= maxWidth) { line2 = test; i++; }
    else break;
  }
  if (i < words.length) {
    // Rest passt nicht mehr -> Ellipse an line2 anhängen (gekürzt)
    let rest = words.slice(i).join(' ');
    let l2 = line2;
    while (font.widthOfTextAtSize(l2 + ' …', size) > maxWidth && l2.length > 0) {
      l2 = l2.slice(0, -1);
    }
    line2 = l2 + ' …';
  }
  return [line1, line2];
}

async function exportPdf() {
  if (state.entries.length === 0) { showToast('Keine Einträge zum Exportieren vorhanden.'); return; }
  showToast('PDF wird erstellt …');

  const { PDFDocument, rgb } = PDFLib;

  const templateBytes = await fetch('assets/template.pdf').then(r => r.arrayBuffer());
  const outDoc = await PDFDocument.create();
  outDoc.registerFontkit(fontkit);
  const [templatePage] = await outDoc.embedPdf(templateBytes);

  // Handschriftähnliche Schrift (Patrick Hand) statt Helvetica, für ein "handschriftliches" Ausfüllgefühl.
  const handwritingBytes = await fetch('vendor/patrick-hand.ttf').then(r => r.arrayBuffer());
  const font = await outDoc.embedFont(handwritingBytes, { subset: true });
  const fontBold = font; // die Handschrift-Schrift hat keinen eigenen Fettschnitt, Jahr wird stattdessen größer gesetzt

  const employeeName = (state.employeeName || $('f-employee').value || '').trim();
  const pagesPlan = buildExportPages();

  for (const plan of pagesPlan) {
    const page = outDoc.addPage([TEMPLATE.pageWidth, TEMPLATE.pageHeight]);
    page.drawPage(templatePage, { x: 0, y: 0, width: TEMPLATE.pageWidth, height: TEMPLATE.pageHeight });

    const [y, m] = plan.monthKey.split('-');
    const monatName = MONATE[parseInt(m, 10) - 1];

    // Kopfzeile: Name
    page.drawText(employeeName, {
      x: TEMPLATE.header.nameValueX, y: topToPdfY(TEMPLATE.header.nameBaselineTop),
      size: 14, font, color: rgb(0,0,0)
    });
    // Monat
    page.drawText(monatName, {
      x: TEMPLATE.header.monatValueX, y: topToPdfY(TEMPLATE.header.monatBaselineTop),
      size: 13, font, color: rgb(0,0,0)
    });
    // Jahr: vorgedrucktes Jahr überdecken und neues eintragen
    page.drawRectangle({
      x: TEMPLATE.header.jahrBoxX0, y: topToPdfY(TEMPLATE.header.jahrBoxBottom),
      width: TEMPLATE.header.jahrBoxX1 - TEMPLATE.header.jahrBoxX0,
      height: TEMPLATE.header.jahrBoxBottom - TEMPLATE.header.jahrBoxTop,
      color: rgb(1,1,1)
    });
    const jahrText = y;
    const jahrWidth = fontBold.widthOfTextAtSize(jahrText, 19);
    page.drawText(jahrText, {
      x: TEMPLATE.header.jahrValueCenterX - jahrWidth/2, y: topToPdfY(TEMPLATE.header.jahrBaselineTop + 1),
      size: 19, font: fontBold, color: rgb(0,0,0)
    });

    // Zeilen füllen
    let rowIdx = 0;
    outer:
    for (const group of plan.groups) {
      const dailyTotal = dailyTotalHours(group.entries);
      for (let i = 0; i < group.entries.length; i++) {
        if (rowIdx >= TEMPLATE.rows.length) break outer; // Sicherheitsnetz bei Überlauf-Sonderfall
        const row = TEMPLATE.rows[rowIdx];
        const isLastOfDay = i === group.entries.length - 1;
        drawEntryRow(page, font, row, group.entries[i], dailyTotal, isLastOfDay);
        rowIdx++;
      }
    }
  }

  const pdfBytes = await outDoc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const fname = `Stundenzettel_${employeeName ? employeeName.replace(/\s+/g,'_')+'_' : ''}${new Date().toISOString().slice(0,10)}.pdf`;

  // Exportierte Einträge ins Archiv verschieben, damit der nächste Export nur noch neue Einträge enthält
  archiveCurrentEntries(fname);

  if (navigator.canShare && navigator.canShare({ files: [new File([blob], fname, { type: 'application/pdf' })] })) {
    try {
      await navigator.share({ files: [new File([blob], fname, { type: 'application/pdf' })], title: 'Stundenzettel' });
      showToast('PDF geteilt/gespeichert. Einträge sind jetzt im Archiv.');
      return;
    } catch (e) { /* Nutzer hat abgebrochen -> Fallback Download */ }
  }

  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast('PDF wurde erstellt. Einträge sind jetzt im Archiv.');
}

// ---------- Archiv ----------

function archiveCurrentEntries(pdfFilename) {
  if (state.entries.length === 0) return;
  const batch = {
    id: uid(),
    exportedAt: new Date().toISOString(),
    label: pdfFilename,
    entries: state.entries
  };
  state.archive.unshift(batch); // neuester Export zuerst
  state.entries = [];
  saveState();
  renderEntries();
  renderArchive();
}

function formatExportedAt(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0');
  const min = String(d.getMinutes()).padStart(2,'0');
  return `${dd}.${mm}.${d.getFullYear()}, ${hh}:${min} Uhr`;
}

function renderArchive() {
  const wrap = $('archiveWrap');
  const totalArchived = state.archive.reduce((s, b) => s + b.entries.length, 0);
  $('archiveCountBadge').textContent = totalArchived;
  if (state.archive.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Noch keine Exporte im Archiv.</div>';
    return;
  }
  wrap.innerHTML = '';
  state.archive.forEach(batch => {
    const totalH = batch.entries.reduce((sum, e) => sum + minutesToHoursDecimal(computeNetMinutes(e)), 0);
    const details = document.createElement('details');
    details.className = 'archive-batch';
    const dateRange = batch.entries.length
      ? [...new Set(batch.entries.map(e => e.date))].sort()
      : [];
    const rangeLabel = dateRange.length ? `${formatDateShort(dateRange[0])} – ${formatDateShort(dateRange[dateRange.length-1])}` : '';
    details.innerHTML = `
      <summary>
        <span>Export vom ${formatExportedAt(batch.exportedAt)} <span class="badge">${batch.entries.length} Einträge${rangeLabel ? ', ' + rangeLabel : ''}</span></span>
      </summary>
      <div class="archive-batch-body">
        <div class="btn-block-row" style="margin:10px 0;">
          <button class="btn btn-secondary batch-restore-all">Ganzen Export zurück in aktive Liste</button>
        </div>
        <div class="archive-entry-list"></div>
      </div>
    `;
    const listEl = details.querySelector('.archive-entry-list');
    batch.entries.forEach(e => {
      const mins = computeNetMinutes(e);
      const timeLabel = e.timeMode === 'range' ? `${e.start}–${e.end}` : `${formatHoursDE(e.durationHours)} Std`;
      const item = document.createElement('div');
      item.className = 'entry-item';
      item.innerHTML = `
        <div class="info">
          <div class="customer">${formatDateShort(e.date)} · ${escapeHtml(e.customer)} ${e.aufmass === 'ja' ? '<span class="badge">Aufmaß</span>' : ''}</div>
          <div class="desc">${escapeHtml(e.desc)}</div>
          <div class="meta">${timeLabel}${e.breakMinutes ? ` · ${e.breakMinutes} Min Pause` : ''} · ${formatHoursDE(minutesToHoursDecimal(mins))} Std</div>
        </div>
        <div class="actions">
          <button class="icon-btn restore-one" title="Zurück in aktive Liste">↩️</button>
        </div>`;
      item.querySelector('.restore-one').addEventListener('click', () => restoreEntryFromArchive(batch.id, e.id));
      listEl.appendChild(item);
    });
    details.querySelector('.batch-restore-all').addEventListener('click', () => restoreBatchFromArchive(batch.id));
    wrap.appendChild(details);
  });
}

function restoreEntryFromArchive(batchId, entryId) {
  const batch = state.archive.find(b => b.id === batchId);
  if (!batch) return;
  const idx = batch.entries.findIndex(e => e.id === entryId);
  if (idx === -1) return;
  const [entry] = batch.entries.splice(idx, 1);
  state.entries.push(entry);
  if (batch.entries.length === 0) {
    state.archive = state.archive.filter(b => b.id !== batchId);
  }
  saveState();
  renderEntries();
  renderArchive();
  showToast('Eintrag zurück in aktive Liste geholt.');
}

function restoreBatchFromArchive(batchId) {
  const batch = state.archive.find(b => b.id === batchId);
  if (!batch) return;
  if (!confirm(`Alle ${batch.entries.length} Einträge dieses Exports zurück in die aktive Liste holen?`)) return;
  state.entries.push(...batch.entries);
  state.archive = state.archive.filter(b => b.id !== batchId);
  saveState();
  renderEntries();
  renderArchive();
  showToast('Export zurück in aktive Liste geholt.');
}

function drawEntryRow(page, font, row, entry, dailyTotalHours_, isLastOfDay) {
  const { rgb } = PDFLib;
  const size = 10.5;
  const c = TEMPLATE.cols;

  // Datum (einzeilig, vertikal zentriert)
  const datumY = topToPdfY((row.top + row.bottom) / 2 - 3.5);
  page.drawText(formatDateShort(entry.date), { x: c.datum.x0 + TEMPLATE.padLeft, y: datumY, size, font });

  // Kunde: Zeile 1 = Name, Zeile 2 = Adresse (nur eine Zeile Platz -> verkleinern, dann kürzen)
  const kundeMaxW = c.kunde.x1 - c.kunde.x0 - TEMPLATE.padLeft * 2;
  {
    const fit = fitOneLine(font, size, entry.customer, kundeMaxW);
    page.drawText(fit.text, { x: c.kunde.x0 + TEMPLATE.padLeft, y: topToPdfY(row.mid - 4), size: fit.size, font });
  }
  if (entry.address) {
    const fit = fitOneLine(font, size - 1, entry.address, kundeMaxW, 5.5);
    page.drawText(fit.text, { x: c.kunde.x0 + TEMPLATE.padLeft, y: topToPdfY(row.bottom - 4), size: fit.size, font });
  }

  // Arbeitsbeschreibung: 2 Zeilen mit Umbruch
  const maxW = c.beschr.x1 - c.beschr.x0 - TEMPLATE.padLeft * 2;
  const [l1, l2] = wrapTwoLines(font, size, entry.desc, maxW);
  page.drawText(l1, { x: c.beschr.x0 + TEMPLATE.padLeft, y: topToPdfY(row.mid - 4), size, font });
  if (l2) page.drawText(l2, { x: c.beschr.x0 + TEMPLATE.padLeft, y: topToPdfY(row.bottom - 4), size, font });

  // Arbeitszeit Kunde (dieser Eintrag)
  const netH = minutesToHoursDecimal(computeNetMinutes(entry));
  const zk = formatHoursDE(netH);
  const zkWidth = font.widthOfTextAtSize(zk, size);
  const zkCenterX = (c.zeitKunde.x0 + c.zeitKunde.x1) / 2;
  page.drawText(zk, { x: zkCenterX - zkWidth/2, y: topToPdfY((row.top+row.bottom)/2 - 3.5), size, font });

  // Arbeitszeit Gesamt (Tagessumme, nur hinter dem letzten Eintrag des Tages)
  if (isLastOfDay) {
    const zg = formatHoursDE(dailyTotalHours_);
    const zgWidth = font.widthOfTextAtSize(zg, size);
    const zgCenterX = (c.zeitGesamt.x0 + c.zeitGesamt.x1) / 2;
    page.drawText(zg, { x: zgCenterX - zgWidth/2, y: topToPdfY((row.top+row.bottom)/2 - 3.5), size, font });
  }

  // Aufmaß: das zutreffende Kästchen ("Ja"/"Nein") mit einem X markieren
  const boxX0 = entry.aufmass === 'ja' ? TEMPLATE.aufmass.jaX0 : TEMPLATE.aufmass.neinX0;
  const boxX1 = entry.aufmass === 'ja' ? TEMPLATE.aufmass.jaX1 : TEMPLATE.aufmass.neinX1;
  const cyTop = (row.aufmassTop + row.aufmassBottom) / 2;
  const padX = 3, padY = 6;
  const x0 = boxX0 + padX, x1 = boxX1 - padX;
  const yTopPt = topToPdfY(cyTop - padY);
  const yBotPt = topToPdfY(cyTop + padY);
  const xColor = rgb(0, 0, 0);
  page.drawLine({ start: { x: x0, y: yTopPt }, end: { x: x1, y: yBotPt }, thickness: 1.3, color: xColor });
  page.drawLine({ start: { x: x0, y: yBotPt }, end: { x: x1, y: yTopPt }, thickness: 1.3, color: xColor });
}

// ---------- Service Worker ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ---------- Init ----------

initForm();
renderEntries();
renderArchive();
