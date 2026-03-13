// ─── Analytics Engine (formulas from ICHD-3 / research) ──────────────────────

// 1. Basic metrics
function calcFrequency(attacks, days) {
  if (!days) return 0;
  return (attacks.length / days) * 30; // per month
}

function calcAvgIntensity(attacks) {
  if (!attacks.length) return 0;
  return attacks.reduce((s, a) => s + (a.intensity || 0), 0) / attacks.length;
}

function calcAvgDuration(attacks) {
  const withDur = attacks.filter(a => a.endTime && a.startTime);
  if (!withDur.length) return null;
  const avgMs = withDur.reduce((s, a) => s + (new Date(a.endTime) - new Date(a.startTime)), 0) / withDur.length;
  return Math.round(avgMs / 60000); // minutes
}

function calcDaysFree(attacks, days) {
  const attackDates = new Set(attacks.map(a => a.date?.slice(0, 10)));
  return Math.max(0, days - attackDates.size);
}

// 2. Trigger risk % (P(T|H=1))
function calcTriggerRisk(attacks) {
  if (!attacks.length) return {};
  const TRIGGERS = ['stress','poorSleep','hunger','weather','smell','screen','alcohol','caffeine'];
  const result = {};
  TRIGGERS.forEach(t => {
    const count = attacks.filter(a => a.triggers?.[t]).length;
    result[t] = Math.round((count / attacks.length) * 100);
  });
  return result;
}

// 3. Pearson correlation between binary trigger and headache (1=headache day)
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
    if (h >= 5  && h < 12) b.morning++;
    else if (h >= 12 && h < 17) b.afternoon++;
    else if (h >= 17 && h < 22) b.evening++;
    else b.night++;
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

// 6. Weekly pattern (day-of-week frequencies)
function calcWeekdayPattern(attacks) {
  const days = new Array(7).fill(0);
  attacks.forEach(a => {
    days[new Date(a.startTime || a.date).getDay()]++;
  });
  return days; // 0=Sun
}

// 7. Symptom frequency
function calcSymptomFreq(attacks) {
  const SYMPTOMS = ['nausea','vomiting','photophobia','phonophobia','aura','dizziness','numbness','weakness'];
  const result = {};
  SYMPTOMS.forEach(s => {
    const count = attacks.filter(a => a.symptoms?.[s]).length;
    result[s] = { count, pct: attacks.length ? Math.round(count/attacks.length*100) : 0 };
  });
  return result;
}

// 8. Main insight generator
function generateInsights(attacks, daysTracked) {
  const insights = [];
  if (!attacks.length) return insights;

  const freq = calcFrequency(attacks, daysTracked);
  const avgInt = calcAvgIntensity(attacks);
  const tod = calcTOD(attacks);
  const triggers = calcTriggerRisk(attacks);
  const meds = calcMedEffectiveness(attacks);

  // Frequency
  if (freq >= 15) {
    insights.push({ type: 'danger', icon: '🚨', title: 'Хроническая мигрень', text: `${freq.toFixed(1)} приступов в месяц — это хроническая мигрень. Срочно обратитесь к неврологу.` });
  } else if (freq >= 8) {
    insights.push({ type: 'warning', icon: '⚠️', title: 'Частые приступы', text: `${freq.toFixed(1)} приступов в месяц. Рекомендуется профилактическое лечение.` });
  } else {
    insights.push({ type: 'good', icon: '✅', title: 'Частота в норме', text: `${freq.toFixed(1)} приступов в месяц — эпизодическая форма.` });
  }

  // Intensity
  if (avgInt >= 7) {
    insights.push({ type: 'warning', icon: '💢', title: 'Высокая интенсивность', text: `Средняя интенсивность ${avgInt.toFixed(1)}/10. Сильные боли — обсудите с врачом.` });
  }

  // Top triggers
  const topTriggers = Object.entries(triggers)
    .filter(([,v]) => v >= 40)
    .sort(([,a],[,b]) => b-a)
    .slice(0, 3);
  const triggerNames = { stress:'стресс', poorSleep:'недосып', hunger:'голод', weather:'погода', smell:'запахи', screen:'экран', alcohol:'алкоголь', caffeine:'кофеин' };
  if (topTriggers.length) {
    insights.push({ type: 'info', icon: '⚡', title: 'Ваши триггеры', text: `Чаще всего: ${topTriggers.map(([k,v])=>`${triggerNames[k]} (${v}%)`).join(', ')}.` });
  }

  // Time of day
  const todMax = Object.entries(tod).sort(([,a],[,b])=>b-a)[0];
  const todNames = { morning:'утром', afternoon:'днём', evening:'вечером', night:'ночью' };
  if (todMax && todMax[1] > 0) {
    insights.push({ type: 'info', icon: '🕐', title: 'Время приступов', text: `Чаще всего приступы начинаются ${todNames[todMax[0]]}.` });
  }

  // Med effectiveness
  if (meds.length > 0 && meds[0].eff >= 70) {
    insights.push({ type: 'good', icon: '💊', title: 'Лекарство работает', text: `${meds[0].name} эффективно для вас на ${meds[0].eff}%.` });
  } else if (meds.length > 0 && meds[0].eff < 50) {
    insights.push({ type: 'warning', icon: '💊', title: 'Низкая эффективность', text: `${meds[0].name} помогает лишь на ${meds[0].eff}%. Обсудите с врачом замену.` });
  }

  // Overuse warning (>10 doses per 10 days)
  const last10 = attacks.filter(a => {
    const d = new Date(a.startTime || a.date);
    const now = new Date();
    return (now - d) < 10 * 86400000;
  });
  const doseCount = last10.reduce((s, a) => s + (a.medications?.length || 0), 0);
  if (doseCount > 10) {
    insights.push({ type: 'danger', icon: '🚫', title: 'Медикаментозная головная боль?', text: `Более 10 доз за 10 дней. Это может вызвать рикошетную головную боль.` });
  }

  return insights;
}