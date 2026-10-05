# CLAUDE.md

Claude Codeがこのリポジトリで作業する際に毎回自動で読み込むプロジェクトコンテキストです。

## プロジェクト概要
LINE公式アカウントのLIFFを使ったスペース予約システム。ユーザーがLINE上から予約 → GASがスプレッドシートに仮登録しつつDiscordへ通知 → スタッフが承認画面で確認・確定 → LINEで確定通知 → 前日リマインドを自動送信、という流れを全コンポーネント無料枠で構築します。元の要件定義は`docs/spec.md`参照。

## アーキテクチャ
- フロントエンド: 素のHTML/CSS/JS。ビルドステップなし。GitHub Pagesで公開（HTTPS必須、LIFFの要件）。
- バックエンド: Google Apps Script (GAS) のWeb App一本（doGet/doPost）。
- DB: Googleスプレッドシート（予約管理台帳）。空き状況判定はスプレッドシートの確定済みデータのみで完結する（Googleカレンダーの空き状況は参照しない）
- 空き状況判定のルール: 1日あたりの合計人数（スペース合算）が15人に達していなければ「空きあり」とする粗めの目安表示。日付単位の判定のみでスペース・時間帯別の判定は行わない。最終的な可否はスタッフが承認画面で個別に判断する
- カレンダー連携: 予約が承認・確定したタイミングでCalendarServiceがGoogleカレンダーに予定を登録する（確定記録の反映先としてのみ利用し、空き状況判定には使わない）
- 通知: Discord Webhook（初期はSlack Webhookで代用可） / LINE Messaging API（仮予約受付時・確定時・キャンセル時・前日リマインド時、LINE UserId保持者向け） / MailApp（仮予約受付時・確定時・前日リマインド時、メールアドレス登録者向け）

### GAS側のルーティング設計
doGet/doPostは公開URLを1つしか持てないため、クエリパラメータで内部ルーティングします。

- `doGet(e)`: パラメータなし → 空き状況JSONを返す（フロントのfetch用）／`?page=approval&id=XXX` → HtmlServiceで承認画面(ApprovalPage.html)を返す／`?page=admin` → HtmlServiceで管理者画面(AdminPage.html)を返す
- `doPost(e)`: フロントからの仮予約データ受信専用
- 承認画面内の「承認」ボタンは`google.script.run.approveReservation(id, editedData)`でサーバー関数を直接呼ぶ（同一プロジェクト内なのでCORSも発生しない）

### 管理者画面（AdminPage.html）
- 予約一覧・ステータス別フィルタ・検索・詳細パネルからの承認/却下/キャンセル操作ができるスタッフ向け画面
- アクセス制限は`isAuthorizedAdmin_()`が担う：`Session.getActiveUser().getEmail()`を取得し、スクリプトプロパティ`ADMIN_EMAILS`（カンマ区切りのメールアドレス一覧）と照合する。未許可・匿名アクセスの場合は一覧データを含まない「アクセス権がありません」画面を返す
- 既存の1つのWebアプリデプロイ（アクセス可能ユーザー設定は「全員」）で予約用・管理者用の両方を兼用できる。実機確認の結果、匿名のLINEユーザーには`Session.getActiveUser()`が空になり予約機能に影響しない一方、スクリプト所有ドメイン（sinnovation.jp）にログイン済みのスタッフがアクセスした場合は同関数でメールアドレスが取得できるため、`ADMIN_EMAILS`との照合だけで管理者画面のアクセス制御が成立する。別デプロイは不要

### CORSの注意点（重要）
GASのWeb AppはOPTIONSプリフライトを正しく処理できません。フロントから`Content-Type: application/json`でPOSTするとプリフライトで失敗するので、`Content-Type: text/plain;charset=utf-8`でJSON文字列を送り、GAS側は`JSON.parse(e.postData.contents)`で受け取ってください。

### リマインドトリガー
時限トリガーは`clasp push`だけでは有効化されません。トリガー登録用のセットアップ関数（例: `createDailyTrigger()`）を用意し、GASエディタで初回のみ手動実行してください。

