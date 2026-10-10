/* Stundenzettel App — Logik
   Speicherung: localStorage (Einträge lokal); Kundenstamm + Aufmaßnummern zusätzlich über Firebase
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

function formatDateFileDE(iso) {
  // Für Dateinamen: "YYYY-MM-DD" -> "DD.MM.YYYY"
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
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

// ---------- Urlaub: Feiertage Niedersachsen + Aufteilung in Wochen ----------

const URLAUB_STUNDEN_PRO_TAG = 8;

function isVacation(e) { return !!e && e.type === 'urlaub'; }

function easterSunday(year) {
  // Anonymer gregorianischer Algorithmus (Meeus/Jones/Butcher)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const _holidayCache = {};
function holidaysNds(year) {
  // Gesetzliche Feiertage in Niedersachsen: ISO-Datum -> Name
  if (_holidayCache[year]) return _holidayCache[year];
  const easter = easterSunday(year);
  const rel = (days) => { const d = new Date(easter); d.setDate(d.getDate() + days); return isoFromDate(d); };
  const map = {
    [`${year}-01-01`]: 'Neujahr',
    [rel(-2)]: 'Karfreitag',
    [rel(1)]: 'Ostermontag',
    [`${year}-05-01`]: 'Tag der Arbeit',
    [rel(39)]: 'Christi Himmelfahrt',
    [rel(50)]: 'Pfingstmontag',
    [`${year}-10-03`]: 'Tag der Deutschen Einheit',
    [`${year}-10-31`]: 'Reformationstag',
    [`${year}-12-25`]: '1. Weihnachtstag',
    [`${year}-12-26`]: '2. Weihnachtstag'
  };
  _holidayCache[year] = map;
  return map;
}

function holidayName(iso) { return holidaysNds(parseInt(iso.slice(0, 4), 10))[iso] || null; }

function isoWeekMonday(iso) {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // Mo=0 … So=6
  d.setDate(d.getDate() - dow);
  return isoFromDate(d);
}

function isoWeekNumber(iso) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); // Donnerstag derselben Woche
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}

// Liefert für einen Zeitraum die Urlaubs-Blöcke: pro Kalenderwoche (und zusätzlich
// getrennt am Monatswechsel, da der Stundenzettel pro Monat ein eigenes Blatt hat)
// ein Block mit allen Werktagen Mo–Fr, die keine Feiertage sind.
function computeVacationChunks(fromISO, toISO) {
  const chunks = [];
  const skippedHolidays = [];
  if (!fromISO || !toISO || toISO < fromISO) return { chunks, skippedHolidays };
  let cur = fromISO;
  let chunk = null;
  let guard = 0;
  while (cur <= toISO && guard++ < 800) {
    const dow = new Date(cur + 'T00:00:00').getDay();
    const isWeekday = dow >= 1 && dow <= 5;
    const hol = isWeekday ? holidayName(cur) : null;
    if (hol) skippedHolidays.push({ date: cur, name: hol });
    if (isWeekday && !hol) {
      const key = isoWeekMonday(cur) + '|' + monthKey(cur);
      if (!chunk || chunk.key !== key) {
        chunk = { key, start: cur, end: cur, days: [] };
        chunks.push(chunk);
      }
      chunk.end = cur;
      chunk.days.push(cur);
    }
    cur = shiftDateISO(cur, 1);
  }
  return { chunks, skippedHolidays };
}

function vacationDesc(start, end, n) {
  const range = start === end ? formatDateLong(start) : `${formatDateLong(start)} – ${formatDateLong(end)}`;
  return `Urlaub ${range} (${n} ${n === 1 ? 'Tag' : 'Tage'} à ${URLAUB_STUNDEN_PRO_TAG} Std)`;
}

function buildVacationEntry(chunk, blockId) {
  const n = chunk.days.length;
  return {
    id: uid(),
    type: 'urlaub',
    blockId,
    date: chunk.start,
    dateEnd: chunk.end,
    days: n,
    customer: 'Urlaub',
    address: '',
    desc: vacationDesc(chunk.start, chunk.end, n),
    aufmass: 'keins',
    timeMode: 'duration',
    durationHours: n * URLAUB_STUNDEN_PRO_TAG,
    breakMinutes: 0
  };
}

function allVacationEntries() {
  return [...state.entries, ...state.archive.flatMap(b => b.entries)].filter(isVacation);
}

function overlappingVacationDays(days, excludeId = null) {
  const daySet = new Set(days);
  const hits = [];
  allVacationEntries().forEach(e => {
    if (e.id === excludeId) return;
    let d = e.date;
    while (d <= (e.dateEnd || e.date)) { if (daySet.has(d)) hits.push(d); d = shiftDateISO(d, 1); }
  });
  return [...new Set(hits)].sort();
}

function entryDateLabel(e, long = false) {
  if (isVacation(e) && e.dateEnd && e.dateEnd !== e.date) {
    return long ? `${formatDateLong(e.date)} – ${formatDateLong(e.dateEnd)}` : `${formatDateShort(e.date)}–${formatDateShort(e.dateEnd)}`;
  }
  return long ? formatDateLong(e.date) : formatDateShort(e.date);
}

function entryTimeLabel(e) {
  if (isVacation(e)) return `${e.days} ${e.days === 1 ? 'Urlaubstag' : 'Urlaubstage'} × ${URLAUB_STUNDEN_PRO_TAG} Std`;
  return e.timeMode === 'range' ? `${e.start}–${e.end}` : `${formatHoursDE(e.durationHours)} Std`;
}

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
    breakMinutes: null, customer: null, aufmass: null, aufmassNr: null, desc: '', recognized: [] };
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
    let name = m[1].trim().replace(/^(familie|firma|kunden?)\s+/i, '');
    let removeEnd = m.index + m[0].length;
    // Beginnt der erkannte Text mit einem Kunden aus dem Kundenstamm, nur diesen nehmen –
    // der Rest (z. B. "Steckdosen gesetzt") bleibt für die Arbeitsbeschreibung.
    const known = Object.values(state.customers)
      .filter(c => { const k = c.name.toLowerCase(), n = name.toLowerCase(); return n === k || n.startsWith(k + ' '); })
      .sort((x, y) => y.name.length - x.name.length)[0];
    if (known && known.name.length < name.length) {
      const pos = text.toLowerCase().indexOf(known.name.toLowerCase(), m.index);
      if (pos >= 0) { removeEnd = pos + known.name.length; name = known.name; }
    }
    if (name) {
      result.customer = name;
      removeRanges.push([m.index, removeEnd]);
      result.recognized.push(`Kunde: ${name}`);
    }
  }

  // Aufmaß (Sonderzeichen "ß" wird von \b in JS nicht als Wortzeichen erkannt,
  // daher Grenzen manuell über Lookaround statt \b prüfen)
  if (/(?<![a-zäöü])aufmaß(?![a-zäöü])/i.test(text)) {
    result.aufmass = 'ja'; result.recognized.push('Aufmaß: Ja');
    // Aufmaßnummer im Satz, z. B. "Aufmaß SB-26-003" (Diktat liefert evtl. "SB 26 003")
    const nm = text.match(/aufmaß(?:nummer)?\s*(?:nr\.?|nummer)?\s*([A-Za-zÄÖÜäöü]{1,4})[-\s]?(\d{2})[-\s]?(\d{3})(?!\d)/i)
      || text.match(/(?<![A-Za-z0-9])([A-Za-zÄÖÜäöü]{1,4})[-\s]?(\d{2})[-\s]?(\d{3})(?!\d)/);
    if (nm) {
      result.aufmassNr = `${nm[1].toUpperCase()}-${nm[2]}-${nm[3]}`;
      removeRanges.push([nm.index, nm.index + nm[0].length]);
      result.recognized.push(`Aufmaß-Nr.: ${result.aufmassNr}`);
    }
  }

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
    hideSuggest();
  }

  if (result.desc) $('f-desc').value = result.desc;

  if (result.aufmass) {
    setAufmassUI(result.aufmass);
    if (result.aufmassNr) setAufmassNr('f', result.aufmassNr);
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
  hhmm = hhmm || quarterIndexToHHMM(idx);
  $('f-start').value = idx;
  setTP($('f-start-label'), hhmm);
}

function setEndSliderHHMM(hhmm) {
  const idx = hhmmToQuarterIndex(hhmm);
  hhmm = hhmm || quarterIndexToHHMM(idx);
  $('f-end').value = idx;
  setTP($('f-end-label'), hhmm);
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
  // pointerdown reicht auf dem Desktop, aber manche Android-Browser übernehmen das
  // "auf Berührungsposition springen" für <input type=range> intern über den nativen
  // Touch-Pfad, bei dem preventDefault() auf pointerdown nicht zuverlässig greift —
  // deshalb zusätzlich touchstart (explizit non-passive) mit derselben Prüfung abfangen.
  const guard = (e) => {
    const clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : null);
    if (clientX == null) return;
    if (!isPointerOnThumb(inputEl, clientX)) {
      e.preventDefault();
    }
  };
  inputEl.addEventListener('pointerdown', guard, { passive: false });
  inputEl.addEventListener('touchstart', guard, { passive: false });
}

// Uhrzeit-Anzeige: sichtbarer Text (zuverlässig aktualisierbar, auch auf iOS) plus ein
// unsichtbares natives Zeitfeld darüber, das beim Antippen den Zeit-Picker öffnet.
// Prüft, dass "Von" vor "Bis" liegt (wie bei den Schiebern).
function startBeforeEndValidator(otherWrap, isStart) {
  return (hhmm) => {
    const other = getTP(otherWrap);
    if (!other) return null;
    const ok = isStart ? parseHM(hhmm) < parseHM(other) : parseHM(hhmm) > parseHM(other);
    return ok ? null : (isStart ? `„Von“ muss vor „Bis“ (${other}) liegen.` : `„Bis“ muss nach „Von“ (${other}) liegen.`);
  };
}

// "Von" später als (oder gleich) "Bis" -> "Bis" wandert mit und behält die bisherige Dauer
// (z. B. 08:00–12:00, Von auf 13:00 -> 13:00–17:00). Begrenzt auf 23:59.
function startPushesEndValidator(startWrap, endWrap, endSlider) {
  return (hhmm) => {
    const newStart = parseHM(hhmm);
    const end = parseHM(getTP(endWrap));
    if (newStart < end) return null;
    if (newStart >= 23 * 60 + 59) return '„Von“ muss vor 23:59 liegen.';
    const oldDur = end - parseHM(getTP(startWrap));
    const newEnd = Math.min(23 * 60 + 59, newStart + Math.max(15, oldDur));
    const newEndHHMM = `${String(Math.floor(newEnd / 60)).padStart(2, '0')}:${String(newEnd % 60).padStart(2, '0')}`;
    setTP(endWrap, newEndHHMM);
    endSlider.value = hhmmToQuarterIndex(newEndHHMM);
    return null;
  };
}

// Schieber "Von" über "Bis" hinaus -> "Bis" wird eine Viertelstunde dahinter mitgeschoben.
function onStartSliderInput(startEl, endEl, startWrap, endWrap) {
  let startVal = parseInt(startEl.value, 10);
  if (startVal >= QUARTER_MAX) { startVal = QUARTER_MAX - 1; startEl.value = startVal; }
  const startMins = startVal * 15;
  if (startMins >= parseHM(getTP(endWrap))) {
    const endVal = startVal + 1;
    endEl.value = endVal;
    setTP(endWrap, quarterIndexToHHMM(endVal));
  }
  setTP(startWrap, quarterIndexToHHMM(startVal));
}

function timePickHtml(id, hhmm) {
  return `<span class="time-pick" id="${id}"><span class="tp-text time-value">${hhmm}</span><input type="time" value="${hhmm}" aria-label="Uhrzeit direkt eingeben"></span>`;
}
function getTP(wrap) { return wrap.querySelector('.tp-text').textContent.trim(); }
function setTP(wrap, hhmm) {
  wrap.querySelector('.tp-text').textContent = hhmm;
  const inp = wrap.querySelector('input');
  if (inp.value !== hhmm) inp.value = hhmm;
}

// validate(hhmm) liefert eine Fehlermeldung (-> Eingabe wird verworfen) oder null.
function bindTimeInputToSlider(wrap, sliderEl, onChange, validate) {
  const inp = wrap.querySelector('input');
  const sync = () => {
    if (!/^\d{1,2}:\d{2}/.test(inp.value)) return;
    const hhmm = inp.value.slice(0, 5);
    const err = validate ? validate(hhmm) : null;
    if (err) {
      inp.value = getTP(wrap); // auf den letzten gültigen Wert zurücksetzen
      showToast(err);
      return;
    }
    wrap.querySelector('.tp-text').textContent = hhmm;
    sliderEl.value = hhmmToQuarterIndex(hhmm);
    if (onChange) onChange();
  };
  inp.addEventListener('input', sync);
  inp.addEventListener('change', sync);
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
  $('f-nrHost').innerHTML = aufmassPickerHtml('f');
  bindAufmassPicker('f');
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
    $('rangeFields').style.display = timeMode === 'range' ? 'block' : 'none';
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
    setAufmassUI(btn.dataset.aufmass);
  });

  restrictSliderToThumbDrag($('f-start'));
  restrictSliderToThumbDrag($('f-end'));

  $('f-start').addEventListener('input', () => {
    onStartSliderInput($('f-start'), $('f-end'), $('f-start-label'), $('f-end-label'));
    updateComputedHint();
  });
  $('f-end').addEventListener('input', () => {
    const { endVal } = clampTimeSliders($('f-start'), $('f-end'), $('f-end'));
    setTP($('f-end-label'), quarterIndexToHHMM(endVal));
    updateComputedHint();
  });
  // Direkteingabe: Uhrzeit antippen und eintippen/auswählen (minutengenau);
  // der Schieberegler springt auf die nächstliegende Viertelstunde mit.
  bindTimeInputToSlider($('f-start-label'), $('f-start'), updateComputedHint, startPushesEndValidator($('f-start-label'), $('f-end-label'), $('f-end')));
  bindTimeInputToSlider($('f-end-label'), $('f-end'), updateComputedHint, startBeforeEndValidator($('f-start-label'), false));
  $('f-duration').addEventListener('input', updateComputedHint);

  initCustomerField();

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

  $('archiveYearSel').addEventListener('change', renderArchiveMonthView);
  $('archiveExportYearSel').addEventListener('change', renderArchive);

  $('backupExportBtn').addEventListener('click', exportDataBackup);
  $('backupImportBtn').addEventListener('click', () => $('backupImportInput').click());
  $('backupImportInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importDataBackup(file);
    e.target.value = '';
  });

  initVacationForm();
  updateComputedHint();
}

// ---------- Urlaub erfassen ----------

function initVacationForm() {
  $('v-from').addEventListener('change', () => {
    if (!$('v-to').value || $('v-to').value < $('v-from').value) $('v-to').value = $('v-from').value;
    renderVacationPreview();
  });
  $('v-to').addEventListener('change', renderVacationPreview);
  $('saveVacationBtn').addEventListener('click', saveVacation);
  renderVacationPreview();
}

function renderVacationPreview() {
  const from = $('v-from').value, to = $('v-to').value;
  const box = $('vacationPreview');
  if (!from || !to) { box.innerHTML = '<div class="hint">Zeitraum wählen (erster und letzter Urlaubstag).</div>'; return; }
  if (to < from) { box.innerHTML = '<div class="hint" style="color:var(--red)">„Bis“ liegt vor „Von“.</div>'; return; }
  const { chunks, skippedHolidays } = computeVacationChunks(from, to);
  const totalDays = chunks.reduce((s, c) => s + c.days.length, 0);
  if (!chunks.length) { box.innerHTML = '<div class="hint">Im gewählten Zeitraum liegen keine Werktage.</div>'; return; }
  let html = '<div class="vac-preview">';
  chunks.forEach(c => {
    const range = c.start === c.end ? formatDateLong(c.start) : `${formatDateLong(c.start)} – ${formatDateLong(c.end)}`;
    html += `<div class="vac-row"><span>KW ${isoWeekNumber(c.start)}: ${range}</span><span>${c.days.length} T · ${c.days.length * URLAUB_STUNDEN_PRO_TAG} Std</span></div>`;
  });
  html += `<div class="vac-row vac-total"><span>Gesamt: ${totalDays} ${totalDays === 1 ? 'Urlaubstag' : 'Urlaubstage'}</span><span>${totalDays * URLAUB_STUNDEN_PRO_TAG} Std</span></div>`;
  if (skippedHolidays.length) {
    html += `<div class="hint">Feiertage nicht mitgezählt: ${skippedHolidays.map(h => `${formatDateShort(h.date)} ${h.name}`).join(', ')}</div>`;
  }
  const overlap = overlappingVacationDays(chunks.flatMap(c => c.days));
  if (overlap.length) {
    html += `<div class="hint" style="color:var(--red)">Achtung: Für ${overlap.length} dieser Tage ist bereits Urlaub eingetragen (${overlap.map(formatDateShort).join(', ')}).</div>`;
  }
  html += '</div>';
  box.innerHTML = html;
}

function saveVacation() {
  const from = $('v-from').value, to = $('v-to').value;
  if (!from || !to) { showToast('Bitte Von- und Bis-Datum wählen.'); return; }
  if (to < from) { showToast('„Bis“ liegt vor „Von“.'); return; }
  const { chunks } = computeVacationChunks(from, to);
  if (!chunks.length) { showToast('Im Zeitraum liegen keine Werktage.'); return; }
  const overlap = overlappingVacationDays(chunks.flatMap(c => c.days));
  if (overlap.length && !confirm(`Für ${overlap.length} Tag(e) ist bereits Urlaub eingetragen (${overlap.map(formatDateShort).join(', ')}). Trotzdem zusätzlich eintragen?`)) return;
  const blockId = uid();
  chunks.forEach(c => state.entries.push(buildVacationEntry(c, blockId)));
  saveState();
  renderEntries();
  const totalDays = chunks.reduce((s, c) => s + c.days.length, 0);
  showToast(`Urlaub eingetragen: ${totalDays} Tage in ${chunks.length} ${chunks.length === 1 ? 'Eintrag' : 'Einträgen'}.`);
  $('v-from').value = ''; $('v-to').value = '';
  renderVacationPreview();
}

function openVacationEditModal(e) {
  const modal = $('editModal');
  modal.innerHTML = `
    <h3>Urlaubseintrag bearbeiten</h3>
    <div class="hint" style="margin-top:0;">Wochenenden und Feiertage werden automatisch ausgelassen. Der Eintrag muss innerhalb einer Woche und eines Monats bleiben — für längere Zeiträume bitte unter „Urlaub“ neu eintragen.</div>
    <div class="row">
      <div><label>Von</label><input type="date" id="mv-from" value="${e.date}"></div>
      <div><label>Bis</label><input type="date" id="mv-to" value="${e.dateEnd || e.date}"></div>
    </div>
    <div class="hint" id="mv-hint" style="margin-top:10px;"></div>
    <div class="btn-block-row" style="margin-top:16px;">
      <button class="btn btn-secondary" id="m-cancel">Abbrechen</button>
      <button class="btn btn-primary" id="m-save">Speichern</button>
    </div>`;
  const calc = () => {
    const from = modal.querySelector('#mv-from').value, to = modal.querySelector('#mv-to').value;
    const res = computeVacationChunks(from, to);
    let err = null;
    if (!from || !to || to < from) err = 'Bitte gültigen Zeitraum wählen.';
    else if (!res.chunks.length) err = 'Im Zeitraum liegen keine Werktage.';
    else if (res.chunks.length > 1) err = 'Zeitraum geht über eine Woche bzw. einen Monatswechsel hinaus.';
    modal.querySelector('#mv-hint').innerHTML = err
      ? `<span style="color:var(--red)">${err}</span>`
      : `→ ${res.chunks[0].days.length} ${res.chunks[0].days.length === 1 ? 'Tag' : 'Tage'} · ${res.chunks[0].days.length * URLAUB_STUNDEN_PRO_TAG} Std`;
    return err ? null : res.chunks[0];
  };
  modal.querySelector('#mv-from').addEventListener('change', calc);
  modal.querySelector('#mv-to').addEventListener('change', calc);
  calc();
  modal.querySelector('#m-cancel').addEventListener('click', closeEditModal);
  modal.querySelector('#m-save').addEventListener('click', () => {
    const chunk = calc();
    if (!chunk) { showToast('Bitte Zeitraum korrigieren.'); return; }
    const updated = buildVacationEntry(chunk, e.blockId);
    Object.assign(e, updated, { id: e.id });
    saveState();
    renderEntries();
    closeEditModal();
    showToast('Urlaubseintrag aktualisiert.');
  });
  $('editModalBackdrop').classList.add('show');
}

function updateComputedHint() {
  const entry = readFormAsEntry(true);
  if (!entry) { $('computedHint').textContent = ''; return; }
  const mins = computeNetMinutes(entry);
  const h = minutesToHoursDecimal(mins);
  const brk = entry.breakMinutes ? `<span class="ht-sub">nach Abzug von ${entry.breakMinutes} Min Pause</span>` : '';
  $('computedHint').innerHTML = `<span class="ht-label">Arbeitszeit${brk}</span><span class="ht-value">${formatHoursDE(h)}<small>Std</small></span>`;
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
    aufmassNr: aufmass === 'ja' ? getAufmassNr('f') : '',
    timeMode,
    breakMinutes: breakMinutes || 0
  };
  if (timeMode === 'range') {
    entry.start = getTP($('f-start-label')) || quarterIndexToHHMM(parseInt($('f-start').value, 10) || 0);
    entry.end = getTP($('f-end-label')) || quarterIndexToHHMM(parseInt($('f-end').value, 10) || 0);
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
  if (timeMode === 'range' && parseHM(getTP($('f-start-label'))) >= parseHM(getTP($('f-end-label')))) {
    showToast('„Von“ muss vor „Bis“ liegen.'); return;
  }
  if (timeMode === 'duration' && (!$('f-duration').value || parseFloat($('f-duration').value) <= 0)) {
    showToast('Bitte eine Stundenzahl angeben.'); $('f-duration').focus(); return;
  }

  const entry = readFormAsEntry(false);
  state.entries.push(entry);

  // Kunde in den Kundenstamm (neu anlegen bzw. Adresse ergänzen)
  upsertCustomer(customer, $('f-customer-address').value);

  saveState();
  renderEntries();
  showToast('Eintrag gespeichert.');

  resetEntryFormFields();
}

function resetEntryFormFields() {
  // Datum bleibt stehen (für weitere Einträge am selben Tag), alle anderen Felder werden geleert
  $('f-freetext').value = '';
  $('freetextBox').open = false;
  $('f-customer').value = '';
  $('f-customer-address').value = '';
  addrForKey = null;
  hideSuggest();
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

  setAufmassNr('f', '');
  setAufmassUI('nein');

  updateTimeDefaults(); // Von = letztes Bis desselben Tages (oder 07:30), Bis = jetzt aufgerundet
}

// ---------- Eintragsliste ----------

function groupedEntriesByDate() {
  // Urlaubs-Einträge bilden jeweils eine eigene Gruppe (eigene Zeile mit eigener
  // "Gesamt"-Summe), damit sie nicht mit Arbeitseinträgen desselben Tages vermischt werden.
  const map = {};
  const vacGroups = [];
  state.entries.forEach(e => {
    if (isVacation(e)) { vacGroups.push({ date: e.date, vacation: true, entries: [e] }); return; }
    if (!map[e.date]) map[e.date] = [];
    map[e.date].push(e);
  });
  const groups = Object.keys(map).map(date => ({ date, entries: map[date] })).concat(vacGroups);
  return groups.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.vacation ? -1 : 0) - (b.vacation ? -1 : 0));
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
    const groupLabel = g.vacation ? '🏖️ ' + entryDateLabel(g.entries[0], true) : formatDateLong(g.date);
    gDiv.innerHTML = `<div class="entry-group-date"><span>${groupLabel}</span><span class="total">Gesamt: ${formatHoursDE(total)} Std</span></div>`;
    const list = document.createElement('div');
    g.entries.forEach(e => {
      const mins = computeNetMinutes(e);
      const timeLabel = entryTimeLabel(e);
      const item = document.createElement('div');
      item.className = 'entry-item' + (isVacation(e) ? ' vacation' : '');
      item.innerHTML = `
        <div class="info">
          <div class="customer">${escapeHtml(e.customer)} ${aufmassBadge(e)}</div>
          <div class="desc">${escapeHtml(e.desc)}</div>
          <div class="meta">${timeLabel}${e.breakMinutes ? ` · ${e.breakMinutes} Min Pause` : ''} · ${formatHoursDE(minutesToHoursDecimal(mins))} Std</div>
        </div>
        <div class="actions">
          <button class="icon-btn edit" title="Bearbeiten">✏️</button>
          <button class="icon-btn del" title="Löschen">🗑️</button>
        </div>`;
      item.querySelector('.edit').addEventListener('click', () => isVacation(e) ? openVacationEditModal(e) : openEditModal(e.id));
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
    <label>Adresse (Straße/Ort, Telefon)</label>
    <textarea id="m-address" rows="2">${escapeHtml(e.address || (state.customers[custKey(e.customer)] || {}).address || '')}</textarea>
    <label>Arbeitsbeschreibung</label>
    <textarea id="m-desc" rows="3">${escapeHtml(e.desc)}</textarea>
    <label>Zeit</label>
    <div class="segmented" id="m-timeSeg">
      <button type="button" data-mode="range" class="${e.timeMode==='range'?'active':''}">Uhrzeit</button>
      <button type="button" data-mode="duration" class="${e.timeMode==='duration'?'active':''}">Stunden</button>
    </div>
    <div id="m-rangeFields" style="margin-top:10px; display:${e.timeMode==='range'?'block':'none'};">
      <div class="time-slider-group">
        <div class="time-row">Von ${timePickHtml('m-start-label', e.start||'07:30')}</div>
        <input type="range" id="m-start" min="0" max="95" step="1" value="${hhmmToQuarterIndex(e.start||'07:30')}">
      </div>
      <div class="time-slider-group">
        <div class="time-row">Bis ${timePickHtml('m-end-label', e.end||'16:15')}</div>
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
    <div id="m-nrHost"></div>
    <div class="btn-block-row" style="margin-top:16px;">
      <button class="btn btn-secondary" id="m-cancel">Abbrechen</button>
      <button class="btn btn-primary" id="m-save">Speichern</button>
    </div>
  `;
  let mTimeMode = e.timeMode, mAufmass = e.aufmass;
  modal.querySelector('#m-nrHost').innerHTML = aufmassPickerHtml('m');
  bindAufmassPicker('m');
  refreshAufmassPicker('m', e.customer);
  setAufmassNr('m', e.aufmassNr || '');
  $('m-nrBox').style.display = mAufmass === 'ja' ? 'block' : 'none';
  modal.querySelector('#m-customer').addEventListener('input', () => refreshAufmassPicker('m', modal.querySelector('#m-customer').value));
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
    onStartSliderInput(mStartEl, mEndEl, modal.querySelector('#m-start-label'), modal.querySelector('#m-end-label'));
  });
  mEndEl.addEventListener('input', () => {
    const { endVal } = clampTimeSliders(mStartEl, mEndEl, mEndEl);
    setTP(modal.querySelector('#m-end-label'), quarterIndexToHHMM(endVal));
  });
  bindTimeInputToSlider(modal.querySelector('#m-start-label'), mStartEl, null, startPushesEndValidator(modal.querySelector('#m-start-label'), modal.querySelector('#m-end-label'), mEndEl));
  bindTimeInputToSlider(modal.querySelector('#m-end-label'), mEndEl, null, startBeforeEndValidator(modal.querySelector('#m-start-label'), false));
  modal.querySelector('#m-aufmassSeg').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-aufmass]'); if (!btn) return;
    mAufmass = btn.dataset.aufmass;
    modal.querySelectorAll('#m-aufmassSeg button').forEach(b => b.classList.toggle('active', b===btn));
    $('m-nrBox').style.display = mAufmass === 'ja' ? 'block' : 'none';
    if (mAufmass === 'ja') loadAufmassNummern(false);
  });
  modal.querySelector('#m-cancel').addEventListener('click', closeEditModal);
  modal.querySelector('#m-save').addEventListener('click', () => {
    if (mTimeMode === 'range' && parseHM(getTP(modal.querySelector('#m-start-label'))) >= parseHM(getTP(modal.querySelector('#m-end-label')))) {
      showToast('„Von“ muss vor „Bis“ liegen.'); return;
    }
    e.date = modal.querySelector('#m-date').value;
    e.customer = modal.querySelector('#m-customer').value.trim();
    e.desc = modal.querySelector('#m-desc').value.trim();
    e.timeMode = mTimeMode;
    if (mTimeMode === 'range') {
      e.start = getTP(modal.querySelector('#m-start-label')) || quarterIndexToHHMM(parseInt(modal.querySelector('#m-start').value, 10));
      e.end = getTP(modal.querySelector('#m-end-label')) || quarterIndexToHHMM(parseInt(modal.querySelector('#m-end').value, 10));
    } else {
      e.durationHours = parseFloat(modal.querySelector('#m-duration').value) || 0;
    }
    e.breakMinutes = parseFloat(modal.querySelector('#m-break').value) || 0;
    e.aufmass = mAufmass;
    e.aufmassNr = mAufmass === 'ja' ? getAufmassNr('m') : '';
    e.address = modal.querySelector('#m-address').value.trim();
    upsertCustomer(e.customer, e.address);
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

function mergeEntriesByCustomerForExport(entries) {
  // Fasst mehrere Einträge desselben Kunden am selben Tag (z.B. wenn der Kunde
  // zwischendurch verlassen und später wieder aufgesucht wurde) zu EINER Export-Zeile
  // zusammen: Netto-Stunden werden addiert, Beschreibungen zusammengeführt. Die
  // ursprünglichen Einzeleinträge in der App/im Archiv bleiben davon unberührt —
  // die Zusammenführung passiert ausschließlich für den PDF-Export.
  const order = [];
  const groupsByCustomer = {};
  entries.forEach(e => {
    const key = (e.customer || '').trim().toLowerCase();
    if (!groupsByCustomer[key]) { groupsByCustomer[key] = []; order.push(key); }
    groupsByCustomer[key].push(e);
  });
  const merged = [];
  order.forEach(key => {
    const group = groupsByCustomer[key];
    if (group.length === 1) { merged.push(group[0]); return; }
    const totalMinutes = group.reduce((sum, e) => sum + computeNetMinutes(e), 0);
    const descs = [...new Set(group.map(e => (e.desc || '').trim()).filter(Boolean))];
    const withAddress = group.find(e => e.address);
    merged.push({
      id: group.map(e => e.id).join('+'),
      date: group[0].date,
      customer: group[0].customer,
      address: withAddress ? withAddress.address : '',
      desc: descs.join(' + '),
      aufmass: group.some(e => e.aufmass === 'ja') ? 'ja' : 'nein',
      aufmassNr: [...new Set(group.map(e => e.aufmassNr).filter(Boolean))].join(', '),
      timeMode: 'duration',
      durationHours: totalMinutes / 60,
      breakMinutes: 0
    });
  });
  return merged;
}

function buildExportPages() {
  // 1) nach Monat gruppieren (chronologisch), 2) innerhalb des Monats nach Datum gruppieren,
  // 3) Datums-Gruppen so auf Blätter packen, dass eine Datums-Gruppe NIE über zwei Blätter
  //    gesplittet wird (Vorgabe: reicht der Platz nicht, kommt ein komplett neues Blatt).
  // Innerhalb jedes Tages werden mehrere Einträge desselben Kunden zu einer Zeile zusammengeführt.
  const dateGroups = groupedEntriesByDate().map(g => ({
    date: g.date,
    entries: mergeEntriesByCustomerForExport(g.entries)
  })); // sortiert nach Datum
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

  // Dateiname enthält den tatsächlichen Datumsbereich der exportierten Einträge
  // (Stundenzettel_Name_Von_Bis.pdf bzw. nur ein Datum, wenn alles an einem Tag war)
  // statt des Datums, an dem exportiert wurde.
  const exportDates = [...new Set(state.entries.flatMap(e => isVacation(e) && e.dateEnd ? [e.date, e.dateEnd] : [e.date]))].sort();
  const rangeLabel = exportDates.length
    ? (exportDates[0] === exportDates[exportDates.length - 1]
        ? formatDateFileDE(exportDates[0])
        : `${formatDateFileDE(exportDates[0])}_${formatDateFileDE(exportDates[exportDates.length - 1])}`)
    : formatDateFileDE(todayISO());
  const fname = `Stundenzettel_${employeeName ? employeeName.replace(/\s+/g,'_')+'_' : ''}${rangeLabel}.pdf`;

  // Exportierte Einträge ins Archiv verschieben, damit der nächste Export nur noch neue Einträge enthält
  archiveCurrentEntries(fname);

  if (navigator.canShare && navigator.canShare({ files: [new File([blob], fname, { type: 'application/pdf' })] })) {
    try {
      // Bewusst OHNE "title" — iOS Safari legt beim Teilen mit files+title beim "In Dateien
      // sichern" sonst zusätzlich eine .txt-Datei mit dem Titeltext an.
      await navigator.share({ files: [new File([blob], fname, { type: 'application/pdf' })] });
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

// ---------- Archiv: Jahr/Monat-Übersicht ----------

function archiveYearsAvailable() {
  const years = new Set();
  state.archive.forEach(b => b.entries.forEach(e => years.add(e.date.slice(0, 4))));
  years.add(String(new Date().getFullYear()));
  return [...years].sort((a, b) => b - a); // neuestes Jahr zuerst
}

function populateArchiveExportYearFilter() {
  const sel = $('archiveExportYearSel');
  if (!sel) return;
  const years = archiveYearsAvailable();
  const prev = sel.value;
  sel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  sel.value = years.includes(prev) ? prev : years[0];
}

function populateArchiveMonthFilter() {
  const yearSel = $('archiveYearSel');
  if (!yearSel) return;
  const years = archiveYearsAvailable();
  const prevYear = yearSel.value;
  yearSel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSel.value = years.includes(prevYear) ? prevYear : String(new Date().getFullYear());
}

function renderArchiveMonthView() {
  const yearSel = $('archiveYearSel');
  const wrap = $('archiveMonthsWrap');
  if (!yearSel || !wrap) return;
  const year = yearSel.value;

  // Alle 12 Monate des gewählten Jahres anzeigen — jeder Monat einzeln aufklappbar,
  // zugeklappt sieht man nur den Monatsnamen mit der Gesamtstundenzahl.
  wrap.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    const monthStr = String(m).padStart(2, '0');
    const monthKeyVal = `${year}-${monthStr}`;
    const monatName = MONATE[m - 1];

    const matches = []; // { entry, batchId }
    state.archive.forEach(batch => {
      batch.entries.forEach(e => {
        if (monthKey(e.date) === monthKeyVal) matches.push({ entry: e, batchId: batch.id });
      });
    });
    const totalH = matches.reduce((sum, mm) => sum + minutesToHoursDecimal(computeNetMinutes(mm.entry)), 0);

    const details = document.createElement('details');
    details.className = 'archive-batch';
    details.innerHTML = `
      <summary>
        <span>${monatName} <span class="badge">${formatHoursDE(totalH)} Std${matches.length ? ', ' + matches.length + ' ' + (matches.length === 1 ? 'Eintrag' : 'Einträge') : ''}</span></span>
      </summary>
      <div class="archive-batch-body">
        <div class="archive-month-entry-list"></div>
      </div>
    `;

    const listEl = details.querySelector('.archive-month-entry-list');
    if (!matches.length) {
      listEl.innerHTML = '<div class="empty-state">Keine archivierten Einträge in diesem Monat.</div>';
    } else {
      const byDate = {};
      matches.forEach(mm => {
        const key = isVacation(mm.entry) ? `${mm.entry.date}~u${mm.entry.id}` : mm.entry.date; // Urlaub = eigene Gruppe
        (byDate[key] = byDate[key] || []).push(mm);
      });
      Object.keys(byDate).sort().forEach(key => {
        const first = byDate[key][0].entry;
        const dayTotal = byDate[key].reduce((s, mm) => s + minutesToHoursDecimal(computeNetMinutes(mm.entry)), 0);
        const gDiv = document.createElement('div');
        gDiv.className = 'entry-group';
        const label = isVacation(first) ? '🏖️ ' + entryDateLabel(first, true) : formatDateLong(first.date);
        gDiv.innerHTML = `<div class="entry-group-date"><span>${label}</span><span class="total">Gesamt: ${formatHoursDE(dayTotal)} Std</span></div>`;
        const list = document.createElement('div');
        byDate[key].forEach(({ entry: e, batchId }) => {
          const mins = computeNetMinutes(e);
          const timeLabel = entryTimeLabel(e);
          const item = document.createElement('div');
          item.className = 'entry-item';
          item.innerHTML = `
            <div class="info">
              <div class="customer">${escapeHtml(e.customer)} ${aufmassBadge(e)}</div>
              <div class="desc">${escapeHtml(e.desc)}</div>
              <div class="meta">${timeLabel}${e.breakMinutes ? ` · ${e.breakMinutes} Min Pause` : ''} · ${formatHoursDE(minutesToHoursDecimal(mins))} Std</div>
            </div>
            <div class="actions">
              <button class="icon-btn restore-one" title="Zurück in aktive Liste">↩️</button>
            </div>`;
          item.querySelector('.restore-one').addEventListener('click', () => {
            restoreEntryFromArchive(batchId, e.id); // ruft renderArchive() auf, das auch diese Ansicht neu zeichnet
          });
          list.appendChild(item);
        });
        gDiv.appendChild(list);
        listEl.appendChild(gDiv);
      });
    }

    wrap.appendChild(details);
  }
}

function renderArchive() {
  populateArchiveMonthFilter();
  renderArchiveMonthView();
  populateArchiveExportYearFilter();

  const wrap = $('archiveWrap');
  const totalArchived = state.archive.reduce((s, b) => s + b.entries.length, 0);
  $('archiveCountBadge').textContent = totalArchived;
  const exportCountBadge = $('archiveExportCountBadge');
  if (exportCountBadge) exportCountBadge.textContent = state.archive.length;

  if (state.archive.length === 0) {
    wrap.innerHTML = '<div class="empty-state">Noch keine Exporte im Archiv.</div>';
    return;
  }

  // Exportliste nach dem gewählten Jahr filtern (ein Export "gehört" zu einem Jahr,
  // wenn mindestens ein enthaltener Eintrag aus diesem Jahr ist) — hält die Liste
  // übersichtlich, wenn im Laufe der Zeit viele Exporte zusammenkommen.
  const exportYearSel = $('archiveExportYearSel');
  const selectedExportYear = exportYearSel ? exportYearSel.value : null;
  const visibleBatches = selectedExportYear
    ? state.archive.filter(b => b.entries.some(e => e.date.startsWith(selectedExportYear)))
    : state.archive;

  wrap.innerHTML = '';
  if (visibleBatches.length === 0) {
    wrap.innerHTML = `<div class="empty-state">Keine Exporte mit Einträgen aus ${selectedExportYear}.</div>`;
    return;
  }
  visibleBatches.forEach(batch => {
    const totalH = batch.entries.reduce((sum, e) => sum + minutesToHoursDecimal(computeNetMinutes(e)), 0);
    const details = document.createElement('details');
    details.className = 'archive-batch';
    const dateRange = batch.entries.length
      ? [...new Set(batch.entries.flatMap(e => isVacation(e) && e.dateEnd ? [e.date, e.dateEnd] : [e.date]))].sort()
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
      const timeLabel = entryTimeLabel(e);
      const item = document.createElement('div');
      item.className = 'entry-item';
      item.innerHTML = `
        <div class="info">
          <div class="customer">${entryDateLabel(e)} · ${escapeHtml(e.customer)} ${aufmassBadge(e)}</div>
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

  // Datum (einzeilig, vertikal zentriert) — bei Urlaub über mehrere Tage zweizeilig "von –" / "bis"
  if (isVacation(entry) && entry.dateEnd && entry.dateEnd !== entry.date) {
    page.drawText(formatDateShort(entry.date) + ' –', { x: c.datum.x0 + TEMPLATE.padLeft, y: topToPdfY(row.mid - 4), size, font });
    page.drawText(formatDateShort(entry.dateEnd), { x: c.datum.x0 + TEMPLATE.padLeft, y: topToPdfY(row.bottom - 4), size, font });
  } else {
    const datumY = topToPdfY((row.top + row.bottom) / 2 - 3.5);
    page.drawText(formatDateShort(entry.date), { x: c.datum.x0 + TEMPLATE.padLeft, y: datumY, size, font });
  }

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

  // Aufmaß: das zutreffende Kästchen ("Ja"/"Nein") mit einem X markieren (bei Urlaub keins)
  if (isVacation(entry)) return;
  const boxX0 = entry.aufmass === 'ja' ? TEMPLATE.aufmass.jaX0 : TEMPLATE.aufmass.neinX0;
  const boxX1 = entry.aufmass === 'ja' ? TEMPLATE.aufmass.jaX1 : TEMPLATE.aufmass.neinX1;
  const cyTop = (row.aufmassTop + row.aufmassBottom) / 2;
  // Aufmaßnummer links vor der Beschriftung "Aufmaß" (also vor den Ja/Nein-Kästchen)
  if (entry.aufmass === 'ja' && entry.aufmassNr) {
    const A = TEMPLATE.aufmass;
    const fit = fitOneLine(font, A.nrSize, entry.aufmassNr, A.nrRight - A.nrLeft);
    const w = font.widthOfTextAtSize(fit.text, fit.size);
    page.drawText(fit.text, { x: A.nrRight - w, y: topToPdfY(cyTop + A.nrBaselineOffset), size: fit.size, font });
  }
  const padX = 3, padY = 6;
  const x0 = boxX0 + padX, x1 = boxX1 - padX;
  const yTopPt = topToPdfY(cyTop - padY);
  const yBotPt = topToPdfY(cyTop + padY);
  const xColor = rgb(0, 0, 0);
  page.drawLine({ start: { x: x0, y: yTopPt }, end: { x: x1, y: yBotPt }, thickness: 1.3, color: xColor });
  page.drawLine({ start: { x: x0, y: yBotPt }, end: { x: x1, y: yTopPt }, thickness: 1.3, color: xColor });
}

// ---------- Datensicherung (JSON-Export/Import) ----------
// Unabhängig vom localStorage: schützt davor, dass Einträge verloren gehen,
// falls die App auf dem Handy (z.B. wegen eines hakenden Updates) neu eingerichtet
// werden muss — Home-Bildschirm-Icons auf iOS haben teils ihren eigenen, isolierten
// Speicher, der beim Löschen/Neuanlegen des Icons verloren geht.

function exportDataBackup() {
  const backup = {
    type: 'stundenzettel-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    state: {
      entries: state.entries,
      archive: state.archive,
      customers: state.customers,
      employeeName: state.employeeName
    }
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const fname = `Stundenzettel_Sicherung_${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(blob);

  const fallbackDownload = () => {
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('Sicherung wurde heruntergeladen.');
  };

  const file = new File([blob], fname, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    // Bewusst OHNE "title" — siehe Hinweis bei exportPdf() weiter oben.
    navigator.share({ files: [file] })
      .then(() => showToast('Sicherung geteilt/gespeichert.'))
      .catch(() => fallbackDownload());
  } else {
    fallbackDownload();
  }
}

function importDataBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) {
      showToast('Datei konnte nicht gelesen werden — ist es eine gültige Sicherungsdatei?');
      return;
    }
    const incoming = data && data.state ? data.state : data; // akzeptiert auch ein rohes state-Objekt
    if (!incoming || !Array.isArray(incoming.entries)) {
      showToast('Das ist keine gültige Stundenzettel-Sicherungsdatei.');
      return;
    }

    const hasExisting = state.entries.length > 0 || state.archive.length > 0;
    if (hasExisting) {
      const ok = confirm('Es sind bereits Einträge vorhanden. Die Sicherung wird zu den bestehenden Einträgen hinzugefügt (nichts wird überschrieben oder gelöscht). Fortfahren?');
      if (!ok) return;
    }

    const existingIds = new Set([
      ...state.entries.map(e => e.id),
      ...state.archive.flatMap(b => b.entries.map(e => e.id))
    ]);

    const newEntries = (incoming.entries || []).filter(e => e && e.id && !existingIds.has(e.id));
    state.entries.push(...newEntries);
    newEntries.forEach(e => existingIds.add(e.id));

    const existingBatchIds = new Set(state.archive.map(b => b.id));
    let importedArchiveEntries = 0;
    (incoming.archive || []).forEach(batch => {
      if (!batch || existingBatchIds.has(batch.id)) return;
      const filteredEntries = (batch.entries || []).filter(e => e && e.id && !existingIds.has(e.id));
      if (filteredEntries.length) {
        state.archive.push({ ...batch, entries: filteredEntries });
        filteredEntries.forEach(e => existingIds.add(e.id));
        importedArchiveEntries += filteredEntries.length;
      }
    });

    Object.entries(incoming.customers || {}).forEach(([key, val]) => {
      if (!state.customers[key]) state.customers[key] = val;
    });

    if (!state.employeeName && incoming.employeeName) state.employeeName = incoming.employeeName;

    saveState();
    renderEntries();
    renderArchive();
    refreshCustomerList();
    pushLocalCustomers();
    if ($('f-employee')) $('f-employee').value = state.employeeName || '';
    showToast(`Sicherung eingespielt: ${newEntries.length} aktive + ${importedArchiveEntries} archivierte Einträge hinzugefügt.`);
  };
  reader.readAsText(file);
}

// ---------- Service Worker ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// Manuelles Update: räumt den installierten Service Worker + Cache komplett weg und lädt
// die Seite danach neu, damit garantiert die aktuelle Version vom Server geladen wird —
// unabhängig davon, ob die normale Hintergrund-Aktualisierung (noch) gegriffen hat.
async function forceAppUpdate() {
  showToast('Suche nach Updates …');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) { /* auch bei Fehler trotzdem neu laden */ }
  window.location.reload();
}

