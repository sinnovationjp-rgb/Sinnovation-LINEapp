var NotifyService = (function () {
  function getWebhookUrl_() {
    const props = PropertiesService.getScriptProperties();
    return props.getProperty('DISCORD_WEBHOOK_URL') || props.getProperty('SLACK_WEBHOOK_URL');
  }

  // 古い形式（discordapp.com）のWebhook URLもDiscordとして扱う。Slack形式（text）で送るとDiscordは
  // 「空のメッセージ」として400を返し、毎回失敗してしまう
  function isDiscordUrl_(url) {
    return /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(url);
  }

  // Discordは1メッセージ2000文字まで（超えると400で拒否される）。備考が長い予約でも届くよう切り詰める
  const DISCORD_MAX_LENGTH = 2000;

  function buildPayload_(url, message) {
    if (isDiscordUrl_(url)) {
      const content = message.length > DISCORD_MAX_LENGTH
        ? message.slice(0, DISCORD_MAX_LENGTH - 20) + '\n…（以下省略）'
        : message;
      // allowed_mentions: [] で氏名・備考等に@everyone等が入力されてもメンションを発生させない
      return { content: content, allowed_mentions: { parse: [] } };
    }
    return { text: message };
  }

  // 1回だけ送信を試みる。例外は投げず、結果（成否・ステータス・本文の一部・429時の待ち秒数）を返す
  function attemptSend_(url, message) {
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(buildPayload_(url, message)),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      if (code >= 200 && code < 300) {
        return { ok: true, code: code };
      }
      const body = String(response.getContentText() || '').slice(0, 300);
      console.error(`NotifyService.send: Webhookがエラーを返しました (status=${code})`, body);
      return { ok: false, code: code, body: body, retryAfterSec: getRetryAfterSec_(response, body) };
    } catch (err) {
      console.error('NotifyService.send failed', err);
      return { ok: false, code: null, body: String(err).slice(0, 300) };
    }
  }

  // 429（レート制限）のとき、Discordが指定する待ち秒数を読み取る（ヘッダーまたはJSON本文のretry_after）
  function getRetryAfterSec_(response, body) {
    try {
      const headers = response.getHeaders() || {};
      const headerValue = headers['Retry-After'] || headers['retry-after'];
      if (headerValue && !isNaN(Number(headerValue))) return Number(headerValue);
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.retry_after === 'number') return parsed.retry_after;
    } catch (err) {
      // 本文がJSONでない（CloudflareのHTMLエラーページ等）場合は既定の待ち時間を使う
    }
    return null;
  }

  // 失敗理由をスタッフ向けの説明にする（フォールバックメールに載せ、原因の切り分けに使う）
  function describeFailure_(result) {
    if (!result.code) return `通信エラー: ${result.body}`;
    const hints = {
      400: 'Discordが内容を受け付けませんでした（Webhook URLがSlack用の形式になっていないか確認してください）',
      401: 'Webhook URLが無効です（URLのトークン部分が正しいか確認してください）',
      403: 'Webhookへのアクセスが拒否されました',
      404: 'Webhookが見つかりません（Discord側でWebhookが削除された可能性があります。新しく作り直してDISCORD_WEBHOOK_URLを更新してください）',
      429: 'Discordのレート制限（送信回数の制限）にかかりました'
    };
    const hint = hints[result.code] || (result.code >= 500 ? 'Discord側の一時的な障害です' : '');
    return `status=${result.code}${hint ? '（' + hint + '）' : ''} 応答: ${result.body}`;
  }

  // Discord/Slackへの送信が最終的に失敗した場合、ADMIN_EMAILSへフォールバックメールを送り、
  // 予約の見落としを防ぐ（設定されているスタッフ全員に送る）
  function notifyAdminsOfFailure_(message, reason) {
    try {
      const adminEmails = (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (adminEmails.length === 0) {
        console.error('NotifyService.notifyAdminsOfFailure_: ADMIN_EMAILSが未設定のためフォールバック通知を送れません');
        return;
      }
      adminEmails.forEach((email) => {
        MailApp.sendEmail({
          to: email,
          subject: '【oO SPACE】Discord通知の送信に失敗しました',
          body: [
            'Discord（またはSlack）への通知の送信に複数回試行しましたが失敗しました。',
            reason ? `理由: ${reason}` : '',
            '',
            '--- 本来送るはずだった内容 ---',
            message,
            '',
            '予約の見落としを防ぐため、スプレッドシートを直接ご確認ください。'
          ].filter((line) => line !== '').join('\n'),
          name: 'oO SPACE'
        });
      });
    } catch (err) {
      console.error('NotifyService.notifyAdminsOfFailure_ failed', err);
    }
  }

  // 一時的な通信エラーやDiscordのレート制限に備え、間隔を空けて最大3回まで再送する。
  // 404/401など再送しても直らないエラーは即座にあきらめる。
  // それでも失敗した場合はADMIN_EMAILSへフォールバックメールを送り、スタッフが気づけるようにする
  function send(message) {
    const url = getWebhookUrl_();
    if (!url) {
      console.error('NotifyService.send: Webhook URLが未設定です');
      notifyAdminsOfFailure_(message, 'Webhook URL（DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL）が未設定です');
      return;
    }

    const maxAttempts = 3;
    let result = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      result = attemptSend_(url, message);
      if (result.ok) {
        return;
      }
      const retryable = !result.code || result.code === 429 || result.code >= 500;
      if (!retryable || attempt === maxAttempts) {
        break;
      }
      // 429ならDiscordの指定秒数（最大15秒）、それ以外は2秒・4秒と間隔を空ける
      const waitSec = result.code === 429
        ? Math.min(Math.max(result.retryAfterSec || 5, 1), 15)
        : 2 * attempt;
      Utilities.sleep(waitSec * 1000);
    }

    const reason = describeFailure_(result);
    console.error(`NotifyService.send: 送信できませんでした ${reason}`);
    notifyAdminsOfFailure_(message, reason);
  }

  // GASエディタからの診断用: テストメッセージを送り、結果（ステータス・応答）をそのまま返す
  function debugWebhook() {
    const url = getWebhookUrl_();
    if (!url) return '❌ DISCORD_WEBHOOK_URL / SLACK_WEBHOOK_URL が未設定です';
    const masked = url.replace(/\/[^/]+$/, '/****');
    const kind = isDiscordUrl_(url) ? 'Discord' : 'Slack（またはDiscordと判定できないURL）';
    const result = attemptSend_(url, '🔧 oO SPACE 予約システムからのテスト通知です');
    return result.ok
      ? `✅ 送信成功（${kind}, status=${result.code}）\nURL: ${masked}`
      : `❌ 送信失敗（${kind}）\nURL: ${masked}\n${describeFailure_(result)}`;
  }

  return {
    send: send,
    debugWebhook: debugWebhook
  };
})();

// GASエディタから実行して、Discord通知が届くか・失敗する場合の原因（ステータスコード）を確認する
function debugDiscordWebhook() {
  assertEditorRun_('debugDiscordWebhook');
  const report = NotifyService.debugWebhook();
  console.log(report);
  return report;
}