## シークレット管理
GASは`.env`を使えません。Webhook URL、LINEチャネルアクセストークン、スプレッドシートID、カレンダーID（`CALENDAR_ID`）、管理者画面の許可メールアドレス一覧（`ADMIN_EMAILS`）は必ず`PropertiesService.getScriptProperties()`経由で読み込み、ソースコードに直書きしないこと。値自体はGASエディタの「プロジェクトの設定 > スクリプトプロパティ」から手動登録します。

### LINEチャネルアクセストークンの2つの登録方法
`LineService.getAccessToken_()`は以下の優先順位でトークンを取得する。
1. `LINE_CHANNEL_ACCESS_TOKEN`（Developers Consoleで発行する長期トークン）が設定されていればそれを使う
2. 未設定の場合、`LINE_CHANNEL_ID`と`LINE_CHANNEL_SECRET`から、送信のたびに15分だけ有効な「ステートレスなアクセストークン」を`https://api.line.me/oauth2/v3/token`経由で取得する（Developers Consoleでの発行操作・プロバイダーへのアクセス権限が不要）

後者は、Messaging APIチャネルが入っているプロバイダーへの管理者権限がない場合の代替手段として使える。

## ディレクトリ構成
README.mdの構成図を参照してください（gas/配下はclaspでプッシュする対象）。

## コーディング規約
- GAS側は関心事ごとにファイル分割（Code.js / SheetService.js / CalendarService.js / NotifyService.js / LineService.js / Trigger.js）
- NotifyService.jsはDiscordとSlackのWebhook形式差異を吸収する共通インターフェースにする
- NotifyService.send()は一時的な通信エラー・レート制限に備えて最大3回まで間隔を空けて再送し、それでも失敗した場合は`ADMIN_EMAILS`宛てにフォールバックメールを送って通知の見落としを防ぐ
- 外部API呼び出しは必ずtry/catchし、失敗時はログを残す
- フロントは1画面1HTMLファイル。共通処理はjs/に切り出す

## 開発の進め方
TASKS.mdのPhase順に、1フェーズずつ実装→動作確認→次フェーズ、を繰り返してください。一度に複数フェーズをまとめて依頼しないこと。

## GitHub運用ルール
- main: 本番環境（GitHub Pagesと直結、直接pushしない）
- develop / feature/xxx: 開発ブランチ、PR経由でmainにマージ
- GitHub Pages公開設定はSettings > Pagesでmain（または/docs）を指定
- 発行されたURLをLINE DevelopersのLIFFエンドポイントURLに登録

## 進行中の作業メモ（引き継ぎ用）

### 本番の公式LINEアカウントへの切り替え作業（2026-10-01 完了）
これまで開発に使っていたテスト用LIFF（`LIFF_ID = '2011404271-2LcJbLkK'`）を、実際に運用する公式アカウント「oO SPACE Niigata」（ベーシックID `@186lmmed`）に切り替える作業。**LINE確定通知の実機受信を確認し、完了。**
現在の本番LIFF ID: `2011811803-LPCWIDmb`（`frontend/js/liff-init.js`）。`@186lmmed`のMessaging APIチャネルと同一プロバイダー内に作成したLINE Loginチャネルのもの。

**ここまで完了したこと**
- LINE Official Account Manager（manager.line.biz）で `@186lmmed` のMessaging APIを有効化し、チャネルID・チャネルシークレットを取得済み
- 齋藤さんの権限で新規にLINE Loginチャネル「oO SPACE予約」を作成し、LIFFアプリを追加（LIFF ID: `2011761592-fPsPphNA`、エンドポイントURL: `https://sinnovationjp-rgb.github.io/Sinnovation-LINEapp/frontend/index.html`）→ `frontend/js/liff-init.js`の`LIFF_ID`をこの値に更新しmainにマージ済み
- `LineService.js`を修正し、`LINE_CHANNEL_ID`+`LINE_CHANNEL_SECRET`があれば送信の都度ステートレスなアクセストークン（15分有効、`https://api.line.me/oauth2/v3/token`）を取得できるようにした。これによりチャネルアクセストークンの発行だけは権限問題を回避できる見込み

