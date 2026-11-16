// 予約フローのステップ制御・確認画面組み立て・送信

// ---- ラウンジ貸切（gas/Code.jsのLOUNGE_*/CHARTER_*と同じ。変えるときは両方そろえる） ----
const LOUNGE_SPACE = 'ラウンジ・スペース';
const LOUNGE_CHARTER_SPACE = 'ラウンジ・スペース（貸切）';
const CHARTER_HOURS = 3;
const CHARTER_EVENING_START_MINUTES = 18 * 60;
const CHARTER_PRICE_DAYTIME = 22000;
const CHARTER_PRICE_EVENING = 33000;
const LOUNGE_NORMAL_STAY_HOURS = 2; // 確定済みの貸切と重なるか判定するときの、通常利用の滞在時間の目安

function timeToMinutes(time) {
  const m = String(time || '').match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatYen(n) {
  return `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}円`;
}

// 選んだ開始時刻での貸切料金（例: '33,000円／3時間'）
function getCharterPriceLabel(time) {
  const start = timeToMinutes(time);
  if (start === null) return '';
  const price = start >= CHARTER_EVENING_START_MINUTES ? CHARTER_PRICE_EVENING : CHARTER_PRICE_DAYTIME;
  return `${formatYen(price)}／${CHARTER_HOURS}時間`;
}

// 送信・確認画面に使うスペース名（ラウンジで貸切を選んだ場合は「ラウンジ・スペース（貸切）」）
function getSelectedSpace() {
  if (reserveState.space === LOUNGE_SPACE && reserveState.loungeUsage === '貸切') return LOUNGE_CHARTER_SPACE;
  return reserveState.space;
}

// 選んだ日時が確定済みのラウンジ貸切と重なっていれば、その貸切の時間帯を返す（重ならなければnull）。
// 貸切は開始から3時間、通常利用は2時間いるものとして判定する（gas/Code.jsのoverlapsLoungeCharter_と同じ）
function findBlockingCharter() {
  const charters = charterMap[reserveState.dateISO] || [];
  const start = timeToMinutes(reserveState.time);
  if (start === null) return null;
  const stay = (reserveState.loungeUsage === '貸切' ? CHARTER_HOURS : LOUNGE_NORMAL_STAY_HOURS) * 60;
  return charters.find((c) => start < c.end && c.start < start + stay) || null;
}

// スペース選択画面の表示を、選んだ日時・ご利用方法に合わせて更新する
function refreshSpaceStep() {
  const isLounge = reserveState.space === LOUNGE_SPACE;
  const usageField = document.getElementById('lounge-usage');
  if (usageField) usageField.hidden = !isLounge;
  const priceEl = document.getElementById('charter-price');
  if (priceEl) priceEl.textContent = getCharterPriceLabel(reserveState.time);

  // ラウンジは通常利用・貸切どちらで判定しても重なる場合だけカードごと選べなくする。
  // 貸切だけ重なる場合（例: 貸切の少し前の時間）は、カードは選べて「次へ」で止める
  const savedUsage = reserveState.loungeUsage;
  reserveState.loungeUsage = '通常利用';
  const normalBlock = findBlockingCharter();
  reserveState.loungeUsage = savedUsage;
  const block = isLounge ? findBlockingCharter() : normalBlock;

  const loungeCard = document.querySelector(`.space-card[data-space="${LOUNGE_SPACE}"]`);
  loungeCard?.classList.toggle('is-disabled', !!normalBlock);
  if (normalBlock && isLounge) {
    loungeCard.classList.remove('is-selected');
    reserveState.space = null;
  }
  const warnEl = document.getElementById('lounge-blocked');
  if (warnEl) {
    const shown = normalBlock || (isLounge && block);
    warnEl.hidden = !shown;
    if (shown) {
      warnEl.textContent = normalBlock
        ? `この時間帯は貸切のご予約が入っているため、ラウンジはお選びいただけません（${minutesToTime(normalBlock.start)}〜${minutesToTime(normalBlock.end)}）`
        : `${minutesToTime(block.start)}〜${minutesToTime(block.end)}に貸切のご予約が入っているため、この開始時刻では貸切をお選びいただけません`;
    }
  }
  if (!reserveState.space) {
    if (usageField) usageField.hidden = true;
  }

  const ready = !!reserveState.space && !(reserveState.space === LOUNGE_SPACE && block);
  document.getElementById('step2-next')?.toggleAttribute('disabled', !ready);
}

document.querySelectorAll('.space-card').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.classList.contains('is-disabled')) return;
    document.querySelectorAll('.space-card').forEach((el) => el.classList.remove('is-selected'));
    card.classList.add('is-selected');
    reserveState.space = card.dataset.space;
    refreshSpaceStep();
  });
});

document.querySelectorAll('input[name="loungeUsage"]').forEach((el) => {
  el.addEventListener('change', () => {
    reserveState.loungeUsage = el.value;
    refreshSpaceStep();
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
  if (n === 2) refreshSpaceStep();
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
    ['スペース', getSelectedSpace()],
    ...(getSelectedSpace() === LOUNGE_CHARTER_SPACE ? [['貸切料金', getCharterPriceLabel(reserveState.time)]] : []),
    ['飲み放題', reserveState.drink === 'あり' ? 'あり（2時間 3,000円／人）' : reserveState.drink],
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

// 予約が登録できたら、お客様のLINEから公式アカウントのトークに予約内容を送り、
// LINE公式アカウントのチャット欄でスタッフが新しい予約に気付けるようにする（お客様が送る扱いなので月の送信通数は使わない）。
// LIFFアプリのスコープ「chat_message.write」が必要。LINEアプリの外で開いた場合や、
// グループ・複数人トークから開いた場合は送らない。失敗しても予約自体は完了しているので、ログを残すだけにする
async function sendReservationToOfficialChat(reservation) {
  try {
    if (typeof liff === 'undefined' || !liff.isInClient || !liff.isInClient()) return;
    const context = liff.getContext && liff.getContext();
    if (!context || context.type !== 'utou') return;
    const lines = [
      '【予約を申し込みました】',
      `日時: ${reserveState.dateLabel} ${reserveState.time}`,
      `人数: ${reservation.headcount}名`,
      `スペース: ${reservation.space}`,
      ...(reservation.space === LOUNGE_CHARTER_SPACE ? [`貸切料金: ${getCharterPriceLabel(reserveState.time)}`] : []),
      `飲み放題: ${reservation.drink}`,
      `お名前: ${reservation.name}`
    ];
    if (reservation.note) lines.push(`備考: ${reservation.note.slice(0, 200)}`);
    await liff.sendMessages([{ type: 'text', text: lines.join('\n') }]);
  } catch (err) {
    console.warn('公式アカウントのトークへの予約内容の送信に失敗しました（予約は完了しています）', err);
  }
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
    space: getSelectedSpace(),
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
    await sendReservationToOfficialChat(reservation);
    showStep(5);
  } catch (err) {
    console.error('予約の送信に失敗しました', err);
    alert('予約の送信に失敗しました。時間をおいて再度お試しください。');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'この内容で登録する';
  }
});
