"""
夢グループ風 通販CM（約47秒）掛け合い合成音声ジェネレーター
- 社長（おじさん役）: ja-JP-KeitaNeural（低め・落ち着いた語調＋温かみのあるTV放送風EQ）
- 女性アシスタント役: ja-JP-NanamiNeural（高め・明るく張りのある掛け合いトーン＋プレゼンス強調）

※ AI動画生成（Text-to-Video等）は使用せず、日本語テキストの正確な読み上げと
  映像テロップ・効果音・BGM の「間（ま）」をミリ秒単位で同期させます。
"""
import asyncio
import os
import subprocess
import wave
from dataclasses import dataclass
from typing import List, Optional, Tuple

import edge_tts
import imageio_ffmpeg
import numpy as np
from scipy.signal import butter, filtfilt

SR = 48000


@dataclass(frozen=True)
class VoiceCue:
    key: str
    speaker: str       # "shacho" | "assistant"
    start_sec: float   # 動画タイムライン上の発話開始時刻
    pitch: str         # Edge TTS pitch 指定
    rate: str          # Edge TTS rate 指定
    text: str          # 読み上げ最適化テキスト（誤読防止済み）
    gain: float = 1.0  # クリップ個別の音量微調整
    pan: float = 0.0   # わずかなステレオ定位（社長=-0.06, アシスタント=+0.06）


# 映像タイムライン (TOTAL = 47.60s) と1対1対応する掛け合い台本
# セグメント長: S1=9.80, S2A=2.90, S2B=3.30, S3A=3.80, S3B=4.60, S3C=3.50, S4=12.10, S5=7.60
VOICE_CUES: List[VoiceCue] = [
    # --- Scene 1: お悩み提起 (0.00s - 9.80s) ---
    VoiceCue("01_s1_shacho_1", "shacho",    0.25, "-26Hz", "+4%",  "ダイヤ好きのマニアの皆さん！", gain=1.02, pan=-0.06),
    VoiceCue("02_s1_shacho_2", "shacho",    2.25, "-26Hz", "+6%",  "エクセルでポチポチ線を引いて、セル結合とかしちゃって…", gain=1.00, pan=-0.06),
    VoiceCue("03_s1_shacho_3", "shacho",    6.35, "-28Hz", "-6%",  "気が利かないねぇ…", gain=1.05, pan=-0.06),
    VoiceCue("04_s1_assist_4", "assistant", 7.90, "+22Hz", "+4%",  "面倒じゃありませんか！", gain=0.98, pan=+0.06),

    # --- Scene 2-A: タイトル登場 (9.80s - 12.70s) ---
    VoiceCue("05_s2a_shacho",  "shacho",   10.05, "-25Hz", "+6%",  "そこで今回ご紹介するのがこちら！", gain=1.02, pan=-0.06),

    # --- Scene 2-B: 実アプリ全体画面 (12.70s - 16.00s) ---
    VoiceCue("06_s2b_shacho",  "shacho",   12.90, "-25Hz", "+4%",  "ブラウザで動く、ハコダイヤ描画システムー！", gain=1.04, pan=-0.06),

    # --- Scene 3: 機能実演デモ (16.00s - 27.90s) ---
    VoiceCue("07_s3a_shacho",  "shacho",   16.20, "-25Hz", "+4%",  "面倒な罫線引きは一切不要！", gain=1.02, pan=-0.06),
    VoiceCue("08_s3b_assist",  "assistant",20.00, "+20Hz", "+10%", "データを入力するだけで、あっという間に美しいハコダイヤが完成ー！", gain=0.98, pan=+0.06),
    VoiceCue("09_s3c_shacho",  "shacho",   24.60, "-25Hz", "+4%",  "そのまま印刷までできちゃうんです！", gain=1.02, pan=-0.06),

    # --- Scene 4: 衝撃の価格発表・オチ (27.90s - 40.00s) ---
    VoiceCue("10_s4_shacho_1", "shacho",   28.05, "-25Hz", "+15%", "インストール不要！ブラウザですぐ使える！", gain=1.02, pan=-0.06),
    VoiceCue("11_s4_shacho_2", "shacho",   31.20, "-27Hz", "-4%",  "気になるお値段は…なんと！", gain=1.05, pan=-0.06),
    VoiceCue("12_s4_shacho_3", "shacho",   33.60, "-20Hz", "+2%",  "無料！ゼロ円です！", gain=1.08, pan=-0.04),
    VoiceCue("13_s4_assist_4", "assistant",35.90, "+24Hz", "+12%", "えーっ、無料なんですかー？ 安ーい！", gain=1.00, pan=+0.06),
    VoiceCue("14_s4_shacho_5", "shacho",   39.05, "-28Hz", "-6%",  "無料です。", gain=1.06, pan=-0.06),

    # --- Scene 5: 公開日時告知・CTA (40.00s - 47.60s) ---
    VoiceCue("15_s5_assist_1", "assistant",40.20, "+18Hz", "+20%", "2026年11月14日18時、ギットハブページズで公開！", gain=0.98, pan=+0.05),
    VoiceCue("16_s5_shacho_2", "shacho",   45.05, "-25Hz", "+12%", "せきたんのアカウントをフォローしてお待ちください！", gain=1.04, pan=-0.05),
]

