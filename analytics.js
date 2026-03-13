// ─── Analytics Engine (ICHD-3 / research formulas) ───────────────────────────

// 1. Basic metrics
function calcFrequency(attacks, days) {
  if (!days) return 0;
  return (attacks.length / days) * 30;
}

function calcAvgIntensity(attacks) {
  if (!attacks.length) return 0;
  return attacks.reduce((s, a) => s + (a.intensity || 0), 0) / attacks.length;
}

function calcAvgDuration(attacks) {
  const withDur = attacks.filter(a => a.endTime && a.startTime);
  if (!withDur.length) return null;
  const avgMs = withDur.reduce((s, a) => s + (new Date(a.endTime) - new Date(a.startTime)), 0) / withDur.length;
  return Math.round(avgMs / 60000);
}

function calcDaysFree(attacks, days) {
  const attackDates = new Set(attacks.map(a => a.date?.slice(0, 10)));
  return Math.max(0, days - attackDates.size);
}

// 2. Trigger risk % — P(T|H=1)
// Includes legacy 'poorSleep' mapped to both lessSleep + moreSleep for backward compat
function calcTriggerRisk(attacks) {
  if (!attacks.length) return {};
  const TRIGGERS = [
    'stress','lessSleep','moreSleep','poorSleep',
    'hunger','weather','smell','noise','runnyNose',
    'screen','physActivity','alcohol','caffeine','hookah'
  ];
  const result = {};
  TRIGGERS.forEach(t => {
    const count = attacks.filter(a => a.triggers?.[t]).length;
    result[t] = Math.round((count / attacks.length) * 100);
  });
  // merge legacy poorSleep into lessSleep for display
  if (!result.lessSleep && result.poorSleep) result.lessSleep = result.poorSleep;
  return result;
}

// 3. Pearson correlation
function pearson(x, y) {
  const n = x.length; if (n < 3) return 0;
  const mx = x.reduce((s,v)=>s+v,0)/n, my = y.reduce((s,v)=>s+v,0)/n;
  const num = x.reduce((s,v,i)=>s+(v-mx)*(y[i]-my),0);
  const dx  = Math.sqrt(x.reduce((s,v)=>s+(v-mx)**2,0));
  const dy  = Math.sqrt(y.reduce((s,v)=>s+(v-my)**2,0));
  return (dx && dy) ? num/(dx*dy) : 0;
}

// 4. Time-of-day pattern
function calcTOD(attacks) {
  const b = { morning:0, afternoon:0, evening:0, night:0 };
  attacks.forEach(a => {
    const h = new Date(a.startTime || a.date).getHours();
    if      (h >= 5  && h < 12) b.morning++;
    else if (h >= 12 && h < 17) b.afternoon++;
    else if (h >= 17 && h < 22) b.evening++;
    else                         b.night++;
  });
  return b;
}

// 5. Medication effectiveness
function calcMedEffectiveness(attacks) {
  const meds = {};
  attacks.forEach(a => {
    (a.medications || []).forEach(m => {
      if (!m.name?.trim()) return;
      const k = m.name.toLowerCase().trim();
      if (!meds[k]) meds[k] = { label: m.name, total: 0, n: 0 };
      meds[k].total += (m.effectiveness || 5);
      meds[k].n++;
    });
  });
  return Object.values(meds)
    .map(m => ({ name: m.label, eff: Math.round(m.total / m.n * 10), uses: m.n }))
    .sort((a, b) => b.eff - a.eff);
}

// 6. Day-of-week pattern (0=Sun)
function calcWeekdayPattern(attacks) {
  const days = new Array(7).fill(0);
  attacks.forEach(a => { days[new Date(a.startTime || a.date).getDay()]++; });
  return days;
}

// 7. Symptom frequency
function calcSymptomFreq(attacks) {
  const SYMPTOMS = ['nausea','vomiting','photophobia','phonophobia','aura','dizziness','numbness','weakness','menstruation'];
  const result = {};
  SYMPTOMS.forEach(s => {
    const count = attacks.filter(a => a.symptoms?.[s]).length;
    result[s] = { count, pct: attacks.length ? Math.round(count/attacks.length*100) : 0 };
  });
  return result;
}

