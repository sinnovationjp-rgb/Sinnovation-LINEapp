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

  return {
    pushMessage: pushMessage,
    pushConfirmation: pushConfirmation,
    pushCancellation: pushCancellation
  };
})();
