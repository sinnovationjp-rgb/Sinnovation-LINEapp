function doGet(e) {
  if (e.parameter && e.parameter.page === 'approval' && e.parameter.id) {
    return renderApprovalPage_(e.parameter.id);
  }
  if (e.parameter && e.parameter.page === 'admin') {
    return renderAdminPage_(e.parameter.session);
  }
  const availability = SheetService.getAvailability(30);
  return jsonResponse_(availability);
}

// 予約データの読み取り→判定→書き込みが複数リクエストで同時に走ると、スプレッドシートの
// 二重書き込みや、確定/キャンセル二重実行防止チェックがすり抜ける恐れがあるため、
// 予約を変更する処理はスクリプト全体で排他制御する
function withReservationLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 最大10秒待つ
  } catch (err) {
    throw new Error('只今他の予約処理が混み合っています。少し時間をおいて再度お試しください。');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    console.error('doPost: リクエストのパースに失敗しました', err);
    return jsonResponse_({ success: false, error: 'invalid request' });
  }

  if (!data.datetime || !data.name || !data.phone) {
    console.error('doPost: 必須項目が不足しています', data);
    return jsonResponse_({ success: false, error: '日時・氏名・電話番号は必須です' });
  }

  try {
    const id = withReservationLock_(() => SheetService.addProvisionalReservation(data));
    const approvalUrl = getWebAppUrl_() + '?page=approval&id=' + id;
    NotifyService.send(buildProvisionalMessage_(id, data, approvalUrl));
    sendEmail_(data.email, '【oO SPACE】ご予約を受け付けました', buildProvisionalEmailBody_(data));
    if (data.userId) {
      const lineOk = LineService.pushProvisional(data.userId, data);
      if (!lineOk) {
        NotifyService.send(`⚠️ LINE仮予約受付通知の送信に失敗しました（予約ID ${id}）`);
      }
    } else {
      console.warn(`doPost: LINE UserIdが空のため仮予約受付通知を送信できません（予約ID ${id}）`);
    }
    return jsonResponse_({ success: true, id: id });
  } catch (err) {
    console.error('doPost: 仮予約処理に失敗しました', err);
    return jsonResponse_({ success: false, error: String(err) });
  }
}