VOICES = {
    "shacho": "ja-JP-KeitaNeural",
    "assistant": "ja-JP-NanamiNeural",
}


def _apply_broadcast_eq(sig: np.ndarray, speaker: str) -> np.ndarray:
    """昭和〜平成テレビ通販マイク風の聞き取りやすい帯域調整＋穏やかな音圧補正"""
    if len(sig) < 64:
        return sig

    # 不要な超低域ハム除去 (95Hzハイパス)
    b_hp, a_hp = butter(2, 95.0 / (SR * 0.5), btype="high")
    out = filtfilt(b_hp, a_hp, sig)

    if speaker == "shacho":
        # 社長（おじさん）：中低域の厚み (150-350Hz) を少し足し、高域を少し丸めて渋みを出す
        b_warm, a_warm = butter(2, [140.0 / (SR * 0.5), 380.0 / (SR * 0.5)], btype="band")
        b_lp, a_lp = butter(2, 5800.0 / (SR * 0.5), btype="low")
        warm = filtfilt(b_warm, a_warm, out)
        out = filtfilt(b_lp, a_lp, out) + 0.28 * warm
    else:
        # 女性アシスタント：明瞭なプレゼンス帯域 (2.2k-4.8kHz) を軽く持ち上げ抜けを良くする
        b_pres, a_pres = butter(2, [2000.0 / (SR * 0.5), 4800.0 / (SR * 0.5)], btype="band")
        pres = filtfilt(b_pres, a_pres, out)
        out = out + 0.22 * pres

    # 簡易RMS正規化＋ソフトコンプで発話音量を均一化
    rms = np.sqrt(np.mean(out ** 2)) + 1e-9
    target_rms = 0.165
    out = out * min(3.5, target_rms / rms)
    out = np.tanh(out * 1.15) / np.tanh(1.15)
    return out


def _trim_silence(sig: np.ndarray, thresh: float = 0.012) -> np.ndarray:
    """TTS先頭・末尾の無音パディングを切り詰め、発話開始タイミングを正確化する"""
    nz = np.where(np.abs(sig) > thresh)[0]
    if len(nz) == 0:
        return sig
    pad_pre = int(0.018 * SR)
    pad_post = int(0.045 * SR)
    i0 = max(0, nz[0] - pad_pre)
    i1 = min(len(sig), nz[-1] + pad_post)
    trimmed = sig[i0:i1].copy()
    # クリックノイズ防止フェード
    f_in = min(int(0.008 * SR), len(trimmed))
    f_out = min(int(0.025 * SR), len(trimmed))
    if f_in > 0:
        trimmed[:f_in] *= np.linspace(0.0, 1.0, f_in)
    if f_out > 0:
        trimmed[-f_out:] *= np.linspace(1.0, 0.0, f_out)
    return trimmed


