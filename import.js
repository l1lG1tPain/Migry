// ─── import.js — Excel import + text export ────────────────────────────────

// ── Excel Import ──────────────────────────────────────────────────────────────
// Depends on SheetJS (loaded via CDN in index.html)

function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data  = new Uint8Array(e.target.result);
        const wb    = XLSX.read(data, { type: 'array', cellDates: true });
        const ws    = wb.Sheets[wb.SheetNames[0]];
        const rows  = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        const attacks = convertExcelRows(rows);
        resolve(attacks);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Column mapping (0-based) ──────────────────────────────────────────────────
// 0:Дата  1:Время  2:Головная боль  3:Признаки мигрени  4:Менструальный цикл
// 5:Принятые медикаменты  6:Интенсивность  7:Локализация  8:Характер
// 9:Нагрузки  10:Тошнота  11:ФоТофобия  12:ФоНофобия  13:Триггеры
// 14:Начало боли  15:Окончание боли  16:Комментарии

function convertExcelRows(rows) {
  const attacks = [];
  if (!rows.length) return attacks;

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    if (r[2] !== 'Да') continue; // only headache days

    const dateStr = parseExcelDate(r[0]);
    if (!dateStr) continue;

    const intensity  = parseIntensity(r[6]);
    const location   = parseLocation(r[7]);
    const painType   = parsePainType(r[8]);
    const symptoms   = parseSymptoms(r);
    const triggers   = parseTriggers(r);
    const medications = parseMedications(r[5]);
    const startTime  = resolveTime(dateStr, r[14]);
    const endTime    = resolveTime(dateStr, r[15]);
    const notes      = r[16] ? String(r[16]).trim() : '';
    const timeChip   = toTimeChip(r[14]);

    attacks.push({
      date: dateStr,
      startTime,
      endTime: endTime && r[15] !== 'Нет' && r[15] !== 'нет' ? endTime : null,
      timeChip,
      intensity,
      painType,
      location: location.loc,
      side:     location.side,
      symptoms,
      triggers,
      medications,
      notes,
    });
  }
  return attacks;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseExcelDate(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0,10);
  }
  const s = String(val).trim();
  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  // DD.MM.YYYY
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

function parseIntensity(val) {
  if (val === null || val === undefined || val === '') return 5;
  const n = parseInt(String(val));
  return isNaN(n) ? 5 : Math.max(1, Math.min(10, n));
}

const LOC_MAP = {
  'вся':       { loc: 'full',     side: null    },
  'слева':     { loc: 'temples',  side: 'left'  },
  'справа':    { loc: 'temples',  side: 'right' },
  'лоб':       { loc: 'forehead', side: null    },
  'виски':     { loc: 'temples',  side: null    },
  'вески':     { loc: 'temples',  side: null    },
  'сверху':    { loc: 'top',      side: null    },
  'сверху головы': { loc: 'top',  side: null    },
  'затылок':   { loc: 'back',     side: null    },
  'челюсть':   { loc: 'jaw',      side: null    },
  'зубы':      { loc: 'jaw',      side: null    },
  'веки':      { loc: 'eyelids',  side: null    },
};
function parseLocation(val) {
  if (!val) return { loc: null, side: null };
  const s = String(val).toLowerCase().trim();
  for (const [key, mapped] of Object.entries(LOC_MAP)) {
    if (s.includes(key)) return mapped;
  }
  return { loc: null, side: null };
}

const PAIN_MAP = {
  'ныла':         'aching',
  'распирала':    'bursting',
  'давила':       'pressing',
  'пульсировала': 'throbbing',
  'сжимала':      'squeezing',
  'пронзала':     'sharp',
};
function parsePainType(val) {
  if (!val) return null;
  const s = String(val).toLowerCase().trim();
  for (const [key, mapped] of Object.entries(PAIN_MAP)) {
    if (s.includes(key)) return mapped;
  }
  return null;
}

function parseSymptoms(r) {
  const s = {};
  if (r[10] === 'Да') s.nausea       = true;
  if (r[11] === 'Да') s.photophobia  = true;
  if (r[12] === 'Да') s.phonophobia  = true;
  if (r[3]  === 'Да') s.aura         = true;   // Признаки мигрени
  if (r[4]  === 'Да') s.menstruation = true;   // Менструальный цикл
  return s;
}