const updateBtnEl = document.getElementById('updateBtn');
if (updateBtnEl) updateBtnEl.addEventListener('click', forceAppUpdate);

// ---------- Kundenstamm (lokal + gemeinsam über Firebase) ----------
// Jeder erfasste Kunde landet im Kundenstamm (mit Adresse, sobald sie bekannt ist).
// Der Stamm liegt lokal (state.customers → auch offline nutzbar) und – nach Anmeldung –
// zusätzlich in Firestore (Sammlung "kundenstamm", gemeinsam für alle Kollegen und die Aufmaß-App).

function custKey(name) { return (name || '').trim().toLowerCase(); }

// Zu welchem Kunden (Schlüssel) gehört der Inhalt des Adressfelds gerade?
let addrForKey = null;
let suggestItems = [];

const cloud = {
  ready: false, auth: null, db: null, user: null,
  unsubCust: null, remote: {}, syncedOnce: false, permissionDenied: false, permToastShown: false,
  aufmass: [], aufmassLoadedAt: 0, aufmassLoading: false, aufmassError: null
};
const AUFMASS_CACHE_KEY = 'stundenzettel_aufmassnr_v1';

// Legt einen Kunden an bzw. ergänzt seine Adresse. Eine vorhandene Adresse wird nie durch
// eine leere überschrieben. Gibt true zurück, wenn sich etwas geändert hat.
function upsertCustomer(name, address) {
  name = (name || '').trim();
  if (!name) return false;
  address = (address || '').trim();
  const key = custKey(name);
  const cur = state.customers[key];
  let changed = false;
  if (!cur) {
    state.customers[key] = { name, address, t: Date.now() };
    changed = true;
  } else if (address && address !== cur.address) {
    cur.address = address;
    cur.t = Date.now();
    changed = true;
  }
  if (changed) {
    saveState();
    refreshCustomerList();
    cloudPushCustomer(key);
  }
  return changed;
}

