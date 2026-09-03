// LIFF初期化。テスト用LIFF ID（Oo space予約）。本番公開時は本番チャネルのIDに差し替える
const LIFF_ID = '2011404271-2LcJbLkK';

// clasp deploy後のGAS WebアプリURL（テストデプロイ）
const GAS_ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbycD2bBXSqOdDjYud0l-vKPEpFIoy8eMBA0Fr9N03tni0yPS_dG4k7QdAH1ncYDLNVU/exec';

let currentUserId = null;

async function initLiff() {
  if (LIFF_ID === 'YOUR_LIFF_ID') {
    console.warn('LIFF_IDが未設定のためダミーモードで動作します');
    currentUserId = 'dummy-user-id';
    return;
  }
  try {
    await liff.init({ liffId: LIFF_ID });
    if (liff.isLoggedIn()) {
      const profile = await liff.getProfile();
      currentUserId = profile.userId;
    }
  } catch (err) {
    console.error('LIFF初期化に失敗しました', err);
  }
}

initLiff();

document.getElementById('new-reservation')?.addEventListener('click', () => {
  location.href = 'reserve.html';
});