**【訂正】プロバイダー不一致が実際にLINE通知を阻害することが判明（2026-10-01）**
- 以前「リンクされたLINE公式アカウント」設定は友だち追加オプションのUX機能だけで、プッシュ通知の可否とは無関係と判断し、プロバイダー不一致は問題ないと結論づけていたが、これは**誤りだった**
- 実際にデプロイ後の本番環境で検証した結果、「oO SPACE予約」LINE Loginチャネル（LIFF ID: `2011761592-fPsPphNA`）経由で取得したuserIdを使って`@186lmmed`へプッシュ送信すると、`status=400 {"message":"Failed to send messages"}`で失敗することを確認
- 原因を切り分けるためLineService.jsにデバッグ関数（`debugLineBotInfo`/`debugLineFriendStatus`）を追加して調査した結果:
  - `debugLineBotInfo`→チャネルID/SECRETは正しく`@186lmmed`（oO SPACE Niigata）を指している
  - 対象ユーザーは実際にLINEアプリ上で`@186lmmed`を友だち追加済み（リッチメニュー表示を目視確認）であるにもかかわらず
  - `debugLineFriendStatus`（`GET /v2/bot/profile/{userId}`）が`404 Not Found`を返す
  - → **LINEのuserIdはプロバイダーごとに異なる値が発行される仕様**であり、「oO SPACE予約」チャネルと`@186lmmed`のMessaging APIチャネルが別プロバイダーに属しているため、LIFFから取得したuserIdは`@186lmmed`の友だちリスト上のIDと一致しない（友だち追加という行為自体は正しくできていても、システム上は別人のIDとして扱われる）
- **結論**: LIFF（LINE Loginチャネル）を`@186lmmed`のMessaging APIチャネルと**同じプロバイダー内**に作り直さない限り、LINE通知は原理的に届かない。「リンク不要」は友だち追加プロンプト機能については正しいが、プロバイダーが別だとそもそもuserIdが一致しないため無関係に機能しない

**チャネルアクセストークンの対応状況（これは問題なし）**
- GAS（Space予約管理プロジェクト）のスクリプトプロパティに`LINE_CHANNEL_ID`・`LINE_CHANNEL_SECRET`（社長から取得、`@186lmmed`のMessaging APIチャネルのもの）を登録済み、ステートレストークン取得は`debugLineConnection`で動作確認済み（✅成功）
- 古い`LINE_CHANNEL_ACCESS_TOKEN`（siturt0330時代の値）はスクリプトプロパティから削除済み

**プロバイダー問題への対応（2026-10-01、解決済み）**
1. ✅ `@186lmmed`のMessaging APIチャネルと同一プロバイダー内に新しいLINE Loginチャネル＋LIFFアプリを作成（LIFF ID: `2011811803-LPCWIDmb`）
2. ✅ `frontend/js/liff-init.js`の`LIFF_ID`を更新してmainにマージ（フロントはGitHub Pages直結のためclasp deploy不要）
3. ✅ manager.line.biz（`@186lmmed`側）のリッチメニューのリンク先を新LIFF IDに差し替え
4. ✅ 新LIFF経由でテスト予約→承認し、LINEに「ご予約が確定しました」の通知が実機で届くことを確認（2026-10-01）
5. 旧LIFF（`2011761592-fPsPphNA`、別プロバイダー）由来のLINE UserIdが残っている過去の仮予約データがあれば、そのuserIdは新チャネルに対して引き続き無効（友だち判定404）なので、再承認が必要な場合は新しく予約し直してもらう必要がある

**残作業（軽微、いつでも可）**
- `fixPhoneNumberLeadingZeros`（GAS）の実行、`sendReminders`用トリガー（`createDailyTrigger`）がこのプロジェクトに登録されているかの確認（いずれもデプロイ不要、齋藤さん側で完結可能、未確認のまま）

**デバッグ用に追加した関数（LineService.js、本番コードには影響しない診断専用）**
- `debugLineConnection()`: アクセストークン取得の成否を確認
- `debugLineTestPushFromProperty()`: スクリプトプロパティ`DEBUG_TEST_USER_ID`の値へテスト通知を送信
- `debugLineBotInfo()`: 現在のチャネルID/SECRETが実際にどの公式アカウントを制御しているか確認
- `debugLineFriendStatus()`: `DEBUG_TEST_USER_ID`のuserIdが現在のチャネルから見て友だち扱いになっているか確認

### その他、確認が取れていない項目
- XSS修正（PR #30）の再テスト結果（管理者画面で`<img src=x onerror=...>`が実行されずテキスト表示になるか）
- `docs/test-checklist.md`の全項目の実施状況
