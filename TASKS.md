# 実装タスク一覧（フェーズ別）

Claude Codeへの依頼は1フェーズずつ進めるのがおすすめです。フェーズ内でも欲張らず、まず動くものを作ってから細部を詰めましょう。各フェーズの前提としてCLAUDE.mdのアーキテクチャ節を参照してください。

## Phase 1: プロジェクト初期化
- [x] frontend/ と gas/ のディレクトリ雛形・空ファイル一式を作成
- [x] gas/appsscript.json、.gitignore を配置

**依頼例:**
> CLAUDE.mdの構成に沿って、frontend/とgas/のディレクトリと各ファイルの雛形を作成して。

## Phase 2: フロントエンド — トップ画面 & 予約画面
- [x] index.html: liff.init()でuserId取得、「新規予約」ボタンを配置したポータルUI
- [x] reserve.html: FullCalendarで空き状況を表示、予約フォーム（日時/人数/コース・プラン/氏名/電話番号/備考）
- [x] reserve-form.js: 現時点ではダミーJSONでカレンダーが色分け表示されればOK（バックエンドは次フェーズ）

**依頼例:**
> reserve.htmlにFullCalendarを組み込んで、{date, available}形式のJSON配列をもとに予約可能日を色分け表示して。バックエンドはまだないのでダミーデータで動くようにして。

## Phase 3: GASバックエンド — doGet/doPost
- [x] Code.js: doGet（空き状況JSON、または?page=approvalで承認画面を返すルーティング）／doPost（仮予約受信）
- [x] CalendarService.js: Googleカレンダーから空き状況を判定
- [x] SheetService.js: スプレッドシートの読み書き
- [x] NotifyService.js: Discord/Slack Webhook送信を共通化
- [x] シークレットはPropertiesServiceから読む設計にする
- [x] フロント側のfetchはContent-Type: text/plainでPOSTし、GAS側でJSON.parse(e.postData.contents)する（CORS対策、CLAUDE.md参照）

**依頼例:**
> gas/Code.jsにdoGet/doPostを実装して。doGetはCalendarService経由で向こう30日分の空き状況を返し、doPostは受け取った予約データをSheetServiceで「仮予約」として書き込んだ上でNotifyServiceでDiscordに承認URL付きで通知して。シークレットは全部PropertiesService.getScriptProperties()から読むようにして。

## Phase 4: 承認画面 & 確定処理
- [x] ApprovalPage.html: Discord通知のリンクから開く内容確認・修正フォーム
- [x] 承認ボタンはgoogle.script.runでサーバー関数approveReservation()を直接呼ぶ
- [x] approveReservation(): ステータスを「確定」に更新 → カレンダーへ正式登録 → Discordに確定報告 → LINE Messaging APIでユーザーへ確定通知をプッシュ

**依頼例:**
> ApprovalPage.htmlと、google.script.runで呼び出すapproveReservation()関数を実装して。承認時にSheetServiceでステータスを「確定」に更新し、CalendarServiceでカレンダー予定を作成し、NotifyServiceで確定報告をDiscordに送り、LineServiceでユーザーに確定通知をプッシュ送信して。

## Phase 5: リマインド機能
- [x] Trigger.js: 「確定」かつ「翌日（または当日）」の予約を抽出してLINE・Discordにリマインド送信する関数
- [ ] トリガー登録用のセットアップ関数（例: createDailyTrigger()）を用意し、GASエディタで一度だけ手動実行

**依頼例:**
> Trigger.jsに毎朝実行を想定したsendReminders()を実装して。SheetServiceで「確定」かつ予約日が翌日のデータを抽出し、LineServiceとNotifyServiceでリマインドを送信して。あわせてトリガーを登録するcreateDailyTrigger()も用意して。

## Phase 6: 結合テスト & デプロイ
- [ ] clasp push / clasp deploy でGASを公開
- [ ] 発行されたWebアプリURLをフロントエンドのAPIエンドポイントに設定
- [ ] GitHub PagesのURLをLINE DevelopersのLIFFエンドポイントURLに登録
- [ ] 予約→Discord通知→承認→カレンダー登録→LINE確定通知→リマインドの一連の流れを実機で確認
