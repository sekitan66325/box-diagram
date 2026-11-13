"""
夢グループ風 通販CM（47.6秒）レトロBGM＋効果音(SE)＋合成音声ミキサー (48kHz Stereo WAV)
"""
import os
import wave
import numpy as np

from voice_synth import build_voice_track

SR = 48000
DURATION = 47.60
N_SAMPLES = int(round(SR * DURATION))


def midi_to_hz(note: float) -> float:
    return 440.0 * (2.0 ** ((note - 69.0) / 12.0))


def add_mono_event(buf_l: np.ndarray, buf_r: np.ndarray, t0: float, sig: np.ndarray, pan: float = 0.0, gain: float = 1.0):
    i0 = int(t0 * SR)
    if i0 >= N_SAMPLES:
        return
    i1 = min(N_SAMPLES, i0 + len(sig))
    n = i1 - i0
    if n <= 0:
        return
    gl = gain * np.sqrt(0.5 * (1.0 - pan))
    gr = gain * np.sqrt(0.5 * (1.0 + pan))
    buf_l[i0:i1] += sig[:n] * gl
    buf_r[i0:i1] += sig[:n] * gr


def synth_organ_note(freq: float, dur: float, amp: float = 0.25) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    # 昭和風オルガン加算合成（基音＋2倍音＋3倍音）
    wave_sig = (
        0.65 * np.sin(2 * np.pi * freq * t)
        + 0.25 * np.sin(2 * np.pi * 2.0 * freq * t)
        + 0.10 * np.sin(2 * np.pi * 3.0 * freq * t)
    )
    atk = min(int(0.015 * SR), len(t))
    rel = min(int(0.05 * SR), len(t))
    env = np.ones_like(t)
    if atk > 0:
        env[:atk] = np.linspace(0.0, 1.0, atk)
    if rel > 0:
        env[-rel:] *= np.linspace(1.0, 0.0, rel)
    return wave_sig * env * amp


def synth_brass(freq: float, dur: float, amp: float = 0.28) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    # 温かみのあるブラスシンセ（弱めののこぎり波倍音）
    sig = np.zeros_like(t)
    for k in range(1, 7):
        sig += (1.0 / (k ** 1.15)) * np.sin(2 * np.pi * k * freq * t + 0.1 * k)
    sig *= 0.45
    atk = min(int(0.03 * SR), len(t))
    rel = min(int(0.08 * SR), len(t))
    env = np.ones_like(t)
    if atk > 0:
        env[:atk] = np.linspace(0.0, 1.0, atk)
    if rel > 0:
        env[-rel:] *= np.linspace(1.0, 0.0, rel)
    return sig * env * amp


def synth_bell(freq: float, dur: float, amp: float = 0.25) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    mod = np.sin(2 * np.pi * (freq * 2.0) * t) * 1.6 * np.exp(-6.0 * t)
    sig = np.sin(2 * np.pi * freq * t + mod) * np.exp(-4.5 * t)
    atk = min(int(0.004 * SR), len(t))
    if atk > 0:
        sig[:atk] *= np.linspace(0.0, 1.0, atk)
    return sig * amp


def synth_bass(freq: float, dur: float, amp: float = 0.34) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    sig = (0.8 * np.sin(2 * np.pi * freq * t) + 0.2 * np.sin(2 * np.pi * 2 * freq * t)) * np.exp(-5.0 * t)
    atk = min(int(0.006 * SR), len(t))
    if atk > 0:
        sig[:atk] *= np.linspace(0.0, 1.0, atk)
    return sig * amp


def synth_kick(dur: float = 0.18, amp: float = 0.52) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    f = 46.0 + 95.0 * np.exp(-34.0 * t)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-16.0 * t) * amp


def synth_snare_hit(dur: float = 0.14, amp: float = 0.22) -> np.ndarray:
    rng = np.random.default_rng(1234)
    n = int(SR * dur)
    t = np.arange(n) / SR
    noise = rng.normal(0.0, 1.0, n)
    # 簡易ハイパス
    noise[1:] = noise[1:] - 0.55 * noise[:-1]
    tone = 0.35 * np.sin(2 * np.pi * 190.0 * t) * np.exp(-26.0 * t)
    return (noise * 0.45 * np.exp(-22.0 * t) + tone) * amp


