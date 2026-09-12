# 買取再販 物件販売管理アプリ

買取再販事業で買い取った物件の販売計画・価格推移をチームで共有管理するWebアプリです。
仕様の詳細は [`property-sales-tracker-spec.md`](./property-sales-tracker-spec.md) を参照してください。

## セットアップ手順

### 1. Firebase プロジェクトを作成する

1. [Firebase Console](https://console.firebase.google.com) にアクセス（Googleアカウントでログイン）
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力（例: `kaitorischedule`）してプロジェクトを作成
4. 左メニューから「Firestore Database」→「データベースの作成」
   - 「本番環境モード」を選択して作成（あとでルールを変更します）
   - リージョンは「asia-northeast1（東京）」を推奨

### 2. アプリのFirebase設定を取得する

1. Firebase Consoleの歯車アイコン→「プロジェクトの設定」
2. 「マイアプリ」タブ→「</>」（Web）をクリック
3. アプリ名（例: `kaitorischedule-web`）を入力して登録
4. 表示される `firebaseConfig` オブジェクトの中身をコピー

### 3. `js/config.js` を書き換える

`js/config.js` の上部にある `FIREBASE_CONFIG` に、コピーした値を貼り付けます：

```javascript
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSy...",
  authDomain:        "your-project.firebaseapp.com",
  projectId:         "your-project",
  storageBucket:     "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId:             "1:123...:web:abc..."
};
```

### 4. Firestore セキュリティルールを設定する

Firebase Console → Firestore → 「ルール」タブで以下に書き換えて「公開」：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /properties/{document} {
      allow read, write: if true;
    }
  }
}
```

> ※ このルールはチーム内ツールの想定で、誰でも読み書きできます（現時点ではログイン認証なしの社内アクセス限定運用を想定）。
> 外部公開する場合や認証を追加する場合はルールを強化してください。

### 4.5. Cloudinary の unsigned upload preset を用意する（販売資料アップロード用）

物件ごとの販売資料（PDF・画像など）の保存には [Cloudinary](https://cloudinary.com) を使用します（Firebase Storageは使いません）。無料アカウントで以下を用意し、`js/config.js` の値を差し替えてください。

1. Cloudinaryダッシュボードの **Cloud name** を確認する
2. Settings → Upload → Upload presets で新規presetを作成し、**Signing Mode を「Unsigned」** にする
3. その preset 名を控える

```javascript
const CLOUDINARY_CLOUD_NAME = 'あなたのCloud name';
const CLOUDINARY_UPLOAD_PRESET = 'あなたのpreset名';
```

> ※ Unsigned presetはクライアントから誰でもアップロードできる設定です。個人・社内利用のツールという前提のため簡易的にしています。
> ※ アップロード済みファイルの削除はCloudinary側では行われません（アプリの一覧・編集画面から見えなくなるだけです）。実ファイルを消したい場合はCloudinaryの管理画面から手動で削除してください。

### 5. ローカルで動作確認する

```bash
# Python がある場合
python -m http.server 8000

# Node.js がある場合
npx serve .
```

ブラウザで `http://localhost:8000` を開いて動作確認してください。

### 6. Vercel にデプロイする（無料）