const TRIG_TEXT_MAP = {
  'алкоголь': 'alcohol',
  'кальян':   'hookah',
  'стресс':   'stress',
  'погода':   'weather',
  'голод':    'hunger',
  'запах':    'smell',
  'экран':    'screen',
  'кофе':     'caffeine',
  'шум':      'noise',
};
function parseTriggers(r) {
  const t = {};
  if (r[9] === 'Да') t.physActivity = true; // Нагрузки
  const txt = r[13] ? String(r[13]).toLowerCase() : '';
  if (txt) {
    for (const [key, val] of Object.entries(TRIG_TEXT_MAP)) {
      if (txt.includes(key)) t[val] = true;
    }
  }
  return t;
}

// Med format: "Ибупрофен 400, 2 таблетки, Помогло"
const EFF_MAP = { 'помогло': 9, 'немного помогло': 6, 'не помогло': 2, 'не': 2 };
function parseMedications(val) {
  if (!val || val === 'Нет' || val === 'нет') return [];
  const s = String(val).trim();
  const parts = s.split(',').map(p => p.trim());
  const name = parts[0] || '';
  const dose = parts[1] || '';
  let effectiveness = 5;
  const effStr = (parts[2] || '').toLowerCase();
  for (const [key, eff] of Object.entries(EFF_MAP)) {
    if (effStr.includes(key)) { effectiveness = eff; break; }
  }
  if (!name) return [];
  return [{ name, dose, qty: '', effectiveness }];
}

// "Утром" → "08:00" etc.
const TIME_PERIOD_MAP = {
  'утром':   '08:00',
  'днём':    '13:00',
  'вечером': '19:00',
  'ночью':   '02:00',
};
function resolveTime(dateStr, val) {
  if (!val || val === 'Нет' || val === 'нет') return null;
  const s = String(val).trim().toLowerCase();
  const mapped = TIME_PERIOD_MAP[s];
  if (mapped) return `${dateStr}T${mapped}`;
  // HH:MM
  if (/^\d{1,2}:\d{2}$/.test(val)) return `${dateStr}T${String(val).padStart(5,'0')}`;
  return null;
}
function toTimeChip(val) {
  if (!val) return null;
  const s = String(val).trim().toLowerCase();
  const chipMap = { 'утром':'morning', 'днём':'afternoon', 'вечером':'evening', 'ночью':'night' };
  return chipMap[s] || null;
}