function deleteCustomer(key) {
  delete state.customers[key];
  saveState();
  refreshCustomerList();
  cloudPushCustomer(key, true);
}

function customerMatches(q) {
  const ql = q.trim().toLowerCase();
  if (!ql) return [];
  const starts = [], contains = [];
  Object.values(state.customers).forEach(c => {
    const n = (c.name || '').toLowerCase();
    if (n.startsWith(ql)) starts.push(c);
    else if (n.includes(ql) || (c.address || '').toLowerCase().includes(ql)) contains.push(c);
  });
  const byName = (a, b) => a.name.localeCompare(b.name, 'de');
  return starts.sort(byName).concat(contains.sort(byName)).slice(0, 8);
}

const ADDR_LABEL_NEW = 'Adresse (Neukunde) — Straße/Ort, Telefon';

function updateAddressLabel() {
  const name = $('f-customer').value.trim();
  const known = name ? state.customers[custKey(name)] : null;
  const lbl = document.querySelector('label[for="f-customer-address"]');
  if (!known) lbl.textContent = ADDR_LABEL_NEW;
  else if (known.address) lbl.textContent = 'Adresse (aus Kundenstamm – bei Bedarf ergänzen/ändern)';
  else lbl.textContent = 'Adresse fehlt im Kundenstamm noch – hier eintragen, wird übernommen';
}