async def _synthesize_all_cues(cache_dir: str, cues: List[VoiceCue]) -> List[Tuple[VoiceCue, np.ndarray]]:
    os.makedirs(cache_dir, exist_ok=True)
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    results: List[Tuple[VoiceCue, np.ndarray]] = []

    for cue in cues:
        mp3_path = os.path.join(cache_dir, f"{cue.key}.mp3")
        wav_path = os.path.join(cache_dir, f"{cue.key}.wav")

        voice_name = VOICES[cue.speaker]
        comm = edge_tts.Communicate(cue.text, voice_name, pitch=cue.pitch, rate=cue.rate)
        await comm.save(mp3_path)
        subprocess.run(
            [ffmpeg, "-y", "-i", mp3_path, "-ac", "1", "-ar", str(SR), wav_path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
        )

        with wave.open(wav_path, "rb") as wf:
            raw = wf.readframes(wf.getnframes())
        pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
        pcm = _trim_silence(pcm)
        pcm = _apply_broadcast_eq(pcm, cue.speaker) * cue.gain
        results.append((cue, pcm))

    return results


def build_voice_track(cache_dir: str, total_duration: float, cues: Optional[List[VoiceCue]] = None) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    全セリフを合成し、ステレオ音声トラック (voice_l, voice_r) と
    BGMダッキング用エンベロープ (voice_active_env: 0.0..1.0) を返す。
    """
    use_cues = cues if cues is not None else VOICE_CUES
    try:
        asyncio.get_running_loop()
        in_loop = True
    except RuntimeError:
        in_loop = False

    if in_loop:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=1) as pool:
            synthesized = pool.submit(asyncio.run, _synthesize_all_cues(cache_dir, use_cues)).result()
    else:
        synthesized = asyncio.run(_synthesize_all_cues(cache_dir, use_cues))

    n_total = int(round(total_duration * SR))
    voice_l = np.zeros(n_total, dtype=np.float64)
    voice_r = np.zeros(n_total, dtype=np.float64)
    active_env = np.zeros(n_total, dtype=np.float64)

    print("=== Synthetic Voice Timeline Report ===")
    prev_end = 0.0
    for cue, sig in synthesized:
        i0 = int(round(cue.start_sec * SR))
        i1 = min(n_total, i0 + len(sig))
        n = i1 - i0
        dur = len(sig) / SR
        end_sec = cue.start_sec + dur
        gap = cue.start_sec - prev_end
        overlap_warn = " [OVERLAP!]" if gap < 0.05 else ""
        clip_warn = " [CLIPPED AT END!]" if (i0 + len(sig) > n_total) else ""
        print(
            f"  {cue.key:16s} [{cue.speaker:9s}] {cue.start_sec:5.2f}s -> {end_sec:5.2f}s "
            f"(dur={dur:.2f}s, gap={gap:+.2f}s){overlap_warn}{clip_warn}"
        )
        prev_end = end_sec

        if n <= 0:
            continue
        gl = np.sqrt(0.5 * (1.0 - cue.pan))
        gr = np.sqrt(0.5 * (1.0 + cue.pan))
        voice_l[i0:i1] += sig[:n] * gl
        voice_r[i0:i1] += sig[:n] * gr

        # 発話区間前後 80ms/180ms のスムーズなダッキングマスクを作成
        d_pre = int(0.08 * SR)
        d_post = int(0.20 * SR)
        di0 = max(0, i0 - d_pre)
        di1 = min(n_total, i1 + d_post)
        mask = np.ones(di1 - di0, dtype=np.float64)
        pre_len = i0 - di0
        post_len = di1 - i1
        if pre_len > 0:
            mask[:pre_len] = np.linspace(0.0, 1.0, pre_len)
        if post_len > 0:
            mask[-post_len:] = np.linspace(1.0, 0.0, post_len)
        active_env[di0:di1] = np.maximum(active_env[di0:di1], mask)

    return voice_l, voice_r, active_env


if __name__ == "__main__":
    vl, vr, env = build_voice_track(os.path.join(os.path.dirname(__file__), "build", "tts_final"), 47.6)
    print(f"Voice peak={max(np.max(np.abs(vl)), np.max(np.abs(vr))):.3f}")
