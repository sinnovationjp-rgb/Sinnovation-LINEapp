// LIFF初期化。LIFF_IDが未設定の間はダミーモードで動作する（Phase 6で実IDに置き換え）
const LIFF_ID = 'YOUR_LIFF_ID';

// clasp deploy後のGAS WebアプリURL。未設定の間はダミーデータで動作する（Phase 6で実URLに置き換え）
const GAS_ENDPOINT_URL = '';

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