function approveReservation(id, editedData) {
  try {
    if (!id) {
      throw new Error('予約IDが指定されていません（承認画面の読み込みに失敗している可能性があります。リンクを開き直してください）');
    }

    const lockResult = withReservationLock_(() => {
      const reservation = SheetService.getReservationById(id);
      if (!reservation) {
        throw new Error(`予約ID ${id} が見つかりません`);
      }
      if (reservation['ステータス'] === '確定') {
        // 承認リンクの二重送信・連打・画面の再読み込みなどで同じ予約が再度承認された場合、
        // カレンダーの二重登録やLINE/メール/Discordの二重通知を防ぐため、何もせず成功を返す
        console.warn(`approveReservation: 予約ID ${id} は既に確定済みのため、処理をスキップします`);
        return { alreadyProcessed: true };
      }

      // editedDataは承認画面のフォームから届く値。LINE UserIdなどフォームにない項目まで
      // 上書きされないよう、フォームが実際に持つ項目だけを許可リストとして反映する
      const EDITABLE_FIELDS = ['予約日時', '人数', 'スペース', '飲み放題', 'ご利用履歴', '氏名（カタカナ）', '電話番号', 'メールアドレス', '備考'];
      const safeEdits = {};
      EDITABLE_FIELDS.forEach((key) => {
        if (editedData && Object.prototype.hasOwnProperty.call(editedData, key)) {
          safeEdits[key] = editedData[key];
        }
      });
      const confirmed = Object.assign({}, reservation, safeEdits);

      SheetService.updateReservation(id, {
        'ステータス': '確定',
        '予約日時': confirmed['予約日時'],
        '人数': confirmed['人数'],
        'スペース': confirmed['スペース'],
        '飲み放題': confirmed['飲み放題'],
        'ご利用履歴': confirmed['ご利用履歴'],
        '氏名（カタカナ）': confirmed['氏名（カタカナ）'],
        '電話番号': confirmed['電話番号'],
        'メールアドレス': confirmed['メールアドレス'],
        '備考': confirmed['備考']
      });

      try {
        const event = CalendarService.createEvent({
          datetime: confirmed['予約日時'],
          headcount: confirmed['人数'],
          space: confirmed['スペース'],
          drink: confirmed['飲み放題'],
          name: confirmed['氏名（カタカナ）'],
          note: confirmed['備考']
        });
        SheetService.updateReservation(id, { 'カレンダーイベントID': event.getId() });
      } catch (calendarErr) {
        console.error(`approveReservation: カレンダー登録に失敗しました（予約ID ${id}）。スプレッドシートの確定・通知は続行します`, calendarErr);
        NotifyService.send(`⚠️ カレンダー登録に失敗しました（予約ID ${id}）。手動でカレンダーに追加してください。\nエラー: ${calendarErr}`);
      }

      return { confirmed: confirmed };
    });

    if (lockResult.alreadyProcessed) {
      return { success: true };
    }
    const confirmed = lockResult.confirmed;

    NotifyService.send(buildConfirmedMessage_(confirmed));

    const userId = confirmed['LINE UserId'];
    if (userId) {
      const lineOk = LineService.pushConfirmation(userId, confirmed);
      if (!lineOk) {
        NotifyService.send(`⚠️ LINE確定通知の送信に失敗しました（予約ID ${id}）。お客様に電話等で確認をお願いします。`);
      }
    } else {
      console.warn(`approveReservation: LINE UserIdが空のため確定通知を送信できません（予約ID ${id}）`);
    }

    sendEmail_(confirmed['メールアドレス'], '【oO SPACE】ご予約が確定しました', buildConfirmedEmailBody_(confirmed));

    return { success: true };
  } catch (err) {
    console.error('approveReservation failed', err);
    return { success: false, error: String(err) };
  }
}

function renderApprovalPage_(id) {
  const reservation = SheetService.getReservationById(id);
  const template = HtmlService.createTemplateFromFile('ApprovalPage');
  template.reservationId = id;
  template.reservation = reservation;
  return template.evaluate().setTitle('予約承認');
}

// 管理者アカウントのみアクセス許可（スクリプトプロパティADMIN_EMAILSに登録されたメールアドレスの一覧と照合）
// 承認・却下・キャンセル・ユーザー管理など「操作」を伴う機能はすべてこれで判定する
function isAuthorizedAdmin_(sessionToken) {
  return getUserRole_(sessionToken) === 'admin';
}

// 画面を閲覧できるか（管理者 or 閲覧者）。操作の可否は別途isAuthorizedAdmin_()で判定する
function isAuthorizedViewer_(sessionToken) {
  return getUserRole_(sessionToken) !== null;
}

// 現在の利用者の権限（'admin' | 'viewer' | null）を返す。
// 「自分として実行」のWebアプリでは、Session.getActiveUser()はスクリプト所有者と同じWorkspaceドメイン
// （sinnovation.jp）のユーザーにしかメールアドレスを返さない（Googleの仕様）。そのためGmail等の社外アカウントは、
// メールで受け取ったログインリンクのセッショントークンで本人確認する
function getUserRole_(sessionToken) {
  const googleRole = getRoleForEmail_(Session.getActiveUser().getEmail());
  if (googleRole) return googleRole;
  return getRoleForEmail_(getSessionEmail_(sessionToken));
}

function getRoleForEmail_(email) {
  const lower = String(email || '').trim().toLowerCase();
  if (!lower) return null;
  if (getAdminEmailList_().some((e) => e.toLowerCase() === lower)) return 'admin';
  if (getViewerEmailList_().some((e) => e.toLowerCase() === lower)) return 'viewer';
  return null;
}