// ── Insight helpers ───────────────────────────────────────────────────────────
function weekdayName(i) {
  return ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'][i];
}

// 8. Main insight generator
function generateInsights(attacks, daysTracked) {
  const insights = [];
  if (!attacks.length) return insights;

  const freq    = calcFrequency(attacks, daysTracked);
  const avgInt  = calcAvgIntensity(attacks);
  const tod     = calcTOD(attacks);
  const triggers = calcTriggerRisk(attacks);
  const meds    = calcMedEffectiveness(attacks);
  const symptFreq = calcSymptomFreq(attacks);
  const wdPat   = calcWeekdayPattern(attacks);

  // ── 1. Frequency severity ─────────────────────────────────────────────────
  if (freq >= 15) {
    insights.push({ type:'danger',  icon:'🚨', title:'Хроническая мигрень',
      text:`${freq.toFixed(1)} приступов в месяц — это хроническая форма (≥15/мес). Срочно обратитесь к неврологу.` });
  } else if (freq >= 8) {
    insights.push({ type:'warning', icon:'⚠️', title:'Частые приступы',
      text:`${freq.toFixed(1)} приступов в месяц. Рассмотрите профилактическое лечение с врачом.` });
  } else {
    insights.push({ type:'good',    icon:'✅', title:'Частота в норме',
      text:`${freq.toFixed(1)} приступов в месяц — эпизодическая форма, всё под контролем.` });
  }

  // ── 2. Intensity ──────────────────────────────────────────────────────────
  if (avgInt >= 7) {
    insights.push({ type:'warning', icon:'💢', title:'Высокая интенсивность',
      text:`Средняя интенсивность ${avgInt.toFixed(1)}/10. Такие боли требуют обсуждения с врачом.` });
  } else if (avgInt <= 4 && attacks.length >= 3) {
    insights.push({ type:'good', icon:'🙂', title:'Умеренная интенсивность',
      text:`Средняя интенсивность ${avgInt.toFixed(1)}/10 — боль терпимая. Продолжайте отслеживать.` });
  }

  // ── 3. Top triggers ───────────────────────────────────────────────────────
  const triggerNames = {
    stress:'стресс', lessSleep:'мало сна', moreSleep:'много сна', poorSleep:'недосып',
    hunger:'голод', weather:'погода', smell:'запахи', noise:'шум',
    runnyNose:'насморк', screen:'экран', physActivity:'физ. нагрузка',
    alcohol:'алкоголь', caffeine:'кофеин', hookah:'кальян'
  };
  const topTriggers = Object.entries(triggers)
    .filter(([k,v]) => v >= 40 && k !== 'poorSleep')
    .sort(([,a],[,b]) => b-a).slice(0, 3);
  if (topTriggers.length) {
    insights.push({ type:'info', icon:'⚡', title:'Ваши главные триггеры',
      text:`Чаще всего перед приступом: ${topTriggers.map(([k,v])=>`${triggerNames[k]} (${v}%)`).join(', ')}.` });
  }

  // ── 4. Time of day ────────────────────────────────────────────────────────
  const todMax = Object.entries(tod).sort(([,a],[,b])=>b-a)[0];
  const todNames = { morning:'утром', afternoon:'днём', evening:'вечером', night:'ночью' };
  if (todMax && todMax[1] > 0) {
    insights.push({ type:'info', icon:'🕐', title:'Время приступов',
      text:`Чаще всего приступы начинаются ${todNames[todMax[0]]}. Планируйте защитные меры заранее.` });
  }

  // ── 5. Medication effectiveness ───────────────────────────────────────────
  if (meds.length > 0 && meds[0].eff >= 70) {
    insights.push({ type:'good', icon:'💊', title:'Лекарство работает',
      text:`${meds[0].name} эффективно для вас на ${meds[0].eff}%. Отличный выбор — держите всегда под рукой.` });
  } else if (meds.length > 0 && meds[0].eff < 50) {
    insights.push({ type:'warning', icon:'💊', title:'Низкая эффективность лекарства',
      text:`${meds[0].name} помогает лишь на ${meds[0].eff}%. Обсудите с врачом альтернативу.` });
  }

  // ── 6. Medication overuse ─────────────────────────────────────────────────
  const now = new Date();
  const last10days = attacks.filter(a => (now - new Date(a.startTime || a.date)) < 10 * 86400000);
  const doseCount  = last10days.reduce((s, a) => s + (a.medications?.length || 0), 0);
  if (doseCount > 10) {
    insights.push({ type:'danger', icon:'🚫', title:'Риск медикаментозной головной боли',
      text:`Более 10 доз за 10 дней. Злоупотребление анальгетиками само вызывает головную боль.` });
  }

  // ── 7. Aura / visual migraine ─────────────────────────────────────────────
  if (attacks.length >= 5 && symptFreq.aura?.pct >= 30) {
    insights.push({ type:'warning', icon:'👁', title:'Зрительная мигрень',
      text:`Зрительная мигрень отмечается в ${symptFreq.aura.pct}% приступов. Важно сообщить неврологу — это меняет тактику лечения.` });
  }

  // ── 8. Menstruation pattern ───────────────────────────────────────────────
  if (attacks.length >= 3 && symptFreq.menstruation?.pct >= 30) {
    insights.push({ type:'info', icon:'🩸', title:'Менструальная мигрень',
      text:`В ${symptFreq.menstruation.pct}% случаев приступ совпадает с менструацией. Это отдельный вид мигрени — сообщите гинекологу.` });
  }

  // ── 9. Day-of-week pattern ────────────────────────────────────────────────
  if (attacks.length >= 6) {
    const maxWd  = wdPat.indexOf(Math.max(...wdPat));
    const maxVal = wdPat[maxWd];
    const total  = wdPat.reduce((s,v)=>s+v,0);
    if (maxVal / total > 0.25) {
      const isWeekend = maxWd === 0 || maxWd === 6;
      insights.push({ type:'info', icon:'📆', title: isWeekend ? 'Мигрень выходного дня' : 'День недели',
        text: isWeekend
          ? `Приступы чаще в выходные — это «мигрень расслабления». Резкая смена режима сна/кофе провоцирует боль.`
          : `Больше всего приступов приходится на ${weekdayName(maxWd)}. Отследите, что происходит накануне.` });
    }
  }

  // ── 10. Sleep imbalance ───────────────────────────────────────────────────
  const lessS = triggers.lessSleep || 0;
  const moreS = triggers.moreSleep || 0;
  if (lessS >= 35 && moreS >= 20) {
    insights.push({ type:'warning', icon:'😴', title:'Нестабильный сон — главный триггер',
      text:`И мало, и много сна провоцируют приступы. Старайтесь ложиться и вставать в одно время.` });
  } else if (lessS >= 50) {
    insights.push({ type:'warning', icon:'😴', title:'Недосып — частый триггер',
      text:`Мало сна предшествует ${lessS}% приступов. Режим сна — мощная профилактика мигрени.` });
  } else if (moreS >= 40) {
    insights.push({ type:'info', icon:'🛌', title:'Много сна тоже триггер',
      text:`Избыточный сон перед ${moreS}% приступов. Даже в выходные лучше не отступать от режима.` });
  }

  // ── 11. Sensory triggers combo ────────────────────────────────────────────
  const noisePct = triggers.noise || 0;
  const smellPct = triggers.smell || 0;
  if (noisePct >= 30 && smellPct >= 30) {
    insights.push({ type:'info', icon:'🌡️', title:'Сенсорная чувствительность',
      text:`Шум (${noisePct}%) и запахи (${smellPct}%) часто предшествуют приступам. Наушники и чистый воздух — ваши союзники.` });
  }

  return insights;
}