// 予約フローのステップ制御・確認画面組み立て・送信

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

// スマホでは全角の「＠」「．」や英数字が入力されることがあるため、半角に揃えて前後の空白を除く
function normalizeEmail(value) {
  return String(value || '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .trim();
}

// gas/Code.jsのEMAIL_PATTERNと同じ（変えるときは両方そろえる）。
// 「@」の前はdocomo・auの古いアドレス（「..」や「@」直前の「.」）も通すため緩め、ドメインは厳しめに判定する
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

// メールアドレスは任意項目。入力されている場合だけ形式をチェックし、正しければtrueを返す
function validateEmailInput() {
  const input = document.getElementById('email-input');
  const errorEl = document.getElementById('email-error');
  const email = normalizeEmail(input.value);
  input.value = email;
  const ok = !email || EMAIL_PATTERN.test(email);
  errorEl.textContent = ok ? '' : 'メールアドレスの形式が正しくありません（例: example@gmail.com）';
  input.classList.toggle('is-invalid', !ok);
  return ok;
}

document.getElementById('email-input')?.addEventListener('blur', validateEmailInput);
document.getElementById('email-input')?.addEventListener('input', () => {
  // 一度エラーを出した後は、正しい形式になった時点ですぐにエラー表示を消す
  if (document.getElementById('email-input').classList.contains('is-invalid')) validateEmailInput();
});

document.getElementById('step3-next')?.addEventListener('click', () => {
  const lastname = document.getElementById('lastname-input').value.trim();
  const firstname = document.getElementById('firstname-input').value.trim();
  const phone = document.getElementById('phone-input').value.trim();
  if (!lastname || !firstname || !phone) {
    alert('セイ・メイ・電話番号は必須です');
    return;
  }
  if (!validateEmailInput()) {
    document.getElementById('email-input').focus();
    return;
  }
  showStep(4);
});

document.querySelectorAll('[data-prev]').forEach((btn) => {
  btn.addEventListener('click', () => showStep(Number(btn.dataset.prev)));
});

// 氏名・備考等は利用者本人の入力値だが、innerHTMLへそのまま埋め込むと
// <img src=x onerror=...> のようなタグが実行されてしまうため、表示前に必ずエスケープする
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    <div class="summary-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>
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
