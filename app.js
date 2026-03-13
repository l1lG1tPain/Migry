// ─── State ─────────────────────────────────────────────────────────────────
let allAttacks = [];
let calMonth, calYear;
let selectedPills = {};

const MONTHS_RU   = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DAYS_SHORT  = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const INTENSITY_EMOJI = { 1:'😌', 2:'🙂', 3:'😶', 4:'😕', 5:'😐', 6:'😣', 7:'😖', 8:'😩', 9:'😫', 10:'🤯' };
const SYMPTOM_LABEL = { nausea:'Тошнота', vomiting:'Рвота', photophobia:'Свет', phonophobia:'Звук', aura:'Аура', dizziness:'Головокружение', numbness:'Онемение', weakness:'Слабость' };
const TRIGGER_LABEL = { stress:'Стресс', poorSleep:'Недосып', hunger:'Голод', weather:'Погода', smell:'Запахи', screen:'Экран', alcohol:'Алкоголь', caffeine:'Кофеин' };

// ─── Init ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    await openDB();
    allAttacks = await getAllAttacks();
  } catch (e) {
    console.error('DB error:', e);
    allAttacks = [];
  }

  const now = new Date();
  calMonth = now.getMonth();
  calYear  = now.getFullYear();

  initTheme();
  setDefaultDateTime();
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
  const current = document.documentElement.getAttribute('data-theme');
  const next    = current === 'dark' ? 'light' : 'dark';
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

  const firstDay  = new Date(calYear, calMonth, 1);
  const lastDay   = new Date(calYear, calMonth + 1, 0);
  const grid      = document.getElementById('calendarGrid');

  // Build attack map: date → max intensity
  const attackMap = {};
  allAttacks.forEach(a => {
    const d = new Date(a.startTime || a.date);
    if (d.getMonth() === calMonth && d.getFullYear() === calYear) {
      const key = d.getDate();
      attackMap[key] = Math.max(attackMap[key] || 0, a.intensity || 0);
    }
  });

  let dow = firstDay.getDay(); // 0=Sun
  if (dow === 0) dow = 7;      // make Sun = 7
  dow--;                        // 0=Mon

  const today = new Date();
  let html = '';

  for (let i = 0; i < dow; i++) html += '<div class="cal-cell empty"></div>';

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const isToday = today.getDate() === d && today.getMonth() === calMonth && today.getFullYear() === calYear;
    const intensity = attackMap[d] || 0;
    let intensityClass = '';
    if (intensity > 0)   intensityClass = intensity <= 3 ? 'low' : intensity <= 6 ? 'mid' : 'high';

    html += `<div class="cal-cell${isToday ? ' today' : ''}${intensity ? ' has-attack' : ''}" data-intensity="${intensityClass}" data-day="${d}" data-month="${calMonth}" data-year="${calYear}">
      <span class="cal-day">${d}</span>
      ${intensity ? '<span class="cal-dot"></span>' : ''}
    </div>`;
  }
  grid.innerHTML = html;

  // Click events
  grid.querySelectorAll('.cal-cell[data-day]').forEach(cell => {
    cell.addEventListener('click', () => {
      const day = +cell.dataset.day, month = +cell.dataset.month, year = +cell.dataset.year;
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const attacks = allAttacks.filter(a => (a.startTime || a.date || '').startsWith(dateStr));
      if (attacks.length) showDayModal(attacks, dateStr);
    });
  });
}

// ─── Stats bar ──────────────────────────────────────────────────────────────
function renderStats() {
  const now   = new Date();
  const days  = Math.max(1, Math.ceil((now - new Date(Math.min(...allAttacks.map(a => new Date(a.startTime||a.date||a.createdAt||now)), now))) / 86400000) + 1);

  const last30 = allAttacks.filter(a => (now - new Date(a.startTime || a.date)) < 30 * 86400000);
  const freq   = last30.length;
  const avgInt = allAttacks.length ? calcAvgIntensity(allAttacks).toFixed(1) : '—';
  const daysFree = allAttacks.length ? calcDaysFree(allAttacks, Math.min(days, 30)) : '—';

  document.getElementById('statFreq').textContent = freq || '—';
  document.getElementById('statAvgIntensity').textContent = avgInt;
  document.getElementById('statDaysFree').textContent = daysFree;
}

