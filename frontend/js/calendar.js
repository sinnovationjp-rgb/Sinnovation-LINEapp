// ダミーの空き状況データ（{date, available}形式）。GAS_ENDPOINT_URL未設定時のフォールバック
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

document.addEventListener('DOMContentLoaded', async () => {
  const calendarEl = document.getElementById('calendar');
  const availability = await fetchAvailability();

  const events = availability.map(({ date, available }) => ({
    start: date,
    display: 'background',
    color: available ? '#8fd3a0' : '#e58f8f'
  }));

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    locale: 'ja',
    height: 'auto',
    events
  });
  calendar.render();
});
