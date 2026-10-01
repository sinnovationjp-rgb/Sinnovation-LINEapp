// LIFF初期化。本番用LIFF ID（@186lmmedのMessaging APIチャネルと同一プロバイダー内に作り直したもの）
const LIFF_ID = '2011811803-LPCWIDmb';

// GAS_ENDPOINT_URLはjs/config.js（このスクリプトより先に読み込む）で定義

let currentUserId = null;

async function initLiff() {
  if (LIFF_ID === 'YOUR_LIFF_ID') {
    console.warn('LIFF_IDが未設定のためダミーモードで動作します');
    currentUserId = 'dummy-user-id';
    return;
  }
  try {
    await liff.init({ liffId: LIFF_ID });
    // 未ログインのままだとuserIdが取得できず、確定・キャンセル時のLINE通知が送れなくなる
    if (!liff.isLoggedIn()) {
      liff.login({ redirectUri: location.href });
      return;
    }
    const profile = await liff.getProfile();
    currentUserId = profile.userId;
  } catch (err) {
    console.error('LIFF初期化に失敗しました', err);
  }
}

initLiff();

document.getElementById('new-reservation')?.addEventListener('click', () => {
  location.href = 'reserve.html';
});