// 末尾が「_」でないトップレベル関数は、承認画面・管理者画面などHtmlServiceのページを開いた人なら誰でも（匿名でも）
// ブラウザの開発者ツールから google.script.run.<関数名>() で呼び出せ、スクリプト所有者の権限で実行されてしまう。
// GASエディタやトリガーからだけ実行したい保守・診断用の関数は、先頭で以下のガードを呼んでWebアプリ経由の呼び出しを拒否する
// （末尾を「_」にするとgoogle.script.runからは隠れるが、エディタの関数選択プルダウンからも消えてしまうため使えない）

// Webアプリは「自分として実行（USER_DEPLOYING）」でデプロイしているため、Webアプリ経由の呼び出しでは
// getEffectiveUser()が常にスクリプト所有者になる一方、getActiveUser()は訪問者（匿名・社外アカウントなら空文字）になる。
// GASエディタからの実行では両者とも実行した本人になって一致するので、これで呼び出し元を区別できる
function isEditorRun_() {
  const active = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const effective = (Session.getEffectiveUser().getEmail() || '').toLowerCase();
  return !!active && active === effective;
}

// トリガー実行時にgetActiveUser()でメールアドレスが取れるかはGASのドキュメント上保証されていないため、
// トリガーが渡すイベントオブジェクトのtriggerUidを、このプロジェクトに登録済みのトリガーのIDと照合して判定する
function isOwnTriggerRun_(e, handlerFunction) {
  const triggerUid = e && e.triggerUid ? String(e.triggerUid) : '';
  if (!triggerUid) return false;
  return ScriptApp.getProjectTriggers().some(
    (trigger) => trigger.getUniqueId() === triggerUid && trigger.getHandlerFunction() === handlerFunction
  );
}

function assertEditorRun_(functionName) {
  if (!isEditorRun_()) {
    throw new Error(`${functionName}はGASエディタからのみ実行できます`);
  }
}

// トリガーのハンドラー関数用（エディタからの手動実行も許可する）
function assertEditorOrTriggerRun_(e, functionName) {
  if (!isEditorRun_() && !isOwnTriggerRun_(e, functionName)) {
    throw new Error(`${functionName}はGASエディタまたはトリガーからのみ実行できます`);
  }
}

const LOGIN_SESSION_PREFIX = 'LOGIN_SESSION_';
const LOGIN_SESSION_DAYS = 7;

// セッショントークンに紐づくメールアドレスを返す（無効・期限切れならnull）
function getSessionEmail_(sessionToken) {
  if (!isValidSessionTokenFormat_(sessionToken)) return null;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(LOGIN_SESSION_PREFIX + sessionToken);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.expiresAt || session.expiresAt < Date.now()) {
      props.deleteProperty(LOGIN_SESSION_PREFIX + sessionToken);
      return null;
    }
    return session.email || null;
  } catch (err) {
    console.error('getSessionEmail_: セッション情報の読み取りに失敗しました', err);
    return null;
  }
}

function isValidSessionTokenFormat_(token) {
  return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
}

function deleteExpiredSessions_(props) {
  const now = Date.now();
  props.getKeys().forEach((key) => {
    if (key.indexOf(LOGIN_SESSION_PREFIX) !== 0) return;
    try {
      const session = JSON.parse(props.getProperty(key));
      if (!session.expiresAt || session.expiresAt < now) props.deleteProperty(key);
    } catch (err) {
      props.deleteProperty(key);
    }
  });
}