// ── Export / Report ───────────────────────────────────────────────────────────
function generateReport(attacks) {
  if (!attacks.length) return 'Нет данных для отчёта.';

  const sorted = [...attacks].sort((a,b)=>new Date(a.startTime||a.date)-new Date(b.startTime||b.date));
  const first  = new Date(sorted[0].startTime || sorted[0].date);
  const last   = new Date(sorted[sorted.length-1].startTime || sorted[sorted.length-1].date);
  const daysSpan = Math.max(1, Math.ceil((last - first) / 86400000) + 1);

  const now = new Date();
  const last30 = attacks.filter(a => (now - new Date(a.startTime||a.date)) < 30*86400000);
  const last90 = attacks.filter(a => (now - new Date(a.startTime||a.date)) < 90*86400000);

  // Monthly breakdown
  const byMonth = {};
  attacks.forEach(a => {
    const key = (a.startTime||a.date||'').slice(0,7);
    if (!byMonth[key]) byMonth[key] = [];
    byMonth[key].push(a);
  });

  const avgInt  = calcAvgIntensity(attacks).toFixed(1);
  const avgDur  = calcAvgDuration(attacks);
  const triggers= calcTriggerRisk(attacks);
  const meds    = calcMedEffectiveness(attacks);
  const symptFreq = calcSymptomFreq(attacks);

  const triggerNames = {
    stress:'Стресс', lessSleep:'Мало сна', moreSleep:'Много сна',
    hunger:'Голод', weather:'Погода', smell:'Запахи', noise:'Шум',
    screen:'Экран', physActivity:'Физ. нагрузка',
    alcohol:'Алкоголь', caffeine:'Кофеин', hookah:'Кальян'
  };
  const symptomNames = {
    nausea:'Тошнота', vomiting:'Рвота', photophobia:'Светобоязнь',
    phonophobia:'Звукобоязнь', aura:'Зрит. мигрень', dizziness:'Головокружение',
    menstruation:'Менструальный цикл'
  };

  const fmtDate = d => d.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
  const fmtShort = d => d.toLocaleDateString('ru-RU', { day:'numeric', month:'long' });

  const topTriggers = Object.entries(triggers)
    .filter(([k,v]) => v >= 30 && k !== 'poorSleep')
    .sort(([,a],[,b])=>b-a).slice(0,4);
  const topSymptoms = Object.entries(symptFreq)
    .filter(([,v]) => v.pct >= 20)
    .sort(([,a],[,b])=>b.pct-a.pct).slice(0,5);

  const monthRows = Object.entries(byMonth)
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([key, arr]) => {
      const [y,m] = key.split('-');
      const mName = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][+m-1];
      const uniqueDays = new Set(arr.map(a=>(a.startTime||a.date||'').slice(0,10))).size;
      const maxInt = Math.max(...arr.map(a=>a.intensity||0));
      return `  ${mName} ${y}: ${uniqueDays} дн. боли, макс. ${maxInt}/10`;
    }).join('\n');

  let report = '';
  report += `╔══════════════════════════════════════════╗\n`;
  report += `║        ДНЕВНИК ГОЛОВНОЙ БОЛИ — МИГРИ     ║\n`;
  report += `╚══════════════════════════════════════════╝\n\n`;

  report += `📅 Период наблюдения\n`;
  report += `   ${fmtDate(first)} — ${fmtDate(last)}\n`;
  report += `   Всего записей: ${attacks.length} приступов за ${daysSpan} дней\n\n`;

  report += `📊 Частота (за 30 дней / за 90 дней)\n`;
  report += `   За последние 30 дн.: ${last30.length} приступов\n`;
  report += `   За последние 90 дн.: ${last90.length} приступов\n`;
  const freq30 = last30.length;
  if      (freq30 >= 15) report += `   ⚠️  ХРОНИЧЕСКАЯ МИГРЕНЬ (≥15/мес)\n`;
  else if (freq30 >= 8)  report += `   ⚠️  Частая мигрень (≥8/мес)\n`;
  else                   report += `   ✅ Эпизодическая форма\n`;
  report += `\n`;

  report += `💢 Интенсивность\n`;
  report += `   Средняя: ${avgInt}/10\n`;
  if (avgDur) {
    const h = Math.floor(avgDur/60), min = avgDur%60;
    report += `   Средняя длительность: ${h>0?h+' ч ':''} ${min} мин\n`;
  }
  report += `\n`;

  if (monthRows) {
    report += `📆 По месяцам\n${monthRows}\n\n`;
  }

  if (topTriggers.length) {
    report += `⚡ Основные триггеры\n`;
    topTriggers.forEach(([k,v]) => {
      report += `   • ${triggerNames[k] || k}: ${v}% приступов\n`;
    });
    report += `\n`;
  }

  if (topSymptoms.length) {
    report += `😣 Частые симптомы\n`;
    topSymptoms.forEach(([k,v]) => {
      report += `   • ${symptomNames[k] || k}: ${v.pct}% приступов\n`;
    });
    report += `\n`;
  }

  if (meds.length) {
    report += `💊 Применяемые препараты\n`;
    meds.slice(0,5).forEach(m => {
      report += `   • ${m.name}: ${m.uses} раз, эффективность ${m.eff}%\n`;
    });
    report += `\n`;
  }

  // Last 3 attacks
  const recent = [...attacks]
    .sort((a,b)=>new Date(b.startTime||b.date)-new Date(a.startTime||a.date))
    .slice(0,3);
  report += `🕐 Последние приступы\n`;
  recent.forEach(a => {
    const dt = new Date(a.startTime||a.date);
    const trigs = Object.entries(a.triggers||{}).filter(([,v])=>v).map(([k])=>triggerNames[k]||k);
    report += `   • ${fmtShort(dt)}: ${a.intensity}/10`;
    if (trigs.length) report += `, триггеры: ${trigs.join(', ')}`;
    report += `\n`;
  });
  report += `\n`;

  report += `──────────────────────────────────────────\n`;
  report += `Сформировано: ${fmtDate(now)}\n`;
  report += `Приложение Мигри — дневник для самонаблюдения.\n`;
  report += `Отчёт предназначен для передачи лечащему врачу.\n`;

  return report;
}