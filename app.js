// ─── State ─────────────────────────────────────────────────────────────────
let allAttacks = [];
let calMonth, calYear;
let selectedPills  = {};
let selectedChip   = null; // active time chip key
let medRowCount    = 0;

const MONTHS_RU  = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const INTENSITY_EMOJI = { 1:'😌', 2:'🙂', 3:'😶', 4:'😕', 5:'😐', 6:'😣', 7:'😖', 8:'😩', 9:'😫', 10:'🤯' };
const SYMPTOM_LABEL = {
  nausea:'Тошнота', vomiting:'Рвота', photophobia:'Свет', phonophobia:'Звук',
  aura:'Зрит. мигрень', dizziness:'Головокружение', numbness:'Онемение',
  weakness:'Слабость', menstruation:'Менструация'
};
const TRIGGER_LABEL = {
  stress:'Стресс', lessSleep:'Мало сна', moreSleep:'Много сна', poorSleep:'Недосып',
  hunger:'Голод', weather:'Погода', smell:'Запахи', noise:'Шум',
  runnyNose:'Насморк', screen:'Экран', physActivity:'Физ. нагрузка',
  alcohol:'Алкоголь', caffeine:'Кофеин', hookah:'Кальян'
};

// Time chip → computed time (hours offset from now, or fixed hour)
const CHIP_MAP = {
  morning:   { label:'Утром',       fixedHour: 8  },
  afternoon: { label:'Днём',        fixedHour: 13 },
  evening:   { label:'Вечером',     fixedHour: 19 },
  night:     { label:'Ночью',       fixedHour: 2  },
  ago1:      { label:'1–2 ч назад', offsetMin: 90  },
  ago3:      { label:'3–4 ч назад', offsetMin: 210 },
  ago5:      { label:'5+ ч назад',  offsetMin: 300 },
};

// ─── Init ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    await openDB();
    allAttacks = await getAllAttacks();
  } catch (e) {
    console.error('DB:', e);
    allAttacks = [];
  }
  const now = new Date();
  calMonth = now.getMonth();
  calYear  = now.getFullYear();

  initTheme();
  initMedRows();
  setDefaultDate();
  renderAll();
  setupListeners();
  registerSW();
}

function renderAll() {
  renderCalendar();
  renderStats();
  renderLastAttack();
  renderWeekCards();
  renderTimeOfDay();
  renderMedications();
  renderInsights();
}

// ─── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('migry_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('migry_theme', next);
  updateThemeIcon(next);
}
function updateThemeIcon(theme) {
  const btn = document.getElementById('themeToggle');
  btn.querySelector('.icon-sun').style.display  = theme === 'dark'  ? 'block' : 'none';
  btn.querySelector('.icon-moon').style.display = theme === 'light' ? 'block' : 'none';
}

