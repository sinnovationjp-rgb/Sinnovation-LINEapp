// Step1（日時・人数・時間）の状態と、GAS_ENDPOINT_URL未設定時のダミー空き状況フォールバック
const reserveState = {
  dateISO: null,
  dateLabel: null,
  people: null,
  time: null,
  space: null,
  drink: 'あり',
  usageHistory: '初めて'
};

function getDummyAvailability() {
  const today = new Date();
  const data = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    data.push({ date: dateStr, available: i % 3 !== 0 });
  }
  return data;
}

async function fetchAvailability() {
  if (!GAS_ENDPOINT_URL) {
    console.warn('GAS_ENDPOINT_URLが未設定のためダミーデータで動作します');
    return getDummyAvailability();
  }
  try {
    const res = await fetch(GAS_ENDPOINT_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.error('空き状況の取得に失敗しました。ダミーデータで表示します', err);
    return getDummyAvailability();
  }
}

function isoDate(year, month, day) {
  const mm = String(month + 1).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const dows = ['日', '月', '火', '水', '木', '金', '土'];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  const month = today.getMonth();

  const calMonthEl = document.getElementById('cal-month');
  const calGridEl = document.getElementById('cal-grid');
  if (calMonthEl) calMonthEl.textContent = `${year}年${month + 1}月`;

  const availability = await fetchAvailability();
  const availabilityMap = {};
  availability.forEach(({ date, available }) => {
    availabilityMap[date] = available;
  });

  if (calGridEl) {
    dows.forEach((d, i) => {
      const el = document.createElement('div');
      el.className = 'cal-dow' + (i === 0 ? ' is-sun' : i === 6 ? ' is-sat' : '');
      el.textContent = d;
      calGridEl.appendChild(el);
    });

    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    for (let i = 0; i < firstDow; i++) {
      calGridEl.appendChild(document.createElement('div'));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = isoDate(year, month, day);
      const isPast = day < today.getDate();
      const available = availabilityMap[dateStr];

      const cell = document.createElement('div');
      const cellIsAvailable = !isPast && available === true;
      cell.className = 'cal-cell' + (isPast || !cellIsAvailable ? ' is-past' : ' is-available');
      cell.innerHTML = `<span class="cal-num">${day}</span><span class="cal-mark">${cellIsAvailable ? '○' : '－'}</span>`;

      if (cellIsAvailable) {
        cell.addEventListener('click', () => {
          document.querySelectorAll('.cal-cell.is-selected').forEach((el) => el.classList.remove('is-selected'));
          cell.classList.add('is-selected');
          reserveState.dateISO = dateStr;
          reserveState.dateLabel = `${month + 1}/${day}(${dows[new Date(year, month, day).getDay()]})`;
          updateStep1Ready();
        });
      }
      calGridEl.appendChild(cell);
    }
  }

  const peopleRow = document.getElementById('people-row');
  if (peopleRow) {
    for (let n = 1; n <= 8; n++) {
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.innerHTML = `<span class="dot"></span>${n}名`;
      pill.addEventListener('click', () => {
        document.querySelectorAll('#people-row .pill').forEach((el) => el.classList.remove('is-selected'));
        pill.classList.add('is-selected');
        reserveState.people = n;
        updateStep1Ready();
      });
      peopleRow.appendChild(pill);
    }
  }

  const timeRow = document.getElementById('time-row');
  if (timeRow) {
    for (let minutes = 15 * 60; minutes <= 21 * 60; minutes += 30) {
      const h = String(Math.floor(minutes / 60)).padStart(2, '0');
      const m = String(minutes % 60).padStart(2, '0');
      const label = `${h}:${m}`;
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.textContent = label;
      pill.addEventListener('click', () => {
        document.querySelectorAll('#time-row .pill').forEach((el) => el.classList.remove('is-selected'));
        pill.classList.add('is-selected');
        reserveState.time = label;
        updateStep1Ready();
      });
      timeRow.appendChild(pill);
    }
  }
});

function updateStep1Ready() {
  const btn = document.getElementById('step1-next');
  if (!btn) return;
  const ready = reserveState.dateISO && reserveState.people && reserveState.time;
  btn.toggleAttribute('disabled', !ready);
}