function hideSuggest() {
  const box = $('customerSuggest');
  if (box) { box.classList.remove('show'); box.innerHTML = ''; }
  suggestItems = [];
}

function renderSuggest() {
  const box = $('customerSuggest');
  const q = $('f-customer').value.trim();
  if (!q) { hideSuggest(); return; }
  const matches = customerMatches(q);
  const exact = state.customers[custKey(q)];
  if (exact && matches.length <= 1) { hideSuggest(); return; }
  suggestItems = matches;
  let html = matches.map((c, i) =>
    `<div class="suggest-item" data-i="${i}"><div class="s-name">${escapeHtml(c.name)}</div>` +
    (c.address ? `<div class="s-addr">${escapeHtml(c.address)}</div>` : '') + '</div>').join('');
  if (!exact) html += `<div class="suggest-item s-new" data-new="1">➕ „${escapeHtml(q)}“ als neuen Kunden übernehmen</div>`;
  box.innerHTML = html;
  box.classList.add('show');
}

function pickCustomer(c) {
  if (!c) return;
  $('f-customer').value = c.name;
  $('f-customer-address').value = c.address || '';
  addrForKey = custKey(c.name);
  $('newCustomerBox').style.display = 'block';
  hideSuggest();
  updateAddressLabel();
  if (aufmass === 'ja') refreshAufmassPicker('f', c.name);
}

