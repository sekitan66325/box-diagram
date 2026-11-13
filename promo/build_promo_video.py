"""
箱ダイヤ描画システム β版 告知CM動画（夢グループ風 / 1920x1080 / 30fps / 45秒）ビルダー

厳守事項:
- 生成AIによる動画/画像生成（Text-to-Video等）は一切使用しません。
- すべての映像は (1) 実ブラウザ操作画面のキャプチャ と (2) promo/slides/*.html からの描画のみで構成します。

使い方:
  <venv>/python.exe promo/build_promo_video.py
"""
import asyncio
import http.server
import os
import shutil
import socketserver
import subprocess
import sys
import threading
import time
from io import BytesIO
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROMO_DIR = os.path.join(ROOT_DIR, "promo")
SLIDES_DIR = os.path.join(PROMO_DIR, "slides")
BUILD_DIR = os.path.join(PROMO_DIR, "build")
OUT_DIR = os.path.join(PROMO_DIR, "out")
OUT_MP4 = os.path.join(OUT_DIR, "hakodiagram_promo_yume_1080p.mp4")

FPS = 30
WIDTH = 1920
HEIGHT = 1080
SERVER_PORT = 8988

# audio_synth.py をインポートできるようにパス追加
sys.path.insert(0, PROMO_DIR)
import audio_synth


def get_ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        exe = shutil.which("ffmpeg")
        if exe:
            return exe
        raise RuntimeError(
            "ffmpeg が見つかりません。imageio-ffmpeg を仮想環境にインストールするか PATH に ffmpeg を追加してください。"
        )


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, format, *args):
        pass


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


