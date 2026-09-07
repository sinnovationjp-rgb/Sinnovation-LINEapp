// 予約フローのステップ制御・確認画面組み立て・送信
const KATAKANA_PATTERN = /^[゠-ヿ\s]+$/;

document.querySelectorAll('.space-card').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.space-card').forEach((el) => el.classList.remove('is-selected'));
    card.classList.add('is-selected');
    reserveState.space = card.dataset.space;
    document.getElementById('step2-next')?.removeAttribute('disabled');
  });
});

document.querySelectorAll('input[name="drink"]').forEach((el) => {
  el.addEventListener('change', () => { reserveState.drink = el.value; });
});

document.querySelectorAll('input[name="usageHistory"]').forEach((el) => {
  el.addEventListener('change', () => { reserveState.usageHistory = el.value; });
});

function showStep(n) {
  document.querySelectorAll('.screen').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.screen === String(n));
  });
  document.querySelectorAll('.step-node').forEach((el) => {
    const node = Number(el.dataset.node);
    el.classList.toggle('is-active', node === n);
    el.classList.toggle('is-done', node < n);
  });
  if (n === 4) buildSummary();
  window.scrollTo({ top: 0 });
}

document.getElementById('step1-next')?.addEventListener('click', () => showStep(2));
document.getElementById('step2-next')?.addEventListener('click', () => showStep(3));

document.getElementById('step3-next')?.addEventListener('click', () => {
  const lastname = document.getElementById('lastname-input').value.trim();
  const firstname = document.getElementById('firstname-input').value.trim();
  const phone = document.getElementById('phone-input').value.trim();
  if (!lastname || !firstname || !phone) {
    alert('セイ・メイ・電話番号は必須です');
    return;
  }
  if (!KATAKANA_PATTERN.test(lastname) || !KATAKANA_PATTERN.test(firstname)) {
    alert('セイ・メイはカタカナで入力してください');
    return;
  }
  showStep(4);
});

document.querySelectorAll('[data-prev]').forEach((btn) => {
  btn.addEventListener('click', () => showStep(Number(btn.dataset.prev)));
});

function buildSummary() {
  const lastname = document.getElementById('lastname-input').value;
  const firstname = document.getElementById('firstname-input').value;
  const phone = document.getElementById('phone-input').value;
  const email = document.getElementById('email-input').value || 'なし';
  const note = document.getElementById('note-input').value || 'なし';

  const rows = [
    ['来店日', reserveState.dateLabel],
    ['時間', reserveState.time],
    ['人数', `${reserveState.people}名`],
    ['スペース', reserveState.space],
    ['飲み放題', reserveState.drink],
    ['ご利用履歴', reserveState.usageHistory],
    ['お名前（カタカナ）', `${lastname} ${firstname}`],
    ['電話番号', phone],
    ['メールアドレス', email],
    ['備考', note]
  ];

  document.getElementById('summary').innerHTML = rows.map(([label, value]) => `
    <div class="summary-row"><dt>${label}</dt><dd>${value}</dd></div>
  `).join('');
}

document.getElementById('confirm-btn')?.addEventListener('click', async () => {
  const lastname = document.getElementById('lastname-input').value.trim();
  const firstname = document.getElementById('firstname-input').value.trim();
  const phone = document.getElementById('phone-input').value.trim();
  const email = document.getElementById('email-input').value.trim();
  const note = document.getElementById('note-input').value.trim();

  const reservation = {
    datetime: `${reserveState.dateISO}T${reserveState.time}:00`,
    headcount: reserveState.people,
    space: reserveState.space,
    drink: reserveState.drink,
    usageHistory: reserveState.usageHistory,
    name: `${lastname} ${firstname}`,
    phone: phone,
    email: email,
    note: note,
    userId: currentUserId
  };

  if (!GAS_ENDPOINT_URL) {
    console.warn('GAS_ENDPOINT_URLが未設定のためダミー送信します');
    console.log('予約データ（ダミー送信）', reservation);
    showStep(5);
    return;
  }

  const confirmBtn = document.getElementById('confirm-btn');
  confirmBtn.disabled = true;
  confirmBtn.textContent = '送信中...';

  try {
    // GASのWeb AppはOPTIONSプリフライトを処理できないため、text/plainでJSON文字列をPOSTする
    const res = await fetch(GAS_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(reservation)
    });
    const result = await res.json();
    if (!result.success) {
      throw new Error(result.error || '予約に失敗しました');
    }
    showStep(5);
  } catch (err) {
    console.error('予約の送信に失敗しました', err);
    alert('予約の送信に失敗しました。時間をおいて再度お試しください。');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'この内容で登録する';
  }
});