function onCustomerInput() {
  const name = $('f-customer').value.trim();
  if (!name) {
    $('newCustomerBox').style.display = 'none';
    hideSuggest();
    if (aufmass === 'ja') refreshAufmassPicker('f', '');
    return;
  }
  $('newCustomerBox').style.display = 'block';
  const key = custKey(name);
  const known = state.customers[key];
  const addrEl = $('f-customer-address');
  if (known) {
    // Adresse des gewählten Kunden übernehmen – außer sie wurde gerade für genau diesen Kunden eingetippt
    if (addrForKey !== key) { addrEl.value = known.address || ''; addrForKey = key; }
  } else if (addrForKey && state.customers[addrForKey]) {
    // Feld enthält noch die Adresse eines anderen (bekannten) Kunden → leeren
    addrEl.value = '';
    addrForKey = null;
  }
  updateAddressLabel();
  renderSuggest();
  if (aufmass === 'ja') refreshAufmassPicker('f', name);
}

function initCustomerField() {
  const inp = $('f-customer');
  inp.addEventListener('input', onCustomerInput);
  inp.addEventListener('focus', renderSuggest);
  inp.addEventListener('blur', () => setTimeout(hideSuggest, 250));
  const box = $('customerSuggest');
  box.addEventListener('mousedown', (e) => e.preventDefault()); // Fokus im Feld lassen
  box.addEventListener('click', (e) => {
    const it = e.target.closest('.suggest-item');
    if (!it) return;
    if (it.dataset.new) {
      const name = inp.value.trim();
      upsertCustomer(name, $('f-customer-address').value);
      hideSuggest();
      updateAddressLabel();
      showToast(`„${name}“ zum Kundenstamm hinzugefügt – Adresse bitte unten eintragen.`);
      $('f-customer-address').focus();
    } else {
      pickCustomer(suggestItems[parseInt(it.dataset.i, 10)]);
    }
  });
  const addr = $('f-customer-address');
  addr.addEventListener('input', () => { addrForKey = custKey(inp.value) || null; });
  // Adresse nachträglich zu einem schon bekannten Kunden eingetragen → in den Stamm übernehmen
  addr.addEventListener('change', () => {
    const name = inp.value.trim();
    const known = name ? state.customers[custKey(name)] : null;
    const a = addr.value.trim();
    if (known && a && a !== known.address) {
      upsertCustomer(name, a);
      updateAddressLabel();
      showToast('Adresse im Kundenstamm ergänzt.');
    }
  });
}