1. [Vercel](https://vercel.com) にサインアップ（GitHubアカウント推奨）
2. このフォルダを GitHub にプッシュ
3. Vercel で「New Project」→ GitHubリポジトリを選択
4. そのままデプロイ（設定不要・ビルドコマンド・出力ディレクトリの指定は不要な静的サイトです）
5. 発行されたURLをチームに共有

---

## ファイル構成

```
kaitorischedule/
├── index.html          # 物件一覧・登録・編集・履歴表示（すべてこの1画面）
├── css/
│   └── style.css        # スタイル（いえプロ不動産ブランドカラー準拠）
├── js/
│   ├── config.js         # ★設定ファイル（Firebase設定・日付/金額ユーティリティ）
│   └── main.js           # 一覧描画・CRUD・フィルタ・ソート・グラフ描画ロジック
└── property-sales-tracker-spec.md  # 元の仕様書
```

## 機能一覧

- **複数区画対応**：1物件（分譲地など）の中に複数の区画を登録できます。区画ごとに担当・価格・仕入決済予定日・履歴を個別管理し、一覧には区画単位で1行ずつ表示されます（区画が1つだけの通常物件は区画名を空欄のままでOK）。物件名でソートすると、区画が2件以上ある物件の上に「表示中◯区画・成約済み◯／販売中◯・区画合計粗利」の小計行が挟まります
- **成約済みステータス**：区画ごとに「販売中／成約済み」を切り替えられます（各行の「成約済みにする」ボタン、または編集モーダル内のステータス欄）。成約済みにしても削除ではないため合計粗利などの実績は消えず、決済日アラート・値下げ検討アラートの対象からは外れます。一覧上部の「状態」フィルタは既定で「販売中」のみ表示、「成約済み」「すべて」に切り替えると実績集計にも使えます
- **一覧・CRUD**：物件の登録／編集／削除（「＋ 新規登録」ボタン、編集モーダル内の「＋ 区画を追加」「この区画を削除」、各行の「編集」「削除」＝クリックした区画のみ削除。最後の1区画を削除すると物件ごと削除されます。編集モーダルの「物件を削除（全区画）」で一括削除も可能）
- **価格変更履歴の自動記録**：編集画面で現在価格を前回と異なる値に変更して保存すると、その時点の日付と価格が自動で履歴（`history`）に追加されます。手動で履歴を入力する欄はありません
- **履歴表示**：各行の「履歴」ボタンから、価格推移の折れ線グラフと変更履歴の表（日付／価格／増減）を表示
- **仕入決済予定日アラート**：
  - 仕入決済予定日が今日より過去 → 行を赤色表示＋「期限超過」タグ
  - 仕入決済予定日まで7日以内 → 行をゴールド表示＋「残り○日」タグ
  - 閾値は `js/config.js` の `SETTLEMENT_ALERT_DAYS` で変更できます
- **値下げ検討アラート**：仕入決済予定日を起点に、1ヶ月半（1ヶ月＋15日）ごと・半年後まで（①1ヶ月半後／②3ヶ月後／③4ヶ月半後／④半年後の4段階）値下げ検討タイミングの予定を刻み、登録されたまま（＝未成約）の物件には到来済みの段階を「値下げ検討①」〜「値下げ検討④」タグで表示。あくまで画面上の注意喚起で、価格自体は今まで通り人が編集します（自動での価格書き換えは行いません）。「履歴」モーダルのグラフにも全4段階の予定日を縦線で表示（到来済みは赤、未到来はゴールド）。間隔・段階数は `js/config.js` の `PRICE_REVIEW_MONTHS_AFTER_SETTLEMENT` / `PRICE_REVIEW_DAYS_AFTER_SETTLEMENT` / `PRICE_REVIEW_MAX_STAGES` で変更できます
- **一覧グラフ**：物件別の粗利比較を横棒グラフで表示（フィルタ・検索結果と連動）
- **フィルタ・検索**：担当名で絞り込み、物件名で部分一致検索
- **ソート**：テーブルヘッダーをクリックして物件名／担当／各価格／仕入決済予定日／価格変更日で並び替え（再クリックで昇順・降順切り替え）
- **サマリー表示**：物件数、合計粗利、仕入決済まで7日以内の件数に加えて、担当者別の合計粗利も表示

## データモデル（Firestore コレクション：`properties`）

物件（案件）ドキュメントは物件名と、複数の区画（`lots`配列）を持ちます。価格・決済日・履歴などは
すべて区画（`lots`の各要素）単位で管理し、物件ドキュメント直下には持ちません。

| フィールド名 | 型 | 内容 |
|---|---|---|
| name | string | 物件名（必須） |
| lots | array | 区画の配列。要素は下表のオブジェクト |
| updatedAt | timestamp | 更新日時 |

### `lots` 配列の各要素

| フィールド名 | 型 | 内容 |
|---|---|---|
| id | string | 区画ID（自動採番、編集時の識別に使用） |
| lotName | string | 区画名（号地など）。区画が1つだけの物件は空文字でOK |
| staff | string | 担当名 |
| startPrice | number | 販売開始価格（万円） |
| currentPrice | number | 現在価格（万円） |
| grossProfit | number | 粗利（万円） |
| settlementDate | date (string) | 仕入決済予定日（`YYYY-MM-DD`） |
| salesStartDate | date (string) | 販売開始日（`YYYY-MM-DD`） |
| priceChangeDate | date (string) | 価格変更日（直近の変更日） |
| history | array | 価格変更履歴。要素は `{ date, price }` |

> **旧形式データとの互換性**：区画対応より前に登録された物件（`lots`を持たず、物件直下に`staff`／`currentPrice`等を持つ形式）は、
> 読み込み時に自動的に「区画1件」として扱われます。そのまま編集・保存すると新形式（`lots`配列）に自動移行され、
> 物件直下の旧フィールドは削除されます。手動でのデータ移行は不要です。

## 今回のスコープ外（仕様書の「未確定・要相談事項」への回答）

- **ログイン方式**：認証なし・社内アクセスのみで実装（Google認証は未実装）
- **担当者ごとの合計粗利サマリー**：実装済み（一覧画面の「担当者別 合計粗利」、区画単位で集計）
- **値下げが必要そうな物件を上位に出す並び替えロジック**：未実装（必要になった場合は判定基準を決めた上で追加してください）
