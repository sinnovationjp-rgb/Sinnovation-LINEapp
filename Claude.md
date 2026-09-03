# CLAUDE.md

Claude Codeがこのリポジトリで作業する際に毎回自動で読み込むプロジェクトコンテキストです。

## プロジェクト概要
LINE公式アカウントのLIFFを使ったスペース予約システム。ユーザーがLINE上から予約 → GASがスプレッドシートに仮登録しつつDiscordへ通知 → スタッフが承認画面で確認・確定 → Googleカレンダーへ正式登録 & LINEで確定通知 → 前日リマインドを自動送信、という流れを全コンポーネント無料枠で構築します。元の要件定義は`docs/spec.md`参照。

## アーキテクチャ
- フロントエンド: 素のHTML/CSS/JS + FullCalendar。ビルドステップなし。GitHub Pagesで公開（HTTPS必須、LIFFの要件）。
- バックエンド: Google Apps Script (GAS) のWeb App一本（doGet/doPost）。
- DB: Googleスプレッドシート（予約管理台帳）
- カレンダー: Googleカレンダー
- 通知: Discord Webhook（初期はSlack Webhookで代用可） / LINE Messaging API

### GAS側のルーティング設計
doGet/doPostは公開URLを1つしか持てないため、クエリパラメータで内部ルーティングします。

- `doGet(e)`: パラメータなし → 空き状況JSONを返す（フロントのfetch用）／`?page=approval&id=XXX` → HtmlServiceで承認画面(ApprovalPage.html)を返す
- `doPost(e)`: フロントからの仮予約データ受信専用
- 承認画面内の「承認」ボタンは`google.script.run.approveReservation(id, editedData)`でサーバー関数を直接呼ぶ（同一プロジェクト内なのでCORSも発生しない）

### CORSの注意点（重要）
GASのWeb AppはOPTIONSプリフライトを正しく処理できません。フロントから`Content-Type: application/json`でPOSTするとプリフライトで失敗するので、`Content-Type: text/plain;charset=utf-8`でJSON文字列を送り、GAS側は`JSON.parse(e.postData.contents)`で受け取ってください。

### リマインドトリガー
時限トリガーは`clasp push`だけでは有効化されません。トリガー登録用のセットアップ関数（例: `createDailyTrigger()`）を用意し、GASエディタで初回のみ手動実行してください。

## シークレット管理
GASは`.env`を使えません。Webhook URL、LINEチャネルアクセストークン、スプレッドシートID、カレンダーIDは必ず`PropertiesService.getScriptProperties()`経由で読み込み、ソースコードに直書きしないこと。値自体はGASエディタの「プロジェクトの設定 > スクリプトプロパティ」から手動登録します。

## ディレクトリ構成
README.mdの構成図を参照してください（gas/配下はclaspでプッシュする対象）。

## コーディング規約
- GAS側は関心事ごとにファイル分割（Code.js / CalendarService.js / SheetService.js / NotifyService.js / LineService.js / Trigger.js）
- NotifyService.jsはDiscordとSlackのWebhook形式差異を吸収する共通インターフェースにする
- 外部API呼び出しは必ずtry/catchし、失敗時はログを残す
- フロントは1画面1HTMLファイル。共通処理はjs/に切り出す

## 開発の進め方
TASKS.mdのPhase順に、1フェーズずつ実装→動作確認→次フェーズ、を繰り返してください。一度に複数フェーズをまとめて依頼しないこと。

## GitHub運用ルール
- main: 本番環境（GitHub Pagesと直結、直接pushしない）
- develop / feature/xxx: 開発ブランチ、PR経由でmainにマージ
- GitHub Pages公開設定はSettings > Pagesでmain（または/docs）を指定
- 発行されたURLをLINE DevelopersのLIFFエンドポイントURLに登録