def synth_hihat(amp: float = 0.09) -> np.ndarray:
    rng = np.random.default_rng(777)
    n = int(SR * 0.05)
    t = np.arange(n) / SR
    noise = rng.normal(0.0, 1.0, n)
    noise[1:] = noise[1:] - 0.85 * noise[:-1]
    return noise * np.exp(-65.0 * t) * amp


def synth_mouse_click() -> np.ndarray:
    n = int(SR * 0.025)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * 1450 * t) * np.exp(-220 * t) * 0.28


def synth_buzzer() -> np.ndarray:
    dur = 0.48
    t = np.arange(int(SR * dur)) / SR
    sig = 0.5 * np.sign(np.sin(2 * np.pi * 138 * t)) + 0.35 * np.sign(np.sin(2 * np.pi * 145 * t))
    sig *= np.exp(-3.2 * t)
    return sig * 0.16


def build_audio(out_wav_path: str, tts_cache_dir: str = None):
    os.makedirs(os.path.dirname(out_wav_path), exist_ok=True)
    if tts_cache_dir is None:
        tts_cache_dir = os.path.join(os.path.dirname(out_wav_path), "tts_final")

    # BGM 用と 効果音(SE) 用を分け、発話時のスマートダッキングを綺麗にかける
    bgm_l = np.zeros(N_SAMPLES, dtype=np.float64)
    bgm_r = np.zeros(N_SAMPLES, dtype=np.float64)
    sfx_l = np.zeros(N_SAMPLES, dtype=np.float64)
    sfx_r = np.zeros(N_SAMPLES, dtype=np.float64)

    # ------------------------------------------------------------------
    # SCENE 1 (0.0 - 9.80s): トホホお悩み・ゆっくりマイナー風オルガン＋クリック＋エラー音
    # ------------------------------------------------------------------
    sad_chords = [
        (0.2, [57, 60, 64], 2.0),  # Am
        (2.3, [53, 57, 60], 2.0),  # F
        (4.4, [50, 53, 57], 1.9),  # Dm
        (6.4, [52, 56, 59], 2.8),  # E7 (気が利かないねぇ〜)
    ]
    for t0, notes, dur in sad_chords:
        for i, m in enumerate(notes):
            add_mono_event(bgm_l, bgm_r, t0, synth_organ_note(midi_to_hz(m), dur, 0.10), pan=(i - 1) * 0.25)

    for click_t in [0.9, 1.4, 2.6, 3.2, 4.3]:
        add_mono_event(sfx_l, sfx_r, click_t, synth_mouse_click(), pan=0.1)

    # 5.70s: 「エラー・セル結合不可」ブザー（直後の「気が利かないねぇ…」の前に鳴らす）
    add_mono_event(sfx_l, sfx_r, 5.70, synth_buzzer(), pan=0.0, gain=0.90)

    # ------------------------------------------------------------------
    # SCENE 2〜5 BGM (9.80 - 46.80s): 126 BPM 通販風ご機嫌シンセ・マーチ！
    # （ただし 31.65〜33.45s ドラムロール前は一旦抜いて「間」を作る）
    # ------------------------------------------------------------------
    beat_sec = 60.0 / 126.0
    prog = [
        (48, [60, 64, 67]),  # C
        (55, [59, 62, 67]),  # G
        (57, [60, 64, 69]),  # Am
        (52, [59, 64, 67]),  # Em
        (53, [60, 65, 69]),  # F
        (48, [60, 64, 67]),  # C
        (53, [60, 65, 69]),  # F
        (55, [59, 62, 67]),  # G
    ]
    melody_pattern = [
        (72, 0.0, 0.45), (76, 0.5, 0.45), (79, 1.0, 0.45), (76, 1.5, 0.35),
        (74, 2.0, 0.45), (79, 2.5, 0.45), (76, 3.0, 0.7),
        (72, 4.0, 0.45), (74, 4.5, 0.45), (76, 5.0, 0.45), (72, 5.5, 0.35),
        (74, 6.0, 0.45), (71, 6.5, 0.45), (72, 7.0, 0.7),
    ]

    bgm_start = 10.00
    total_beats = int((45.90 - bgm_start) / beat_sec)
    for b in range(total_beats):
        t = bgm_start + b * beat_sec
        if 31.60 <= t <= 33.45:
            continue

        bar_idx = (b // 2) % len(prog)
        bass_midi, chord_midis = prog[bar_idx]

        if b % 2 == 0:
            add_mono_event(bgm_l, bgm_r, t, synth_kick(0.16, 0.36), pan=0.0)
            add_mono_event(bgm_l, bgm_r, t, synth_bass(midi_to_hz(bass_midi), beat_sec * 0.9, 0.24), pan=-0.05)
        else:
            add_mono_event(bgm_l, bgm_r, t, synth_snare_hit(0.11, 0.15), pan=0.08)
            for idx_c, cm in enumerate(chord_midis):
                add_mono_event(bgm_l, bgm_r, t, synth_organ_note(midi_to_hz(cm), beat_sec * 0.55, 0.075), pan=(idx_c - 1) * 0.35)

        add_mono_event(bgm_l, bgm_r, t, synth_hihat(0.06), pan=-0.2)
        add_mono_event(bgm_l, bgm_r, t + beat_sec * 0.5, synth_hihat(0.04), pan=0.2)

    cycle_len_beats = 8
    mel_t = 11.05
    while mel_t < 45.2:
        for note_m, offset_b, dur_b in melody_pattern:
            nt = mel_t + offset_b * beat_sec
            if 31.50 <= nt <= 33.70:
                continue
            if nt >= 45.2:
                continue
            add_mono_event(bgm_l, bgm_r, nt, synth_organ_note(midi_to_hz(note_m), dur_b * beat_sec, 0.085), pan=0.18)
        mel_t += cycle_len_beats * beat_sec

    # ------------------------------------------------------------------
    # 各シーン切り替え効果音（ジャジャン！ / ピコーン！ / ドドーン！）
    # ------------------------------------------------------------------
    # 9.80s: シーン2突入 ジャジャン！ & 11.05s ロゴ出現
    for m in [60, 64, 67, 72]:
        add_mono_event(sfx_l, sfx_r, 9.80, synth_brass(midi_to_hz(m), 0.32, 0.20))
    add_mono_event(sfx_l, sfx_r, 11.05, synth_brass(midi_to_hz(72), 0.45, 0.22))
    add_mono_event(sfx_l, sfx_r, 11.05, synth_bell(midi_to_hz(84), 0.55, 0.22), pan=-0.25)

    # 12.70s / 16.00s / 19.80s / 24.40s: 実アプリ・実演カット切替 ピコーン！
    for p_t, n1, n2 in [(12.70, 76, 84), (16.00, 79, 88), (19.80, 81, 91), (24.40, 84, 96)]:
        add_mono_event(sfx_l, sfx_r, p_t, synth_bell(midi_to_hz(n1), 0.30, 0.22), pan=-0.2)
        add_mono_event(sfx_l, sfx_r, p_t + 0.07, synth_bell(midi_to_hz(n2), 0.45, 0.24), pan=0.2)

    # 27.90s: シーン4 価格発表イントロ
    add_mono_event(sfx_l, sfx_r, 27.90, synth_brass(midi_to_hz(67), 0.40, 0.20))

    # 31.80 - 33.15s: スネア ドラムロール（クレッシェンド -> 0.30s無音の劇的な「間」）
    rng = np.random.default_rng(2026)
    roll_t = 31.80
    step = 0.068
    while roll_t < 33.15:
        progress = (roll_t - 31.80) / 1.35
        amp = 0.08 + 0.24 * (progress ** 1.4)
        add_mono_event(sfx_l, sfx_r, roll_t, synth_snare_hit(0.08, amp), pan=rng.uniform(-0.15, 0.15))
        roll_t += step
        step = max(0.036, step * 0.965)

    # 33.45s: 特大「無料！（0円）」ドドーーーン＋ジャジャーン＋キラキラ！
    add_mono_event(sfx_l, sfx_r, 33.45, synth_kick(0.30, 0.65), pan=0.0)
    add_mono_event(sfx_l, sfx_r, 33.45, synth_snare_hit(0.22, 0.32), pan=0.0)
    for m, pan in [(60, -0.3), (64, -0.1), (67, 0.1), (72, 0.3), (76, 0.0)]:
        add_mono_event(sfx_l, sfx_r, 33.45, synth_brass(midi_to_hz(m), 0.75, 0.22), pan=pan)
    for idx_b, bm in enumerate([84, 88, 91, 96]):
        add_mono_event(sfx_l, sfx_r, 33.50 + idx_b * 0.055, synth_bell(midi_to_hz(bm), 0.75, 0.22), pan=(idx_b - 1.5) * 0.3)

    # 35.78s: アシスタント「安〜い！」登場キラリーン効果音
    for idx_b, bm in enumerate([79, 84, 88, 96]):
        add_mono_event(sfx_l, sfx_r, 35.78 + idx_b * 0.05, synth_bell(midi_to_hz(bm), 0.55, 0.22), pan=(idx_b - 1.5) * 0.25)

    # 40.00s: シーン5 案内カード出現チャイム
    for idx_b, bm in enumerate([72, 76, 79, 84]):
        add_mono_event(sfx_l, sfx_r, 40.00 + idx_b * 0.045, synth_bell(midi_to_hz(bm), 0.45, 0.18), pan=(idx_b - 1.5) * 0.2)

    # 46.15 - 47.45s: エンディング ジャン・ジャ・ジャーン！終止和音
    for m in [65, 69, 72]:
        add_mono_event(sfx_l, sfx_r, 46.15, synth_brass(midi_to_hz(m), 0.24, 0.20))
    for m in [67, 71, 74]:
        add_mono_event(sfx_l, sfx_r, 46.43, synth_brass(midi_to_hz(m), 0.24, 0.20))
    for m in [60, 64, 67, 72, 76]:
        add_mono_event(sfx_l, sfx_r, 46.73, synth_brass(midi_to_hz(m), 1.0, 0.24))
    add_mono_event(sfx_l, sfx_r, 46.78, synth_bell(midi_to_hz(84), 1.0, 0.26), pan=-0.2)
    add_mono_event(sfx_l, sfx_r, 46.86, synth_bell(midi_to_hz(96), 1.0, 0.22), pan=0.2)

    # ------------------------------------------------------------------
    # 社長・女性アシスタント 合成音声トラック生成＋スマートBGMダッキング合成
    # ------------------------------------------------------------------
    voice_l, voice_r, voice_env = build_voice_track(tts_cache_dir, DURATION)
    bgm_duck = 1.0 - 0.64 * voice_env
    sfx_duck = 1.0 - 0.25 * voice_env

    buf_l = voice_l * 1.15 + bgm_l * bgm_duck + sfx_l * sfx_duck
    buf_r = voice_r * 1.15 + bgm_r * bgm_duck + sfx_r * sfx_duck

    # ソフトリミッター（安全なピーク抑制）＆終端フェードアウト
    stereo = np.stack([buf_l, buf_r], axis=1)
    peak = np.max(np.abs(stereo))
    if peak > 0.0:
        stereo = np.tanh(stereo * 1.15) / np.tanh(1.15) * 0.90
    fade_n = int(SR * 0.28)
    stereo[-fade_n:, :] *= np.linspace(1.0, 0.0, fade_n)[:, None]

    pcm16 = np.clip(stereo * 32767.0, -32768, 32767).astype(np.int16)
    with wave.open(out_wav_path, "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(SR)
        wf.writeframes(pcm16.tobytes())
    print(f"Synthesized mixed soundtrack (Voice + BGM + SE) written to {out_wav_path} ({DURATION:.2f}s, 48kHz Stereo)")


if __name__ == "__main__":
    out = os.path.join(os.path.dirname(__file__), "build", "soundtrack_mix.wav")
    build_audio(out)

