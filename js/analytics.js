/**
 * 箱ダイヤ描画システム - GA4 詳細利用状況計測ヘルパー (BoxAnalytics)
 *
 * - すべての送信値から個人特定情報およびユーザーが入力した固有名文字列（路線名・駅名・列番・注記・作成者名・フォント自由入力など）を除外し、
 *   項目名・操作種別・列挙値・数値・件数のみを匿名送信します。
 * - DataModel.subscribe と連動して全設定変更・編集操作を捕捉しつつ、連続操作はデバウンスして計測負荷を抑制します。
 */
(function (global) {
  "use strict";

  const APP_VERSION = "1.2.0";

  // 自由入力文字列を直接送らず有無・長さ帯へ丸める対象キー
  const SENSITIVE_TEXT_SETTING_KEYS = new Set([
    "rosterColHeaderText",
    "depotOutColHeaderText",
    "depotInColHeaderText",
    "distanceColHeaderText"
  ]);

  // スライダー等で連続変化し得る数値設定（デバウンス対象）
  const DEBOUNCED_SETTING_KEYS = new Set([
    "tableVerticalScale",
    "tableHorizontalScale",
    "rosterColWidth",
    "depotOutColWidth",
    "depotInColWidth",
    "distanceColWidth",
    "customPageWidthMm",
    "customPageHeightMm",
    "timeAxisCustomWidthMm",
    "timeAxisCustomHeightMm",
    "baseRowHeight",
    "blockPaddingRows"
  ]);

  const MILESTONE_SECONDS = [30, 60, 180, 300, 600, 1200, 1800];

  function truncateStr(val, maxLen = 100) {
    const s = String(val === undefined || val === null ? "" : val);
    return s.length > maxLen ? s.slice(0, maxLen) : s;
  }

  function lenBucket(str) {
    const n = String(str || "").trim().length;
    if (n === 0) return "empty";
    if (n <= 6) return "short";
    if (n <= 20) return "medium";
    return "long";
  }

  function normalizeParamValue(val) {
    if (val === undefined || val === null) return "none";
    if (typeof val === "boolean") return val ? "true" : "false";
    if (typeof val === "number") return Number.isFinite(val) ? Math.round(val * 1000) / 1000 : 0;
    return truncateStr(val, 96);
  }

  function detectWebViewKind(ua) {
    const s = String(ua || "");
    if (/Twitter|TwitterAndroid/i.test(s)) return "x_twitter";
    if (/Line\//i.test(s)) return "line";
    if (/Instagram/i.test(s)) return "instagram";
    if (/FBAN|FBAV/i.test(s)) return "facebook";
    if (/YJApp/i.test(s)) return "yahoo_japan";
    if (/MicroMessenger/i.test(s)) return "wechat";
    if (/musical_ly|BytedanceWebview/i.test(s)) return "tiktok";
    return "standard";
  }

  function viewportBucket(w) {
    const width = Number(w) || 0;
    if (width <= 420) return "mobile_xs";
    if (width <= 720) return "mobile_sm";
    if (width <= 900) return "tablet_sm";
    if (width <= 1280) return "desktop_md";
    return "desktop_lg";
  }

  const pendingDebounced = new Map();
  let lastSettingsCache = null;
  let lastMetadataCache = null;
  let nextActionCtx = null;
  let activeModelRef = null;
  let activeTrackingReady = false;

  // 実アクティブ時間計測状態（ユーザーが操作してから最大30秒間をアクティブ扱いとする）
  let activeSeconds = 0;
  let lastInteractionAt = 0;
  let usageTickTimer = null;
  const firedMilestones = new Set();

  function sendRaw(eventName, params = {}) {
    if (typeof global.gtag !== "function") return;
    const safeName = truncateStr(String(eventName || "custom_event").replace(/[^a-zA-Z0-9_]/g, "_"), 40);
    const cleanParams = { app_version: APP_VERSION };
    const entries = Object.entries(params || {});
    for (let i = 0; i < entries.length && Object.keys(cleanParams).length < 24; i++) {
      const [rawK, rawV] = entries[i];
      if (rawV === undefined) continue;
      const cleanK = truncateStr(String(rawK).replace(/[^a-zA-Z0-9_]/g, "_"), 40);
      if (!cleanK) continue;
      cleanParams[cleanK] = normalizeParamValue(rawV);
    }
    try {
      global.gtag("event", safeName, cleanParams);
    } catch (_) {
      // アナリティクス失敗時もアプリ動作へ影響させない
    }
  }

  function track(eventName, params = {}) {
    markInteraction();
    sendRaw(eventName, params);
  }

  function trackDebounced(debounceKey, eventName, params = {}, delayMs = 550) {
    markInteraction();
    const key = String(debounceKey || eventName);
    const existing = pendingDebounced.get(key);
    if (existing && existing.timer) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      pendingDebounced.delete(key);
      sendRaw(eventName, params);
    }, delayMs);
    pendingDebounced.set(key, { timer, eventName, params });
  }

  function flushPending() {
    for (const [, entry] of pendingDebounced.entries()) {
      if (entry.timer) clearTimeout(entry.timer);
      sendRaw(entry.eventName, entry.params);
    }
    pendingDebounced.clear();
  }

  function markInteraction() {
    lastInteractionAt = Date.now();
  }

  function startActiveUsageTracking() {
    if (usageTickTimer) return;
    lastInteractionAt = Date.now();
    ["pointerdown", "keydown", "input", "change", "wheel"].forEach((ev) => {
      global.addEventListener(ev, markInteraction, { passive: true, capture: true });
    });
    usageTickTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (Date.now() - lastInteractionAt > 30000) return;
      activeSeconds += 5;
      for (const m of MILESTONE_SECONDS) {
        if (activeSeconds >= m && !firedMilestones.has(m)) {
          firedMilestones.add(m);
          sendRaw("active_usage_milestone", {
            milestone_sec: m,
            device_layout: global.innerWidth <= 900 ? "mobile" : "desktop",
            axis_mode: getAxisMode()
          });
        }
      }
    }, 5000);

    global.addEventListener("pagehide", flushPending);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flushPending();
      });
    }
  }

  function getAxisMode() {
    try {
      const s = activeModelRef && activeModelRef.getSettings ? activeModelRef.getSettings() : {};
      return s.xAxisMode === "time" ? "time" : "station";
    } catch (_) {
      return "station";
    }
  }

  function cloneJsonSafe(obj) {
    try {
      return JSON.parse(JSON.stringify(obj || {}));
    } catch (_) {
      return {};
    }
  }

  function settingGroupFor(key) {
    if (key.startsWith("fonts") || key.startsWith("font")) return "fonts";
    if (key.startsWith("timeAxis")) return "time_axis";
    if (key.startsWith("depot")) return "depot";
    if (key.startsWith("distance")) return "distance";
    if (key.startsWith("table") || key.endsWith("ColWidth")) return "scale_width";
    if (key.startsWith("page") || key === "orientation" || key.startsWith("customPage") || key === "separatePageSettingsByAxisMode") return "page";
    if (key.startsWith("showHeader") || key === "meta_title" || key === "meta_copyright" || key === "rosterColHeaderText") return "header";
    return "style_behavior";
  }

  function emitSettingChanged(settingKey, val, groupOverride = null, forceDebounce = false) {
    const group = groupOverride || settingGroupFor(settingKey);
    const axis = getAxisMode();
    const payload = {
      setting_key: settingKey,
      setting_value: val,
      setting_group: group,
      axis_mode: axis
    };
    if (forceDebounce || DEBOUNCED_SETTING_KEYS.has(settingKey)) {
      trackDebounced(`setting:${settingKey}`, "setting_changed", payload, 550);
    } else {
      sendRaw("setting_changed", payload);
    }
  }

  function diffAndTrackSettings(nextSettings, patch = null) {
    const prev = lastSettingsCache || {};
    const cur = cloneJsonSafe(nextSettings);
    const keysToInspect = patch && typeof patch === "object" ? Object.keys(patch) : Object.keys(cur);

    for (const key of keysToInspect) {
      if (key === "fonts") {
        const pf = prev.fonts || {};
        const cf = cur.fonts || {};
        const roles = new Set([...Object.keys(pf), ...Object.keys(cf)]);
        roles.forEach((role) => {
          if (pf[role] !== cf[role]) {
            emitSettingChanged(`fonts_${role}`, cf[role] || "F1", "fonts");
          }
        });
        continue;
      }

      if (key === "fontStyles") {
        const ps = prev.fontStyles || {};
        const cs = cur.fontStyles || {};
        const roles = new Set([...Object.keys(ps), ...Object.keys(cs)]);
        roles.forEach((role) => {
          const pItem = ps[role] || {};
          const cItem = cs[role] || {};
          ["bold", "italic", "underline", "tabularNums", "sizeScale", "letterSpacing", "customFamily"].forEach((prop) => {
            if (pItem[prop] !== cItem[prop]) {
              const outVal = prop === "customFamily" ? lenBucket(cItem[prop]) : cItem[prop];
              const isSlider = prop === "sizeScale" || prop === "letterSpacing" || prop === "customFamily";
              emitSettingChanged(`font_${role}_${prop}`, outVal, "fonts", isSlider);
            }
          });
        });
        continue;
      }

      if (prev[key] !== cur[key] || (patch && patch[key] !== undefined && prev[key] === undefined)) {
        const outVal = SENSITIVE_TEXT_SETTING_KEYS.has(key) ? lenBucket(cur[key]) : cur[key];
        emitSettingChanged(key, outVal, null, SENSITIVE_TEXT_SETTING_KEYS.has(key));
      }
    }
    lastSettingsCache = cur;
  }

  function diffAndTrackMetadata(nextMeta, patch = null) {
    const prev = lastMetadataCache || {};
    const cur = cloneJsonSafe(nextMeta);
    const keys = patch && typeof patch === "object" ? Object.keys(patch) : ["title", "copyright"];
    for (const k of keys) {
      if (prev[k] !== cur[k]) {
        emitSettingChanged(`meta_${k}`, lenBucket(cur[k]), "header", true);
      }
    }
    lastMetadataCache = cur;
  }

  function snapshotDataSettings(data, trigger = "init") {
    if (!data || !data.settings) return;
    const s = data.settings;
    const rosters = Array.isArray(data.rosters) ? data.rosters : [];
    const trainsCount = rosters.reduce((acc, r) => acc + ((r && r.trains) ? r.trains.length : 0), 0);
    const stationsCount = Array.isArray(data.stations) ? data.stations.length : 0;
    const visibleStations = Array.isArray(data.stations) ? data.stations.filter(st => st.visible !== false).length : 0;
    const notesCount = Array.isArray(data.notes) ? data.notes.length : 0;

    sendRaw("settings_profile_layout", {
      trigger,
      x_axis_mode: s.xAxisMode || "station",
      page_size: s.pageSize || "A4",
      orientation: s.orientation || "portrait",
      separate_page: !!s.separatePageSettingsByAxisMode,
      time_page_size: s.timeAxisPageSize || "AUTO",
      time_orient: s.timeAxisOrientation || "landscape",
      page_break: s.pageBreakMode || "auto",
      station_dir: s.stationAxisDirection || "ltr",
      show_out_col: s.showDepotOutCol !== false,
      show_in_col: s.showDepotInCol !== false,
      depot_scope: s.depotDisplayScope || "all",
      depot_fmt: s.depotTextFormat || "station_time",
      depot_filled: s.depotFilledPolicy || "ends_only",
      dist_mode: s.distanceDisplayMode || "none",
      dist_excl_dead: !!s.distanceExcludeDeadhead,
      v_scale: s.tableVerticalScale || 1,
      h_scale: s.tableHorizontalScale || 1,
      rosters_count: rosters.length,
      trains_count: trainsCount,
      stations_count: stationsCount,
      visible_stations: visibleStations,
      notes_count: notesCount
    });

    const f = s.fonts || {};
    const fs = s.fontStyles || {};
    sendRaw("settings_profile_style", {
      trigger,
      show_title: s.showHeaderTitle !== false,
      show_copy: s.showHeaderCopyright !== false,
      has_title: lenBucket(data.metadata && data.metadata.title),
      has_copy: lenBucket(data.metadata && data.metadata.copyright),
      pn_enabled: s.pageNumberEnabled !== false,
      pn_fmt: s.pageNumberFormat || "slash",
      pn_pos: s.pageNumberPosition || "bottom-center",
      pn_hide_single: !!s.pageNumberHideSingle,
      st_hdr_dir: s.stationHeaderDirection || "vertical",
      time_fmt: s.timeDisplayFormat || "h:mm",
      st_grid: s.stationGridStyle || "none",
      ta_grid_min: s.timeAxisGridMinutes || 30,
      ta_grid_style: s.timeAxisGridStyle || "default",
      ta_night_fmt: s.timeAxisLateNightFormat || "24plus",
      turnaround_col: s.turnaroundColorMode || "next",
      sub_hdr: s.subHeaderMode || "omitFirst",
      self_hl: s.selfHighlightStyle || "red",
      zebra: !!s.rosterZebraFill,
      auto_sync: s.autoSyncCoupled !== false,
      font_header: f.header || "F1",
      font_roster: f.roster || "F1",
      font_time: f.time || "F2",
      roster_bold: !!(fs.roster && fs.roster.bold)
    });
  }

  function summarizeCounts(data) {
    const rosters = (data && data.rosters) || [];
    return {
      rosters_count: rosters.length,
      trains_count: rosters.reduce((s, r) => s + ((r && r.trains) ? r.trains.length : 0), 0),
      stations_count: ((data && data.stations) || []).length,
      notes_count: ((data && data.notes) || []).length,
      axis_mode: getAxisMode()
    };
  }

  function setNextActionContext(ctx) {
    nextActionCtx = ctx ? Object.assign({}, ctx, { ts: Date.now() }) : null;
  }

  function consumeActionContext() {
    if (!nextActionCtx) return null;
    const c = nextActionCtx;
    nextActionCtx = null;
    if (Date.now() - c.ts > 2000) return null;
    return c;
  }

  function attachModel(dataModel) {
    if (!dataModel || activeTrackingReady) return;
    activeTrackingReady = true;
    activeModelRef = dataModel;
    const initData = dataModel.getData();
    lastSettingsCache = cloneJsonSafe(initData ? initData.settings : {});
    lastMetadataCache = cloneJsonSafe(initData ? initData.metadata : {});
    startActiveUsageTracking();

    dataModel.subscribe((data, actionType, meta) => {
      markInteraction();
      const ctx = consumeActionContext();

      if (actionType === "load") {
        lastSettingsCache = cloneJsonSafe(data ? data.settings : {});
        lastMetadataCache = cloneJsonSafe(data ? data.metadata : {});
        return;
      }

      if (actionType === "settings-update") {
        diffAndTrackSettings(data.settings, meta && meta.patch);
        return;
      }

      if (actionType === "metadata-update") {
        diffAndTrackMetadata(data.metadata, meta && meta.patch);
        return;
      }

      if (actionType === "history") {
        sendRaw("history_used", {
          action: (ctx && ctx.action) || (meta && meta.direction) || "history",
          via: (ctx && ctx.via) || "button",
          axis_mode: getAxisMode()
        });
        lastSettingsCache = cloneJsonSafe(data ? data.settings : {});
        lastMetadataCache = cloneJsonSafe(data ? data.metadata : {});
        return;
      }

      const counts = summarizeCounts(data);
      const baseParams = Object.assign({ action_type: actionType }, counts);
      if (ctx) {
        if (ctx.field) baseParams.field = ctx.field;
        if (ctx.via) baseParams.via = ctx.via;
        if (ctx.kind) baseParams.kind = ctx.kind;
        if (ctx.detailPanel) baseParams.detail_panel = "true";
      }

      if (actionType.endsWith("-update") || actionType === "trains-sync") {
        const dKey = `mut:${actionType}:${baseParams.field || "row"}`;
        trackDebounced(dKey, "data_mutated", baseParams, 650);
      } else {
        sendRaw("data_mutated", baseParams);
      }
    });
  }

  global.BoxAnalytics = {
    APP_VERSION,
    attachModel,
    track,
    trackDebounced,
    flushPending,
    setNextActionContext,
    snapshotDataSettings,
    detectWebViewKind,
    viewportBucket,
    lenBucket
  };
})(typeof window !== "undefined" ? window : globalThis);
