# 箱ダイヤ描画システム β版 告知CM動画（夢グループ風）ソース一式

2026年11月14日 18:00 公開に向けた SNS告知用ショート動画（1920×1080・約45秒）の生成資産です。
**AIによる動画生成（Text-to-Video等）は一切使用せず**、以下の2種類の素材のみから構築されています。

1. **実際のブラウザ操作画面の録画**（Chromium / Playwright による実操作キャプチャ）
   - シーン1：Excelでセル結合や罫線引きを繰り返す手作業再現 UI（`promo/slides/scene1_excel_pain.html`）
   - シーン3：実際の Webアプリ（`index.html`）での編集→即時SVG描画・複雑運用ズーム・A4印刷プレビュー
2. **編集可能な HTML/CSS スライド**（`promo/slides/*.html`）
   - 後からテロップ文言・フォント・配色を直接編集できるよう独立したHTMLファイルとして管理しています。

## ディレクトリ構成

- `promo/slides/slide_base.css` — 共通フォント・集中線・極太フチ文字・話者バッジ用CSS
- `promo/slides/scene1_excel_pain.html` — シーン1（0:00〜0:10）：Excel罫線・セル結合苦行＆掛け合いテロップ
- `promo/slides/scene2_title_reveal.html` — シーン2前半（0:10〜0:14）：タイトルコール「ブラウザで動く『箱ダイヤ描画システム』〜！」
- `promo/slides/scene4_free_price.html` — シーン4（0:32〜0:42）：集中線＋特大「無 料 ！（0円）」価格発表＆「安〜い！」オチ
- `promo/slides/scene5_release_cta.html` — シーン5（0:42〜0:45）：公開日時（2026年11月14日 18:00）＆ `@sekitan66325` 告知スライド
- `promo/slides/telop_overlay.html` — シーン2後半・シーン3（カットA/B/C）の実操作映像に重ねる透過オーバーレイテロップ
- `promo/audio_synth.py` — レトロ通販風オリジナルBGM（48kHz ステレオ）＋効果音（ジャジャン／ピコーン／ドドーン 等）合成スクリプト
- `promo/build_promo_video.py` — 実ブラウザキャプチャ＋HTMLスライド＋音声を FFmpeg で合成し 1080p MP4 を生成するビルドスクリプト

## 文言を変更して動画を再生成する方法

1. `promo/slides/` 配下の編集したい HTML（または `telop_overlay.html`）をテキストエディタで開き、テロップ文言を修正します。ブラウザで直接開いて見た目を確認することもできます。
2. Python（Playwright と `imageio-ffmpeg` が利用可能な仮想環境）で以下を実行します：

```powershell
python promo/build_promo_video.py
```

完成動画は `promo/out/hakodiagram_promo_yume_1080p.mp4` に出力されます。

