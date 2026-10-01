var LineService = (function () {
  // LINE_CHANNEL_ACCESS_TOKEN（長期トークン、Developers Consoleで発行）が設定されていればそれを使う。
  // 未設定の場合はLINE_CHANNEL_ID/LINE_CHANNEL_SECRETから、送信の都度15分だけ有効な
  // ステートレスなアクセストークンを取得する（Developers Consoleでの発行操作が不要）。
  function getAccessToken_() {
    const props = PropertiesService.getScriptProperties();
    const staticToken = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    if (staticToken) return staticToken;

    const channelId = props.getProperty('LINE_CHANNEL_ID');
    const channelSecret = props.getProperty('LINE_CHANNEL_SECRET');
    if (!channelId || !channelSecret) return null;

    try {
      const response = UrlFetchApp.fetch('https://api.line.me/oauth2/v3/token', {
        method: 'post',
        contentType: 'application/x-www-form-urlencoded',
        payload: {
          grant_type: 'client_credentials',
          client_id: channelId,
          client_secret: channelSecret
        },
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        console.error(`LineService.getAccessToken_: トークン取得に失敗しました (status=${code})`, response.getContentText());
        return null;
      }
      return JSON.parse(response.getContentText()).access_token;
    } catch (err) {
      console.error('LineService.getAccessToken_ failed', err);
      return null;
    }
  }

  function pushMessage(userId, text) {
    const token = getAccessToken_();
    if (!token) {
      console.error('LineService.pushMessage: アクセストークンを取得できませんでした（LINE_CHANNEL_ACCESS_TOKEN、またはLINE_CHANNEL_ID/LINE_CHANNEL_SECRETのスクリプトプロパティを確認してください）');
      return;
    }
    if (!userId) {
      console.error('LineService.pushMessage: userIdが指定されていません');
      return;
    }
    try {
      const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: `Bearer ${token}` },
        payload: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text: text }]
        }),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        console.error(`LineService.pushMessage: LINE APIがエラーを返しました (status=${code})`, response.getContentText());
      }
    } catch (err) {
      console.error('LineService.pushMessage failed', err);
    }
  }

  function pushProvisional(userId, data) {
    const text = [
      '仮予約を承りました。現時点で予約は確定しておりません。',
      '',
      `日時: ${data.datetime ? formatDateTimeForDisplay_(data.datetime) : '未入力'}`,
      `人数: ${data.headcount ? data.headcount + '名' : '未入力'}`,
      `スペース: ${data.space || '未入力'}`,
      `飲み放題: ${data.drink || '未入力'}`,
      '',
      '内容を確認のうえ、担当者よりLINEにてご連絡いたします。'
    ].join('\n');
    pushMessage(userId, text);
  }

  function pushConfirmation(userId, reservation) {
    const text = [
      'ご予約が確定しました',
      '',
      `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
      `人数: ${reservation['人数'] || ''}名`,
      `スペース: ${reservation['スペース'] || ''}`,
      `飲み放題: ${reservation['飲み放題'] || ''}`
    ].join('\n');
    pushMessage(userId, text);
  }

  function pushCancellation(userId, reservation, wasConfirmed) {
    const text = [
      wasConfirmed ? 'ご予約がキャンセルとなりました' : '大変申し訳ございませんが、今回のご予約はお受けできませんでした',
      '',
      `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
      `人数: ${reservation['人数'] || ''}名`,
      `スペース: ${reservation['スペース'] || ''}`,
      '',
      'ご不明な点がございましたら店舗までお問い合わせください。'
    ].join('\n');
    pushMessage(userId, text);
  }

  // 通知が届かないときの切り分け用。スクリプトプロパティの設定状況とトークン取得の成否をログに出す
  function debugConnection() {
    const props = PropertiesService.getScriptProperties();
    const staticToken = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
    const channelId = props.getProperty('LINE_CHANNEL_ID');
    const channelSecret = props.getProperty('LINE_CHANNEL_SECRET');

    console.log(`LINE_CHANNEL_ACCESS_TOKEN: ${staticToken ? '設定あり（長期トークンを使用）' : '未設定'}`);
    console.log(`LINE_CHANNEL_ID: ${channelId ? `設定あり（${channelId}）` : '未設定'}`);
    console.log(`LINE_CHANNEL_SECRET: ${channelSecret ? '設定あり' : '未設定'}`);

    const token = getAccessToken_();
    if (token) {
      console.log('✅ アクセストークンの取得に成功しました。LINE_CHANNEL_ID/SECRET（またはACCESS_TOKEN）の設定は正しいです。');
    } else {
      console.log('❌ アクセストークンの取得に失敗しました。直前のエラーログ（LineService.getAccessToken_: トークン取得に失敗しました...）の内容を確認してください。');
    }
    return !!token;
  }

  // 実際に指定したuserIdへテスト通知を送る。GASエディタで debugTestPush('Uxxxx...') の形で手動実行する
  function debugTestPush(userId) {
    if (!userId) {
      console.error('debugTestPush: userIdを引数で指定してください（スプレッドシートのLINE UserId列の値をコピーして渡す）');
      return;
    }
    pushMessage(userId, 'oO SPACE: これはテスト通知です。届いていれば送信設定は正常です。');
    console.log('送信を試みました。上に❌のエラーが出ていなければ、LINEアプリに届いているはずです。');
  }

  // 今のLINE_CHANNEL_ID/SECRET（またはACCESS_TOKEN）が実際にどの公式アカウントを制御しているか確認する。
  // 「友だちになっているはずなのに届かない」場合、スクリプトプロパティの認証情報が
  // 想定と別の公式アカウント（チャネル）のものになっている可能性を切り分けるために使う
  function debugBotInfo() {
    const token = getAccessToken_();
    if (!token) {
      console.error('debugBotInfo: アクセストークンを取得できませんでした');
      return;
    }
    try {
      const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
        method: 'get',
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      console.log(`debugBotInfo: status=${code}`);
      console.log(response.getContentText());
      console.log('↑ displayName・basicIdが「oO SPACE Niigata」「@186lmmed」になっているか確認してください。違う場合はチャネルID/SECRETの設定ミスです。');
    } catch (err) {
      console.error('debugBotInfo failed', err);
    }
  }

  // 指定したuserIdが、今のチャネルからみて「友だち」かどうかを直接LINEに確認する
  function debugFriendStatus(userId) {
    const token = getAccessToken_();
    if (!token) {
      console.error('debugFriendStatus: アクセストークンを取得できませんでした');
      return;
    }
    if (!userId) {
      console.error('debugFriendStatus: userIdが指定されていません');
      return;
    }
    try {
      const response = UrlFetchApp.fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
        method: 'get',
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code === 200) {
        console.log(`✅ 友だちとして認識されています: ${response.getContentText()}`);
      } else {
        console.log(`❌ 友だちとして認識できません (status=${code}): ${response.getContentText()}`);
        console.log('→ このチャネル（debugBotInfoで表示される公式アカウント）に対しては、このuserIdのユーザーは友だち登録されていないことを意味します。');
      }
    } catch (err) {
      console.error('debugFriendStatus failed', err);
    }
  }

  return {
    pushMessage: pushMessage,
    pushProvisional: pushProvisional,
    pushConfirmation: pushConfirmation,
    pushCancellation: pushCancellation,
    debugConnection: debugConnection,
    debugTestPush: debugTestPush,
    debugBotInfo: debugBotInfo,
    debugFriendStatus: debugFriendStatus
  };
})();