// ログイン画面から呼ばれる。登録済みのメールアドレスであれば、ログイン用リンクをそのアドレスへ送る。
// 登録の有無が外部から判別できないよう、未登録でも同じ応答を返す
function requestAdminLoginLink(email) {
  const genericResponse = { success: true, message: '登録済みのメールアドレスであれば、ログイン用のリンクを送信しました。メールをご確認ください。' };
  try {
    const trimmed = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { success: false, error: '正しいメールアドレスを入力してください' };
    }
    const lower = trimmed.toLowerCase();
    if (!getRoleForEmail_(lower)) {
      console.warn(`requestAdminLoginLink: 未登録のメールアドレスからのログイン要求（${lower}）`);
      return genericResponse;
    }

    // 連打やいたずらによるメール大量送信を防ぐため、同じアドレスへの送信は1分に1回まで
    const cache = CacheService.getScriptCache();
    const throttleKey = 'LOGIN_LINK_SENT_' + lower;
    if (cache.get(throttleKey)) {
      return genericResponse;
    }

    const props = PropertiesService.getScriptProperties();
    deleteExpiredSessions_(props);
    const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase();
    const expiresAt = Date.now() + LOGIN_SESSION_DAYS * 24 * 60 * 60 * 1000;
    props.setProperty(LOGIN_SESSION_PREFIX + token, JSON.stringify({ email: lower, expiresAt: expiresAt }));

    const loginUrl = getWebAppUrl_() + '?page=admin&session=' + token;
    checkEmailQuota_();
    MailApp.sendEmail({
      to: trimmed,
      subject: '【oO SPACE】予約管理画面へのログインリンク',
      body: [
        '予約管理画面へのログインリンクです。下記のURLを開いてください。',
        '',
        loginUrl,
        '',
        `このリンクは${LOGIN_SESSION_DAYS}日間有効です。他の人には共有しないでください。`,
        'このメールに心当たりがない場合は、破棄してください。'
      ].join('\n'),
      name: 'oO SPACE'
    });
    cache.put(throttleKey, '1', 60);
    return genericResponse;
  } catch (err) {
    console.error('requestAdminLoginLink failed', err);
    return { success: false, error: 'ログインリンクの送信に失敗しました。時間をおいて再度お試しください。' };
  }
}

// メールやDiscordに載せるWebアプリのURL。ScriptApp.getService().getUrl()は、実際には開けないURLや
// Workspaceドメイン限定の /a/macros/<ドメイン>/ 形式のURLを返すことがあり、社外の人が開けない恐れがあるため、
// 実際に社外アカウントで開けることを確認したURLをスクリプトプロパティWEB_APP_URLに設定して使う
const WEB_APP_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

