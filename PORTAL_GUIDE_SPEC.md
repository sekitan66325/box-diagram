# 上位ページ（sekitan66325.github.io）連携・案内掲載仕様書

本書は、親サイト **[真岡鐵道 情報ポータル](https://sekitan66325.github.io/)** 側に、本アプリ **「箱ダイヤ描画システム（β版）」**（公開URL: `https://sekitan66325.github.io/box-diagram/`）への案内・導線を実装するための詳細仕様書です。

---

## 1. 連携先アプリ・関連URL一覧（正本）

| 項目 | URL / 値 | 備考 |
| :--- | :--- | :--- |
| **本アプリ公開URL** | `https://sekitan66325.github.io/box-diagram/` | ルート配下の相対指定なら `box-diagram/` または `/box-diagram/`（末尾スラッシュ統一） |
| **親ポータルURL** | `https://sekitan66325.github.io/` | 本アプリ側のヘッダー・ヘルプモーダル内から逆リンク設定済み |
| **YouTube 紹介動画** | `https://youtu.be/rNZxBmkyHq0` | 約48秒の通販CM風紹介動画（A/Bテスト稼働中・公開中） |
| **アプリアイコン (SVG)** | `https://sekitan66325.github.io/box-diagram/assets/favicon.svg` | 相対パス: `/box-diagram/assets/favicon.svg`（サイズ 64x64 viewBox） |
| **アプリアイコン (PNG)** | `https://sekitan66325.github.io/box-diagram/assets/apple-touch-icon.png` | 180x180 PNG（アイコンカード装飾やサムネ代用にも利用可） |
| **ご意見・不具合フォーム** | `https://docs.google.com/forms/d/e/1FAIpQLSc45MP0RUGMoadCOQn6BY76kv__9lb29PureF1rfRvtywM2ZQ/viewform` | ログイン不要。アプリ右上の `✉ お問い合わせ` からも開けます |
| **GitHub リポジトリ** | `https://github.com/sekitan66325/box-diagram` | ソースコード・README・取扱説明書（`MANUAL.md`） |
| **Google Analytics ID** | `G-0GM4B0FTW9` | 親ポータル・本アプリとも同一測定IDを `<head>` / ページ内に設置済み |
| **開発者 X** | `https://x.com/sekitan66325` | 公開告知・アップデート案内 |

---

## 2. 親サイト（`sekitan66325.github.io`）の構造に合わせた推奨配置設計

親サイト `https://sekitan66325.github.io/`（`style.css?v=20261106_v5` 準拠）のデザイン・情報設計を崩さないための配置ルールです。

### 2-1. トップページ（`index.html`）への配置（最推奨）

- **`.portal-grid`（3カラム）には無理に混ぜないことを推奨**  
  現在の `.portal-grid` は「列車走行位置・時刻表」「目撃情報掲示板」「車両運用資料」の**真岡鐵道の情報閲覧3本柱**で美しく3列バランスが取れています。4枚目を入れると3列×2段で空き枠が生まれ、かつ「ツール」と「路線ポータル」の役割が混在します。
- **推奨位置**:  
  1. **最有力案**: `.content-section` として、**Discord 通知セクションと『真岡鐵道ダイヤ全録』セクションの間**（または『真岡鐵道ダイヤ全録』セクションの直後）に独立セクションを設置する。  
     - *理由*: 「行路・ダイヤ資料（ダイヤ全録）」の制作ツールという文脈で自然につながり、かつポータルの主目的（真岡鐵道の運行・目撃閲覧）を邪魔しません。
  2. 既存 CSS の **`.discord-card`**（またはそれを流用した横長カード）のレイアウト・トークン（`--surface`, `--border`, `--radius: 10px`, `--accent: #1e40af`, `.status-badge`, `.btn-primary`）をそのまま踏襲する。
  3. **デザイン配色ルール**: 親サイトは `--accent: #1e40af`（ブルー基調）で統一されているため、親サイト上のボタンやリンク色にはアプリ側の青緑（`#2F6F73`）を持ち込まず、**親サイトの CSS トークン（`--accent` 等）に合わせる**こと（アプリアイコン画像のみワンポイントで表示するのは可）。

### 2-2. 車両運用資料ページ（`database/unyou/index.html`）への導線追加（強い推奨）

- 「車両運用資料」を見に来る訪問者は、箱ダイヤ（仕業行路図）の構造に関心が高いコア層です。
- 資料ページのヘッダー下または一覧下部に、1行バナー／コンパクトカードとして以下を配置すると高い送客効果が見込めます。
  - 文言例: `このような箱ダイヤ（仕業行路図）をブラウザ上で自作・PDF出力できるWebツール「箱ダイヤ描画システム（β版）」を公開しています → [ツールを開く](/box-diagram/)`

### 2-3. フッター（`.footer-links`）およびグローバルナビ（`.global-nav`）

- **フッター（全ページ共通推奨）**:  
  `<ul class="footer-links">` に項目を追加してください（`flex-wrap: wrap` のため崩れません）。
  ```html
  <li><a href="/box-diagram/" class="footer-link">箱ダイヤ描画システム (β版)</a></li>
  ```
- **グローバルナビ（任意）**:  
  `.global-nav` に `箱ダイヤ作成` を追加する場合は、スマートフォン幅・768px〜1024px 幅でヘッダー2段落ちや折り返し破綻が起きないかを必ず実機/DevToolsで確認してください。崩れる場合は無理に入れず、トップページの専用セクション＋フッター＋運用資料ページで導線を張るのが安全です。

---

## 3. ユーザーに誤解させない必須伝達事項（仕様・文言ルール）

案内文には、以下のポイントを正確に含めてください（未実装機能・誇張表現を避け、実態と一致させてください）。

1. **ツール名称の統一**
   - 見出し・呼称: **`箱ダイヤ描画システム（β版）`**（補足・正式名称: `箱ダイヤ描画ソフト / 鉄道車両仕業行路図作成システム`）
2. **汎用ツールであることの明記（重要）**
   - 親サイトが「真岡鐵道 情報ポータル」であるため、「真岡鐵道専用データ閲覧ツール」と誤認されやすいです。
   - **必ず「任意の路線・車両データを自由に作成できる汎用エディタ（架空路線の体験用サンプル収録）」である旨を明記**してください。
   - 開発背景として「『真岡鐵道ダイヤ全録』の行路図制作を効率化するために作った個人ツールを一般公開（β版）」と添えると、親サイトとの関連性が自然に伝わります。
3. **主な仕様（事実ベース）**
   - **完全無料・登録不要・インストール不要**：ブラウザだけで動作。
   - **直感的な表入力 → リアルタイム SVG 描画**：Excel での罫線引きやセル結合が不要。
   - **鉄道運用特有の表現に対応**：列車種別ごとの色・線種設定、併結表記と相手運用同期、途中駅部分継走、`○出区 / △入区` 記号、図面上ドラッグ＆`Alt` キー吸着による注記配置。
   - **1:1 ベクター PDF 出力**：ブラウザ印刷機能から A4 / B5（縦・横）の綺麗なベクター PDF を書き出し可能。
   - **データ保存・利用環境の注意点**：
     - サーバー送信なし（100% ブラウザ内処理・プライバシー安全）。ただしブラウザを閉じると入力内容は消えるため、**`保存 (JSON)` で手元に保存して `読込 (JSON)` で再開する方式**。
     - 編集パネル＋図面プレビューの2ペイン構成のため、**PC（パソコン画面・Chrome / Edge / Firefox 等の最新ブラウザ）推奨**。
4. **公開日時 / β版の注記**
   - 公開日時: **2026年11月14日(土) 18:00 公開**（公開前デプロイ時は「2026年11月14日 18:00 公開予定」、公開時刻以降にそのまま「無料公開中」へ）。
   - β版につき、アプリ内 `✉ お問い合わせ` フォーム等から要望・不具合報告を受け付け、改善予定であることを記載。

---

## 4. 紹介文バリエーション（文字量別）

### パターンA：標準（トップページ専用セクション用・推奨）

- **セクション見出し**: `Webツール：箱ダイヤ描画システム（β版）`
- **概要説明（`.section-desc`）**:  
  `『真岡鐵道ダイヤ全録』の制作過程で生まれた、ブラウザ上で鉄道の箱ダイヤ（車両運用図・仕業行路図）を作成・編集し、そのまま A4/B5 のベクター PDF として出力できる無料 Web アプリ（β版）です。真岡鐵道に限らず、お好みの路線や架空鉄道のダイヤを自由に作成できます。`
- **カード内タイトル**: `箱ダイヤ描画システム（β版）` ＋ バッジ `無料公開`
- **カード内本文**:  
  `インストール・ログイン不要、データはお使いのブラウザ内のみで処理されます（PC画面推奨 / JSON保存・読込対応）。Excel の罫線引きやセル結合の手間なく、表に入力するだけで美しい行路図を自動描画できます。`
- **アクションボタン**:
  - 主ボタン（Primary）: **`ツールを開く（無料）`** → `https://sekitan66325.github.io/box-diagram/`（または `/box-diagram/`）
  - 副リンク / ボタン: **`紹介動画を見る（YouTube / 約48秒）↗`** → `https://youtu.be/rNZxBmkyHq0`

### パターンB：コンパクト（運用資料ページ・フッター周辺用）

- `Excel不要・ブラウザだけで鉄道の「箱ダイヤ（仕業行路図）」を作成＆A4/B5 PDF化できる無料ツール『箱ダイヤ描画システム（β版）』を公開中です。` → `[ツールを開く](/box-diagram/)` / `[紹介動画 (YouTube)](https://youtu.be/rNZxBmkyHq0)`

### パターンC：短縮キャッチ（1〜2行）

- `ブラウザだけで鉄道の箱ダイヤを作成・PDF出力できる無料ツール（β版 / PC推奨）。Excel罫線作業なしで即作図できます。`

---

## 5. 親サイト（`sekitan66325.github.io`）用 HTML / CSS 実装サンプル

親サイトの現行マークアップ（`.content-section` / `.discord-card` / `.status-badge` / `.btn-primary`）をそのまま活かした実装例です。

### 5-1. `index.html` 追加 HTML スニペット

```html
    <section class="content-section" id="box-diagram-section">
      <h2 class="section-title">Webツール：箱ダイヤ描画システム（β版）</h2>
      <p class="section-desc">
        『真岡鐵道ダイヤ全録』の行路図制作を効率化するために開発した、ブラウザ上で鉄道の箱ダイヤ（車両運用図・仕業行路図）を作成・PDF出力できる無料 Web アプリです。真岡鐵道に限らず、全国の路線や架空鉄道のダイヤを自由に作成できます。
      </p>

      <div class="discord-card tool-intro-card">
        <div class="tool-card-media">
          <img
            src="/box-diagram/assets/favicon.svg"
            alt="箱ダイヤ描画システム アイコン"
            class="tool-card-icon"
            width="48"
            height="48"
            loading="lazy"
          >
        </div>

        <div class="discord-card-body">
          <div class="tool-card-heading">
            <strong class="discord-card-title">箱ダイヤ描画システム（鉄道車両仕業行路図作成）</strong>
            <span class="status-badge">β版・無料</span>
            <span class="status-badge">PC推奨</span>
          </div>
          <p class="discord-card-desc">
            インストール不要・Excelの罫線引き不要。左側の表に入力するだけで図面を自動描画し、そのまま A4/B5 ベクター PDF として印刷・保存できます（データは外部送信されず、JSONファイルで手元に保存・読込可能）。
          </p>
          <p class="tool-card-sublinks">
            <a href="https://youtu.be/rNZxBmkyHq0" target="_blank" rel="noopener noreferrer">
              紹介動画を見る（通販CM風 / 約48秒 / YouTube）↗
            </a>
            <span aria-hidden="true"> / </span>
            <a href="https://github.com/sekitan66325/box-diagram/blob/main/MANUAL.md" target="_blank" rel="noopener noreferrer">
              取扱説明書・仕様
            </a>
          </p>
        </div>

        <div class="discord-card-action">
          <a href="/box-diagram/" class="btn-primary">
            ツールを開く
          </a>
        </div>
      </div>
    </section>
```

> **補足**:
> - 上記では GitHub Pages 静的ホスティングで `.md` がブラウザ上できれいに表示されるよう `github.com/.../blob/main/MANUAL.md` を指定しています（「ツール右上の『？ 使い方』をご覧ください」という表記に置き換えても問題ありません）。
> - リンク遷移先は同タブ（`href="/box-diagram/"` または `href="box-diagram/"`）を基本とします。既に本アプリ側ヘッダーからポータルへ戻るリンクには未保存データ保護のため `target="_blank"` を付与しています。

### 5-2. 親サイト `style.css` 追加推奨 CSS（最小限）

親サイトの既存スタイル（`.discord-card`, `.status-badge`, `.btn-primary`）を壊さずにアイコン・バッジ・サブリンクを整えるための最小補助スタイルです。

```css
/* 箱ダイヤ描画システム案内カード補助スタイル */
.tool-intro-card {
  align-items: center;
}

.tool-card-media {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tool-card-icon {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  display: block;
}

.tool-card-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin-bottom: 4px;
}

.tool-card-heading .discord-card-title {
  margin-bottom: 0;
}

.tool-card-sublinks {
  margin-top: 6px;
  font-size: 0.8rem;
  color: var(--c-muted);
}

.tool-card-sublinks a {
  color: var(--c-accent);
  font-weight: 500;
}

.tool-card-sublinks a:hover {
  text-decoration: underline;
}

@media (max-width: 600px) {
  .tool-intro-card {
    align-items: flex-start;
  }
}
```

---

## 6. 本アプリ側（`sekitan66325.github.io/box-diagram/`）での逆向き導線・設置済み仕様

親サイトとの整合のため、本アプリ側には以下をすでに実装・設置しています。

1. **ヘッダー左上ブランド横のポータルリンク**:
   - ボタンラベル: `情報ポータル ↗`（`href="https://sekitan66325.github.io/"`, `target="_blank" rel="noopener noreferrer"`）
   - 編集中のデータがブラウザ再読み込み等で失われないよう、新タブで親ポータルを開く仕様にしています。
2. **アプリ内「？ 使い方」ヘルプモーダル内の導線**:
   - 「関連サイト・開発の応援について（任意）」欄に `真岡鐵道 情報ポータル (sekitan66325.github.io) ↗` ボタンを配置。
   - モーダルフッターに `せきたん (sekitan66325.github.io) ↗` リンクを配置。
3. **アプリアイコン**:
   - `assets/favicon.svg` / `assets/favicon.png`（64×64）/ `assets/apple-touch-icon.png`（180×180）を設置し、アプリ左上ヘッダーにも表示。
4. **Google Analytics (`G-0GM4B0FTW9`)**:
   - `index.html` の `<head>` 内に親サイトと同一測定 ID の `gtag.js` を設置済みのため、GA4 側で `/box-diagram/` パスおよび親サイト間の回遊を単一プロパティで計測可能です。

---

## 7. 親サイト公開・確認チェックリスト

- [ ] `https://sekitan66325.github.io/box-diagram/` へのリンク（相対 `box-diagram/` または `/box-diagram/`）が本番環境で 404 にならないこと
- [ ] アプリアイコン `/box-diagram/assets/favicon.svg` が正常に表示されること（公開直前の場合、先に `box-diagram` リポジトリをプッシュするか、親側アイコンパスに注意）
- [ ] 「汎用ツール（真岡鐵道以外の任意路線・架空路線も作れる）」「PC推奨」「JSON保存が必要（自動サーバー保存なし）」が読み手に誤解なく伝わること
- [ ] 紹介動画リンク `https://youtu.be/rNZxBmkyHq0` が新しいタブ（`target="_blank" rel="noopener noreferrer"`）で開くこと
- [ ] スマホ幅（375px）〜デスクトップ幅（1280px）で `.tool-intro-card` のアイコン・ボタン・テキストがはみ出したり重なったりしないこと
- [ ] Google Analytics（`G-0GM4B0FTW9`）リアルタイムレポートでトップページ ⇄ `/box-diagram/` の遷移が計測されること
