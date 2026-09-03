// 予約フォームのダミー送信。Phase 3でGASへのPOSTに置き換え
document.getElementById('reserve-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const reservation = Object.fromEntries(formData.entries());
  console.log('予約データ（ダミー送信）', reservation);
  location.href = 'complete.html';
});