// ─── Calendar ───────────────────────────────────────────────────────────────
function renderCalendar() {
  document.getElementById('calendarTitle').textContent = `${MONTHS_RU[calMonth]} ${calYear}`;

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay  = new Date(calYear, calMonth + 1, 0);
  const grid     = document.getElementById('calendarGrid');

  // attack map: day → max intensity
  const attackMap = {};
  allAttacks.forEach(a => {
    const d = new Date(a.startTime || a.date);
    if (d.getMonth() === calMonth && d.getFullYear() === calYear) {
      const key = d.getDate();
      attackMap[key] = Math.max(attackMap[key] || 0, a.intensity || 0);
    }
  });

  let dow = firstDay.getDay();
  if (dow === 0) dow = 7;
  dow--;

  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  let html = '';
  for (let i = 0; i < dow; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const intensity = attackMap[d] || 0;
    let ic = '';
    if (intensity > 0) ic = intensity <= 3 ? 'low' : intensity <= 6 ? 'mid' : 'high';

    html += `<div class="cal-cell${isToday ? ' today' : ''}${intensity ? ' has-attack' : ''}" data-intensity="${ic}" data-date="${dateStr}">
      <span class="cal-day">${d}</span>
      ${intensity ? '<span class="cal-dot"></span>' : ''}
    </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const dateStr = cell.dataset.date;
      const attacks = allAttacks.filter(a => (a.startTime || a.date || '').startsWith(dateStr));

      if (attacks.length === 0) {
        // Empty day → open sheet pre-filled with that date
        openSheet(dateStr);
      } else {
        // Has attacks → show detail modal with "+ Add" button
        showDayModal(attacks, dateStr, true);
      }
    });
  });
}

// ─── Stats ──────────────────────────────────────────────────────────────────
function renderStats() {
  const now    = new Date();
  const last30 = allAttacks.filter(a => (now - new Date(a.startTime || a.date)) < 30 * 86400000);
  const days   = allAttacks.length
    ? Math.max(1, Math.ceil((now - new Date(Math.min(...allAttacks.map(a => new Date(a.startTime||a.date||now))))) / 86400000) + 1)
    : 30;
  const avgInt  = last30.length ? calcAvgIntensity(last30).toFixed(1) : '—';
  const daysFree = last30.length ? calcDaysFree(last30, Math.min(30, days)) : '—';

  document.getElementById('statFreq').textContent         = last30.length || '—';
  document.getElementById('statAvgIntensity').textContent = avgInt;
  document.getElementById('statDaysFree').textContent     = daysFree;
}

// ─── Last Attack ─────────────────────────────────────────────────────────────
function renderLastAttack() {
  const card = document.getElementById('lastAttackCard');
  if (!allAttacks.length) {
    card.innerHTML = `<div class="empty-state"><span class="empty-icon">✨</span><p>Нет записей — нажми «Записать приступ»!</p></div>`;
    card.onclick = null;
    return;
  }
  const a = [...allAttacks].sort((x,y) => new Date(y.startTime||y.date) - new Date(x.startTime||x.date))[0];
  const dt = new Date(a.startTime || a.date);
  const ago = timeAgo(dt);
  const intLevel = a.intensity <= 3 ? 'low' : a.intensity <= 6 ? 'medium' : 'high';
  const intLabel = { low:'Слабая', medium:'Средняя', high:'Сильная' }[intLevel];
  const symptoms = Object.entries(a.symptoms || {}).filter(([,v])=>v).map(([k])=>SYMPTOM_LABEL[k]).filter(Boolean);
  const triggers = Object.entries(a.triggers || {}).filter(([,v])=>v).map(([k])=>TRIGGER_LABEL[k]).filter(Boolean);
  let dur = '';
  if (a.endTime && a.startTime) {
    const m = Math.round((new Date(a.endTime) - new Date(a.startTime)) / 60000);
    dur = m >= 60 ? `${Math.floor(m/60)} ч ${m%60} мин` : `${m} мин`;
  }
  const medName = a.medications?.[0]?.name || '';

  card.innerHTML = `
    <div class="la-header">
      <div><div class="la-date">${formatDate(dt)}</div><div class="la-ago">${ago}</div></div>
      <span class="la-badge ${intLevel}">${intLabel} · ${a.intensity}/10</span>
    </div>
    <div class="la-intensity-bar"><div class="la-intensity-fill" style="width:${(a.intensity/10)*100}%"></div></div>
    ${symptoms.length ? `<div class="la-tags">${symptoms.map(s=>`<span class="la-tag">😣 ${s}</span>`).join('')}</div>` : ''}
    ${triggers.length ? `<div class="la-tags">${triggers.map(t=>`<span class="la-tag">⚡ ${t}</span>`).join('')}</div>` : ''}
    <div class="la-meta">
      ${dur ? `<span class="la-meta-item">⏱ ${dur}</span>` : ''}
      ${medName ? `<span class="la-meta-item">💊 ${medName}</span>` : ''}
    </div>`;
  card.style.cursor = 'pointer';
  card.onclick = () => showDayModal([a], (a.startTime||a.date||'').slice(0,10), false);
}

// ─── Week Cards ──────────────────────────────────────────────────────────────
function renderWeekCards() {
  const container = document.getElementById('weekCards');
  const today = new Date(); today.setHours(0,0,0,0);
  const dow = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  let html = '';

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    const dateStr  = d.toISOString().slice(0,10);
    const isToday  = d.getTime() === today.getTime();
    const isFuture = d > today;
    const dayAttacks = allAttacks.filter(a => (a.startTime||a.date||'').startsWith(dateStr));
    const maxInt = dayAttacks.length ? Math.max(...dayAttacks.map(a=>a.intensity||0)) : 0;
    let dotClass = 'empty';
    if (!isFuture && dayAttacks.length === 0) dotClass = 'ok';
    else if (maxInt > 0) dotClass = maxInt <= 3 ? 'low' : maxInt <= 6 ? 'mid' : 'high';

    html += `<div class="week-card${isToday ? ' today-card' : ''}" data-date="${dateStr}">
      <span class="wc-day">${DAYS[i]}</span>
      <span class="wc-num">${d.getDate()}</span>
      <span class="wc-dot ${dotClass}"></span>
    </div>`;
  }
  container.innerHTML = html;
  container.querySelectorAll('.week-card').forEach(card => {
    card.addEventListener('click', () => {
      const date    = card.dataset.date;
      const attacks = allAttacks.filter(a => (a.startTime||a.date||'').startsWith(date));
      if (attacks.length) showDayModal(attacks, date, false);
    });
  });
}

// ─── Time of Day ─────────────────────────────────────────────────────────────
function renderTimeOfDay() {
  if (!allAttacks.length) return;
  const tod = calcTOD(allAttacks);
  const max = Math.max(...Object.values(tod), 1);
  const labels = { morning:'Утро', afternoon:'День', evening:'Вечер', night:'Ночь' };
  const icons  = { morning:'🌅', afternoon:'☀️', evening:'🌆', night:'🌙' };
  let html = '';
  Object.entries(tod).forEach(([key, count]) => {
    html += `<div class="tod-bar-wrap">
      <span class="tod-count">${count}</span>
      <div class="tod-bar-track"><div class="tod-bar-fill" style="height:${Math.round((count/max)*100)}%"></div></div>
      <span class="tod-label">${icons[key]}</span>
      <span class="tod-label">${labels[key]}</span>
    </div>`;
  });
  const maxEntry = Object.entries(tod).sort(([,a],[,b])=>b-a)[0];
  const todNames = { morning:'утром', afternoon:'днём', evening:'вечером', night:'ночью' };
  document.getElementById('todChart').innerHTML = html;
  document.getElementById('todInsight').textContent = maxEntry[1] > 0
    ? `Чаще всего приступы начинаются ${todNames[maxEntry[0]]}.`
    : 'Запишите несколько приступов, чтобы увидеть паттерн';
}

// ─── Medications ──────────────────────────────────────────────────────────────
function renderMedications() {
  const card = document.getElementById('medicationCard');
  const meds = calcMedEffectiveness(allAttacks);
  if (!meds.length) {
    card.innerHTML = `<div class="empty-state"><span class="empty-icon">💊</span><p>Добавьте данные о лекарствах при записи приступа</p></div>`;
    return;
  }
  card.innerHTML = `<div class="med-list">${meds.slice(0,5).map(m=>`
    <div class="med-item">
      <div class="med-row"><span class="med-name">${m.name}</span><span class="med-meta">${m.uses} раз · ${m.eff}%</span></div>
      <div class="med-bar-track"><div class="med-bar-fill" style="width:${m.eff}%"></div></div>
    </div>`).join('')}</div>`;
}

// ─── Insights ────────────────────────────────────────────────────────────────
function renderInsights() {
  const container  = document.getElementById('insightsList');
  const now        = new Date();
  const daysTracked = allAttacks.length
    ? Math.ceil((now - new Date(Math.min(...allAttacks.map(a=>new Date(a.startTime||a.date||now))))) / 86400000) + 1
    : 0;

  if (daysTracked < 7 || allAttacks.length < 2) {
    const p = Math.min(daysTracked, 7);
    container.innerHTML = `<div class="glass-card insight-placeholder">
      <span class="insight-icon">🔮</span>
      <p>Инсайты появятся после 7 дней записей</p>
      <div class="progress-track"><div class="progress-bar" style="width:${(p/7)*100}%"></div></div>
      <span class="progress-label">${p}/7 дней</span>
    </div>`;
    return;
  }

  const insights = generateInsights(allAttacks, daysTracked);
  container.innerHTML = `<div class="insight-cards">${insights.map((ins,i)=>`
    <div class="insight-card ${ins.type}" style="animation-delay:${i*60}ms">
      <div class="insight-icon-wrap">${ins.icon}</div>
      <div class="insight-body">
        <div class="insight-title">${ins.title}</div>
        <div class="insight-text">${ins.text}</div>
      </div>
    </div>`).join('')}</div>
  <p class="disclaimer" style="margin-top:8px">⚕️ Только для самоанализа. Не замена врачу.</p>`;
}

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────
function openSheet(presetDate = null) {
  // pre-fill date if passed (from calendar click)
  if (presetDate) {
    document.getElementById('startDate').value = presetDate;
  } else {
    setDefaultDate();
  }
  // reset chip
  selectedChip = null;
  document.querySelectorAll('.time-chip.active').forEach(c => c.classList.remove('active'));
  document.getElementById('timeChipResult').style.display = 'none';

  document.getElementById('bottomSheet').classList.add('open');
  document.getElementById('sheetOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  document.getElementById('bottomSheet').classList.remove('open');
  document.getElementById('sheetOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ─── Time chip helpers ────────────────────────────────────────────────────────
function computeChipTime(chipKey) {
  const now = new Date();
  const cfg = CHIP_MAP[chipKey];
  if (!cfg) return null;

  if (cfg.offsetMin !== undefined) {
    return new Date(now.getTime() - cfg.offsetMin * 60000);
  }
  // Fixed hour — use today (or yesterday for night/early morning)
  const dt = new Date(now);
  dt.setHours(cfg.fixedHour, 0, 0, 0);
  // If fixedHour is in the future and we pick "Ночью", move to yesterday
  if (chipKey === 'night' && dt > now) dt.setDate(dt.getDate() - 1);
  return dt;
}

function formatTime(dt) {
  return dt.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
}

// ─── Medication rows ──────────────────────────────────────────────────────────
function initMedRows() {
  medRowCount = 0;
  document.getElementById('medRows').innerHTML = '';
  addMedRow();
}

function addMedRow() {
  medRowCount++;
  const id  = medRowCount;
  const row = document.createElement('div');
  row.className  = 'med-row-item';
  row.dataset.id = id;
  row.innerHTML  = `
    <input type="text"  class="glass-input med-inp" placeholder="Ибупрофен"  data-field="name"  data-rowid="${id}">
    <input type="text"  class="glass-input med-inp" placeholder="400 мг"     data-field="dose"  data-rowid="${id}">
    <input type="text"  class="glass-input med-inp" placeholder="1 таб"      data-field="qty"   data-rowid="${id}">
    ${id > 1 ? `<button type="button" class="med-remove-btn" onclick="removeMedRow(${id})" aria-label="Удалить">✕</button>` : ''}
  `;
  document.getElementById('medRows').appendChild(row);
}

function removeMedRow(id) {
  document.querySelector(`.med-row-item[data-id="${id}"]`)?.remove();
}

function getMedications() {
  const rows = document.querySelectorAll('.med-row-item');
  const meds = [];
  const effectiveness = +document.getElementById('medEffSlider').value;
  rows.forEach(row => {
    const name = row.querySelector('[data-field="name"]').value.trim();
    const dose = row.querySelector('[data-field="dose"]').value.trim();
    const qty  = row.querySelector('[data-field="qty"]').value.trim();
    if (name) meds.push({ name, dose, qty, effectiveness });
  });
  return meds;
}

// ─── Form default / reset ─────────────────────────────────────────────────────
function setDefaultDate() {
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('startDate').value = today;
}

function getCheckedValues(name) {
  const result = {};
  document.querySelectorAll(`input[name="${name}"]:checked`).forEach(el => { result[el.value] = true; });
  return result;
}

// ─── Form submit ──────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();

  const startDate = document.getElementById('startDate').value;
  if (!startDate) { showToast('Укажи дату начала приступа'); return; }

  // Compute actual startTime from date + chip (or use noon as fallback)
  let startDt = new Date(startDate + 'T12:00');
  if (selectedChip) {
    const computed = computeChipTime(selectedChip);
    if (computed) {
      // Keep date from startDate but use computed hour:min
      const sDate = new Date(startDate + 'T00:00');
      computed.setFullYear(sDate.getFullYear(), sDate.getMonth(), sDate.getDate());
      // for relative chips, date may differ — keep computed as is
      if (selectedChip.startsWith('ago')) startDt = computed;
      else { computed.setFullYear(sDate.getFullYear(), sDate.getMonth(), sDate.getDate()); startDt = computed; }
    }
  }

  const endDate   = document.getElementById('endDate').value;
  const endTime   = endDate ? endDate + 'T23:59' : null;
  const intensity = +document.getElementById('intensitySlider').value;
  const notes     = document.getElementById('attackNotes').value.trim();
  const medications = getMedications();

  const attack = {
    date:      startDate,
    startTime: startDt.toISOString().slice(0,16),
    endTime,
    intensity,
    timeChip:  selectedChip || null,
    painType:  selectedPills.painType  || null,
    location:  selectedPills.location  || null,
    side:      selectedPills.side      || null,
    symptoms:  getCheckedValues('symptom'),
    triggers:  getCheckedValues('trigger'),
    medications,
    notes,
  };

  try {
    await addAttack(attack);
    allAttacks = await getAllAttacks();
    closeSheet();
    renderAll();
    resetForm();
    showToast('✅ Записано! Мигри всё запомнила.');
  } catch (err) {
    showToast('❌ Ошибка сохранения');
    console.error(err);
  }
}

function resetForm() {
  document.getElementById('attackForm').reset();
  setDefaultDate();
  selectedPills = {};
  selectedChip  = null;
  document.querySelectorAll('.pill.active').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.time-chip.active').forEach(c => c.classList.remove('active'));
  document.getElementById('timeChipResult').style.display = 'none';
  document.getElementById('intensitySlider').value = 5;
  document.getElementById('intensityValue').textContent = '5';
  document.getElementById('intensityEmoji').textContent = INTENSITY_EMOJI[5];
  document.getElementById('medEffSlider').value = 5;
  document.getElementById('medEffValue').textContent = '5';
  initMedRows();
}

// ─── Day Modal ────────────────────────────────────────────────────────────────
function showDayModal(attacks, dateStr, showAddBtn) {
  const modal   = document.getElementById('detailModal');
  const overlay = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');

  const displayDate = formatDate(new Date(dateStr + 'T00:00:00'));

  let html = `<div class="modal-header">
    <div class="modal-title">📅 ${displayDate}</div>
    <button class="modal-close" onclick="closeDayModal()">✕</button>
  </div>`;

  attacks.forEach((a, i) => {
    const intLevel = a.intensity <= 3 ? 'low' : a.intensity <= 6 ? 'medium' : 'high';
    const intLabel = { low:'Слабая', medium:'Средняя', high:'Сильная' }[intLevel];
    const symptoms = Object.entries(a.symptoms || {}).filter(([,v])=>v).map(([k])=>SYMPTOM_LABEL[k]).filter(Boolean);
    const triggers = Object.entries(a.triggers || {}).filter(([,v])=>v).map(([k])=>TRIGGER_LABEL[k]).filter(Boolean);
    let dur = '';
    if (a.endTime && a.startTime) {
      const m = Math.round((new Date(a.endTime) - new Date(a.startTime)) / 60000);
      dur = m >= 60 ? `${Math.floor(m/60)} ч ${m%60} мин` : `${m} мин`;
    }
    const chipLabel = a.timeChip ? `≈ ${CHIP_MAP[a.timeChip]?.label || ''}` : '';
    const timeStr = chipLabel || formatTime(new Date(a.startTime||a.date));

    html += `
      ${i > 0 ? '<hr style="border:none;border-top:1px solid var(--glass-border);margin:14px 0">' : ''}
      <div class="modal-detail-row"><span class="modal-detail-key">Время</span><span class="modal-detail-val">${timeStr}</span></div>
      ${dur ? `<div class="modal-detail-row"><span class="modal-detail-key">Длительность</span><span class="modal-detail-val">${dur}</span></div>` : ''}
      <div class="modal-detail-row"><span class="modal-detail-key">Интенсивность</span><span class="modal-detail-val"><span class="la-badge ${intLevel}">${intLabel} · ${a.intensity}/10</span></span></div>
      ${a.painType ? `<div class="modal-detail-row"><span class="modal-detail-key">Тип боли</span><span class="modal-detail-val">${{throbbing:'🌊 Пульсирующая',pressing:'🪨 Давящая',sharp:'⚡ Острая'}[a.painType]||''}</span></div>` : ''}
      ${a.location ? `<div class="modal-detail-row"><span class="modal-detail-key">Локализация</span><span class="modal-detail-val">${{temples:'Виски',forehead:'Лоб',back:'Затылок',full:'Вся голова'}[a.location]||''}${a.side?' · '+({left:'слева',right:'справа',both:'с обеих'}[a.side]||''):''}</span></div>` : ''}
      ${symptoms.length ? `<div class="modal-detail-row"><span class="modal-detail-key">Симптомы</span><span class="modal-detail-val">${symptoms.join(', ')}</span></div>` : ''}
      ${triggers.length ? `<div class="modal-detail-row"><span class="modal-detail-key">Триггеры</span><span class="modal-detail-val">${triggers.join(', ')}</span></div>` : ''}
      ${a.medications?.length ? `<div class="modal-detail-row"><span class="modal-detail-key">Лекарство</span><span class="modal-detail-val">${a.medications.filter(m=>m.name).map(m=>`${m.name}${m.dose?' '+m.dose:''}${m.qty?' ×'+m.qty:''}${m.effectiveness?' ('+m.effectiveness+'/10)':''}`).join(', ')}</span></div>` : ''}
      ${a.notes ? `<div class="modal-detail-row"><span class="modal-detail-key">Заметки</span><span class="modal-detail-val">${a.notes}</span></div>` : ''}
      <button class="modal-delete-btn" onclick="deleteAttackById(${a.id})">🗑 Удалить запись</button>
    `;
  });

  // "+ Добавить запись" at the bottom when opened from calendar filled day
  if (showAddBtn) {
    html += `<button class="modal-add-entry-btn" onclick="closeDayModal(); openSheet('${dateStr}')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      Добавить запись за этот день
    </button>`;
  }

  content.innerHTML = html;
  modal.classList.add('open');
  overlay.classList.add('open');
}

function closeDayModal() {
  document.getElementById('detailModal').classList.remove('open');
  document.getElementById('modalOverlay').classList.remove('open');
}

async function deleteAttackById(id) {
  if (!confirm('Удалить эту запись?')) return;
  await deleteAttack(id);
  allAttacks = await getAllAttacks();
  closeDayModal();
  renderAll();
  showToast('🗑 Запись удалена');
}

// ─── Demo data ────────────────────────────────────────────────────────────────
async function loadDemoData() {
  if (!confirm('Загрузить тестовые данные за 30 дней?')) return;
  const CHIPS   = ['morning','afternoon','evening','night','ago1','ago3'];
  const MEDS    = [['Ибупрофен','400мг','1 таб',7],['Суматриптан','50мг','1 таб',9],['Парацетамол','500мг','2 таб',5],['Напроксен','500мг','1 таб',6]];
  const TRIGS   = ['stress','lessSleep','moreSleep','hunger','weather','noise','screen','alcohol','caffeine'];
  const SYMPTS  = ['nausea','photophobia','phonophobia','aura','dizziness','menstruation'];
  const now = new Date();
  const attackDays = [1,3,5,8,10,11,14,17,19,22,25,27,29];

  for (const daysAgo of attackDays) {
    const dt = new Date(now); dt.setDate(now.getDate() - daysAgo);
    const chip = CHIPS[Math.floor(Math.random()*CHIPS.length)];
    const computed = computeChipTime(chip) || dt;
    const intensity = 3 + Math.floor(Math.random() * 7);
    const med = MEDS[Math.floor(Math.random()*MEDS.length)];
    const endDt = new Date(computed.getTime() + (1+Math.random()*4)*3600000);
    const triggers = {}, symptoms = {};
    TRIGS.slice(0, 2+Math.floor(Math.random()*4)).forEach(t => { if (Math.random()>.4) triggers[t]=true; });
    SYMPTS.slice(0, 1+Math.floor(Math.random()*3)).forEach(s => { if (Math.random()>.3) symptoms[s]=true; });

    await addAttack({
      date:        dt.toISOString().slice(0,10),
      startTime:   computed.toISOString().slice(0,16),
      endTime:     endDt.toISOString().slice(0,16),
      timeChip:    chip,
      intensity,
      painType:    ['throbbing','pressing','sharp'][Math.floor(Math.random()*3)],
      location:    ['temples','forehead','back','full'][Math.floor(Math.random()*4)],
      side:        ['left','right','both'][Math.floor(Math.random()*3)],
      symptoms,
      triggers,
      medications: [{ name:med[0], dose:med[1], qty:med[2], effectiveness:med[3]+Math.floor(Math.random()*2) }],
      notes:'',
    });
  }
  allAttacks = await getAllAttacks();
  renderAll();
  document.getElementById('demoBanner').style.display = 'none';
  showToast('✨ Тестовые данные загружены!');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function formatDate(dt) {
  return dt.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
}
function formatTime(dt) {
  return dt.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
}
function timeAgo(dt) {
  const diff  = Date.now() - dt.getTime();
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (hours < 1)  return 'только что';
  if (hours < 24) return `${hours} ч назад`;
  if (days === 1) return 'вчера';
  return `${days} дн. назад`;
}

// ─── Listeners ───────────────────────────────────────────────────────────────
function setupListeners() {
  document.getElementById('fabBtn').addEventListener('click', () => openSheet());
  document.getElementById('closeSheet').addEventListener('click', closeSheet);
  document.getElementById('sheetOverlay').addEventListener('click', closeSheet);
  document.getElementById('modalOverlay').addEventListener('click', closeDayModal);
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('addMedBtn').addEventListener('click', addMedRow);
  document.getElementById('demoBtn')?.addEventListener('click', loadDemoData);

  // Calendar nav
  document.getElementById('prevMonth').addEventListener('click', () => {
    if (--calMonth < 0) { calMonth = 11; calYear--; } renderCalendar();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    if (++calMonth > 11) { calMonth = 0; calYear++; } renderCalendar();
  });

  // Intensity slider
  const slider = document.getElementById('intensitySlider');
  slider.addEventListener('input', () => {
    const v = +slider.value;
    document.getElementById('intensityValue').textContent = v;
    document.getElementById('intensityEmoji').textContent = INTENSITY_EMOJI[v] || '😐';
  });

  // Med eff slider
  document.getElementById('medEffSlider').addEventListener('input', function() {
    document.getElementById('medEffValue').textContent = this.value;
  });

  // Pills
  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const group = pill.dataset.group, val = pill.dataset.value;
      document.querySelectorAll(`.pill[data-group="${group}"]`).forEach(p => p.classList.remove('active'));
      pill.classList.toggle('active', selectedPills[group] !== val);
      selectedPills[group] = selectedPills[group] === val ? null : val;
    });
  });

  // Time chips
  document.querySelectorAll('.time-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.chip;
      document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('active'));

      if (selectedChip === key) {
        // deselect
        selectedChip = null;
        document.getElementById('timeChipResult').style.display = 'none';
      } else {
        selectedChip = key;
        chip.classList.add('active');
        const dt = computeChipTime(key);
        const result = document.getElementById('timeChipResult');
        const computed = document.getElementById('timeChipComputed');
        if (dt) {
          computed.textContent = `${CHIP_MAP[key].label} — около ${formatTime(dt)}`;
          result.style.display = 'block';
        }
      }
    });
  });

  // Form submit
  document.getElementById('attackForm').addEventListener('submit', handleSubmit);

  // Swipe down to close sheet
  let startY = 0;
  const sheet = document.getElementById('bottomSheet');
  sheet.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive:true });
  sheet.addEventListener('touchend',   e => { if (e.changedTouches[0].clientY - startY > 80) closeSheet(); }, { passive:true });
}

// ─── SW ───────────────────────────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.error);
}

document.addEventListener('DOMContentLoaded', init);