def start_local_server():
    httpd = ReusableTCPServer(("127.0.0.1", SERVER_PORT), QuietHandler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    return httpd


class SegmentEncoder:
    """Pillow / ChromiumスクリーンショットPNGバイト列をFFmpegへパイプし無劣化に近いMP4セグメントを生成"""

    def __init__(self, ffmpeg_exe: str, out_path: str, overlay_img: Image.Image = None):
        self.out_path = out_path
        self.overlay_img = overlay_img.convert("RGBA") if overlay_img is not None else None
        cmd = [
            ffmpeg_exe,
            "-y",
            "-f", "image2pipe",
            "-vcodec", "png",
            "-framerate", str(FPS),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-preset", "fast",
            "-crf", "16",
            "-r", str(FPS),
            out_path,
        ]
        self.proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

    def push_png_bytes(self, png_bytes: bytes, cursor_xy=None, highlight_box=None):
        if self.overlay_img is not None or cursor_xy is not None or highlight_box is not None:
            im = Image.open(BytesIO(png_bytes)).convert("RGBA")
            if highlight_box is not None:
                x1, y1, x2, y2 = highlight_box
                draw = ImageDraw.Draw(im)
                draw.rectangle([x1, y1, x2, y2], outline=(230, 0, 18, 255), width=5)
            if self.overlay_img is not None:
                im = Image.alpha_composite(im, self.overlay_img)
            if cursor_xy is not None:
                cx, cy, clicking = cursor_xy
                draw = ImageDraw.Draw(im)
                if clicking:
                    draw.ellipse([cx - 22, cy - 22, cx + 22, cy + 22], outline=(230, 0, 18, 230), width=5)
                # 目立つ矢印カーソル描画
                pts = [(cx, cy), (cx + 22, cy + 16), (cx + 12, cy + 18), (cx + 17, cy + 30), (cx + 11, cy + 32), (cx + 6, cy + 20), (cx + 1, cy + 26)]
                draw.polygon(pts, fill=(255, 255, 255, 255), outline=(0, 0, 0, 255))
            buf = BytesIO()
            im.convert("RGB").save(buf, format="PNG", compress_level=1)
            self.proc.stdin.write(buf.getvalue())
        else:
            self.proc.stdin.write(png_bytes)

    def close(self):
        self.proc.stdin.close()
        stderr = self.proc.stderr.read().decode("utf-8", errors="replace")
        rc = self.proc.wait()
        if rc != 0:
            raise RuntimeError(f"FFmpeg segment failed ({self.out_path}):\n{stderr}")


async def capture_slide_segment(
    page, ffmpeg_exe: str, slide_file: str, duration_sec: float, out_path: str
):
    """HTMLスライドを time=0..duration_sec で30fps正確にステップ描画して録画"""
    url = f"http://127.0.0.1:{SERVER_PORT}/promo/slides/{slide_file}?manual=1"
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_timeout(200)

    n_frames = int(round(duration_sec * FPS))
    enc = SegmentEncoder(ffmpeg_exe, out_path)
    for i in range(n_frames):
        t = i / FPS
        await page.evaluate(f"window.seekTo({t:.4f})")
        # トランジション反映用に1フレーム待つ
        await page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        png = await page.screenshot(type="png")
        enc.push_png_bytes(png)
    enc.close()
    print(f"Captured HTML slide segment: {slide_file} ({duration_sec:.2f}s, {n_frames} frames)")


async def capture_overlay_png(page, mode_key: str) -> Image.Image:
    url = f"http://127.0.0.1:{SERVER_PORT}/promo/slides/telop_overlay.html?mode={mode_key}"
    await page.goto(url, wait_until="networkidle")
    await page.wait_for_timeout(120)
    png = await page.screenshot(type="png", omit_background=True)
    return Image.open(BytesIO(png)).convert("RGBA")


async def capture_app_demos(page, ffmpeg_exe: str, overlays: dict, out_paths: dict):
    """
    実際の index.html（箱ダイヤ描画システム）をブラウザ上で操作し、
    Scene 2-B（全体俯瞰）, Cut A（リアルタイム作図）, Cut B（複雑運用ズーム）, Cut C（A4印刷ビュー）を録画
    """
    app_url = f"http://127.0.0.1:{SERVER_PORT}/index.html"
    await page.goto(app_url, wait_until="networkidle")
    await page.wait_for_timeout(450)

    # 編集ペインを見やすい幅に、上部をスッキリさせる
    await page.evaluate("""() => {
        const ep = document.querySelector('#editorPane');
        if (ep) ep.style.width = '680px';
    }""")

    # ------------------------------------------------------------------
    # Scene 2-B (14.0s - 18.0s = 4.0s): アプリ全体像＋桜川電鉄本線サンプル俯瞰
    # ------------------------------------------------------------------
    await page.select_option("#presetSelect", "sakuragawa_main")
    await page.select_option("#selectZoom", "fit-width")
    await page.uncheck("#checkShowAllPages")
    await page.wait_for_timeout(200)

    n_2b = int(4.0 * FPS)
    enc_2b = SegmentEncoder(ffmpeg_exe, out_paths["2b"], overlays["scene2b"])
    for i in range(n_2b):
        # ゆっくりプレビューを上→中央へスクロール（ヘッダーが上バッジに隠れない範囲）
        scroll_y = int(15 + 95 * (i / max(1, n_2b - 1)))
        await page.evaluate(f"document.querySelector('#previewViewport').scrollTop = {scroll_y}")
        await page.evaluate("() => new Promise(r => requestAnimationFrame(r))")
        enc_2b.push_png_bytes(await page.screenshot(type="png"))
    enc_2b.close()
    print(f"Captured real app Scene 2-B ({n_2b} frames)")

    # ------------------------------------------------------------------
    # Scene 3 Cut A (18.0s - 22.5s = 4.5s): 駅・列車データ入力 → 即座に線と枠が自動描画！
    # ------------------------------------------------------------------
    await page.select_option("#presetSelect", "sakuragawa_main")
    await page.select_option("#selectZoom", "fit-width")
    await page.evaluate("""() => {
        const ep = document.querySelector('#editorPane');
        if (ep) ep.style.width = '650px';
        const pv = document.querySelector('#previewViewport');
        if (pv) { pv.scrollTop = 20; pv.scrollLeft = 0; }
    }""")
    await page.wait_for_timeout(200)

    add_btn_box = await page.locator("#btnAddTrain").bounding_box()
    bx = int(add_btn_box["x"] + add_btn_box["width"] / 2)
    by = int(add_btn_box["y"] + add_btn_box["height"] / 2)

    n_3a = int(4.5 * FPS)
    enc_3a = SegmentEncoder(ffmpeg_exe, out_paths["3a"], overlays["cutA"])

    did_add = False
    did_type_no = False
    did_type_type = False
    did_type_dep = False
    did_type_arr = False

    for i in range(n_3a):
        t = i / FPS
        cursor = (bx - int(max(0, 0.7 - t) * 140), by + int(max(0, 0.7 - t) * 90), False)
        hl = None

        if t >= 0.75 and not did_add:
            await page.click("#btnAddTrain")
            await page.wait_for_timeout(80)
            did_add = True
            await page.evaluate("() => { const pv = document.querySelector('#previewViewport'); pv.scrollTop = 55; }")

        if 0.75 <= t < 1.05:
            cursor = (bx, by, t < 0.92)

        row8_sel = "#trainsGridTable tbody tr:nth-child(8)"
        if did_add and t >= 1.15 and not did_type_no:
            inp_no = page.locator(f"{row8_sel} input[data-field='trainNo']")
            await inp_no.fill("777")
            await inp_no.dispatch_event("change")
            did_type_no = True

        if did_add and t >= 1.85 and not did_type_type:
            sel_type = page.locator(f"{row8_sel} select[data-field='typeId']")
            await sel_type.select_option("express")
            did_type_type = True

        if did_add and t >= 2.55 and not did_type_dep:
            inp_dep = page.locator(f"{row8_sel} input[data-field='depTime']")
            await inp_dep.fill("10:42")
            await inp_dep.dispatch_event("change")
            did_type_dep = True

        if did_add and t >= 3.20 and not did_type_arr:
            sel_to = page.locator(f"{row8_sel} select[data-field='toStation']")
            await sel_to.select_option("aoyamaonsen")
            inp_arr = page.locator(f"{row8_sel} input[data-field='arrTime']")
            await inp_arr.fill("11:28")
            await inp_arr.dispatch_event("change")
            did_type_arr = True

        if did_add and 1.15 <= t < 1.85:
            box = await page.locator(f"{row8_sel} input[data-field='trainNo']").bounding_box()
            cursor = (int(box["x"] + box["width"] - 4), int(box["y"] + box["height"] / 2), t < 1.32)
            hl = (int(box["x"] - 4), int(box["y"] - 4), int(box["x"] + box["width"] + 4), int(box["y"] + box["height"] + 4))
        elif did_add and 1.85 <= t < 2.55:
            box = await page.locator(f"{row8_sel} select[data-field='typeId']").bounding_box()
            cursor = (int(box["x"] + box["width"] / 2), int(box["y"] + box["height"] / 2), t < 2.02)
            hl = (int(box["x"] - 4), int(box["y"] - 4), int(box["x"] + box["width"] + 4), int(box["y"] + box["height"] + 4))
        elif did_add and 2.55 <= t < 3.20:
            box = await page.locator(f"{row8_sel} input[data-field='depTime']").bounding_box()
            cursor = (int(box["x"] + box["width"] / 2), int(box["y"] + box["height"] / 2), t < 2.72)
            hl = (int(box["x"] - 4), int(box["y"] - 4), int(box["x"] + box["width"] + 4), int(box["y"] + box["height"] + 4))
        elif did_add and t >= 3.20:
            # 右側A1の下端に新しく描かれた赤い急行「777」ライン上を指す
            cursor = (1390, 395, False)

        await page.evaluate("() => new Promise(r => requestAnimationFrame(r))")
        enc_3a.push_png_bytes(await page.screenshot(type="png"), cursor_xy=cursor, highlight_box=hl)
    enc_3a.close()
    print(f"Captured real app Scene 3 Cut A ({n_3a} frames)")

    # ------------------------------------------------------------------
    # Scene 3 Cut B (22.5s - 27.5s = 5.0s): 折返し・増解結・入出庫が整列している画面のズーム
    # ------------------------------------------------------------------
    await page.select_option("#presetSelect", "sakuragawa_main")
    await page.uncheck("#checkShowAllPages")
    await page.select_option("#selectZoom", "1.25")
    await page.evaluate("""() => {
        const ep = document.querySelector('#editorPane');
        if (ep) ep.style.width = '540px';
    }""")
    await page.wait_for_timeout(150)

    n_3b = int(5.0 * FPS)
    enc_3b = SegmentEncoder(ffmpeg_exe, out_paths["3b"], overlays["cutB"])
    switched_p2 = False
    for i in range(n_3b):
        t = i / FPS
        if t < 2.5:
            # 1ページ目 (A1 3両併結・A2・A3 途中駅部分継走) を拡大パン
            p = t / 2.5
            sy = int(20 + p * 230)
            await page.evaluate(f"() => {{ const pv = document.querySelector('#previewViewport'); pv.scrollTop = {sy}; pv.scrollLeft = 40; }}")
        else:
            if not switched_p2:
                await page.click("#btnNextPage")
                await page.wait_for_timeout(100)
                switched_p2 = True
            # 2ページ目 (変A3・A4・A5 併結・観光B1・C1 試運転破線) を拡大パン
            p = (t - 2.5) / 2.5
            sy = int(15 + p * 240)
            await page.evaluate(f"() => {{ const pv = document.querySelector('#previewViewport'); pv.scrollTop = {sy}; pv.scrollLeft = 40; }}")
        await page.evaluate("() => new Promise(r => requestAnimationFrame(r))")
        enc_3b.push_png_bytes(await page.screenshot(type="png"))
    enc_3b.close()
    print(f"Captured real app Scene 3 Cut B ({n_3b} frames)")

    # ------------------------------------------------------------------
    # Scene 3 Cut C (27.5s - 32.0s = 4.5s): A4サイズでそのまま綺麗に印刷プレビュー
    # ------------------------------------------------------------------
    await page.select_option("#presetSelect", "sakuragawa_main")
    await page.uncheck("#checkShowAllPages")
    await page.select_option("#selectZoom", "fit")
    await page.evaluate("""() => {
        const ep = document.querySelector('#editorPane');
        if (ep) ep.style.width = '620px';
    }""")
    await page.wait_for_timeout(150)

    print_btn_box = await page.locator("#btnPrint").bounding_box()
    pbx = int(print_btn_box["x"] + print_btn_box["width"] / 2)
    pby = int(print_btn_box["y"] + print_btn_box["height"] / 2)

    n_3c = int(4.5 * FPS)
    enc_3c = SegmentEncoder(ffmpeg_exe, out_paths["3c"], overlays["cutC"])
    did_print_view = False
    for i in range(n_3c):
        t = i / FPS
        if t < 1.25:
            cursor = (pbx, pby, t >= 0.80)
            hl = (int(print_btn_box["x"] - 3), int(print_btn_box["y"] - 3), int(print_btn_box["x"] + print_btn_box["width"] + 3), int(print_btn_box["y"] + print_btn_box["height"] + 3)) if t >= 0.45 else None
            await page.evaluate("() => new Promise(r => requestAnimationFrame(r))")
            enc_3c.push_png_bytes(await page.screenshot(type="png"), cursor_xy=cursor, highlight_box=hl)
        else:
            if not did_print_view:
                # 印刷プレビュー風の2ページ見開きA4レイアウトで美しいベクター用紙全体を提示
                await page.check("#checkShowAllPages")
                await page.wait_for_timeout(100)
                await page.evaluate("""() => {
                    document.querySelector('.app-header').style.display = 'none';
                    document.querySelector('#editorPane').style.display = 'none';
                    document.querySelector('#workspaceSplitter').style.display = 'none';
                    document.querySelector('.preview-toolbar').style.display = 'none';
                    const pv = document.querySelector('#previewViewport');
                    pv.style.background = '#323639';
                    pv.style.display = 'flex';
                    pv.style.flexDirection = 'row';
                    pv.style.justifyContent = 'center';
                    pv.style.alignItems = 'center';
                    pv.style.gap = '40px';
                    pv.style.padding = '76px 40px 132px';
                    pv.style.overflow = 'hidden';
                    document.querySelectorAll('.preview-page-wrapper').forEach(w => {
                        w.style.width = '595px';
                        w.style.height = '841px';
                        w.style.margin = '0';
                        w.style.boxShadow = '0 14px 36px rgba(0,0,0,0.65)';
                        const s = w.querySelector('.preview-page-sheet');
                        if (s) s.style.transform = 'scale(0.53)';
                    });
                }""")
                did_print_view = True
            await page.evaluate("() => new Promise(r => requestAnimationFrame(r))")
            enc_3c.push_png_bytes(await page.screenshot(type="png"))
    enc_3c.close()
    print(f"Captured real app Scene 3 Cut C ({n_3c} frames)")


async def main():
    t0 = time.time()
    os.makedirs(BUILD_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)

    ffmpeg_exe = get_ffmpeg_exe()
    print(f"Using FFmpeg: {ffmpeg_exe}")

    # 1. 音声WAV生成 (45.0s)
    wav_path = os.path.join(BUILD_DIR, "soundtrack_45s.wav")
    audio_synth.build_audio(wav_path)

    # 2. ローカルWebサーバー起動 & Playwright起動
    server = start_local_server()
    seg_paths = {
        "s1": os.path.join(BUILD_DIR, "seg1_excel.mp4"),
        "s2a": os.path.join(BUILD_DIR, "seg2a_title.mp4"),
        "2b": os.path.join(BUILD_DIR, "seg2b_app.mp4"),
        "3a": os.path.join(BUILD_DIR, "seg3a_cutA.mp4"),
        "3b": os.path.join(BUILD_DIR, "seg3b_cutB.mp4"),
        "3c": os.path.join(BUILD_DIR, "seg3c_cutC.mp4"),
        "s4": os.path.join(BUILD_DIR, "seg4_free.mp4"),
        "s5": os.path.join(BUILD_DIR, "seg5_cta.mp4"),
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
        page = await context.new_page()

        # 透過オーバーレイPNG取得 (実操作画面4カット分)
        overlays = {}
        for mode_key in ["scene2b", "cutA", "cutB", "cutC"]:
            overlays[mode_key] = await capture_overlay_png(page, mode_key)
        print("Rendered transparent overlay PNGs.")

        # シーン1 (0-10s = 10.0s)
        await capture_slide_segment(page, ffmpeg_exe, "scene1_excel_pain.html", 10.0, seg_paths["s1"])

        # シーン2A (10-14s = 4.0s)
        await capture_slide_segment(page, ffmpeg_exe, "scene2_title_reveal.html", 4.0, seg_paths["s2a"])

        # シーン2B + シーン3 (14-32s = 18.0s) 実アプリブラウザ操作録画
        await capture_app_demos(page, ffmpeg_exe, overlays, seg_paths)

        # シーン4 (32-42s = 10.0s)
        await capture_slide_segment(page, ffmpeg_exe, "scene4_free_price.html", 10.0, seg_paths["s4"])

        # シーン5 (42-45s = 3.0s)
        await capture_slide_segment(page, ffmpeg_exe, "scene5_release_cta.html", 3.0, seg_paths["s5"])

        await browser.close()

    server.shutdown()

    # 3. FFmpegでセグメント結合 ＋ レトロBGM/SE合成 → 最終1080p MP4生成
    concat_txt = os.path.join(BUILD_DIR, "concat_list.txt")
    ordered_keys = ["s1", "s2a", "2b", "3a", "3b", "3c", "s4", "s5"]
    with open(concat_txt, "w", encoding="utf-8") as f:
        for k in ordered_keys:
            # Windowsパスエスケープ
            clean_p = seg_paths[k].replace("\\", "/")
            f.write(f"file '{clean_p}'\n")

    cmd = [
        ffmpeg_exe,
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_txt,
        "-i", wav_path,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "medium",
        "-crf", "18",
        "-c:a", "aac",
        "-b:a", "192k",
        "-ar", "48000",
        "-movflags", "+faststart",
        "-shortest",
        OUT_MP4,
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"Final FFmpeg mux failed:\n{res.stdout}")

    size_mb = os.path.getsize(OUT_MP4) / (1024 * 1024)
    print(f"\n>>> SUCCESS! Built promo MP4 in {time.time() - t0:.1f}s:")
    print(f"    File: {OUT_MP4} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    asyncio.run(main())