function getWebAppUrl_() {
  const configured = (PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '').trim().split('?')[0];
  if (configured) return configured;
  return (ScriptApp.getService().getUrl() || '').replace(/\/a\/macros\/[^/]+\//, '/macros/');
}

function logoutAdminSession(sessionToken) {
  if (isValidSessionTokenFormat_(sessionToken)) {
    PropertiesService.getScriptProperties().deleteProperty(LOGIN_SESSION_PREFIX + sessionToken);
  }
  return { success: true };
}

function getAdminEmailList_() {
  return (PropertiesService.getScriptProperties().getProperty('ADMIN_EMAILS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getViewerEmailList_() {
  return (PropertiesService.getScriptProperties().getProperty('VIEWER_EMAILS') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getAllUsersList_() {
  const admins = getAdminEmailList_().map((email) => ({ email: email, role: 'admin' }));
  const viewers = getViewerEmailList_().map((email) => ({ email: email, role: 'viewer' }));
  return admins.concat(viewers);
}

// 管理者画面から、現在登録されている管理者・閲覧者の一覧を取得する（管理者のみ）
function getAllUsers(sessionToken) {
  if (!isAuthorizedAdmin_(sessionToken)) {
    return { success: false, error: 'アクセス権がありません' };
  }
  return { success: true, users: getAllUsersList_() };
}

// 管理者画面から、新しいユーザー（管理者 or 閲覧者）を追加する（管理者のみ）
function addUser(email, role, sessionToken) {
  try {
    if (!isAuthorizedAdmin_(sessionToken)) {
      throw new Error('アクセス権がありません');
    }
    if (role !== 'admin' && role !== 'viewer') {
      throw new Error('権限の指定が正しくありません');
    }
    const trimmed = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new Error('正しいメールアドレスを入力してください');
    }
    const lower = trimmed.toLowerCase();
    const admins = getAdminEmailList_();
    const viewers = getViewerEmailList_();
    if (admins.some((e) => e.toLowerCase() === lower) || viewers.some((e) => e.toLowerCase() === lower)) {
      throw new Error('既に登録されています');
    }

    const props = PropertiesService.getScriptProperties();
    if (role === 'admin') {
      admins.push(trimmed);
      props.setProperty('ADMIN_EMAILS', admins.join(','));
    } else {
      viewers.push(trimmed);
      props.setProperty('VIEWER_EMAILS', viewers.join(','));
    }
    return { success: true, users: getAllUsersList_() };
  } catch (err) {
    console.error('addUser failed', err);
    return { success: false, error: String(err.message || err) };
  }
}

// 管理者画面から、ユーザーを削除する（管理者が0人になる操作は拒否する）（管理者のみ）
function removeUser(email, sessionToken) {
  try {
    if (!isAuthorizedAdmin_(sessionToken)) {
      throw new Error('アクセス権がありません');
    }
    const target = String(email || '').trim().toLowerCase();
    const admins = getAdminEmailList_();
    const viewers = getViewerEmailList_();
    const wasAdmin = admins.some((e) => e.toLowerCase() === target);
    const wasViewer = viewers.some((e) => e.toLowerCase() === target);
    if (!wasAdmin && !wasViewer) {
      throw new Error('指定されたメールアドレスは登録されていません');
    }
    if (wasAdmin && admins.length === 1) {
      throw new Error('管理者が0人になるため削除できません。先に別の管理者を追加してください');
    }

    const props = PropertiesService.getScriptProperties();
    if (wasAdmin) {
      props.setProperty('ADMIN_EMAILS', admins.filter((e) => e.toLowerCase() !== target).join(','));
    }
    if (wasViewer) {
      props.setProperty('VIEWER_EMAILS', viewers.filter((e) => e.toLowerCase() !== target).join(','));
    }
    return { success: true, users: getAllUsersList_() };
  } catch (err) {
    console.error('removeUser failed', err);
    return { success: false, error: String(err.message || err) };
  }
}

// 管理者画面から、既存ユーザーの権限（管理者⇔閲覧者）を切り替える（管理者のみ）
function setUserRole(email, role, sessionToken) {
  try {
    if (!isAuthorizedAdmin_(sessionToken)) {
      throw new Error('アクセス権がありません');
    }
    if (role !== 'admin' && role !== 'viewer') {
      throw new Error('権限の指定が正しくありません');
    }
    const target = String(email || '').trim().toLowerCase();
    const admins = getAdminEmailList_();
    const viewers = getViewerEmailList_();
    const adminEntry = admins.find((e) => e.toLowerCase() === target);
    const viewerEntry = viewers.find((e) => e.toLowerCase() === target);
    const original = adminEntry || viewerEntry;
    if (!original) {
      throw new Error('指定されたメールアドレスは登録されていません');
    }
    const currentRole = adminEntry ? 'admin' : 'viewer';
    if (currentRole === role) {
      return { success: true, users: getAllUsersList_() };
    }
    if (currentRole === 'admin' && admins.length === 1) {
      throw new Error('管理者が0人になるため変更できません。先に別の管理者を追加してください');
    }

    const newAdmins = admins.filter((e) => e.toLowerCase() !== target);
    const newViewers = viewers.filter((e) => e.toLowerCase() !== target);
    if (role === 'admin') {
      newAdmins.push(original);
    } else {
      newViewers.push(original);
    }
    const props = PropertiesService.getScriptProperties();
    props.setProperty('ADMIN_EMAILS', newAdmins.join(','));
    props.setProperty('VIEWER_EMAILS', newViewers.join(','));
    return { success: true, users: getAllUsersList_() };
  } catch (err) {
    console.error('setUserRole failed', err);
    return { success: false, error: String(err.message || err) };
  }
}

function renderAdminPage_(sessionToken) {
  const role = getUserRole_(sessionToken);
  if (!role) {
    const login = HtmlService.createTemplateFromFile('AdminLoginPage');
    login.sessionExpired = Boolean(sessionToken);
    return login.evaluate().setTitle('予約管理 ログイン');
  }
  // Googleアカウントで認証できた場合（sinnovation.jpのスタッフ）はトークン不要なので画面に渡さない
  const googleRole = getRoleForEmail_(Session.getActiveUser().getEmail());
  const template = HtmlService.createTemplateFromFile('AdminPage');
  template.reservations = SheetService.getAllReservations();
  template.role = role;
  template.sessionToken = googleRole ? null : sessionToken;
  return template.evaluate().setTitle('予約管理');
}

function cancelReservation(id, sessionToken) {
  try {
    if (!isAuthorizedAdmin_(sessionToken)) {
      throw new Error('アクセス権がありません');
    }
    if (!id) {
      throw new Error('予約IDが指定されていません（画面を再読み込みしてもう一度お試しください）');
    }

    const lockResult = withReservationLock_(() => {
      const reservation = SheetService.getReservationById(id);
      if (!reservation) {
        throw new Error(`予約ID ${id} が見つかりません`);
      }
      if (reservation['ステータス'] === 'キャンセル') {
        // 既にキャンセル済みの予約への二重操作（パネルの連打・再読み込み等）で
        // LINE/Discordへの二重通知が飛ぶのを防ぐため、何もせず成功を返す
        console.warn(`cancelReservation: 予約ID ${id} は既にキャンセル済みのため、処理をスキップします`);
        return { alreadyProcessed: true };
      }
      const wasConfirmed = reservation['ステータス'] === '確定';

      SheetService.updateReservation(id, { 'ステータス': 'キャンセル' });

      if (wasConfirmed && reservation['カレンダーイベントID']) {
        try {
          CalendarService.deleteEvent(reservation['カレンダーイベントID']);
        } catch (calendarErr) {
          console.error(`cancelReservation: カレンダーの予定削除に失敗しました（予約ID ${id}）`, calendarErr);
          NotifyService.send(`⚠️ カレンダーの予定削除に失敗しました（予約ID ${id}）。手動で削除してください。\nエラー: ${calendarErr}`);
        }
      }

      return { reservation: reservation, wasConfirmed: wasConfirmed };
    });

    if (lockResult.alreadyProcessed) {
      return { success: true };
    }
    const reservation = lockResult.reservation;
    const wasConfirmed = lockResult.wasConfirmed;

    NotifyService.send(buildCancelledMessage_(reservation, wasConfirmed));

    const userId = reservation['LINE UserId'];
    if (userId) {
      const lineOk = LineService.pushCancellation(userId, reservation, wasConfirmed);
      if (!lineOk) {
        NotifyService.send(`⚠️ LINEキャンセル通知の送信に失敗しました（予約ID ${id}）。お客様に電話等で確認をお願いします。`);
      }
    } else {
      console.warn(`cancelReservation: LINE UserIdが空のためキャンセル通知を送信できません（予約ID ${id}）`);
    }

    return { success: true };
  } catch (err) {
    console.error('cancelReservation failed', err);
    return { success: false, error: String(err) };
  }
}

// 予約日時をお客様・スタッフ向けに分かりやすい表記に変換する（Dateオブジェクト・ISO文字列どちらにも対応）
function formatDateTimeForDisplay_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return String(value);
  const dows = ['日', '月', '火', '水', '木', '金', '土'];
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}月${date.getDate()}日(${dows[date.getDay()]}) ${hh}:${mi}`;
}

function buildProvisionalMessage_(id, data, approvalUrl) {
  return [
    '新規予約リクエストがありました',
    `日時: ${data.datetime ? formatDateTimeForDisplay_(data.datetime) : '未入力'}`,
    `人数: ${data.headcount ? data.headcount + '名' : '未入力'}`,
    `スペース: ${data.space || '未入力'}`,
    `飲み放題: ${data.drink || '未入力'}`,
    `ご利用履歴: ${data.usageHistory || '未入力'}`,
    `氏名: ${data.name || '未入力'}`,
    `電話番号: ${data.phone || '未入力'}`,
    `メールアドレス: ${data.email || 'なし'}`,
    `備考: ${data.note || 'なし'}`,
    `承認画面: ${approvalUrl}`
  ].join('\n');
}

function buildConfirmedMessage_(reservation) {
  return [
    '予約が確定しました',
    `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
    `人数: ${reservation['人数'] || ''}名`,
    `スペース: ${reservation['スペース'] || ''}`,
    `飲み放題: ${reservation['飲み放題'] || ''}`,
    `氏名: ${reservation['氏名（カタカナ）'] || ''}`
  ].join('\n');
}

function buildCancelledMessage_(reservation, wasConfirmed) {
  return [
    wasConfirmed ? '確定済みの予約がキャンセルされました' : '仮予約が却下されました',
    `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
    `人数: ${reservation['人数'] || ''}名`,
    `スペース: ${reservation['スペース'] || ''}`,
    `氏名: ${reservation['氏名（カタカナ）'] || ''}`
  ].join('\n');
}

// メールアドレスが指定されている場合のみ送信する。失敗しても呼び出し元の処理は継続させる
function sendEmail_(to, subject, body) {
  if (!to) return;
  checkEmailQuota_();
  try {
    MailApp.sendEmail({ to: to, subject: subject, body: body, name: 'oO SPACE' });
  } catch (err) {
    console.error(`sendEmail_: メール送信に失敗しました（宛先 ${to}）`, err);
    NotifyService.send(`⚠️ メール送信に失敗しました（宛先: ${to}, 件名: ${subject}）\nエラー: ${err}`);
  }
}

// メール送信の1日あたりの残りクォータが少なくなっていたら、1日1回だけDiscordへ警告する
// （GASのMailAppには1日あたりの送信上限があり、超えると以降のメールが送れなくなるため）
function checkEmailQuota_() {
  try {
    const remaining = MailApp.getRemainingDailyQuota();
    const threshold = 20;
    if (remaining >= threshold) return;

    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (props.getProperty('EMAIL_QUOTA_ALERT_DATE') === today) return;

    NotifyService.send(`⚠️ メール送信の残りクォータが少なくなっています（残り${remaining}件）。本日分のメールが送信できなくなる可能性があります。`);
    props.setProperty('EMAIL_QUOTA_ALERT_DATE', today);
  } catch (err) {
    console.error('checkEmailQuota_ failed', err);
  }
}

function buildProvisionalEmailBody_(data) {
  return [
    'この度はご予約のお申し込みをいただき、誠にありがとうございます。',
    '内容を確認のうえ、担当者よりLINEにてご連絡いたします。',
    '',
    `日時: ${data.datetime ? formatDateTimeForDisplay_(data.datetime) : '未入力'}`,
    `人数: ${data.headcount ? data.headcount + '名' : '未入力'}`,
    `スペース: ${data.space || '未入力'}`,
    `飲み放題: ${data.drink || '未入力'}`,
    '',
    'ご不明な点がございましたら店舗までお問い合わせください。'
  ].join('\n');
}

function buildConfirmedEmailBody_(reservation) {
  return [
    'ご予約が確定いたしました。',
    '',
    `日時: ${formatDateTimeForDisplay_(reservation['予約日時'])}`,
    `人数: ${reservation['人数'] || ''}名`,
    `スペース: ${reservation['スペース'] || ''}`,
    `飲み放題: ${reservation['飲み放題'] || ''}`,
    '',
    'キャンセルをご希望の場合は、LINE公式アカウントのメッセージにてお知らせください。',
    '',
    '当日のご来店を心よりお待ちしております。'
  ].join('\n');
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// HtmlServiceテンプレート内でJSONをscriptタグに安全に埋め込むためのヘルパー
function toSafeJson_(obj) {
  return JSON.stringify(obj === undefined ? null : obj).replace(/</g, '\\u003c');
}

// 設定診断用: スクリプトプロパティが一通り設定され、実際にアクセスできるかをまとめて確認する。
// アカウント移行・引き継ぎのたびに「あれ、動かない」の切り分けを早くするため、
// GASエディタの関数選択プルダウンから checkConfig を直接実行できるようにしてある
// （ADMIN_EMAILSなどの設定内容を返すため、Webアプリ経由の呼び出しは拒否する）
function checkConfig() {
  assertEditorRun_('checkConfig');
  const props = PropertiesService.getScriptProperties();
  const lines = [];

  function report(label, ok, detail) {
    lines.push(`${ok ? '✅' : '❌'} ${label}${detail ? `: ${detail}` : ''}`);
  }

  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  report('SPREADSHEET_ID', !!spreadsheetId);
  if (spreadsheetId) {
    try {
      const ss = SpreadsheetApp.openById(spreadsheetId);
      report('  → スプレッドシートを開けるか', true, ss.getName());
    } catch (err) {
      report('  → スプレッドシートを開けるか', false, String(err));
    }
  }

  const calendarId = props.getProperty('CALENDAR_ID');
  report('CALENDAR_ID', !!calendarId);
  if (calendarId) {
    try {
      const cal = CalendarApp.getCalendarById(calendarId);
      report('  → カレンダーにアクセスできるか', !!cal, cal ? cal.getName() : '見つかりません（IDが間違っているか、共有権限がない可能性）');
    } catch (err) {
      report('  → カレンダーにアクセスできるか', false, String(err));
    }
  }

  const discordUrl = props.getProperty('DISCORD_WEBHOOK_URL');
  const slackUrl = props.getProperty('SLACK_WEBHOOK_URL');
  report('DISCORD_WEBHOOK_URL または SLACK_WEBHOOK_URL', !!(discordUrl || slackUrl));

  const adminEmails = props.getProperty('ADMIN_EMAILS');
  report('ADMIN_EMAILS', !!adminEmails, adminEmails || '（未設定だと管理者画面に誰も入れず、通知失敗時のフォールバックメールも届きません）');

  const webAppUrl = (props.getProperty('WEB_APP_URL') || '').trim().split('?')[0];
  if (!webAppUrl) {
    report('WEB_APP_URL', false, `未設定（代わりに ${getWebAppUrl_()} を使います。社外の人がログインリンク・承認リンクを開けない恐れがあるため、デプロイを管理画面に表示される「ウェブアプリ」のURLを設定してください）`);
  } else {
    report('WEB_APP_URL', WEB_APP_URL_PATTERN.test(webAppUrl), WEB_APP_URL_PATTERN.test(webAppUrl)
      ? webAppUrl
      : `${webAppUrl}（https://script.google.com/macros/s/〜/exec の形式ではありません。/a/macros/〜 や /dev のURLは社外の人が開けません）`);
  }

  const lineToken = props.getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const lineId = props.getProperty('LINE_CHANNEL_ID');
  const lineSecret = props.getProperty('LINE_CHANNEL_SECRET');
  const hasLineCreds = !!(lineToken || (lineId && lineSecret));
  report('LINE認証情報（LINE_CHANNEL_ACCESS_TOKEN、またはLINE_CHANNEL_ID+LINE_CHANNEL_SECRET）', hasLineCreds);
  if (hasLineCreds) {
    report('  → LINEアクセストークンを実際に取得できるか', LineService.debugConnection());
  }

  const report_ = lines.join('\n');
  console.log(report_);
  return report_;
}