// GASエディタの関数選択プルダウンから直接実行できる診断用関数
// 1. debugLineConnection() → アクセストークンが取得できるか確認（チャネルID/SECRETの設定ミスを検出）
// 2. debugLineTestPush('Uxxxxxxxx...') → スプレッドシートのLINE UserId列の値を渡して実際にテスト通知を送る
function debugLineConnection() {
  return LineService.debugConnection();
}

function debugLineTestPush(userId) {
  LineService.debugTestPush(userId);
}

// GASエディタの「実行」ボタンは関数に引数を渡せないため、スクリプトプロパティ経由で渡す。
// 事前にスクリプトプロパティ DEBUG_TEST_USER_ID に、スプレッドシートの「LINE UserId」列の値を設定してから実行する
function debugLineTestPushFromProperty() {
  const userId = PropertiesService.getScriptProperties().getProperty('DEBUG_TEST_USER_ID');
  if (!userId) {
    console.error('debugLineTestPushFromProperty: スクリプトプロパティ DEBUG_TEST_USER_ID が未設定です（プロジェクトの設定 > スクリプトプロパティ で、スプレッドシートのLINE UserId列の値を設定してください）');
    return;
  }
  LineService.debugTestPush(userId);
}

// 今のチャネルID/SECRETが実際にどの公式アカウント（LINEのdisplayName・basicId）を制御しているか確認する
function debugLineBotInfo() {
  LineService.debugBotInfo();
}

// DEBUG_TEST_USER_IDに設定したuserIdが、今のチャネルから見て友だちかどうかを直接確認する
function debugLineFriendStatus() {
  const userId = PropertiesService.getScriptProperties().getProperty('DEBUG_TEST_USER_ID');
  if (!userId) {
    console.error('debugLineFriendStatus: スクリプトプロパティ DEBUG_TEST_USER_ID が未設定です');
    return;
  }
  LineService.debugFriendStatus(userId);
}