// ----- Kundenstamm-Ansicht -----

function renderCustomerStamm() {
  const wrap = $('stammList');
  if (!wrap) return;
  const q = (($('stammSearch') || {}).value || '').trim().toLowerCase();
  const all = Object.entries(state.customers).map(([key, c]) => ({ key, ...c }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  $('stammCountBadge').textContent = all.length;
  const list = q ? all.filter(c => c.name.toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q)) : all;
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = `<div class="empty-state">${all.length ? 'Kein Kunde gefunden.' : 'Noch keine Kunden im Stamm.'}</div>`;
    return;
  }
  list.slice(0, 40).forEach(c => {
    const item = document.createElement('div');
    item.className = 'entry-item';
    item.innerHTML = `
      <div class="info">
        <div class="customer">${escapeHtml(c.name)}</div>
        <div class="desc">${c.address ? escapeHtml(c.address) : '<span style="color:var(--red)">Adresse fehlt</span>'}</div>
      </div>
      <div class="actions"><button class="icon-btn edit" title="Name/Adresse bearbeiten">✏️</button></div>`;
    item.querySelector('.edit').addEventListener('click', () => openCustomerModal(c.key));
    wrap.appendChild(item);
  });
  if (list.length > 40) {
    const more = document.createElement('div');
    more.className = 'hint';
    more.textContent = `… und ${list.length - 40} weitere – Suche eingrenzen.`;
    wrap.appendChild(more);
  }
}

function refreshCustomerList() {
  renderCustomerStamm();
}

// Kunde umbenennen (z. B. Tippfehler). Ändert sich nur die Groß-/Kleinschreibung, bleibt der
// Schlüssel gleich. Sonst: neuer Eintrag unter neuem Schlüssel, alter wird (für alle) gelöscht.
// Gibt es den neuen Namen schon, werden beide zusammengeführt (vorhandene Adresse bleibt,
// fehlende wird ergänzt). Noch nicht exportierte Einträge werden mit umbenannt.
function renameCustomer(oldKey, newName, address) {
  const c = state.customers[oldKey];
  newName = (newName || '').trim();
  address = (address || '').trim();
  if (!c || !newName) return { ok: false };
  const newKey = custKey(newName);
  const oldName = c.name;
  if (newKey === oldKey) {
    c.name = newName;
    if (address) c.address = address;
    c.t = Date.now();
  } else {
    const target = state.customers[newKey];
    if (target) {
      if (!target.address && (address || c.address)) target.address = address || c.address;
      target.t = Date.now();
    } else {
      state.customers[newKey] = { name: newName, address: address || c.address || '', t: Date.now() };
    }
    delete state.customers[oldKey];
  }
  let moved = 0;
  state.entries.forEach(e => {
    if (!isVacation(e) && custKey(e.customer) === oldKey) {
      e.customer = state.customers[newKey].name;
      if (!e.address && state.customers[newKey].address) e.address = state.customers[newKey].address;
      moved++;
    }
  });
  saveState();
  refreshCustomerList();
  renderEntries();
  cloudPushCustomer(newKey);
  if (newKey !== oldKey) cloudPushCustomer(oldKey, true);
  if ($('f-customer') && custKey($('f-customer').value) === oldKey) {
    $('f-customer').value = state.customers[newKey].name;
    addrForKey = null;
    onCustomerInput();
    hideSuggest();
  }
  return { ok: true, moved, oldName, merged: newKey !== oldKey && !!state.customers[newKey] };
}