// ─── Last Attack ─────────────────────────────────────────────────────────────
function renderLastAttack() {
  const card = document.getElementById('lastAttackCard');
  if (!allAttacks.length) {
    card.innerHTML = `<div class="empty-state"><span class="empty-icon">✨</span><p>Нет записей. Запишите первый приступ!</p></div>`;
    return;
  }

  const a    = [...allAttacks].sort((x,y) => new Date(y.startTime||y.date) - new Date(x.startTime||x.date))[0];
  const dt   = new Date(a.startTime || a.date);
  const ago  = timeAgo(dt);
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
      <div>
        <div class="la-date">${formatDate(dt)}</div>
        <div class="la-ago">${ago}</div>
      </div>
      <span class="la-badge ${intLevel}">${intLabel} · ${a.intensity}/10</span>
    </div>
    <div class="la-intensity-bar"><div class="la-intensity-fill" style="width:${(a.intensity/10)*100}%"></div></div>
    ${symptoms.length ? `<div class="la-tags">${symptoms.map(s=>`<span class="la-tag">😣 ${s}</span>`).join('')}</div>` : ''}
    ${triggers.length ? `<div class="la-tags">${triggers.map(t=>`<span class="la-tag">⚡ ${t}</span>`).join('')}</div>` : ''}
    <div class="la-meta">
      ${dur ? `<span class="la-meta-item">⏱ ${dur}</span>` : ''}
      ${medName ? `<span class="la-meta-item">💊 ${medName}</span>` : ''}
    </div>
  `;
  card.style.cursor = 'pointer';
  card.onclick = () => showDayModal([a], (a.startTime||a.date||'').slice(0,10));
}

// ─── Week Cards ──────────────────────────────────────────────────────────────
function renderWeekCards() {
  const container = document.getElementById('weekCards');
  const today     = new Date();
  today.setHours(0,0,0,0);

  // Find Monday of current week
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const monday    = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek);

  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  let html = '';

  for (let i = 0; i < 7; i++) {
    const d   = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = d.toISOString().slice(0,10);
    const isToday = d.getTime() === today.getTime();
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
      const date = card.dataset.date;
      const attacks = allAttacks.filter(a => (a.startTime||a.date||'').startsWith(date));
      if (attacks.length) showDayModal(attacks, date);
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
    const pct = Math.round((count / max) * 100);
    html += `<div class="tod-bar-wrap">
      <span class="tod-count">${count}</span>
      <div class="tod-bar-track"><div class="tod-bar-fill" style="height:${pct}%"></div></div>
      <span class="tod-label">${icons[key]}</span>
      <span class="tod-label">${labels[key]}</span>
    </div>`;
  });

  const maxEntry = Object.entries(tod).sort(([,a],[,b])=>b-a)[0];
  const todNames = { morning:'утром', afternoon:'днём', evening:'вечером', night:'ночью' };
  const insight  = maxEntry[1] > 0 ? `Чаще всего приступы начинаются ${todNames[maxEntry[0]]}.` : '';

  document.getElementById('todChart').innerHTML   = html;
  document.getElementById('todInsight').textContent = insight;
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
      <div class="med-row">
        <span class="med-name">${m.name}</span>
        <span class="med-meta">${m.uses} раз · ${m.eff}%</span>
      </div>
      <div class="med-bar-track"><div class="med-bar-fill" style="width:${m.eff}%"></div></div>
    </div>`).join('')}</div>`;
}

// ─── Insights ────────────────────────────────────────────────────────────────
function renderInsights() {
  const container = document.getElementById('insightsList');
  const now       = new Date();
  const daysTracked = allAttacks.length
    ? Math.ceil((now - new Date(Math.min(...allAttacks.map(a=>new Date(a.startTime||a.date||now))))) / 86400000) + 1
    : 0;

  if (daysTracked < 7 || allAttacks.length < 2) {
    const progress = Math.min(daysTracked, 7);
    container.innerHTML = `<div class="glass-card insight-placeholder">
      <span class="insight-icon">🔮</span>
      <p>Инсайты появятся после 7 дней записей</p>
      <div class="progress-track"><div class="progress-bar" style="width:${(progress/7)*100}%"></div></div>
      <span class="progress-label">${progress}/7 дней</span>
    </div>`;
    return;
  }

  const insights = generateInsights(allAttacks, daysTracked);
  if (!insights.length) return;

  container.innerHTML = `<div class="insight-cards">${insights.map((ins,i) => `
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
function openSheet() {
  document.getElementById('bottomSheet').classList.add('open');
  document.getElementById('sheetOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  document.getElementById('bottomSheet').classList.remove('open');
  document.getElementById('sheetOverlay').classList.remove('open');
  document.body.style.overflow = '';
}

// ─── Form helpers ─────────────────────────────────────────────────────────────
function setDefaultDateTime() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0,16);
  document.getElementById('startTime').value = local;
}

function getCheckedValues(name) {
  const result = {};
  document.querySelectorAll(`input[name="${name}"]:checked`).forEach(el => { result[el.value] = true; });
  return result;
}

// ─── Form submit ──────────────────────────────────────────────────────────────
async function handleSubmit(e) {
  e.preventDefault();

  const startTime = document.getElementById('startTime').value;
  if (!startTime) { showToast('Укажи время начала приступа'); return; }

  const intensity = +document.getElementById('intensitySlider').value;
  const endTime   = document.getElementById('endTime').value || null;
  const medName   = document.getElementById('medName').value.trim();
  const medDose   = document.getElementById('medDose').value.trim();
  const medEff    = +document.getElementById('medEffSlider').value;
  const notes     = document.getElementById('attackNotes').value.trim();

  const medications = medName ? [{ name: medName, dose: medDose, effectiveness: medEff }] : [];

  const attack = {
    date:        startTime.slice(0,10),
    startTime,
    endTime,
    intensity,
    painType:    selectedPills.painType  || null,
    location:    selectedPills.location  || null,
    side:        selectedPills.side      || null,
    symptoms:    getCheckedValues('symptom'),
    triggers:    getCheckedValues('trigger'),
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
  setDefaultDateTime();
  selectedPills = {};
  document.querySelectorAll('.pill.active').forEach(p => p.classList.remove('active'));
  document.getElementById('intensitySlider').value = 5;
  document.getElementById('intensityValue').textContent = '5';
  document.getElementById('intensityEmoji').textContent = INTENSITY_EMOJI[5];
  document.getElementById('medEffSlider').value = 5;
  document.getElementById('medEffValue').textContent = '5';
}

// ─── Day Modal ────────────────────────────────────────────────────────────────
function showDayModal(attacks, dateStr) {
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

    html += `
      ${i > 0 ? '<hr style="border:none;border-top:1px solid var(--glass-border);margin:16px 0">' : ''}
      <div class="modal-detail-row"><span class="modal-detail-key">Начало</span><span class="modal-detail-val">${formatDateTime(new Date(a.startTime||a.date))}</span></div>
      ${dur ? `<div class="modal-detail-row"><span class="modal-detail-key">Длительность</span><span class="modal-detail-val">${dur}</span></div>` : ''}
      <div class="modal-detail-row"><span class="modal-detail-key">Интенсивность</span><span class="modal-detail-val"><span class="la-badge ${intLevel}">${intLabel} · ${a.intensity}/10</span></span></div>
      ${a.painType ? `<div class="modal-detail-row"><span class="modal-detail-key">Тип боли</span><span class="modal-detail-val">${{'throbbing':'🌊 Пульсирующая','pressing':'🪨 Давящая','sharp':'⚡ Острая'}[a.painType]||''}</span></div>` : ''}
      ${a.location ? `<div class="modal-detail-row"><span class="modal-detail-key">Локализация</span><span class="modal-detail-val">${{'temples':'Виски','forehead':'Лоб','back':'Затылок','full':'Вся голова'}[a.location]||''}${a.side?' · '+({'left':'слева','right':'справа','both':'с обеих'}[a.side]||''):''}</span></div>` : ''}
      ${symptoms.length ? `<div class="modal-detail-row"><span class="modal-detail-key">Симптомы</span><span class="modal-detail-val">${symptoms.join(', ')}</span></div>` : ''}
      ${triggers.length ? `<div class="modal-detail-row"><span class="modal-detail-key">Триггеры</span><span class="modal-detail-val">${triggers.join(', ')}</span></div>` : ''}
      ${a.medications?.length ? `<div class="modal-detail-row"><span class="modal-detail-key">Лекарство</span><span class="modal-detail-val">${a.medications.map(m=>`${m.name}${m.dose?' '+m.dose:''}${m.effectiveness?' ('+m.effectiveness+'/10)':''}`).join(', ')}</span></div>` : ''}
      ${a.notes ? `<div class="modal-detail-row"><span class="modal-detail-key">Заметки</span><span class="modal-detail-val">${a.notes}</span></div>` : ''}
      <button class="modal-delete-btn" onclick="deleteAttackById(${a.id})">🗑 Удалить запись</button>
    `;
  });

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
  const TRIGGERS_LIST = ['stress','poorSleep','hunger','weather','screen'];
  const SYMPTOMS_LIST = ['nausea','photophobia','phonophobia','aura','dizziness'];
  const MEDS = [['Ибупрофен','400мг',7],['Суматриптан','50мг',9],['Парацетамол','500мг',5],['Напроксен','500мг',6]];

  const now = new Date();
  const attackDays = [1,3,5,8,10,11,14,17,19,22,25,27,29];

  for (const daysAgo of attackDays) {
    const dt = new Date(now);
    dt.setDate(now.getDate() - daysAgo);
    dt.setHours(5 + Math.floor(Math.random() * 14), Math.floor(Math.random()*60));
    const intensity = 3 + Math.floor(Math.random() * 7);
    const med = MEDS[Math.floor(Math.random() * MEDS.length)];
    const endDt = new Date(dt.getTime() + (1 + Math.random()*4) * 3600000);

    const triggers = {}, symptoms = {};
    TRIGGERS_LIST.slice(0, 2 + Math.floor(Math.random()*3)).forEach(t => triggers[t] = Math.random() > 0.4);
    SYMPTOMS_LIST.slice(0, 1 + Math.floor(Math.random()*3)).forEach(s => symptoms[s] = Math.random() > 0.3);

    await addAttack({
      date:        dt.toISOString().slice(0,10),
      startTime:   dt.toISOString().slice(0,16),
      endTime:     endDt.toISOString().slice(0,16),
      intensity,
      painType:    ['throbbing','pressing','sharp'][Math.floor(Math.random()*3)],
      location:    ['temples','forehead','back','full'][Math.floor(Math.random()*4)],
      side:        ['left','right','both'][Math.floor(Math.random()*3)],
      symptoms,
      triggers,
      medications: [{ name:med[0], dose:med[1], effectiveness:med[2] + Math.floor(Math.random()*2) }],
      notes: '',
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dt) {
  return dt.toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
}

function formatDateTime(dt) {
  return dt.toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

function timeAgo(dt) {
  const diff = Date.now() - dt.getTime();
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (hours < 1)  return 'только что';
  if (hours < 24) return `${hours} ч назад`;
  if (days === 1) return 'вчера';
  return `${days} дней назад`;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
function setupListeners() {
  // FAB
  document.getElementById('fabBtn').addEventListener('click', openSheet);

  // Close sheet
  document.getElementById('closeSheet').addEventListener('click', closeSheet);
  document.getElementById('sheetOverlay').addEventListener('click', closeSheet);

  // Close modal
  document.getElementById('modalOverlay').addEventListener('click', closeDayModal);

  // Theme
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Calendar nav
  document.getElementById('prevMonth').addEventListener('click', () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });
  document.getElementById('nextMonth').addEventListener('click', () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  // Intensity slider
  const slider = document.getElementById('intensitySlider');
  slider.addEventListener('input', () => {
    const v = +slider.value;
    document.getElementById('intensityValue').textContent = v;
    document.getElementById('intensityEmoji').textContent = INTENSITY_EMOJI[v] || '😐';
  });

  // Med eff slider
  const medSlider = document.getElementById('medEffSlider');
  medSlider.addEventListener('input', () => {
    document.getElementById('medEffValue').textContent = medSlider.value;
  });

  // Pills (single select per group)
  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const group = pill.dataset.group;
      const val   = pill.dataset.value;
      document.querySelectorAll(`.pill[data-group="${group}"]`).forEach(p => p.classList.remove('active'));
      pill.classList.toggle('active', selectedPills[group] !== val);
      selectedPills[group] = selectedPills[group] === val ? null : val;
    });
  });

  // Form submit
  document.getElementById('attackForm').addEventListener('submit', handleSubmit);

  // Demo button
  document.getElementById('demoBtn')?.addEventListener('click', loadDemoData);

  // Touch drag to close sheet
  let startY = 0;
  const sheet = document.getElementById('bottomSheet');
  sheet.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener('touchend', e => {
    if (e.changedTouches[0].clientY - startY > 80) closeSheet();
  }, { passive: true });
}

// ─── Service Worker ───────────────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
  }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);