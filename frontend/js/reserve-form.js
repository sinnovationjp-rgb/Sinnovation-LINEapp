// 予約フォームの送信。GAS_ENDPOINT_URL未設定時はダミー送信にフォールバック
document.getElementById('reserve-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const reservation = Object.fromEntries(formData.entries());
  reservation.userId = currentUserId;

  if (!GAS_ENDPOINT_URL) {
    console.warn('GAS_ENDPOINT_URLが未設定のためダミー送信します');
    console.log('予約データ（ダミー送信）', reservation);
    location.href = 'complete.html';
    return;
  }

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
    location.href = 'complete.html';
  } catch (err) {
    console.error('予約の送信に失敗しました', err);
    alert('予約の送信に失敗しました。時間をおいて再度お試しください。');
  }
});