function openCustomerModal(key) {
  const c = state.customers[key];
  if (!c) return;
  const modal = $('editModal');
  modal.innerHTML = `
    <h3>Kunde im Kundenstamm</h3>
    <label>Name</label>
    <input type="text" id="mc-name" value="${escapeHtml(c.name)}" autocomplete="off">
    <label>Adresse (Straße/Ort, Telefon)</label>
    <textarea id="mc-address" rows="3">${escapeHtml(c.address || '')}</textarea>
    <div class="hint">Änderungen gelten${cloud.user ? ' für alle Kollegen' : ''}. Bei einem neuen Namen werden auch noch nicht exportierte Einträge dieses Kunden umbenannt; bereits exportierte bleiben unverändert.</div>
    <div class="btn-block-row" style="margin-top:16px;">
      <button class="btn btn-secondary" id="mc-cancel">Abbrechen</button>
      <button class="btn btn-primary" id="mc-save">Speichern</button>
    </div>
    <button class="btn btn-danger" id="mc-del">Kunde löschen</button>`;
  modal.querySelector('#mc-cancel').addEventListener('click', closeEditModal);
  modal.querySelector('#mc-save').addEventListener('click', () => {
    const newName = modal.querySelector('#mc-name').value.trim();
    const a = modal.querySelector('#mc-address').value.trim();
    if (!newName) { showToast('Bitte einen Namen eintragen.'); return; }
    if (!a && c.address) { showToast('Adresse darf nicht leer sein (oder Abbrechen).'); return; }
    if (newName === c.name) {
      if (a) upsertCustomer(c.name, a);
      closeEditModal();
      showToast('Kundenstamm aktualisiert.');
      return;
    }
    const newKey = custKey(newName);
    const existing = newKey !== key ? state.customers[newKey] : null;
    if (existing && !confirm(`„${existing.name}“ gibt es schon im Kundenstamm. „${c.name}“ damit zusammenführen?${existing.address ? '' : ' Die Adresse wird übernommen.'}`)) return;
    const res = renameCustomer(key, newName, a);
    closeEditModal();
    showToast(`${existing ? 'Zusammengeführt' : 'Umbenannt'}: „${res.oldName}“ → „${state.customers[newKey].name}“${res.moved ? ` (${res.moved === 1 ? '1 offener Eintrag' : res.moved + ' offene Einträge'} angepasst)` : ''}.`);
  });
  modal.querySelector('#mc-del').addEventListener('click', () => {
    if (!confirm(`„${c.name}“ aus dem Kundenstamm löschen?${cloud.user ? ' Das gilt für alle Kollegen.' : ''}`)) return;
    deleteCustomer(key);
    closeEditModal();
    showToast('Kunde gelöscht.');
  });
  $('editModalBackdrop').classList.add('show');
}

// ---------- Aufmaßnummer (Auswahl aus der Aufmaßsoftware) ----------

function aufmassBadge(e) {
  if (e.aufmass !== 'ja') return '';
  return `<span class="badge">Aufmaß${e.aufmassNr ? ' ' + escapeHtml(e.aufmassNr) : ''}</span>`;
}

function aufmassPickerHtml(p) {
  return `<div id="${p}-nrBox" style="display:none;">
    <label for="${p}-nrSel" style="display:flex; justify-content:space-between; align-items:center;">
      <span>Aufmaßnummer</span>
      <button type="button" class="icon-btn" id="${p}-nrReload" title="Liste aktualisieren" style="padding:0 4px;">🔄</button>
    </label>
    <select id="${p}-nrSel"></select>
    <input type="text" id="${p}-nrFree" placeholder="Nummer eintippen, z. B. SB-26-003" autocomplete="off" autocapitalize="characters" style="display:none; margin-top:8px;">
    <div class="hint" id="${p}-nrHint"></div>
  </div>`;
}

function getAufmassNr(p) {
  const sel = $(p + '-nrSel');
  if (!sel) return '';
  if (sel.value === '__free__') return (($(p + '-nrFree') || {}).value || '').trim();
  return sel.value || '';
}

function setAufmassNr(p, nr) {
  const sel = $(p + '-nrSel');
  if (!sel) return;
  const free = $(p + '-nrFree');
  nr = (nr || '').trim();
  if (!nr) {
    sel.value = (cloud.aufmass.length ? '' : '__free__');
    free.value = '';
  } else if ([...sel.options].some(o => o.value === nr)) {
    sel.value = nr;
    free.value = '';
  } else {
    sel.value = '__free__';
    free.value = nr;
  }
  free.style.display = sel.value === '__free__' ? 'block' : 'none';
}

function bindAufmassPicker(p) {
  const sel = $(p + '-nrSel');
  sel.addEventListener('change', () => {
    const free = $(p + '-nrFree');
    free.style.display = sel.value === '__free__' ? 'block' : 'none';
    if (sel.value === '__free__') free.focus();
  });
  $(p + '-nrReload').addEventListener('click', async () => {
    if (!cloud.user) { showToast('Bitte zuerst anmelden (☁️ oben).'); return; }
    await loadAufmassNummern(true);
    showToast(cloud.aufmassError ? 'Aufmaßnummern konnten nicht geladen werden.' : `${cloud.aufmass.length} Aufmaßnummern geladen.`);
  });
}

function refreshAufmassPicker(p, customerName) {
  const sel = $(p + '-nrSel');
  if (!sel) return;
  const cur = getAufmassNr(p);
  const list = cloud.aufmass || [];
  const q = (customerName || '').trim().toLowerCase();
  const fits = (a) => q && a.kunde && (a.kunde.toLowerCase().includes(q) || q.includes(a.kunde.toLowerCase()));
  const match = list.filter(fits);
  const rest = list.filter(a => !fits(a)).slice(0, 80);
  const opt = (a) => `<option value="${escapeHtml(a.nummer)}">${escapeHtml(a.nummer)} · ${escapeHtml(a.kunde || '—')}${a.datum ? ' · ' + formatDateFileDE(a.datum) : ''}${a.art === 'Bauaufmaß' ? ' · Bau' : ''}</option>`;
  let html = '<option value="">– Nummer wählen –</option>';
  if (match.length) html += `<optgroup label="Passend zu „${escapeHtml(customerName.trim())}“">${match.map(opt).join('')}</optgroup>`;
  if (rest.length) html += `<optgroup label="${match.length ? 'Weitere' : 'Neueste zuerst'}">${rest.map(opt).join('')}</optgroup>`;
  html += '<option value="__free__">✏️ Andere Nummer eintippen …</option>';
  sel.innerHTML = html;
  setAufmassNr(p, cur);

  const hint = $(p + '-nrHint');
  if (!cloud.user && !list.length) hint.textContent = 'Nicht angemeldet – Nummer eintippen oder oben unter ☁️ anmelden, dann erscheint die Auswahl aus der Aufmaßsoftware.';
  else if (!cloud.user) hint.textContent = `Nicht angemeldet – ${list.length} Nummern vom letzten Abgleich.`;
  else if (cloud.aufmassError && !list.length) hint.textContent = 'Aufmaßnummern konnten nicht geladen werden (offline?) – Nummer bitte eintippen.';
  else if (!list.length) hint.textContent = 'Keine Aufmaßnummern gefunden (in der Aufmaßsoftware muss zuerst ein PDF erstellt sein) – Nummer bitte eintippen.';
  else hint.textContent = `${list.length} Nummern aus der Aufmaßsoftware${match.length ? ` · ${match.length} passend zum Kunden` : ''}.`;
}

function refreshAllAufmassPickers() {
  if ($('f-nrSel')) refreshAufmassPicker('f', $('f-customer').value);
  if ($('m-nrSel')) refreshAufmassPicker('m', ($('m-customer') || {}).value || '');
}

function setAufmassUI(v) {
  aufmass = v;
  document.querySelectorAll('#aufmassSeg button').forEach(b => b.classList.toggle('active', b.dataset.aufmass === v));
  const box = $('f-nrBox');
  if (box) box.style.display = v === 'ja' ? 'block' : 'none';
  if (v === 'ja') {
    refreshAufmassPicker('f', $('f-customer').value);
    loadAufmassNummern(false);
  }
}

async function loadAufmassNummern(force) {
  if (!cloud.user || !cloud.db) return;
  if (!force && Date.now() - cloud.aufmassLoadedAt < 120000) return;
  if (cloud.aufmassLoading) return;
  cloud.aufmassLoading = true;
  try {
    const seen = new Set();
    const liste = [];
    for (const coll of SYNC.aufmassCollections) {
      const snap = await cloud.db.collection('users').doc(cloud.user.uid).collection(coll).get();
      snap.forEach((doc) => {
        const x = doc.data();
        if (!x || x.del || !x.d) return;
        let a;
        try { a = JSON.parse(x.d); } catch (e) { return; }
        if (!a || !a.nummer || seen.has(String(a.nummer))) return;
        seen.add(String(a.nummer));
        liste.push({
          nummer: String(a.nummer),
          kunde: (a.kunde && a.kunde.name) || '',
          baustelle: a.baustelle || '',
          datum: a.datum || (a.erstellt || '').slice(0, 10),
          art: a.typ === 'bau' ? 'Bauaufmaß' : 'Aufmaß'
        });
      });
    }
    liste.sort((x, y) => (y.datum || '').localeCompare(x.datum || '') || y.nummer.localeCompare(x.nummer));
    cloud.aufmass = liste;
    cloud.aufmassLoadedAt = Date.now();
    cloud.aufmassError = null;
    try { localStorage.setItem(AUFMASS_CACHE_KEY, JSON.stringify({ t: Date.now(), list: liste })); } catch (e) { /* ignore */ }
  } catch (err) {
    cloud.aufmassError = err;
  } finally {
    cloud.aufmassLoading = false;
  }
  refreshAllAufmassPickers();
  updateSyncUI();
}

function loadAufmassCache() {
  try {
    const x = JSON.parse(localStorage.getItem(AUFMASS_CACHE_KEY) || 'null');
    if (x && Array.isArray(x.list)) cloud.aufmass = x.list;
  } catch (e) { /* ignore */ }
}

// ---------- Cloud (Firebase): Anmeldung + gemeinsamer Kundenstamm ----------

function cloudInit() {
  loadAufmassCache();
  if (window.firebase && window.FIREBASE_CONFIG) {
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      cloud.auth = firebase.auth();
      cloud.db = firebase.firestore();
      try {
        const p = cloud.db.enablePersistence({ synchronizeTabs: true });
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* Offline-Cache nicht verfügbar – App läuft trotzdem */ }
      cloud.auth.onAuthStateChanged(onAuthChanged);
      cloud.ready = true;
    } catch (e) {
      console.warn('Firebase-Initialisierung fehlgeschlagen', e);
    }
  }
  initSyncUi();
  updateSyncUI();
  window.addEventListener('online', () => { if (cloud.user) loadAufmassNummern(false); });
}

function onAuthChanged(user) {
  cloud.user = user || null;
  if (user) {
    startCustomerSync();
    loadAufmassNummern(true);
  } else {
    stopCustomerSync();
    cloud.aufmass = [];
    cloud.aufmassLoadedAt = 0;
    try { localStorage.removeItem(AUFMASS_CACHE_KEY); } catch (e) { /* ignore */ }
    refreshAllAufmassPickers();
  }
  updateSyncUI();
}

function cloudError(err) {
  if (err && err.code === 'permission-denied') {
    cloud.permissionDenied = true;
    if (!cloud.permToastShown) {
      cloud.permToastShown = true;
      showToast('Gemeinsamer Kundenstamm noch nicht freigeschaltet – Kunden bleiben vorerst nur lokal.');
    }
    updateSyncUI();
  } else {
    console.warn('Cloud-Fehler', err);
  }
}

function customerDocRef(key) {
  return cloud.db.collection(SYNC.customersCollection).doc(encodeURIComponent(key));
}

function cloudPushCustomer(key, deleted) {
  if (!cloud.user || !cloud.db) return;
  const by = cloud.user.email || cloud.user.uid;
  if (deleted) {
    cloud.remote[key] = { address: '', del: true };
    customerDocRef(key).set({ key, del: true, t: Date.now(), by }, { merge: true }).catch(cloudError);
    return;
  }
  const c = state.customers[key];
  if (!c) return;
  cloud.remote[key] = { address: c.address || '', del: false };
  customerDocRef(key).set({ key, name: c.name, address: c.address || '', t: c.t || Date.now(), by, del: false }, { merge: true }).catch(cloudError);
}

function startCustomerSync() {
  stopCustomerSync();
  cloud.syncedOnce = false;
  cloud.remote = {};
  cloud.unsubCust = cloud.db.collection(SYNC.customersCollection).onSnapshot((snap) => {
    cloud.permissionDenied = false;
    let changed = false;
    snap.docChanges().forEach((ch) => {
      const x = ch.doc.data() || {};
      let key = x.key;
      if (!key) { try { key = decodeURIComponent(ch.doc.id); } catch (e) { key = ch.doc.id; } }
      if (ch.type === 'removed') { delete cloud.remote[key]; return; }
      cloud.remote[key] = { address: x.address || '', del: !!x.del };
      if (x.del) {
        if (state.customers[key]) { delete state.customers[key]; changed = true; }
        return;
      }
      if (!x.name) return;
      const cur = state.customers[key];
      // Eine lokal vorhandene Adresse nicht durch eine leere aus der Cloud löschen (sie wird hochgeladen)
      const rec = { name: x.name, address: x.address || (cur && cur.address) || '', t: x.t || 0 };
      if (!cur || cur.name !== rec.name || cur.address !== rec.address) { state.customers[key] = rec; changed = true; }
    });
    if (changed) { saveState(); refreshCustomerList(); updateAddressLabelSafe(); }
    if (!snap.metadata.fromCache && !cloud.syncedOnce) {
      cloud.syncedOnce = true;
      pushLocalCustomers();
    }
    updateSyncUI();
  }, cloudError);
}

function stopCustomerSync() {
  if (cloud.unsubCust) { try { cloud.unsubCust(); } catch (e) { /* ignore */ } }
  cloud.unsubCust = null;
  cloud.syncedOnce = false;
  cloud.remote = {};
}

function updateAddressLabelSafe() {
  try { updateAddressLabel(); } catch (e) { /* ignore */ }
}

// Lädt lokal vorhandene Kunden hoch, die in der Cloud fehlen (oder dort noch keine Adresse haben).
function pushLocalCustomers() {
  if (!cloud.user || !cloud.db || !cloud.syncedOnce) return;
  const by = cloud.user.email || cloud.user.uid;
  const ops = [];
  Object.entries(state.customers).forEach(([key, c]) => {
    const r = cloud.remote[key];
    if (!r) ops.push({ key, data: { key, name: c.name, address: c.address || '', t: c.t || Date.now(), by, del: false } });
    else if (!r.del && !r.address && c.address) ops.push({ key, data: { address: c.address, t: Date.now(), by } });
  });
  if (!ops.length) return;
  for (let i = 0; i < ops.length; i += 400) {
    const batch = cloud.db.batch();
    ops.slice(i, i + 400).forEach(o => {
      batch.set(customerDocRef(o.key), o.data, { merge: true });
      cloud.remote[o.key] = { address: o.data.address || '', del: false };
    });
    batch.commit().catch(cloudError);
  }
  showToast(`${ops.length} Kunden mit dem gemeinsamen Kundenstamm abgeglichen.`);
}

// ----- Anmelde-Oberfläche -----

function authErrorText(err) {
  switch (err && err.code) {
    case 'auth/invalid-email': return 'Ungültige E-Mail-Adresse.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential': return 'E-Mail oder Passwort stimmt nicht.';
    case 'auth/too-many-requests': return 'Zu viele Versuche – bitte kurz warten.';
    case 'auth/network-request-failed': return 'Keine Internetverbindung.';
    case 'auth/user-disabled': return 'Dieses Konto ist gesperrt.';
    default: return 'Anmeldung fehlgeschlagen' + (err && err.code ? ' (' + err.code + ')' : '.');
  }
}

// ----- Seite "Einstellungen & Sicherung" (eigene Ansicht, per #einstellungen erreichbar) -----
let mainScrollY = 0;
function applyView() {
  const settings = location.hash === '#einstellungen';
  if (!settings) settingsPushed = false;
  if (settings && $('settingsView').style.display !== 'none') return;
  if (!settings && $('mainView').style.display !== 'none') return;
  if (settings) mainScrollY = window.scrollY;
  $('mainView').style.display = settings ? 'none' : 'block';
  $('settingsView').style.display = settings ? 'block' : 'none';
  hideSuggest();
  closeEditModal();
  window.scrollTo(0, settings ? 0 : mainScrollY);
}
let settingsPushed = false; // true = Einstellungen wurden per Button geöffnet (Verlaufseintrag vorhanden)
function openSettings() {
  if (location.hash !== '#einstellungen') { settingsPushed = true; location.hash = '#einstellungen'; }
  else applyView();
}
function closeSettings() {
  if (settingsPushed) { settingsPushed = false; history.back(); return; }
  // z. B. nach Neuladen auf der Einstellungsseite: ohne Verlauf direkt zurückschalten
  history.replaceState(null, '', location.pathname + location.search);
  applyView();
}

function initSyncUi() {
  $('syncBtn').addEventListener('click', openSettings);
  $('openSettingsBtn').addEventListener('click', openSettings);
  $('closeSettingsBtn').addEventListener('click', closeSettings);
  window.addEventListener('hashchange', applyView);
  applyView();
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!cloud.auth) { showToast('Cloud-Funktion nicht verfügbar.'); return; }
    const email = $('login-email').value.trim();
    const pw = $('login-pw').value;
    if (!email || !pw) { showToast('Bitte E-Mail und Passwort eingeben.'); return; }
    $('loginBtn').disabled = true;
    try {
      await cloud.auth.signInWithEmailAndPassword(email, pw);
      $('login-pw').value = '';
      showToast('Angemeldet.');
    } catch (err) {
      showToast(authErrorText(err));
    } finally {
      $('loginBtn').disabled = false;
    }
  });
  $('resetPwBtn').addEventListener('click', async () => {
    const email = $('login-email').value.trim();
    if (!cloud.auth || !email) { showToast('Bitte zuerst die E-Mail-Adresse eintragen.'); return; }
    try { await cloud.auth.sendPasswordResetEmail(email); showToast('E-Mail zum Zurücksetzen wurde gesendet.'); }
    catch (err) { showToast(authErrorText(err)); }
  });
  $('logoutBtn').addEventListener('click', async () => {
    if (!cloud.auth) return;
    await cloud.auth.signOut();
    showToast('Abgemeldet.');
  });
  $('stammSearch').addEventListener('input', renderCustomerStamm);
}

function updateSyncUI() {
  const on = !!cloud.user;
  $('syncDot').classList.toggle('on', on && !cloud.permissionDenied);
  $('loginForm').style.display = on || !cloud.ready ? 'none' : 'block';
  $('loggedBox').style.display = on ? 'block' : 'none';
  const lines = [];
  if (!cloud.ready) {
    lines.push('Cloud-Funktion nicht verfügbar – die App arbeitet nur lokal.');
  } else if (!on) {
    lines.push('Nicht angemeldet. Mit demselben Konto wie in der Aufmaßsoftware anmelden, um Aufmaßnummern auszuwählen und den gemeinsamen Kundenstamm zu nutzen. Bis dahin bleiben Kunden nur auf diesem Gerät und werden nach der Anmeldung automatisch abgeglichen.');
  } else {
    lines.push(`✅ Angemeldet als ${escapeHtml(cloud.user.email || '')}`);
    if (cloud.permissionDenied) lines.push('<span style="color:var(--red)">⚠️ Gemeinsamer Kundenstamm noch nicht freigeschaltet (Firestore-Regel fehlt) – Kunden bleiben vorerst nur auf diesem Gerät.</span>');
    else lines.push(`Kundenstamm: ${Object.keys(state.customers).length} Kunden${cloud.syncedOnce ? ' (abgeglichen)' : ' (wird abgeglichen …)'}`);
    if (cloud.aufmassError && !cloud.aufmass.length) lines.push('Aufmaßnummern konnten nicht geladen werden.');
    else lines.push(`Aufmaßnummern: ${cloud.aufmass.length} geladen`);
  }
  $('syncStatus').innerHTML = lines.join('<br>');
}


// ---------- Init ----------

initForm();
renderEntries();
renderArchive();
refreshCustomerList();
cloudInit();
