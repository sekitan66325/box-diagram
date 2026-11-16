/**
 * 箱ダイヤ描画ソフト - メインコントローラー (App)
 * 
 * - データモデル、表形式エディタ、ベクターレンダラーの統合
 * - ツールバー操作 (プリセット切替、Undo/Redo、JSON保存/読込、印刷)
 * - 左右ペインのスプリッター幅変更ドラッグ
 * - プレビューのズーム＆ページ送り (Fit Width / Fit Page / 倍率指定)
 * - 図面上の列車クリック連動＆注記ドラッグ移動 (1:1 SVG座標追従)
 * - 印刷/PDF出力時の全ページ展開＆完全1:1ベクター出力
 */

document.addEventListener("DOMContentLoaded", () => {
  // 1. 各モジュールのインスタンス化
  const dataModel = new BoxDiagramDataModel();
  window.dataModel = dataModel; // テスト・デバッグ用グローバル参照

  // 初期プリセットの読み込み (sakuragawa_main)
  dataModel.load(PRESET_SAKURAGAWA_MAIN);

  const editorContainer = document.getElementById("editorPane");
  const tableEditor = new BoxDiagramTableEditor(editorContainer, dataModel);
  const diagramRenderer = new BoxDiagramRenderer({ interactive: true });

  // DOM要素参照
  const btnNewDiagram = document.getElementById("btnNewDiagram");
  const presetSelect = document.getElementById("presetSelect");
  const optPresetCustom = document.getElementById("optPresetCustom");
  const welcomeSampleBar = document.getElementById("welcomeSampleBar");
  const btnWelcomeNewDiagram = document.getElementById("btnWelcomeNewDiagram");
  const btnWelcomeOpenFile = document.getElementById("btnWelcomeOpenFile");
  const btnDismissWelcomeBar = document.getElementById("btnDismissWelcomeBar");
  const btnUndo = document.getElementById("btnUndo");
  const btnRedo = document.getElementById("btnRedo");
  const btnExportJson = document.getElementById("btnExportJson");
  const inputFileOpen = document.getElementById("inputFileOpen");
  const btnPrint = document.getElementById("btnPrint");
  const btnExportMenu = document.getElementById("btnExportMenu");
  const btnMobileQuickExport = document.getElementById("btnMobileQuickExport");
  const exportMenuDropdown = document.getElementById("exportMenuDropdown");
  const btnExportPngCurrent = document.getElementById("btnExportPngCurrent");
  const btnExportPngAll = document.getElementById("btnExportPngAll");
  const btnExportSvg = document.getElementById("btnExportSvg");
  const btnExportPrintHtml = document.getElementById("btnExportPrintHtml");
  const btnToggleMobileHeaderMenu = document.getElementById("btnToggleMobileHeaderMenu");
  const headerActionsDrawer = document.getElementById("headerActionsDrawer");
  const btnToggleMobilePreviewTools = document.getElementById("btnToggleMobilePreviewTools");
  const mobileInAppHintBar = document.getElementById("mobileInAppHintBar");
  const btnDismissInAppHint = document.getElementById("btnDismissInAppHint");

  const trackAnalytics = (name, params = {}) => {
    if (window.BoxAnalytics && typeof window.BoxAnalytics.track === "function") {
      window.BoxAnalytics.track(name, params);
    }
  };
  const setAnalyticsContext = (ctx) => {
    if (window.BoxAnalytics && typeof window.BoxAnalytics.setNextActionContext === "function") {
      window.BoxAnalytics.setNextActionContext(ctx);
    }
  };

  const mobileWorkspaceNav = document.getElementById("mobileWorkspaceNav");
  const splitter = document.getElementById("workspaceSplitter");
  const previewViewport = document.getElementById("previewViewport");
  const btnAxisStation = document.getElementById("btnAxisStation");
  const btnAxisTime = document.getElementById("btnAxisTime");
  const btnToggleStationDir = document.getElementById("btnToggleStationDir");
  const selectQuickPageSize = document.getElementById("selectQuickPageSize");
  const btnQuickPortrait = document.getElementById("btnQuickPortrait");
  const btnQuickLandscape = document.getElementById("btnQuickLandscape");
  const quickCustomDimGroup = document.getElementById("quickCustomDimGroup");
  const inputQuickCustomW = document.getElementById("inputQuickCustomW");
  const inputQuickCustomH = document.getElementById("inputQuickCustomH");
  const quickPageSizeReadout = document.getElementById("quickPageSizeReadout");
  const quickPageModeBadge = document.getElementById("quickPageModeBadge");
  const layoutSuggestionBar = document.getElementById("layoutSuggestionBar");
  const btnPrevPage = document.getElementById("btnPrevPage");
  const btnNextPage = document.getElementById("btnNextPage");
  const pageIndicator = document.getElementById("pageIndicator");
  const checkShowAllPages = document.getElementById("checkShowAllPages");
  const selectZoom = document.getElementById("selectZoom");
  const optZoomCustom = document.getElementById("optZoomCustom");
  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomOut = document.getElementById("btnZoomOut");
  const dynamicPrintStyle = document.getElementById("dynamic-print-style");

  // モバイル表示切替 ("preview" | "editor") — 既定はプレビュー優先
  function setMobileView(view, fromUser = false) {
    const next = view === "editor" ? "editor" : "preview";
    const prev = document.body.dataset.mobileView;
    document.body.dataset.mobileView = next;
    if (mobileWorkspaceNav) {
      mobileWorkspaceNav.querySelectorAll("[data-mobile-view]").forEach(btn => {
        const active = btn.dataset.mobileView === next;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-pressed", String(active));
      });
    }
    if (fromUser && prev !== next) {
      trackAnalytics("mobile_view_switched", { view: next });
    }
    if (next === "preview") {
      requestAnimationFrame(() => renderPreview());
    }
  }
  setMobileView("preview", false);
  if (mobileWorkspaceNav) {
    mobileWorkspaceNav.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mobile-view]");
      if (!btn) return;
      setMobileView(btn.dataset.mobileView, true);
    });
  }

  function setMobileHeaderMenuOpen(open) {
    const isOpen = !!open;
    if (isOpen) {
      document.body.dataset.mobileMenu = "open";
    } else {
      delete document.body.dataset.mobileMenu;
    }
    if (btnToggleMobileHeaderMenu) {
      btnToggleMobileHeaderMenu.setAttribute("aria-expanded", String(isOpen));
      btnToggleMobileHeaderMenu.textContent = isOpen ? "閉じる ▴" : "メニュー ▾";
    }
  }

  function setMobilePreviewToolsOpen(open) {
    const isOpen = !!open;
    if (isOpen) {
      document.body.dataset.mobilePreviewTools = "open";
    } else {
      delete document.body.dataset.mobilePreviewTools;
    }
    if (btnToggleMobilePreviewTools) {
      btnToggleMobilePreviewTools.setAttribute("aria-expanded", String(isOpen));
      btnToggleMobilePreviewTools.textContent = isOpen ? "詳細 ▴" : "表示設定 ▾";
    }
    requestAnimationFrame(() => renderPreview());
  }

  if (btnToggleMobileHeaderMenu) {
    btnToggleMobileHeaderMenu.addEventListener("click", () => {
      const next = document.body.dataset.mobileMenu !== "open";
      setMobileHeaderMenuOpen(next);
      trackAnalytics("mobile_menu_toggled", { open: next });
    });
  }

  if (btnToggleMobilePreviewTools) {
    btnToggleMobilePreviewTools.addEventListener("click", () => {
      const next = document.body.dataset.mobilePreviewTools !== "open";
      setMobilePreviewToolsOpen(next);
      trackAnalytics("mobile_preview_tools_toggled", { open: next });
    });
  }

  // ローカル下書き自動保存・自動復元（localStorage + 大容量時のIndexedDBフォールバック）
  const DRAFT_STORAGE_KEY = "hakodiagram_draft_v1";
  const DRAFT_IDB_NAME = "hakodiagram_draft_db";
  const DRAFT_IDB_STORE = "drafts";
  let hasDirtyDraft = false;
  let draftSaveTimer = null;
  let currentSourceMode = "sample";
  let currentSourceLabel = "sakuragawa_main";

  function openDraftIdb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      const req = indexedDB.open(DRAFT_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DRAFT_IDB_STORE)) {
          db.createObjectStore(DRAFT_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IDB open failed"));
    });
  }

  async function saveDraftToIdb(payload) {
    const db = await openDraftIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFT_IDB_STORE, "readwrite");
      tx.objectStore(DRAFT_IDB_STORE).put(payload, DRAFT_STORAGE_KEY);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function loadDraftFromIdb() {
    const db = await openDraftIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DRAFT_IDB_STORE, "readonly");
      const req = tx.objectStore(DRAFT_IDB_STORE).get(DRAFT_STORAGE_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function clearIdbDraft() {
    try {
      const db = await openDraftIdb();
      const tx = db.transaction(DRAFT_IDB_STORE, "readwrite");
      tx.objectStore(DRAFT_IDB_STORE).delete(DRAFT_STORAGE_KEY);
      tx.oncomplete = () => db.close();
    } catch (_) { /* ignore */ }
  }

  function clearSavedDraft() {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    hasDirtyDraft = false;
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (_) { /* ignore */ }
    clearIdbDraft();
  }

  function formatDraftSourceLabel(data, mode, label) {
    const isPresetId = label === "sakuragawa_main" || label === "midorikawa_compact";
    if (mode === "custom" && label && !isPresetId) {
      return label;
    }
    const rawTitle = data && data.metadata && data.metadata.title ? String(data.metadata.title).trim() : "";
    const shortTitle = rawTitle ? (rawTitle.length > 24 ? `${rawTitle.slice(0, 24)}…` : rawTitle) : "";
    return shortTitle ? `下書き: ${shortTitle}` : "前回の作業下書き";
  }

  function buildDraftPayload() {
    const data = dataModel.getData();
    if (!data) return null;
    const draftLabel = formatDraftSourceLabel(data, currentSourceMode, currentSourceLabel);
    return {
      version: 1,
      savedAt: Date.now(),
      sourceMode: "custom",
      sourceLabel: draftLabel,
      activeTab: tableEditor ? tableEditor.activeTab : "tab-trains",
      activeRosterId: tableEditor ? tableEditor.activeRosterId : null,
      data
    };
  }

  function flushDraftSave() {
    if (draftSaveTimer) {
      clearTimeout(draftSaveTimer);
      draftSaveTimer = null;
    }
    if (!hasDirtyDraft) return;
    const payload = buildDraftPayload();
    if (!payload) return;
    try {
      const serialized = JSON.stringify(payload);
      localStorage.setItem(DRAFT_STORAGE_KEY, serialized);
    } catch (_) {
      // 容量超過時はIndexedDBへ退避し、localStorageにはポインタを残す
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
          version: 1,
          storage: "idb",
          savedAt: payload.savedAt,
          sourceMode: payload.sourceMode,
          sourceLabel: payload.sourceLabel
        }));
      } catch (__) { /* ignore */ }
      saveDraftToIdb(payload).catch(() => {});
    }
  }

  function scheduleDraftSave() {
    if (!hasDirtyDraft) return;
    if (draftSaveTimer) clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(() => {
      draftSaveTimer = null;
      flushDraftSave();
    }, 600);
  }

  function readSyncDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  // アプリ状態
  let currentPageIndex = 1;
  let totalPageCount = 1;
  let zoomMode = "fit-width"; // "fit-width" | "fit" | "manual"
  let currentZoom = 1.0;
  let appliedScale = 1.0;
  let hasStickyPreviewSettings = false;
  const dismissedSuggestionKeys = new Set();

  const PREVIEW_VIEW_SETTING_KEYS = [
    "xAxisMode",
    "stationAxisDirection",
    "pageSize",
    "orientation",
    "separatePageSettingsByAxisMode",
    "timeAxisPageSize",
    "timeAxisOrientation",
    "customPageWidthMm",
    "customPageHeightMm",
    "timeAxisCustomWidthMm",
    "timeAxisCustomHeightMm",
    "timeAxisStartHour",
    "timeAxisRangeMode",
    "timeAxisEndHour",
    "timeAxisGridMinutes",
    "timeAxisLateNightFormat",
    "timeAxisLabelDensity",
    "pageNumberEnabled",
    "pageNumberFormat",
    "pageNumberPosition",
    "pageNumberHideSingle",
    "timeDisplayFormat",
    "stationGridStyle",
    "showDepotOutCol",
    "showDepotInCol",
    "depotOutColHeaderText",
    "depotInColHeaderText",
    "depotDisplayScope",
    "depotTextFormat",
    "depotFilledPolicy",
    "depotFallbackToEndpoints",
    "depotOutColWidth",
    "depotInColWidth",
    "distanceDisplayMode",
    "distanceColHeaderText",
    "distanceExcludeDeadhead",
    "distanceDecimalPlaces",
    "distanceColWidth",
    "tableVerticalScale",
    "tableHorizontalScale",
    "rosterColWidth"
  ];

  function applyStickyPreviewSettings(targetData, excludeKeys = []) {
    if (!hasStickyPreviewSettings || !targetData || !dataModel.getData()) return targetData;
    const curSet = dataModel.getSettings() || {};
    const cloned = JSON.parse(JSON.stringify(targetData));
    cloned.settings = Object.assign({}, cloned.settings || {});
    const skip = new Set(excludeKeys);
    for (const k of PREVIEW_VIEW_SETTING_KEYS) {
      if (skip.has(k)) continue;
      if (curSet[k] !== undefined) {
        cloned.settings[k] = curSet[k];
      }
    }
    return cloned;
  }

  // 3. データ変更リスナー（プレビューの再描画 & Undo/Redo更新 & 自動保存）
  if (window.BoxAnalytics && typeof window.BoxAnalytics.attachModel === "function") {
    window.BoxAnalytics.attachModel(dataModel);
  }

  dataModel.subscribe((data, actionType) => {
    if (actionType === "load") {
      dismissedSuggestionKeys.clear();
    } else if (actionType === "settings-update") {
      hasStickyPreviewSettings = true;
    }
    if (actionType !== "load") {
      hasDirtyDraft = true;
      scheduleDraftSave();
    }
    updateHistoryButtons();
    renderPreview({ resetScroll: actionType === "load" });
  });

  window.addEventListener("pagehide", flushDraftSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDraftSave();
  });

  function updateHistoryButtons() {
    btnUndo.disabled = !dataModel.canUndo();
    btnRedo.disabled = !dataModel.canRedo();
  }

  let lastEffectivePrintCfg = null;
  let wasAllPagesBeforePrint = null;

  function updatePrintPageStyle(data, effectiveCfgArg = null) {
    const rawCfg = BoxDiagramDataModel.getEffectivePageConfig(data ? data.settings : {});
    if (effectiveCfgArg) {
      lastEffectivePrintCfg = effectiveCfgArg;
    }
    const cfg = effectiveCfgArg
      || (rawCfg.isAutoPageSize && lastEffectivePrintCfg && lastEffectivePrintCfg.isAutoPageSize ? lastEffectivePrintCfg : rawCfg);
    if (dynamicPrintStyle) {
      dynamicPrintStyle.textContent = `
        @page {
          size: ${cfg.cssPageSize};
          margin: 0;
        }
        @media print {
          @page {
            size: ${cfg.cssPageSize};
            margin: 0;
          }
        }
      `;
    }
  }

  function syncPreviewToolbarControls(data, effectiveCfgArg = null) {
    const cfg = effectiveCfgArg || BoxDiagramDataModel.getEffectivePageConfig(data ? data.settings : {});
    if (btnAxisStation) {
      btnAxisStation.classList.toggle("active", cfg.xAxisMode !== "time");
      btnAxisStation.setAttribute("aria-pressed", String(cfg.xAxisMode !== "time"));
    }
    if (btnAxisTime) {
      btnAxisTime.classList.toggle("active", cfg.xAxisMode === "time");
      btnAxisTime.setAttribute("aria-pressed", String(cfg.xAxisMode === "time"));
    }
    if (btnToggleStationDir) {
      const stationDir = (data && data.settings && data.settings.stationAxisDirection === "rtl") ? "rtl" : "ltr";
      btnToggleStationDir.hidden = cfg.xAxisMode === "time";
      btnToggleStationDir.classList.toggle("active", stationDir === "rtl");
      btnToggleStationDir.textContent = stationDir === "rtl" ? "左右: 右→左" : "左右: 左→右";
      btnToggleStationDir.setAttribute("aria-pressed", String(stationDir === "rtl"));
    }
    if (selectQuickPageSize) {
      selectQuickPageSize.value = cfg.pageSize;
      selectQuickPageSize.title = (cfg.isSeparateMode && cfg.xAxisMode === "time")
        ? "時刻軸モード専用の用紙サイズ（別設定中）"
        : "現在の表示モードに適用する用紙サイズ";
    }
    if (btnQuickPortrait) {
      btnQuickPortrait.disabled = !!cfg.isAutoPageSize;
      btnQuickPortrait.classList.toggle("active", !cfg.isLandscape);
      btnQuickPortrait.setAttribute("aria-pressed", String(!cfg.isLandscape));
      btnQuickPortrait.title = cfg.isAutoPageSize
        ? "変形(自動)ではデータ量に応じて縦横寸法を自動決定します"
        : "用紙を縦向きにする";
    }
    if (btnQuickLandscape) {
      btnQuickLandscape.disabled = !!cfg.isAutoPageSize;
      btnQuickLandscape.classList.toggle("active", cfg.isLandscape);
      btnQuickLandscape.setAttribute("aria-pressed", String(cfg.isLandscape));
      btnQuickLandscape.title = cfg.isAutoPageSize
        ? "変形(自動)ではデータ量に応じて縦横寸法を自動決定します"
        : "用紙を横向きにする";
    }
    if (quickCustomDimGroup) {
      quickCustomDimGroup.hidden = !cfg.isCustomPageSize;
      if (cfg.isCustomPageSize) {
        if (inputQuickCustomW && document.activeElement !== inputQuickCustomW) {
          inputQuickCustomW.value = cfg.widthMm;
        }
        if (inputQuickCustomH && document.activeElement !== inputQuickCustomH) {
          inputQuickCustomH.value = cfg.heightMm;
        }
      }
    }
    if (quickPageSizeReadout) {
      quickPageSizeReadout.hidden = !cfg.isAutoPageSize;
      if (cfg.isAutoPageSize) {
        quickPageSizeReadout.textContent = `${cfg.widthMm}×${cfg.heightMm}mm`;
      }
    }
    if (quickPageModeBadge) {
      quickPageModeBadge.hidden = !cfg.isSeparateMode;
    }
  }

  function updateLayoutSuggestionBar(data, diagnostics) {
    if (!layoutSuggestionBar) return;
    const sug = diagnostics && diagnostics.suggestion;
    if (!sug || dismissedSuggestionKeys.has(sug.key)) {
      layoutSuggestionBar.hidden = true;
      layoutSuggestionBar.innerHTML = "";
      return;
    }

    layoutSuggestionBar.innerHTML = "";

    const msgEl = document.createElement("div");
    msgEl.className = "layout-suggestion-msg";
    const iconSpan = document.createElement("span");
    iconSpan.className = "layout-suggestion-badge";
    iconSpan.textContent = "提案";
    const textSpan = document.createElement("span");
    textSpan.textContent = sug.message;
    msgEl.appendChild(iconSpan);
    msgEl.appendChild(textSpan);

    const actionsEl = document.createElement("div");
    actionsEl.className = "layout-suggestion-actions";
    (sug.actions || []).forEach((act, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = idx === 0 ? "btn btn-xs btn-primary" : "btn btn-xs btn-secondary";
      btn.dataset.suggestionAction = act.id || String(idx);
      btn.textContent = act.label;
      btn.addEventListener("click", () => {
        dataModel.updateSettings(act.patch || {});
        trackAnalytics("layout_suggestion_action", { action: "apply", suggestion_key: sug.key });
      });
      actionsEl.appendChild(btn);
    });

    const btnDismiss = document.createElement("button");
    btnDismiss.type = "button";
    btnDismiss.className = "btn btn-xs btn-secondary";
    btnDismiss.dataset.suggestionDismiss = sug.key;
    btnDismiss.textContent = "このまま";
    btnDismiss.title = "この提案を閉じる";
    btnDismiss.addEventListener("click", () => {
      dismissedSuggestionKeys.add(sug.key);
      trackAnalytics("layout_suggestion_action", { action: "dismiss", suggestion_key: sug.key });
      updateLayoutSuggestionBar(dataModel.getData(), diagramRenderer.getLastDiagnostics());
    });
    actionsEl.appendChild(btnDismiss);

    layoutSuggestionBar.appendChild(msgEl);
    layoutSuggestionBar.appendChild(actionsEl);
    layoutSuggestionBar.hidden = false;
  }

  function applyEffectivePagePatch(patch) {
    const cfg = BoxDiagramDataModel.getEffectivePageConfig(dataModel.getSettings());
    const mapped = {};
    const isSeparateTime = !!(cfg.isSeparateMode && cfg.xAxisMode === "time");

    if (patch.orientation && cfg.isCustomPageSize && !patch.pageSize) {
      const w = cfg.widthMm;
      const h = cfg.heightMm;
      const wantLandscape = patch.orientation === "landscape";
      const nextW = wantLandscape ? Math.max(w, h) : Math.min(w, h);
      const nextH = wantLandscape ? Math.min(w, h) : Math.max(w, h);
      if (isSeparateTime) {
        mapped.timeAxisCustomWidthMm = nextW;
        mapped.timeAxisCustomHeightMm = nextH;
        mapped.timeAxisOrientation = patch.orientation;
      } else {
        mapped.customPageWidthMm = nextW;
        mapped.customPageHeightMm = nextH;
        mapped.orientation = patch.orientation;
      }
      dataModel.updateSettings(mapped);
      return;
    }

    if (isSeparateTime) {
      if (patch.pageSize) mapped.timeAxisPageSize = patch.pageSize;
      if (patch.orientation) mapped.timeAxisOrientation = patch.orientation;
      if (patch.widthMm !== undefined) mapped.timeAxisCustomWidthMm = patch.widthMm;
      if (patch.heightMm !== undefined) mapped.timeAxisCustomHeightMm = patch.heightMm;
    } else {
      if (patch.pageSize) mapped.pageSize = patch.pageSize;
      if (patch.orientation) mapped.orientation = patch.orientation;
      if (patch.widthMm !== undefined) mapped.customPageWidthMm = patch.widthMm;
      if (patch.heightMm !== undefined) mapped.customPageHeightMm = patch.heightMm;
    }
    dataModel.updateSettings(mapped);
  }

  // 4. プレビュー描画処理
  function renderPreview(options = {}) {
    const data = dataModel.getData();
    if (!data) return;

    const prevScrollLeft = previewViewport.scrollLeft;
    const prevScrollTop = previewViewport.scrollTop;

    const renderedPages = diagramRenderer.renderPages(data);
    totalPageCount = renderedPages.length;
    const diag = diagramRenderer.getLastDiagnostics();
    const effectiveCfg = (renderedPages[0] && renderedPages[0].pageConfig)
      || (diag && diag.effectivePageConfig)
      || BoxDiagramDataModel.getEffectivePageConfig(data.settings);

    syncPreviewToolbarControls(data, effectiveCfg);
    updateLayoutSuggestionBar(data, diag);
    updatePrintPageStyle(data, effectiveCfg);

    if (currentPageIndex > totalPageCount) {
      currentPageIndex = totalPageCount;
    }
    if (currentPageIndex < 1) {
      currentPageIndex = 1;
    }
    window.currentPageIndex = currentPageIndex;

    // ページ送りボタンと表示の更新
    pageIndicator.textContent = `${currentPageIndex} / ${totalPageCount}`;
    btnPrevPage.disabled = currentPageIndex <= 1;
    btnNextPage.disabled = currentPageIndex >= totalPageCount;

    const showAll = checkShowAllPages.checked;
    previewViewport.innerHTML = "";

    // ページごとの実効用紙寸法計算 (AUTO / CUSTOM / A3..B6)
    const availW = Math.max(200, previewViewport.clientWidth - 48);
    const availH = Math.max(200, previewViewport.clientHeight - 48);

    // 描画対象ページを決定
    const pagesToDraw = showAll ? renderedPages : renderedPages.filter(p => p.pageIndex === currentPageIndex);

    pagesToDraw.forEach(page => {
      const pageCfg = page.pageConfig || effectiveCfg;
      const baseW = pageCfg.baseW;
      const baseH = pageCfg.baseH;

      let pageScale;
      if (zoomMode === "fit-width") {
        pageScale = availW / baseW;
      } else if (zoomMode === "fit") {
        const scaleW = availW / baseW;
        const scaleH = availH / baseH;
        pageScale = Math.min(scaleW, scaleH);
      } else {
        pageScale = currentZoom;
      }
      pageScale = Math.max(0.15, Math.min(2.5, pageScale));
      appliedScale = pageScale;

      const wrapperEl = document.createElement("div");
      wrapperEl.className = "preview-page-wrapper";
      wrapperEl.style.width = `${Math.round(baseW * pageScale)}px`;
      wrapperEl.style.height = `${Math.round(baseH * pageScale)}px`;

      const sheetEl = document.createElement("div");
      sheetEl.className = "preview-page-sheet";
      sheetEl.dataset.pageIndex = page.pageIndex;
      sheetEl.style.width = `${baseW}px`;
      sheetEl.style.height = `${baseH}px`;
      sheetEl.style.transform = `scale(${pageScale})`;
      sheetEl.style.transformOrigin = "top left";

      sheetEl.innerHTML = page.svgHtml;
      wrapperEl.appendChild(sheetEl);
      previewViewport.appendChild(wrapperEl);

      // SVG内の対話イベントを設定
      bindSvgInteractions(sheetEl.querySelector("svg"), page.pageIndex, page.pageConfig);
    });

    // 再描画時の意図しないスクロールリセット（Page 1先頭への飛び）を防止
    if (options && options.resetScroll) {
      previewViewport.scrollLeft = 0;
      previewViewport.scrollTop = 0;
    } else {
      previewViewport.scrollLeft = prevScrollLeft;
      previewViewport.scrollTop = prevScrollTop;
    }
  }

  // 5. SVG上のインタラクション（列車クリック連動・注記ドラッグ＆Alt吸着）
  function bindSvgInteractions(svgEl, pageIdx, pageCfg = null) {
    if (!svgEl) return;

    // 列車線クリック -> 該当行を選択
    svgEl.querySelectorAll(".train-line-group").forEach(group => {
      group.addEventListener("mousedown", (e) => {
        if (e.button === 0) {
          // エディタ側inputへのblur->change->renderPreview()でクリック対象SVGが破棄されるのを防ぐ
          e.preventDefault();
        }
      });
      group.addEventListener("click", (e) => {
        e.stopPropagation();
        if (
          document.activeElement &&
          editorContainer &&
          editorContainer.contains(document.activeElement) &&
          typeof document.activeElement.blur === "function"
        ) {
          document.activeElement.blur();
        }
        const rosterId = group.dataset.rosterId;
        const trainIdx = parseInt(group.dataset.trainIndex, 10);

        diagramRenderer.setSelection(rosterId, trainIdx);
        tableEditor.setActiveRoster(rosterId);
        tableEditor.setActiveTab("tab-trains");
        if (window.innerWidth <= 900) {
          setMobileView("editor", false);
        }
        trackAnalytics("diagram_train_clicked", { axis_mode: (dataModel.getSettings().xAxisMode === "time" ? "time" : "station") });

        // 該当行へスクロール & ハイライト
        setTimeout(() => {
          const row = editorContainer.querySelector(`tr[data-train-idx="${trainIdx}"]`);
          if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            row.classList.remove("row-jump-flash");
            void row.offsetWidth;
            row.classList.add("row-jump-flash");
            row.style.outline = "2px solid var(--primary)";
            setTimeout(() => {
              row.style.outline = "";
              row.classList.remove("row-jump-flash");
            }, 1500);
          }
        }, 50);

        renderPreview();
      });
    });

    // ページ内の列車線幾何情報を収集（吸着計算用）
    function getTrainLineGeometries() {
      return Array.from(svgEl.querySelectorAll(".train-line-group")).map(group => {
        const lineEl = group.querySelector("line:not([stroke-opacity])") || group.querySelector("line");
        if (!lineEl) return null;
        const x1 = parseFloat(lineEl.getAttribute("x1"));
        const x2 = parseFloat(lineEl.getAttribute("x2"));
        const yCenter = parseFloat(lineEl.getAttribute("y1"));
        const yTop = yCenter - 0.64;
        return {
          minX: Math.min(x1, x2),
          maxX: Math.max(x1, x2),
          yTop: yTop,
          yAbove: Math.round((yTop - 1.76) * 100) / 100,   // 標準文字上段ベースライン (元PDF・Excel準拠)
          yBelow: Math.round((yTop + 11.20) * 100) / 100,  // 標準文字下段ベースライン (列車線下側)
          rosterId: group.dataset.rosterId,
          trainIdx: group.dataset.trainIndex
        };
      }).filter(Boolean);
    }

    // 吸着ガイドのSVG描画更新
    function updateSnapGuide(snapInfo) {
      let guideGroup = svgEl.querySelector("#snapGuideOverlay");
      if (!snapInfo || !snapInfo.isSnapped) {
        if (guideGroup) guideGroup.remove();
        return;
      }
      if (!guideGroup) {
        guideGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        guideGroup.id = "snapGuideOverlay";
        guideGroup.style.pointerEvents = "none";
        svgEl.appendChild(guideGroup);
      }

      const line = snapInfo.targetLine;
      const snapY = snapInfo.y;
      const snapX = snapInfo.x;
      const guideX = snapInfo.snapXGuide;
      const verticalGuideHtml = Number.isFinite(guideX)
        ? `<line x1="${guideX.toFixed(2)}" y1="${(snapY - 14).toFixed(2)}" x2="${guideX.toFixed(2)}" y2="${(snapY + 14).toFixed(2)}" stroke="#2F6F73" stroke-width="1.2" stroke-dasharray="3,2" />`
        : "";
      const markerX = (snapInfo.snapXAlign === "right" && Number.isFinite(snapInfo.noteW))
        ? (snapX + snapInfo.noteW)
        : snapX;

      guideGroup.innerHTML = `
        <!-- 列車線の強調ハイライト -->
        <line x1="${line.minX.toFixed(2)}" y1="${(line.yTop + 0.64).toFixed(2)}" x2="${line.maxX.toFixed(2)}" y2="${(line.yTop + 0.64).toFixed(2)}" stroke="#2F6F73" stroke-width="3.5" stroke-opacity="0.45" />
        <!-- 吸着ターゲット基準線 (文字配置ベースライン) -->
        <line x1="${(line.minX - 10).toFixed(2)}" y1="${snapY.toFixed(2)}" x2="${(line.maxX + 10).toFixed(2)}" y2="${snapY.toFixed(2)}" stroke="#2F6F73" stroke-width="1.2" stroke-dasharray="4,3" />
        ${verticalGuideHtml}
        <!-- 吸着点インジケータ -->
        <circle cx="${markerX.toFixed(2)}" cy="${snapY.toFixed(2)}" r="3" fill="#2F6F73" stroke="#FFFFFF" stroke-width="1" />
      `;
    }

    function isAltEvent(ev) {
      if (!ev) return false;
      return !!(ev.altKey || (typeof ev.getModifierState === "function" && ev.getModifierState("AltGraph")));
    }

    // 注記テキストのドラッグ移動 (1:1 SVG座標追従 & Altキー吸着)
    svgEl.querySelectorAll(".diagram-note").forEach(noteGroup => {
      noteGroup.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();

        const noteId = noteGroup.dataset.noteId;
        const notes = dataModel.getNotes();
        const noteObj = notes.find(n => n.id === noteId);
        if (!noteObj) return;

        const curData = dataModel.getData();
        const pageGeom = diagramRenderer.getPageGeometry(curData, pageCfg);
        const vb = (svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.width > 0)
          ? svgEl.viewBox.baseVal
          : { width: pageGeom.W, height: pageGeom.H };
        const svgW = vb.width || pageGeom.W;
        const svgH = vb.height || pageGeom.H;

        const MIN_X = pageGeom.tableLeft;
        const MAX_X = pageGeom.tableRight;
        const MIN_Y = pageGeom.headerTop;
        const MAX_Y = Math.max(MIN_Y + 40.0, svgH - 25.0);

        const initialRect = svgEl.getBoundingClientRect();
        function clientToSvg(clientX, clientY) {
          const liveRect = svgEl.getBoundingClientRect();
          const r = (liveRect && liveRect.width > 0 && liveRect.height > 0) ? liveRect : initialRect;
          return {
            x: (clientX - r.left) * (svgW / r.width),
            y: (clientY - r.top) * (svgH / r.height)
          };
        }

        const startX = Number.isFinite(noteObj.x) ? noteObj.x : 202.40;
        const startY = Number.isFinite(noteObj.y) ? noteObj.y : 340.48;

        let noteW = 60.0;
        let textCenterOffsetY = -4.5;
        try {
          const bb = noteGroup.getBBox();
          if (bb && bb.width > 0) noteW = bb.width;
          if (bb && bb.height > 0) {
            textCenterOffsetY = bb.y + bb.height / 2;
          }
        } catch (_) { /* SVG未接続時は既定値を使用 */ }

        let anchorNoteX = startX;
        let anchorNoteY = startY;
        let anchorMouseSvg = clientToSvg(e.clientX, e.clientY);
        let curX = startX;
        let curY = startY;

        const trainLines = getTrainLineGeometries();
        let stationXs = [];
        if (pageGeom.xAxisMode === "time") {
          const tRange = diagramRenderer.computeTimeAxisRange(curData);
          const spanMin = Math.max(60, tRange.endMin - tRange.startMin);
          const plotW = Math.max(100, pageGeom.timePlotRight - pageGeom.timePlotLeft);
          for (let m = tRange.startMin; m <= tRange.endMin; m += 30) {
            stationXs.push(Math.round((pageGeom.timePlotLeft + ((m - tRange.startMin) / spanMin) * plotW) * 100) / 100);
          }
        } else {
          stationXs = dataModel.getVisibleStations().map(s => diagramRenderer.mapStationXToCanvas(s.x, pageGeom));
        }

        let lastClientX = e.clientX;
        let lastClientY = e.clientY;
        let isAltPressed = isAltEvent(e);
        let committed = false;

        function reanchorAtCurrent(clientX, clientY) {
          anchorNoteX = curX;
          anchorNoteY = curY;
          anchorMouseSvg = clientToSvg(clientX, clientY);
        }

        function handleAltRelease(clientX, clientY) {
          reanchorAtCurrent(clientX, clientY);
          updateSnapGuide(null);
        }

        let finalSnapInfo = null;
        function computePosition(clientX, clientY, altActive) {
          const curMouseSvg = clientToSvg(clientX, clientY);
          const dx = curMouseSvg.x - anchorMouseSvg.x;
          const dy = curMouseSvg.y - anchorMouseSvg.y;

          const unclampedX = anchorNoteX + dx;
          const unclampedY = anchorNoteY + dy;

          // 生の移動後座標 (0.16px刻み)
          const rawX = Math.max(MIN_X, Math.min(MAX_X, Math.round(unclampedX / 0.16) * 0.16));
          const rawY = Math.max(MIN_Y, Math.min(MAX_Y, Math.round(unclampedY / 0.16) * 0.16));

          // クランプ境界を超えた分は即座に戻せるよう境界で再アンカー
          if (unclampedX < MIN_X || unclampedX > MAX_X) {
            anchorNoteX = rawX;
            anchorMouseSvg.x = curMouseSvg.x;
          }
          if (unclampedY < MIN_Y || unclampedY > MAX_Y) {
            anchorNoteY = rawY;
            anchorMouseSvg.y = curMouseSvg.y;
          }

          let snapInfo = null;

          // Altキー押下時: 列車線の上側・下側＆左端・右端・中央への吸着処理
          if (altActive) {
            const SNAP_THRESHOLD_Y = 36.0;
            const NOTE_X_MARGIN = 30.0;
            const noteCenterY = rawY + textCenterOffsetY;

            let minDiffY = Infinity;
            let bestLine = null;
            let bestYTarget = null;
            let bestSide = null;

            for (const line of trainLines) {
              // テキスト範囲 [rawX, rawX + noteW] と列車線範囲が水平方向に重なるか
              const overlapsX = (rawX + noteW >= line.minX - NOTE_X_MARGIN) && (rawX <= line.maxX + NOTE_X_MARGIN);
              if (!overlapsX) continue;

              const aboveDiff = Math.abs(noteCenterY - (line.yAbove + textCenterOffsetY));
              const belowDiff = Math.abs(noteCenterY - (line.yBelow + textCenterOffsetY));
              const sideDiff = (aboveDiff <= belowDiff) ? aboveDiff : belowDiff;
              const sideTarget = (aboveDiff <= belowDiff) ? line.yAbove : line.yBelow;
              const sideName = (aboveDiff <= belowDiff) ? "above" : "below";

              if (sideDiff < minDiffY && sideDiff <= SNAP_THRESHOLD_Y) {
                minDiffY = sideDiff;
                bestLine = line;
                bestYTarget = sideTarget;
                bestSide = sideName;
              }
            }

            if (bestLine) {
              let snappedX = rawX;
              const snappedY = bestYTarget;
              let snapXGuide = null;
              let snapXAlign = "free";

              // X軸候補: 左端揃え・右端揃え・中央揃え (閾値 14.0px)
              const SNAP_THRESHOLD_X = 14.0;
              const round2 = (v) => Math.round(v * 100) / 100;
              const xCandidates = [
                { x: round2(bestLine.minX + 2.08), guideX: bestLine.minX, align: "left" },
                { x: round2(bestLine.maxX - 2.08 - noteW), guideX: bestLine.maxX, align: "right" },
                { x: round2((bestLine.minX + bestLine.maxX) / 2 - noteW / 2), guideX: (bestLine.minX + bestLine.maxX) / 2, align: "center" }
              ];

              for (const stX of stationXs) {
                if (stX >= bestLine.minX - 5 && stX <= bestLine.maxX + 5) {
                  if (stX < bestLine.maxX - 5) {
                    xCandidates.push({ x: round2(stX + 2.08), guideX: stX, align: "left" });
                  }
                  if (stX > bestLine.minX + 5) {
                    xCandidates.push({ x: round2(stX - 2.08 - noteW), guideX: stX, align: "right" });
                  }
                }
              }

              let minDiffX = Infinity;
              let bestCand = null;
              for (const cand of xCandidates) {
                if (cand.x < MIN_X || cand.x > MAX_X) continue;
                const diffX = Math.abs(rawX - cand.x);
                if (diffX < minDiffX && diffX <= SNAP_THRESHOLD_X) {
                  minDiffX = diffX;
                  bestCand = cand;
                }
              }

              if (bestCand !== null) {
                snappedX = bestCand.x;
                snapXGuide = bestCand.guideX;
                snapXAlign = bestCand.align;
              }

              snapInfo = {
                x: snappedX,
                y: snappedY,
                isSnapped: true,
                targetLine: bestLine,
                side: bestSide,
                snapXGuide: snapXGuide,
                snapXAlign: snapXAlign,
                noteW: noteW
              };
            }
          }

          updateSnapGuide(snapInfo);
          finalSnapInfo = snapInfo;

          curX = parseFloat(((snapInfo && snapInfo.isSnapped) ? snapInfo.x : rawX).toFixed(2));
          curY = parseFloat(((snapInfo && snapInfo.isSnapped) ? snapInfo.y : rawY).toFixed(2));

          noteGroup.setAttribute("transform", `translate(${curX.toFixed(2)}, ${curY.toFixed(2)})`);
          noteObj.x = curX;
          noteObj.y = curY;

          // 注記タブのセル入力値もリアルタイム追従更新
          const inpX = editorContainer.querySelector(`tr[data-note-id="${noteId}"] input[data-note-field="x"]`);
          const inpY = editorContainer.querySelector(`tr[data-note-id="${noteId}"] input[data-note-field="y"]`);
          if (inpX) inpX.value = curX.toFixed(2);
          if (inpY) inpY.value = curY.toFixed(2);
        }

        function onMouseMove(ev) {
          lastClientX = ev.clientX;
          lastClientY = ev.clientY;
          const nextAlt = isAltEvent(ev);
          if (isAltPressed && !nextAlt) {
            handleAltRelease(lastClientX, lastClientY);
          }
          isAltPressed = nextAlt;
          computePosition(lastClientX, lastClientY, isAltPressed);
        }

        function onViewportScroll() {
          computePosition(lastClientX, lastClientY, isAltPressed);
        }

        function onKeyDown(ke) {
          if (ke.key === "Alt" || ke.key === "AltGraph") {
            ke.preventDefault();
            if (!isAltPressed) {
              isAltPressed = true;
              computePosition(lastClientX, lastClientY, true);
            }
          }
        }

        function onKeyUp(ke) {
          if (ke.key === "Alt" || ke.key === "AltGraph") {
            ke.preventDefault();
            if (isAltPressed) {
              isAltPressed = false;
              handleAltRelease(lastClientX, lastClientY);
            }
          }
        }

        function finishDrag() {
          if (committed) return;
          committed = true;

          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
          window.removeEventListener("keydown", onKeyDown);
          window.removeEventListener("keyup", onKeyUp);
          window.removeEventListener("blur", finishDrag);
          previewViewport.removeEventListener("scroll", onViewportScroll);
          updateSnapGuide(null);

          // ドロップ時にAltがまだ押されていた場合、直後のAlt解放によるブラウザメニュー起動を抑止
          if (isAltPressed) {
            const swallowPostDragAltKeyUp = (ke) => {
              if (ke.key === "Alt" || ke.key === "AltGraph") {
                ke.preventDefault();
              }
              window.removeEventListener("keyup", swallowPostDragAltKeyUp, true);
            };
            window.addEventListener("keyup", swallowPostDragAltKeyUp, { capture: true, once: true });
            setTimeout(() => window.removeEventListener("keyup", swallowPostDragAltKeyUp, true), 2000);
          }

          // Undo履歴へ移動前の元座標が記録されるよう一旦復元してから確定更新する
          noteObj.x = startX;
          noteObj.y = startY;
          if (curX !== startX || curY !== startY) {
            setAnalyticsContext({ via: "diagram_drag" });
            dataModel.updateNote(noteId, { x: curX, y: curY });
            trackAnalytics("note_drag_completed", {
              snapped: !!(finalSnapInfo && finalSnapInfo.isSnapped),
              snap_align: (finalSnapInfo && finalSnapInfo.snapXAlign) || "none",
              axis_mode: (pageGeom && pageGeom.xAxisMode === "time") ? "time" : "station"
            });
          }
        }

        function onMouseUp() {
          finishDrag();
        }

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", finishDrag);
        previewViewport.addEventListener("scroll", onViewportScroll);
      });
    });
  }

  // 6. スプリッター幅変更ドラッグ
  let isDraggingSplitter = false;
  splitter.addEventListener("mousedown", (e) => {
    isDraggingSplitter = true;
    splitter.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDraggingSplitter) return;
    const newWidth = e.clientX;
    if (newWidth >= 460 && newWidth <= 950) {
      editorContainer.style.width = `${newWidth}px`;
    }
  });

  window.addEventListener("mouseup", () => {
    if (isDraggingSplitter) {
      isDraggingSplitter = false;
      splitter.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (zoomMode === "fit" || zoomMode === "fit-width") {
        renderPreview();
      }
    }
  });

  // 7. ツールバーアクション
  // プリセット切り替え / サンプル案内バナー状態
  let isWelcomeDismissed = false;
  let isSampleMode = true;

  function updateDocumentSourceUI(mode, customLabel = "") {
    currentSourceMode = mode === "sample" ? "sample" : "custom";
    currentSourceLabel = customLabel || (currentSourceMode === "sample" ? "sakuragawa_main" : "作成中データ");
    if (mode === "sample") {
      isSampleMode = true;
      if (optPresetCustom) optPresetCustom.hidden = true;
      if (presetSelect && (customLabel || presetSelect.value === "__custom__")) {
        presetSelect.value = customLabel || "sakuragawa_main";
      }
      if (welcomeSampleBar) welcomeSampleBar.hidden = isWelcomeDismissed;
    } else {
      isSampleMode = false;
      if (optPresetCustom) {
        optPresetCustom.textContent = customLabel || "作成中データ";
        optPresetCustom.hidden = false;
      }
      if (presetSelect) presetSelect.value = "__custom__";
      if (welcomeSampleBar) welcomeSampleBar.hidden = true;
    }
  }

  const PRESET_MAP = {
    sakuragawa_main: PRESET_SAKURAGAWA_MAIN,
    midorikawa_compact: PRESET_MIDORIKAWA_COMPACT
  };

  presetSelect.addEventListener("change", (e) => {
    const rawPreset = PRESET_MAP[e.target.value];
    if (!rawPreset) return;
    const prepared = applyStickyPreviewSettings(rawPreset);
    clearSavedDraft();
    updateDocumentSourceUI("sample", e.target.value);
    dataModel.load(prepared);
    tableEditor.setActiveRoster(null);
    setMobileHeaderMenuOpen(false);
    trackAnalytics("preset_selected", { preset_id: e.target.value });
  });

  if (btnDismissWelcomeBar) {
    btnDismissWelcomeBar.addEventListener("click", () => {
      isWelcomeDismissed = true;
      if (welcomeSampleBar) welcomeSampleBar.hidden = true;
      trackAnalytics("welcome_bar_action", { action: "dismiss" });
    });
  }
  if (btnWelcomeOpenFile && inputFileOpen) {
    btnWelcomeOpenFile.addEventListener("click", () => {
      trackAnalytics("welcome_bar_action", { action: "open_file" });
      inputFileOpen.click();
    });
  }

  // Undo / Redo
  btnUndo.addEventListener("click", () => {
    setAnalyticsContext({ action: "undo", via: "button" });
    dataModel.undo();
  });

  btnRedo.addEventListener("click", () => {
    setAnalyticsContext({ action: "redo", via: "button" });
    dataModel.redo();
  });

  // キーボードショートカット
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (e.shiftKey) {
        setAnalyticsContext({ action: "redo", via: "shortcut" });
        dataModel.redo();
      } else {
        setAnalyticsContext({ action: "undo", via: "shortcut" });
        dataModel.undo();
      }
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      setAnalyticsContext({ action: "redo", via: "shortcut" });
      dataModel.redo();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      preparePrintAndTrigger("shortcut");
      e.preventDefault();
    }
  });

  // JSON エクスポート
  btnExportJson.addEventListener("click", () => {
    const jsonStr = dataModel.toJSON(true);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const meta = dataModel.getMetadata();
    const curData = dataModel.getData();
    const rosters = (curData && curData.rosters) || [];
    const trainsCount = rosters.reduce((s, r) => s + ((r && r.trains) ? r.trains.length : 0), 0);
    const fileName = `${meta.title || "hakodiagram"}_${new Date().toISOString().split("T")[0]}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMobileHeaderMenuOpen(false);
    showAppToast("JSONファイルを保存しました");
    trackAnalytics("json_exported", {
      rosters_count: rosters.length,
      trains_count: trainsCount,
      stations_count: ((curData && curData.stations) || []).length,
      axis_mode: (curData && curData.settings && curData.settings.xAxisMode === "time") ? "time" : "station"
    });
  });

  // 統合ファイルインポート (JSON / .oud / .oud2 自動判別)
  function openOudBuffer(buffer, fileName) {
    oudState.buffer = buffer;
    oudState.fileName = fileName;
    if (oudSelectEncoding) oudSelectEncoding.value = "auto";
    reparseOudDocument();
    openOudImportModal();
  }

  if (inputFileOpen) {
    inputFileOpen.addEventListener("click", () => {
      trackAnalytics("file_import_started", { source: document.body.dataset.mobileMenu === "open" ? "mobile_menu" : "header" });
    });
    inputFileOpen.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      setMobileHeaderMenuOpen(false);
      try {
        const lowerName = (file.name || "").toLowerCase();
        const isOudExt = lowerName.endsWith(".oud") || lowerName.endsWith(".oud2");
        if (isOudExt) {
          openOudBuffer(await file.arrayBuffer(), file.name);
        } else {
          const text = (await file.text()).replace(/^\uFEFF/, "").trim();
          if (text.startsWith("{") || text.startsWith("[") || lowerName.endsWith(".json")) {
            const parsed = JSON.parse(text);
            const val = dataModel.validateSchema(parsed);
            if (!val.valid) {
              trackAnalytics("json_imported", { success: false });
              alert(`インポート失敗:\n${val.errors.join("\n")}`);
              return;
            }
            hasStickyPreviewSettings = false;
            dataModel.load(parsed);
            tableEditor.setActiveRoster(null);
            const loadedTitle = (parsed.metadata && parsed.metadata.title) ? parsed.metadata.title : file.name;
            updateDocumentSourceUI("custom", `読込: ${loadedTitle}`);
            hasDirtyDraft = true;
            flushDraftSave();
            const norm = dataModel.getData();
            const rList = (norm && norm.rosters) || [];
            trackAnalytics("json_imported", {
              success: true,
              rosters_count: rList.length,
              trains_count: rList.reduce((acc, r) => acc + ((r && r.trains) ? r.trains.length : 0), 0),
              stations_count: ((norm && norm.stations) || []).length,
              axis_mode: (norm && norm.settings && norm.settings.xAxisMode === "time") ? "time" : "station"
            });
            alert(`JSONファイル「${file.name}」を読み込みました。`);
          } else {
            openOudBuffer(await file.arrayBuffer(), file.name);
          }
        }
      } catch (err) {
        trackAnalytics("file_import_error", { error_kind: "parse_error" });
        alert(`ファイル解析エラー:\n${err.message}`);
      } finally {
        inputFileOpen.value = "";
      }
    });
  }

  // OuDia (.oud) / OuDiaSecond (.oud2) インポート制御
  const oudImportModalBackdrop = document.getElementById("oudImportModalBackdrop");
  const btnCloseOudImport = document.getElementById("btnCloseOudImport");
  const btnCancelOudImport = document.getElementById("btnCancelOudImport");
  const btnExecuteOudImport = document.getElementById("btnExecuteOudImport");
  const oudImportSubtitle = document.getElementById("oudImportSubtitle");
  const oudSelectDiagram = document.getElementById("oudSelectDiagram");
  const oudSelectEncoding = document.getElementById("oudSelectEncoding");
  const oudSelectFallback = document.getElementById("oudSelectFallback");
  const oudCheckExcludeCanceled = document.getElementById("oudCheckExcludeCanceled");
  const oudCheckSameRow = document.getElementById("oudCheckSameRow");
  const oudImportSummary = document.getElementById("oudImportSummary");
  const oudImportWarnings = document.getElementById("oudImportWarnings");
  const oudStationChecklist = document.getElementById("oudStationChecklist");
  const btnOudVisRecommended = document.getElementById("btnOudVisRecommended");
  const btnOudVisMajor = document.getElementById("btnOudVisMajor");
  const btnOudVisEndpoints = document.getElementById("btnOudVisEndpoints");
  const btnOudVisAll = document.getElementById("btnOudVisAll");

  const oudState = {
    buffer: null,
    fileName: "",
    parsedDoc: null,
    selectedVisibleIds: null,
    lastResult: null
  };

  function closeOudImportModal() {
    if (!oudImportModalBackdrop) return;
    oudImportModalBackdrop.hidden = true;
  }

  function openOudImportModal() {
    if (!oudImportModalBackdrop) return;
    closeHelpModal();
    closeFeedbackModal();
    closeNewDiagramModal();
    closeTermsModal();
    closeImageExportModal();
    closeExportMenu();
    oudImportModalBackdrop.hidden = false;
    const ext = (oudState.fileName || "").toLowerCase().endsWith(".oud2") ? "oud2" : "oud";
    trackAnalytics("oud_modal_opened", {
      file_ext: ext,
      diagrams_count: oudState.parsedDoc ? oudState.parsedDoc.diagrams.length : 0,
      total_stations: oudState.parsedDoc ? oudState.parsedDoc.stations.length : 0,
      has_op_tables: !!(oudState.lastResult && oudState.lastResult.stats && oudState.lastResult.stats.operationTablesCount > 0)
    });
  }

  function reparseOudDocument() {
    if (!oudState.buffer) return;
    const enc = oudSelectEncoding ? oudSelectEncoding.value : "auto";
    const parsedDoc = OudParser.parseDocument(oudState.buffer, enc, oudState.fileName);
    oudState.parsedDoc = parsedDoc;

    if (oudSelectDiagram) {
      const prevIdx = parseInt(oudSelectDiagram.value, 10);
      oudSelectDiagram.innerHTML = "";
      parsedDoc.diagrams.forEach((d, idx) => {
        const opt = document.createElement("option");
        opt.value = String(idx);
        const otLabel = d.operationTables.length > 0 ? ` / 運用${d.operationTables.length}` : "";
        opt.textContent = `${d.name} (下り${d.kudari.length} / 上り${d.nobori.length}${otLabel})`;
        oudSelectDiagram.appendChild(opt);
      });
      if (!Number.isNaN(prevIdx) && prevIdx >= 0 && prevIdx < parsedDoc.diagrams.length) {
        oudSelectDiagram.value = String(prevIdx);
      }
    }

    oudState.selectedVisibleIds = null;
    refreshOudPreview();
  }

  function refreshOudPreview() {
    if (!oudState.parsedDoc) return;
    const diaIdx = oudSelectDiagram ? parseInt(oudSelectDiagram.value, 10) || 0 : 0;
    const opts = {
      diagramIndex: diaIdx,
      excludeCanceled: oudCheckExcludeCanceled ? oudCheckExcludeCanceled.checked : true,
      fallbackMode: oudSelectFallback ? oudSelectFallback.value : "direction",
      propertySameStepRows: oudCheckSameRow && !oudCheckSameRow.checked ? 1 : 0,
      visibleStationIds: oudState.selectedVisibleIds ? Array.from(oudState.selectedVisibleIds) : null
    };

    const result = OudParser.convertToBoxDiagram(oudState.parsedDoc, opts);
    oudState.lastResult = result;
    if (!oudState.selectedVisibleIds) {
      oudState.selectedVisibleIds = new Set(result.recommendedVisibleIds);
    }

    if (oudImportSubtitle) {
      const encText = oudState.parsedDoc.encoding === "shift_jis" ? "Shift_JIS" : "UTF-8";
      oudImportSubtitle.textContent = `${oudState.fileName} ／ ${oudState.parsedDoc.fileType} ／ ${oudState.parsedDoc.rosenName} ／ 文字コード: ${encText}`;
    }

    if (oudImportSummary) {
      const st = result.stats;
      oudImportSummary.innerHTML = "";
      const metrics = [
        { label: "表示駅 / 全駅", value: `${st.visibleStationsCount} / ${st.totalStations}` },
        { label: "列車種別", value: `${st.trainTypesCount} 種` },
        { label: "抽出運用数", value: `${st.rostersCount} 運用` },
        { label: "抽出列車数", value: `${st.trainsCount} 本` }
      ];
      metrics.forEach(m => {
        const item = document.createElement("div");
        item.className = "oud-summary-item";
        const lbl = document.createElement("span");
        lbl.className = "oud-summary-label";
        lbl.textContent = m.label;
        const val = document.createElement("span");
        val.className = "oud-summary-value";
        val.textContent = m.value;
        item.appendChild(lbl);
        item.appendChild(val);
        oudImportSummary.appendChild(item);
      });
      const wide = document.createElement("div");
      wide.className = "oud-summary-item oud-summary-wide";
      const wideLbl = document.createElement("span");
      wideLbl.className = "oud-summary-label";
      wideLbl.textContent = "運用解析モード";
      const wideVal = document.createElement("span");
      wideVal.className = "oud-summary-source";
      wideVal.textContent = st.operationSource;
      wide.appendChild(wideLbl);
      wide.appendChild(wideVal);
      oudImportSummary.appendChild(wide);
    }

    if (oudImportWarnings) {
      oudImportWarnings.innerHTML = "";
      if (result.warnings.length > 0) {
        result.warnings.forEach(w => {
          const li = document.createElement("li");
          li.textContent = w;
          oudImportWarnings.appendChild(li);
        });
        oudImportWarnings.hidden = false;
      } else {
        oudImportWarnings.hidden = true;
      }
    }

    if (oudStationChecklist) {
      const endpointSet = new Set(result.usedEndpointIds);
      oudStationChecklist.innerHTML = "";
      oudState.parsedDoc.stations.forEach(st => {
        const label = document.createElement("label");
        label.className = "oud-station-item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = oudState.selectedVisibleIds.has(st.id);
        cb.addEventListener("change", () => {
          if (cb.checked) {
            oudState.selectedVisibleIds.add(st.id);
          } else {
            if (oudState.selectedVisibleIds.size <= 2) {
              cb.checked = true;
              return;
            }
            oudState.selectedVisibleIds.delete(st.id);
          }
          refreshOudPreview();
        });
        const nameSpan = document.createElement("span");
        nameSpan.className = "oud-station-name";
        nameSpan.textContent = st.name;
        nameSpan.title = st.name;

        label.appendChild(cb);
        label.appendChild(nameSpan);

        if (st.isMajor) {
          const tag = document.createElement("span");
          tag.className = "oud-tag oud-tag-major";
          tag.textContent = "主要";
          label.appendChild(tag);
        }
        if (endpointSet.has(st.id)) {
          const tag = document.createElement("span");
          tag.className = "oud-tag oud-tag-end";
          tag.textContent = "始終";
          label.appendChild(tag);
        }

        oudStationChecklist.appendChild(label);
      });
    }
  }

  function applyStationPreset(mode) {
    if (!oudState.parsedDoc || !oudState.lastResult) return;
    const allStations = oudState.parsedDoc.stations;
    let nextIds = [];
    if (mode === "recommended") {
      nextIds = oudState.lastResult.recommendedVisibleIds;
    } else if (mode === "major") {
      nextIds = allStations.filter(s => s.isMajor).map(s => s.id);
    } else if (mode === "endpoints") {
      nextIds = oudState.lastResult.usedEndpointIds;
    } else {
      nextIds = allStations.map(s => s.id);
    }

    const set = new Set(nextIds);
    if (set.size < 2 && allStations.length >= 2) {
      set.add(allStations[0].id);
      set.add(allStations[allStations.length - 1].id);
    }
    oudState.selectedVisibleIds = set;
    refreshOudPreview();
  }

  if (oudSelectEncoding) {
    oudSelectEncoding.addEventListener("change", () => {
      try {
        reparseOudDocument();
        trackAnalytics("oud_option_changed", { option_key: "encoding", option_val: oudSelectEncoding.value });
      } catch (err) {
        alert(`文字コード切替エラー:\n${err.message}`);
      }
    });
  }
  if (oudSelectDiagram) {
    oudSelectDiagram.addEventListener("change", () => {
      oudState.selectedVisibleIds = null;
      refreshOudPreview();
      trackAnalytics("oud_option_changed", { option_key: "diagram", option_val: oudSelectDiagram.value });
    });
  }
  [oudSelectFallback, oudCheckExcludeCanceled, oudCheckSameRow].forEach(el => {
    if (el) {
      el.addEventListener("change", () => {
        refreshOudPreview();
        const val = el.type === "checkbox" ? String(el.checked) : el.value;
        trackAnalytics("oud_option_changed", { option_key: el.id, option_val: val });
      });
    }
  });
  if (btnOudVisRecommended) btnOudVisRecommended.addEventListener("click", () => { applyStationPreset("recommended"); trackAnalytics("oud_option_changed", { option_key: "station_preset", option_val: "recommended" }); });
  if (btnOudVisMajor) btnOudVisMajor.addEventListener("click", () => { applyStationPreset("major"); trackAnalytics("oud_option_changed", { option_key: "station_preset", option_val: "major" }); });
  if (btnOudVisEndpoints) btnOudVisEndpoints.addEventListener("click", () => { applyStationPreset("endpoints"); trackAnalytics("oud_option_changed", { option_key: "station_preset", option_val: "endpoints" }); });
  if (btnOudVisAll) btnOudVisAll.addEventListener("click", () => { applyStationPreset("all"); trackAnalytics("oud_option_changed", { option_key: "station_preset", option_val: "all" }); });

  if (btnExecuteOudImport) {
    btnExecuteOudImport.addEventListener("click", () => {
      if (!oudState.lastResult || !oudState.lastResult.data) return;
      const converted = oudState.lastResult.data;
      const val = dataModel.validateSchema(converted);
      if (!val.valid) {
        alert(`インポート失敗:\n${val.errors.join("\n")}`);
        return;
      }
      const prepared = applyStickyPreviewSettings(converted, ["timeAxisStartHour"]);
      dataModel.load(prepared);
      tableEditor.setActiveRoster(null);
      const importedTitle = (prepared.metadata && prepared.metadata.title) ? prepared.metadata.title : (oudState.fileName || "OUD読込データ");
      updateDocumentSourceUI("custom", `読込: ${importedTitle}`);
      hasDirtyDraft = true;
      flushDraftSave();
      const st = oudState.lastResult.stats || {};
      const ext = (oudState.fileName || "").toLowerCase().endsWith(".oud2") ? "oud2" : "oud";
      trackAnalytics("oud_import_completed", {
        file_ext: ext,
        visible_stations: st.visibleStationsCount || 0,
        total_stations: st.totalStations || 0,
        rosters_count: st.rostersCount || 0,
        trains_count: st.trainsCount || 0,
        fallback_mode: oudSelectFallback ? oudSelectFallback.value : "direction"
      });
      closeOudImportModal();
    });
  }

  let printCleanupArmedAt = 0;

  function isInAppWebView() {
    const ua = navigator.userAgent || "";
    return /Twitter|TwitterAndroid|FBAN|FBAV|Instagram|Line\/|MicroMessenger|YJApp|musical_ly|BytedanceWebview/i.test(ua);
  }

  function escapeHtmlText(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function downloadPrintableHtml() {
    const data = dataModel.getData();
    if (!data) return;
    const pages = diagramRenderer.renderPages(data);
    const diag = diagramRenderer.getLastDiagnostics();
    const effectiveCfg = (pages[0] && pages[0].pageConfig)
      || (diag && diag.effectivePageConfig)
      || BoxDiagramDataModel.getEffectivePageConfig(data.settings);
    const titleText = escapeHtmlText((data.metadata && data.metadata.title) ? data.metadata.title : "箱ダイヤ");
    const pageSections = pages.map((p) => (
      `<section class="print-page" data-page="${p.pageIndex}">${p.svgHtml}</section>`
    )).join("\n");

    const htmlDoc = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${titleText} - 印刷用</title>
<style>
  @page { size: ${effectiveCfg.cssPageSize}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e2e8f0; font-family: sans-serif; }
  .bar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; background: #1e293b; color: #fff; font-size: 13px; }
  .bar button { padding: 7px 14px; border: none; border-radius: 6px; background: #2F6F73; color: #fff; font-weight: 700; cursor: pointer; }
  .pages { padding: 12px; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .print-page { width: 100%; max-width: ${effectiveCfg.baseW}px; background: #fff; box-shadow: 0 6px 20px rgba(15,23,42,0.18); }
  .print-page svg { width: 100%; height: auto; display: block; }
  @media print {
    html, body { background: #fff !important; }
    .bar { display: none !important; }
    .pages { padding: 0 !important; gap: 0 !important; display: block !important; }
    .print-page { max-width: none !important; width: 100% !important; box-shadow: none !important; page-break-after: always !important; break-after: page !important; page-break-inside: avoid !important; break-inside: avoid !important; }
    .print-page:last-child { page-break-after: avoid !important; break-after: avoid !important; }
    .print-page svg { width: 100% !important; height: auto !important; max-height: 99.6vh !important; }
  }
</style>
</head>
<body>
  <div class="bar">
    <span>${titleText}（${pages.length}ページ）— Safari / Chromeの共有・印刷からPDF保存できます</span>
    <button type="button" onclick="window.print()">印刷 / PDF保存</button>
  </div>
  <main class="pages">${pageSections}</main>
</body>
</html>`;

    const blob = new Blob([htmlDoc], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const rawName = (data.metadata && data.metadata.title) ? data.metadata.title : "box-diagram";
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
    a.download = `${safeName}_print.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function showInAppPrintBanner() {
    let banner = document.getElementById("inAppPrintBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "inAppPrintBanner";
      banner.className = "inapp-print-banner";
      banner.innerHTML = `
        <span>アプリ内ブラウザでは印刷が無効な場合があります。Safari / Chrome で開くか、印刷用HTML・PNG画像として保存してください。</span>
        <div class="inapp-print-banner-actions">
          <button type="button" class="btn btn-xs btn-primary" data-inapp-act="png">PNG画像にする</button>
          <button type="button" class="btn btn-xs btn-secondary" data-inapp-act="download">印刷用HTMLを保存</button>
          <button type="button" class="btn btn-xs btn-secondary" data-inapp-act="close">閉じる</button>
        </div>
      `;
      banner.addEventListener("click", (e) => {
        const btn = e.target.closest("button");
        if (!btn) return;
        if (btn.dataset.inappAct === "png") {
          banner.hidden = true;
          exportDiagramPng("all");
        } else if (btn.dataset.inappAct === "download") {
          trackAnalytics("print_html_fallback_saved", { source: "inapp_banner" });
          downloadPrintableHtml();
        } else if (btn.dataset.inappAct === "close") {
          banner.hidden = true;
        }
      });
      document.body.appendChild(banner);
    }
    banner.hidden = false;
  }

  function syncBeforePrintState() {
    printCleanupArmedAt = Date.now();
    document.body.dataset.printing = "true";
    if (checkShowAllPages && !checkShowAllPages.checked) {
      if (wasAllPagesBeforePrint === null) {
        wasAllPagesBeforePrint = false;
      }
      checkShowAllPages.checked = true;
      renderPreview();
    } else {
      updatePrintPageStyle(dataModel.getData(), lastEffectivePrintCfg);
    }
    void document.documentElement.offsetHeight;
  }

  function restoreAfterPrintState() {
    printCleanupArmedAt = 0;
    delete document.body.dataset.printing;
    if (wasAllPagesBeforePrint === false && checkShowAllPages) {
      wasAllPagesBeforePrint = null;
      checkShowAllPages.checked = false;
      renderPreview();
    } else {
      wasAllPagesBeforePrint = null;
    }
  }

  window.addEventListener("beforeprint", syncBeforePrintState);
  window.addEventListener("afterprint", restoreAfterPrintState);

  if (window.matchMedia) {
    const printMql = window.matchMedia("print");
    const onPrintMediaChange = (ev) => {
      if (ev.matches) {
        syncBeforePrintState();
      } else if (document.body.dataset.printing === "true") {
        restoreAfterPrintState();
      }
    };
    if (typeof printMql.addEventListener === "function") {
      printMql.addEventListener("change", onPrintMediaChange);
    }
  }

  // 一部モバイル端末・WebViewで afterprint が発火しない場合の安全復帰
  window.addEventListener("pointerdown", () => {
    if (document.body.dataset.printing === "true" && printCleanupArmedAt > 0 && Date.now() - printCleanupArmedAt > 2500) {
      restoreAfterPrintState();
    }
  }, { passive: true });

  // 統合出力ドロップダウン（PDF印刷 / PNG画像 / SVG / 印刷HTML）
  let exportMenuAnchorBtn = null;

  function closeExportMenu() {
    if (!exportMenuDropdown || exportMenuDropdown.hidden) return;
    exportMenuDropdown.hidden = true;
    if (btnExportMenu) btnExportMenu.setAttribute("aria-expanded", "false");
    if (btnMobileQuickExport) btnMobileQuickExport.setAttribute("aria-expanded", "false");
    exportMenuAnchorBtn = null;
  }

  function openExportMenu(anchorEl) {
    if (!exportMenuDropdown || !anchorEl) return;
    const isSame = !exportMenuDropdown.hidden && exportMenuAnchorBtn === anchorEl;
    if (isSame) {
      closeExportMenu();
      return;
    }
    exportMenuAnchorBtn = anchorEl;
    exportMenuDropdown.hidden = false;
    const rect = anchorEl.getBoundingClientRect();
    const menuRect = exportMenuDropdown.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, rect.right - menuRect.width));
    const top = Math.min(window.innerHeight - menuRect.height - 8, rect.bottom + 4);
    exportMenuDropdown.style.left = `${Math.round(left)}px`;
    exportMenuDropdown.style.top = `${Math.round(Math.max(8, top))}px`;
    anchorEl.setAttribute("aria-expanded", "true");
    trackAnalytics("output_menu_opened", { trigger: anchorEl.id || "export" });
  }

  if (btnExportMenu) {
    btnExportMenu.addEventListener("click", (e) => {
      e.stopPropagation();
      openExportMenu(btnExportMenu);
    });
  }
  if (btnMobileQuickExport) {
    btnMobileQuickExport.addEventListener("click", (e) => {
      e.stopPropagation();
      openExportMenu(btnMobileQuickExport);
    });
  }
  document.addEventListener("click", (e) => {
    if (!exportMenuDropdown || exportMenuDropdown.hidden) return;
    if (exportMenuDropdown.contains(e.target)) return;
    if (btnExportMenu && btnExportMenu.contains(e.target)) return;
    if (btnMobileQuickExport && btnMobileQuickExport.contains(e.target)) return;
    closeExportMenu();
  });

  // 高解像度 PNG / SVG 画像エクスポート ＋ モバイル共有・長押し保存モーダル
  const imageExportModalBackdrop = document.getElementById("imageExportModalBackdrop");
  const btnCloseImageExport = document.getElementById("btnCloseImageExport");
  const btnCloseImageExportFooter = document.getElementById("btnCloseImageExportFooter");
  const imageExportPreviewImg = document.getElementById("imageExportPreviewImg");
  const imageExportInfo = document.getElementById("imageExportInfo");
  const btnShareExportedImage = document.getElementById("btnShareExportedImage");
  const btnDownloadExportedImage = document.getElementById("btnDownloadExportedImage");
  let activeExportImageState = null;

  function closeImageExportModal() {
    if (!imageExportModalBackdrop) return;
    imageExportModalBackdrop.hidden = true;
    if (imageExportPreviewImg) imageExportPreviewImg.removeAttribute("src");
    if (activeExportImageState && activeExportImageState.url) {
      URL.revokeObjectURL(activeExportImageState.url);
    }
    activeExportImageState = null;
  }

  function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function svgMarkupToCanvas(svgHtml, baseW, baseH, pixelScale) {
    return new Promise((resolve, reject) => {
      const targetW = Math.max(1, Math.round(baseW * pixelScale));
      const targetH = Math.max(1, Math.round(baseH * pixelScale));
      const sizedSvg = svgHtml
        .replace(/<svg\b([^>]*?)width="100%"\s+height="100%"/i, `<svg$1width="${targetW}" height="${targetH}"`)
        .replace(/\.diagram-empty-hint\s*\{[^}]*\}/, ".diagram-empty-hint { display: none; }");
      const svgBlob = new Blob([sizedSvg], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(0, 0, targetW, targetH);
          ctx.drawImage(img, 0, 0, targetW, targetH);
          URL.revokeObjectURL(svgUrl);
          resolve(canvas);
        } catch (err) {
          URL.revokeObjectURL(svgUrl);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(svgUrl);
        reject(new Error("SVG画像変換に失敗しました"));
      };
      img.src = svgUrl;
    });
  }

  async function exportDiagramPng(scope = "current") {
    const data = dataModel.getData();
    if (!data) return;
    closeExportMenu();
    setMobileHeaderMenuOpen(false);
    const allPages = diagramRenderer.renderPages(data);
    if (!allPages || allPages.length === 0) return;

    const targetPages = scope === "all"
      ? allPages
      : [allPages.find(p => p.pageIndex === currentPageIndex) || allPages[0]];
    const diag = diagramRenderer.getLastDiagnostics();
    const effectiveCfg = (targetPages[0] && targetPages[0].pageConfig)
      || (diag && diag.effectivePageConfig)
      || BoxDiagramDataModel.getEffectivePageConfig(data.settings);

    const maxBaseW = Math.max(...targetPages.map(p => (p.pageConfig ? p.pageConfig.baseW : effectiveCfg.baseW) || 1123));
    const sumBaseH = targetPages.reduce((acc, p) => acc + ((p.pageConfig ? p.pageConfig.baseH : effectiveCfg.baseH) || 1587), 0);
    const gapPx = targetPages.length > 1 ? 16 : 0;

    // 端末Canvas上限 (3840px幅 / 8192px高) を超えない高精細スケールを算出
    let scale = 2.0;
    scale = Math.min(scale, 3840 / Math.max(1, maxBaseW));
    scale = Math.min(scale, 8192 / Math.max(1, sumBaseH + (targetPages.length - 1) * gapPx));
    scale = Math.max(0.75, Math.round(scale * 100) / 100);

    try {
      const pageCanvases = [];
      for (const p of targetPages) {
        const cfg = p.pageConfig || effectiveCfg;
        const c = await svgMarkupToCanvas(p.svgHtml, cfg.baseW, cfg.baseH, scale);
        pageCanvases.push(c);
      }

      let outCanvas;
      if (pageCanvases.length === 1) {
        outCanvas = pageCanvases[0];
      } else {
        const scaledGap = Math.round(gapPx * scale);
        const totalW = Math.max(...pageCanvases.map(c => c.width));
        const totalH = pageCanvases.reduce((s, c) => s + c.height, 0) + (pageCanvases.length - 1) * scaledGap;
        outCanvas = document.createElement("canvas");
        outCanvas.width = totalW;
        outCanvas.height = totalH;
        const octx = outCanvas.getContext("2d");
        octx.fillStyle = "#e2e8f0";
        octx.fillRect(0, 0, totalW, totalH);
        let yCursor = 0;
        for (const c of pageCanvases) {
          const offsetX = Math.round((totalW - c.width) / 2);
          octx.drawImage(c, offsetX, yCursor);
          yCursor += c.height + scaledGap;
        }
      }

      const pngBlob = await new Promise((res) => outCanvas.toBlob(res, "image/png"));
      if (!pngBlob) throw new Error("PNGデータ生成に失敗しました");

      const rawName = (data.metadata && data.metadata.title) ? data.metadata.title : "box-diagram";
      const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");
      const fileSuffix = scope === "all" ? "all" : `p${targetPages[0].pageIndex}`;
      const fileName = `${safeName}_${fileSuffix}.png`;
      const isMobileOrInApp = window.innerWidth <= 900 || isInAppWebView();

      trackAnalytics("export_image_triggered", {
        format: scope === "all" ? "png_all" : "png_current",
        method: isMobileOrInApp ? "preview_modal" : "download",
        page_count: targetPages.length,
        axis_mode: (data.settings && data.settings.xAxisMode === "time") ? "time" : "station"
      });
      if (window.BoxAnalytics) {
        window.BoxAnalytics.snapshotDataSettings(data, "export_png");
      }

      if (!isMobileOrInApp) {
        triggerBlobDownload(pngBlob, fileName);
        showAppToast(`PNG画像を保存しました（${outCanvas.width}×${outCanvas.height}px）`);
      } else if (imageExportModalBackdrop && imageExportPreviewImg) {
        closeHelpModal();
        closeTermsModal();
        closeFeedbackModal();
        closeOudImportModal();
        closeNewDiagramModal();
        const url = URL.createObjectURL(pngBlob);
        activeExportImageState = { blob: pngBlob, url, fileName };
        imageExportPreviewImg.src = url;
        if (imageExportInfo) {
          imageExportInfo.textContent = `${fileName}（${outCanvas.width}×${outCanvas.height}px）`;
        }
        if (btnShareExportedImage) {
          let canShareFile = false;
          try {
            const testFile = new File([pngBlob], fileName, { type: "image/png" });
            canShareFile = !!(navigator.canShare && navigator.canShare({ files: [testFile] }));
          } catch (_) { /* ignore */ }
          btnShareExportedImage.hidden = !canShareFile;
        }
        imageExportModalBackdrop.hidden = false;
        trackAnalytics("modal_opened", { modal: "image_export" });
      } else {
        triggerBlobDownload(pngBlob, fileName);
      }
    } catch (err) {
      showAppToast(`画像書き出しに失敗しました: ${err.message || err}`);
    }
  }

  function exportDiagramSvg() {
    const data = dataModel.getData();
    if (!data) return;
    closeExportMenu();
    setMobileHeaderMenuOpen(false);
    const pages = diagramRenderer.renderPages(data);
    if (!pages || pages.length === 0) return;

    const rawName = (data.metadata && data.metadata.title) ? data.metadata.title : "box-diagram";
    const safeName = rawName.replace(/[\\/:*?"<>|]/g, "_");

    pages.forEach((p, idx) => {
      const cfg = p.pageConfig || BoxDiagramDataModel.getEffectivePageConfig(data.settings);
      const svgOut = p.svgHtml.replace(/<svg\b([^>]*?)width="100%"\s+height="100%"/i, `<svg$1width="${cfg.baseW}" height="${cfg.baseH}"`);
      const blob = new Blob([svgOut], { type: "image/svg+xml;charset=utf-8" });
      const fileName = pages.length === 1 ? `${safeName}.svg` : `${safeName}_p${p.pageIndex}.svg`;
      setTimeout(() => triggerBlobDownload(blob, fileName), idx * 140);
    });

    showAppToast(`SVGファイルを保存しました（全${pages.length}ページ）`);
    trackAnalytics("export_image_triggered", {
      format: "svg",
      method: "download",
      page_count: pages.length,
      axis_mode: (data.settings && data.settings.xAxisMode === "time") ? "time" : "station"
    });
    if (window.BoxAnalytics) {
      window.BoxAnalytics.snapshotDataSettings(data, "export_svg");
    }
  }

  if (btnExportPngCurrent) {
    btnExportPngCurrent.addEventListener("click", () => exportDiagramPng("current"));
  }
  if (btnExportPngAll) {
    btnExportPngAll.addEventListener("click", () => exportDiagramPng("all"));
  }
  if (btnExportSvg) {
    btnExportSvg.addEventListener("click", exportDiagramSvg);
  }
  if (btnExportPrintHtml) {
    btnExportPrintHtml.addEventListener("click", () => {
      closeExportMenu();
      setMobileHeaderMenuOpen(false);
      const data = dataModel.getData();
      const pagesCount = data ? diagramRenderer.renderPages(data).length : 1;
      trackAnalytics("print_html_fallback_saved", { source: "export_menu", page_count: pagesCount });
      downloadPrintableHtml();
    });
  }
  if (btnDownloadExportedImage) {
    btnDownloadExportedImage.addEventListener("click", () => {
      if (!activeExportImageState) return;
      triggerBlobDownload(activeExportImageState.blob, activeExportImageState.fileName);
      trackAnalytics("export_image_triggered", { format: "png_modal_download", method: "download" });
    });
  }
  if (btnShareExportedImage) {
    btnShareExportedImage.addEventListener("click", async () => {
      if (!activeExportImageState || !navigator.share) return;
      try {
        const file = new File([activeExportImageState.blob], activeExportImageState.fileName, { type: "image/png" });
        await navigator.share({ files: [file], title: activeExportImageState.fileName });
        trackAnalytics("export_image_triggered", { format: "png_modal_share", method: "share" });
      } catch (_) { /* ユーザーキャンセル等は無視 */ }
    });
  }

  // 印刷 / PDF出力
  btnPrint.addEventListener("click", () => {
    closeExportMenu();
    setMobileHeaderMenuOpen(false);
    preparePrintAndTrigger("menu");
  });

  function preparePrintAndTrigger(via = "menu") {
    syncBeforePrintState();
    const curData = dataModel.getData();
    const s = (curData && curData.settings) || {};
    const cfg = BoxDiagramDataModel.getEffectivePageConfig(s);
    trackAnalytics("print_pdf_triggered", {
      via,
      x_axis_mode: cfg.xAxisMode,
      page_size: cfg.pageSize,
      orientation: cfg.orientation,
      page_count: totalPageCount,
      is_inapp_browser: isInAppWebView(),
      mobile_view: document.body.dataset.mobileView || "preview"
    });
    if (window.BoxAnalytics && curData) {
      window.BoxAnalytics.snapshotDataSettings(curData, "print_pdf");
    }
    window.print();
    if (isInAppWebView()) {
      showInAppPrintBanner();
    }
  }

  // 横軸モード / クイック用紙コントロール
  if (btnAxisStation) {
    btnAxisStation.addEventListener("click", () => {
      hasStickyPreviewSettings = true;
      if (dataModel.getSettings().xAxisMode !== "station") {
        currentPageIndex = 1;
        dataModel.updateSettings({ xAxisMode: "station" });
      }
    });
  }
  if (btnAxisTime) {
    btnAxisTime.addEventListener("click", () => {
      hasStickyPreviewSettings = true;
      if (dataModel.getSettings().xAxisMode !== "time") {
        currentPageIndex = 1;
        dataModel.updateSettings({ xAxisMode: "time" });
      }
    });
  }
  if (btnToggleStationDir) {
    btnToggleStationDir.addEventListener("click", () => {
      hasStickyPreviewSettings = true;
      const cur = dataModel.getSettings().stationAxisDirection === "rtl" ? "rtl" : "ltr";
      const next = cur === "rtl" ? "ltr" : "rtl";
      dataModel.updateSettings({ stationAxisDirection: next });
    });
  }
  if (selectQuickPageSize) {
    selectQuickPageSize.addEventListener("change", (e) => {
      hasStickyPreviewSettings = true;
      applyEffectivePagePatch({ pageSize: e.target.value });
    });
  }
  if (btnQuickPortrait) {
    btnQuickPortrait.addEventListener("click", () => {
      hasStickyPreviewSettings = true;
      applyEffectivePagePatch({ orientation: "portrait" });
    });
  }
  if (btnQuickLandscape) {
    btnQuickLandscape.addEventListener("click", () => {
      hasStickyPreviewSettings = true;
      applyEffectivePagePatch({ orientation: "landscape" });
    });
  }
  if (inputQuickCustomW) {
    inputQuickCustomW.addEventListener("change", (e) => {
      hasStickyPreviewSettings = true;
      const clamped = BoxDiagramDataModel.clampCustomMm(e.target.value, 560, 100, 1800);
      e.target.value = clamped;
      applyEffectivePagePatch({ widthMm: clamped });
    });
  }
  if (inputQuickCustomH) {
    inputQuickCustomH.addEventListener("change", (e) => {
      hasStickyPreviewSettings = true;
      const clamped = BoxDiagramDataModel.clampCustomMm(e.target.value, 220, 80, 1200);
      e.target.value = clamped;
      applyEffectivePagePatch({ heightMm: clamped });
    });
  }

  // ページ送りコントロール
  btnPrevPage.addEventListener("click", () => {
    if (currentPageIndex > 1) {
      currentPageIndex--;
      trackAnalytics("page_navigated", { action: "prev", page: currentPageIndex, total_pages: totalPageCount });
      renderPreview({ resetScroll: !checkShowAllPages.checked });
    }
  });

  btnNextPage.addEventListener("click", () => {
    if (currentPageIndex < totalPageCount) {
      currentPageIndex++;
      trackAnalytics("page_navigated", { action: "next", page: currentPageIndex, total_pages: totalPageCount });
      renderPreview({ resetScroll: !checkShowAllPages.checked });
    }
  });

  checkShowAllPages.addEventListener("change", () => {
    trackAnalytics("page_navigated", { action: checkShowAllPages.checked ? "show_all_on" : "show_all_off", total_pages: totalPageCount });
    renderPreview();
  });

  // ズームコントロール
  selectZoom.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "fit" || val === "fit-width") {
      zoomMode = val;
      if (optZoomCustom) {
        optZoomCustom.hidden = true;
        optZoomCustom.value = "";
      }
    } else if (val) {
      zoomMode = "manual";
      currentZoom = parseFloat(val) || 1.0;
    }
    trackAnalytics("zoom_changed", { mode: zoomMode === "manual" ? `${Math.round(currentZoom * 100)}pct` : zoomMode, via: "select" });
    renderPreview();
  });

  btnZoomIn.addEventListener("click", () => {
    zoomMode = "manual";
    currentZoom = Math.min(2.5, Math.round((appliedScale + 0.15) * 100) / 100);
    syncZoomSelect();
    trackAnalytics("zoom_changed", { mode: `${Math.round(currentZoom * 100)}pct`, via: "btn_in" });
    renderPreview();
  });

  btnZoomOut.addEventListener("click", () => {
    zoomMode = "manual";
    currentZoom = Math.max(0.2, Math.round((appliedScale - 0.15) * 100) / 100);
    syncZoomSelect();
    trackAnalytics("zoom_changed", { mode: `${Math.round(currentZoom * 100)}pct`, via: "btn_out" });
    renderPreview();
  });

  function syncZoomSelect() {
    if (zoomMode === "fit") {
      selectZoom.value = "fit";
      if (optZoomCustom) optZoomCustom.hidden = true;
    } else if (zoomMode === "fit-width") {
      selectZoom.value = "fit-width";
      if (optZoomCustom) optZoomCustom.hidden = true;
    } else {
      const presetOpt = Array.from(selectZoom.options).find(o => o !== optZoomCustom && o.value && Math.abs(parseFloat(o.value) - currentZoom) < 0.025);
      if (presetOpt) {
        if (optZoomCustom) optZoomCustom.hidden = true;
        selectZoom.value = presetOpt.value;
      } else if (optZoomCustom) {
        const valStr = currentZoom.toFixed(2);
        optZoomCustom.value = valStr;
        optZoomCustom.textContent = `${Math.round(currentZoom * 100)}%`;
        optZoomCustom.hidden = false;
        selectZoom.value = valStr;
      }
    }
  }

  // プレビュー上のマウスホイール拡大縮小（カーソル位置基準）＋余白ドラッグパン
  if (previewViewport) {
    previewViewport.addEventListener("wheel", (e) => {
      if (!dataModel.getData()) return;
      if (Math.abs(e.deltaY) < 0.5 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();

      const wrappers = Array.from(previewViewport.querySelectorAll(".preview-page-wrapper"));
      if (wrappers.length === 0) return;

      let targetIdx = 0;
      let bestDist = Infinity;
      wrappers.forEach((w, idx) => {
        const r = w.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left && e.clientX <= r.right) {
          targetIdx = idx;
          bestDist = 0;
        } else if (bestDist > 0) {
          const cy = (r.top + r.bottom) / 2;
          const cx = (r.left + r.right) / 2;
          const d = Math.hypot(e.clientX - cx, e.clientY - cy);
          if (d < bestDist) {
            bestDist = d;
            targetIdx = idx;
          }
        }
      });

      const anchorWrapper = wrappers[targetIdx];
      const oldRect = anchorWrapper.getBoundingClientRect();
      const fx = oldRect.width > 0 ? (e.clientX - oldRect.left) / oldRect.width : 0.5;
      const fy = oldRect.height > 0 ? (e.clientY - oldRect.top) / oldRect.height : 0.5;

      const baseScale = appliedScale || 1.0;
      const factor = e.deltaY < 0 ? 1.1 : (1 / 1.1);
      const nextScale = Math.max(0.2, Math.min(2.5, Math.round(baseScale * factor * 100) / 100));
      if (Math.abs(nextScale - baseScale) < 0.005) return;

      zoomMode = "manual";
      currentZoom = nextScale;
      syncZoomSelect();
      if (window.BoxAnalytics && typeof window.BoxAnalytics.trackDebounced === "function") {
        window.BoxAnalytics.trackDebounced("wheel_zoom", "zoom_changed", { mode: `${Math.round(currentZoom * 100)}pct`, via: "wheel" }, 500);
      }
      renderPreview();

      const newWrappers = previewViewport.querySelectorAll(".preview-page-wrapper");
      const nextWrapper = newWrappers[targetIdx] || newWrappers[0];
      if (nextWrapper) {
        const newRect = nextWrapper.getBoundingClientRect();
        const targetClientX = newRect.left + fx * newRect.width;
        const targetClientY = newRect.top + fy * newRect.height;
        previewViewport.scrollLeft += (targetClientX - e.clientX);
        previewViewport.scrollTop += (targetClientY - e.clientY);
      }
    }, { passive: false });

    let viewportPanState = null;
    previewViewport.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest(".diagram-note") || e.target.closest(".train-line-group")) return;
      if (
        previewViewport.scrollWidth <= previewViewport.clientWidth + 2 &&
        previewViewport.scrollHeight <= previewViewport.clientHeight + 2
      ) {
        return;
      }
      viewportPanState = {
        startX: e.clientX,
        startY: e.clientY,
        scrollLeft: previewViewport.scrollLeft,
        scrollTop: previewViewport.scrollTop,
        moved: false
      };
    });

    window.addEventListener("mousemove", (e) => {
      if (!viewportPanState) return;
      const dx = e.clientX - viewportPanState.startX;
      const dy = e.clientY - viewportPanState.startY;
      if (!viewportPanState.moved && Math.hypot(dx, dy) < 4) return;
      viewportPanState.moved = true;
      previewViewport.classList.add("is-panning");
      previewViewport.scrollLeft = viewportPanState.scrollLeft - dx;
      previewViewport.scrollTop = viewportPanState.scrollTop - dy;
    });

    window.addEventListener("mouseup", () => {
      if (viewportPanState) {
        viewportPanState = null;
        previewViewport.classList.remove("is-panning");
      }
    });
  }

  window.addEventListener("resize", () => {
    if (zoomMode === "fit" || zoomMode === "fit-width") {
      renderPreview();
    }
  });

  // 8. 新規ダイヤ作成 / 使い方・ヘルプ / お問い合わせ モーダル制御
  const newDiagramModalBackdrop = document.getElementById("newDiagramModalBackdrop");
  const btnCloseNewDiagram = document.getElementById("btnCloseNewDiagram");
  const btnCancelNewDiagram = document.getElementById("btnCancelNewDiagram");
  const btnExecuteNewDiagram = document.getElementById("btnExecuteNewDiagram");
  const inputNewTitle = document.getElementById("inputNewTitle");
  const inputNewCopyright = document.getElementById("inputNewCopyright");
  const newStationsList = document.getElementById("newStationsList");
  const btnAddNewStation = document.getElementById("btnAddNewStation");
  const selectNewRosterCount = document.getElementById("selectNewRosterCount");
  const selectNewLayout = document.getElementById("selectNewLayout");
  const selectNewTypes = document.getElementById("selectNewTypes");
  const checkNewStarterTrain = document.getElementById("checkNewStarterTrain");

  let newDiagramStations = [];

  function resetNewStationsDraft() {
    newDiagramStations = [
      { name: "始発駅", abbr: "始", abbrManual: false },
      { name: "主要駅", abbr: "主", abbrManual: false },
      { name: "終着駅", abbr: "終", abbrManual: false }
    ];
  }

  function renderNewStationsList() {
    if (!newStationsList) return;
    newStationsList.innerHTML = "";
    const canDelete = newDiagramStations.length > 2;

    newDiagramStations.forEach((st, idx) => {
      const row = document.createElement("div");
      row.className = "new-station-row";

      const idxSpan = document.createElement("span");
      idxSpan.className = "new-station-idx font-mono";
      idxSpan.textContent = String(idx + 1);

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.className = "form-control";
      nameInput.value = st.name;
      nameInput.placeholder = `駅${idx + 1}（例: 東京）`;

      const abbrInput = document.createElement("input");
      abbrInput.type = "text";
      abbrInput.className = "form-control text-center";
      abbrInput.maxLength = 4;
      abbrInput.value = st.abbr;
      abbrInput.placeholder = "略称";

      nameInput.addEventListener("input", (e) => {
        st.name = e.target.value;
        if (!st.abbrManual) {
          const trimmed = st.name.trim();
          st.abbr = trimmed ? trimmed.slice(0, 1) : "";
          abbrInput.value = st.abbr;
        }
      });

      abbrInput.addEventListener("input", (e) => {
        const val = e.target.value;
        st.abbr = val;
        st.abbrManual = val.trim().length > 0;
      });

      const moveBox = document.createElement("div");
      moveBox.className = "new-station-move-btns";
      const btnUp = document.createElement("button");
      btnUp.type = "button";
      btnUp.className = "btn btn-xs btn-secondary";
      btnUp.textContent = "↑";
      btnUp.title = "上へ";
      btnUp.disabled = idx === 0;
      btnUp.addEventListener("click", () => {
        if (idx <= 0) return;
        const item = newDiagramStations.splice(idx, 1)[0];
        newDiagramStations.splice(idx - 1, 0, item);
        renderNewStationsList();
      });

      const btnDown = document.createElement("button");
      btnDown.type = "button";
      btnDown.className = "btn btn-xs btn-secondary";
      btnDown.textContent = "↓";
      btnDown.title = "下へ";
      btnDown.disabled = idx === newDiagramStations.length - 1;
      btnDown.addEventListener("click", () => {
        if (idx >= newDiagramStations.length - 1) return;
        const item = newDiagramStations.splice(idx, 1)[0];
        newDiagramStations.splice(idx + 1, 0, item);
        renderNewStationsList();
      });
      moveBox.appendChild(btnUp);
      moveBox.appendChild(btnDown);

      const btnDel = document.createElement("button");
      btnDel.type = "button";
      btnDel.className = "btn btn-xs btn-secondary";
      btnDel.textContent = "✕";
      btnDel.title = canDelete ? "この駅を削除" : "駅は最低2つ必要です";
      btnDel.disabled = !canDelete;
      btnDel.addEventListener("click", () => {
        if (newDiagramStations.length <= 2) return;
        newDiagramStations.splice(idx, 1);
        renderNewStationsList();
      });

      row.appendChild(idxSpan);
      row.appendChild(nameInput);
      row.appendChild(abbrInput);
      row.appendChild(moveBox);
      row.appendChild(btnDel);
      newStationsList.appendChild(row);
    });
  }

  function closeNewDiagramModal() {
    if (!newDiagramModalBackdrop) return;
    newDiagramModalBackdrop.hidden = true;
  }

  function openNewDiagramModal() {
    if (!newDiagramModalBackdrop) return;
    closeHelpModal();
    closeFeedbackModal();
    closeOudImportModal();
    closeTermsModal();
    closeImageExportModal();
    closeExportMenu();
    setMobileHeaderMenuOpen(false);
    if (inputNewTitle) inputNewTitle.value = "新規路線 車両運用図";
    if (inputNewCopyright) inputNewCopyright.value = "";
    if (selectNewRosterCount) selectNewRosterCount.value = "1";
    if (selectNewLayout) selectNewLayout.value = "station_a4_portrait";
    if (selectNewTypes) selectNewTypes.value = "standard";
    if (checkNewStarterTrain) checkNewStarterTrain.checked = false;
    resetNewStationsDraft();
    renderNewStationsList();
    newDiagramModalBackdrop.hidden = false;
    trackAnalytics("modal_opened", { modal: "new_diagram" });
    if (inputNewTitle) {
      inputNewTitle.focus();
      inputNewTitle.select();
    }
  }

  if (btnNewDiagram) btnNewDiagram.addEventListener("click", openNewDiagramModal);
  if (btnWelcomeNewDiagram) {
    btnWelcomeNewDiagram.addEventListener("click", () => {
      trackAnalytics("welcome_bar_action", { action: "new_diagram" });
      openNewDiagramModal();
    });
  }

  if (btnAddNewStation) {
    btnAddNewStation.addEventListener("click", () => {
      const n = newDiagramStations.length + 1;
      newDiagramStations.push({ name: `駅${n}`, abbr: String(n), abbrManual: false });
      renderNewStationsList();
      if (newStationsList) {
        newStationsList.scrollTop = newStationsList.scrollHeight;
        const inputs = newStationsList.querySelectorAll('.new-station-row input[type="text"]');
        if (inputs.length >= 2) {
          const lastNameInput = inputs[inputs.length - 2];
          lastNameInput.focus();
          lastNameInput.select();
        }
      }
    });
  }

  if (btnExecuteNewDiagram) {
    btnExecuteNewDiagram.addEventListener("click", () => {
      const cleanedStations = newDiagramStations
        .map(s => ({ name: String(s.name || "").trim(), abbr: String(s.abbr || "").trim() }))
        .filter(s => s.name.length > 0);
      if (cleanedStations.length < 2) {
        alert("駅を2つ以上入力してください。");
        return;
      }

      const titleVal = inputNewTitle ? inputNewTitle.value.trim() : "";
      const copyVal = inputNewCopyright ? inputNewCopyright.value.trim() : "";
      const rosterCount = selectNewRosterCount ? parseInt(selectNewRosterCount.value, 10) : 1;
      const layoutPreset = selectNewLayout ? selectNewLayout.value : "station_a4_portrait";
      const typePreset = selectNewTypes ? selectNewTypes.value : "standard";
      const includeStarterTrain = checkNewStarterTrain ? checkNewStarterTrain.checked : false;

      const newData = BoxDiagramDataModel.createNewDiagramData({
        title: titleVal || "新規路線 車両運用図",
        copyright: copyVal,
        stations: cleanedStations,
        rosterCount,
        layoutPreset,
        typePreset,
        includeStarterTrain
      });

      hasStickyPreviewSettings = false;
      currentPageIndex = 1;
      dataModel.load(newData);
      const firstRoster = (newData.rosters && newData.rosters[0]) ? newData.rosters[0].id : null;
      tableEditor.setActiveRoster(firstRoster);
      tableEditor.setActiveTab(firstRoster ? "tab-trains" : "tab-rosters");
      updateDocumentSourceUI("custom", `作成中: ${newData.metadata.title}`);
      hasDirtyDraft = true;
      flushDraftSave();
      trackAnalytics("diagram_created", {
        roster_count: rosterCount,
        station_count: cleanedStations.length,
        layout_preset: layoutPreset,
        type_preset: typePreset,
        starter_train: includeStarterTrain
      });
      closeNewDiagramModal();
      showAppToast("新しいダイヤを作成しました");
    });
  }

  const appToast = document.getElementById("appToast");
  let toastTimer = null;
  function showAppToast(message, durationMs = 2400) {
    if (!appToast || !message) return;
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
    appToast.textContent = message;
    appToast.hidden = false;
    appToast.classList.remove("is-visible");
    void appToast.offsetWidth;
    appToast.classList.add("is-visible");
    toastTimer = setTimeout(() => {
      appToast.classList.remove("is-visible");
      setTimeout(() => {
        if (!appToast.classList.contains("is-visible")) {
          appToast.hidden = true;
        }
      }, 260);
    }, durationMs);
  }
  window.showAppToast = showAppToast;

  const btnHelp = document.getElementById("btnHelp");
  const helpModalBackdrop = document.getElementById("helpModalBackdrop");
  const btnCloseHelp = document.getElementById("btnCloseHelp");
  const btnCloseHelpFooter = document.getElementById("btnCloseHelpFooter");
  const btnOpenFeedbackFromHelp = document.getElementById("btnOpenFeedbackFromHelp");
  const btnOpenTermsFromHelp = document.getElementById("btnOpenTermsFromHelp");
  const helpModalNav = document.getElementById("helpModalNav");
  const helpModalBody = document.getElementById("helpModalBody");

  const btnTerms = document.getElementById("btnTerms");
  const termsModalBackdrop = document.getElementById("termsModalBackdrop");
  const btnCloseTerms = document.getElementById("btnCloseTerms");
  const btnCloseTermsFooter = document.getElementById("btnCloseTermsFooter");
  const btnCopyTermsCredit = document.getElementById("btnCopyTermsCredit");

  const btnFeedback = document.getElementById("btnFeedback");
  const feedbackModalBackdrop = document.getElementById("feedbackModalBackdrop");
  const btnCloseFeedback = document.getElementById("btnCloseFeedback");
  const btnCloseFeedbackFooter = document.getElementById("btnCloseFeedbackFooter");
  const feedbackFormFrame = document.getElementById("feedbackFormFrame");
  const feedbackLoadingState = document.getElementById("feedbackLoadingState");

  function openHelpModal() {
    if (!helpModalBackdrop) return;
    closeFeedbackModal();
    closeOudImportModal();
    closeNewDiagramModal();
    closeTermsModal();
    closeImageExportModal();
    closeExportMenu();
    setMobileHeaderMenuOpen(false);
    helpModalBackdrop.hidden = false;
    trackAnalytics("modal_opened", { modal: "help" });
    if (helpModalBody) helpModalBody.scrollTop = 0;
    if (helpModalNav) {
      helpModalNav.querySelectorAll(".help-nav-btn").forEach((b, idx) => {
        b.classList.toggle("active", idx === 0);
      });
    }
  }

  function closeHelpModal() {
    if (!helpModalBackdrop) return;
    helpModalBackdrop.hidden = true;
  }

  function openTermsModal() {
    if (!termsModalBackdrop) return;
    closeHelpModal();
    closeFeedbackModal();
    closeOudImportModal();
    closeNewDiagramModal();
    closeImageExportModal();
    closeExportMenu();
    setMobileHeaderMenuOpen(false);
    termsModalBackdrop.hidden = false;
    trackAnalytics("modal_opened", { modal: "terms" });
  }

  function closeTermsModal() {
    if (!termsModalBackdrop) return;
    termsModalBackdrop.hidden = true;
  }

  function openFeedbackModal() {
    if (!feedbackModalBackdrop) return;
    closeHelpModal();
    closeOudImportModal();
    closeNewDiagramModal();
    closeTermsModal();
    closeImageExportModal();
    closeExportMenu();
    setMobileHeaderMenuOpen(false);
    feedbackModalBackdrop.hidden = false;
    trackAnalytics("modal_opened", { modal: "feedback" });
    if (feedbackFormFrame && feedbackFormFrame.dataset.src && !feedbackFormFrame.getAttribute("src")) {
      if (feedbackLoadingState) feedbackLoadingState.hidden = false;
      feedbackFormFrame.setAttribute("src", feedbackFormFrame.dataset.src);
    }
  }

  function closeFeedbackModal() {
    if (!feedbackModalBackdrop) return;
    feedbackModalBackdrop.hidden = true;
  }

  if (feedbackFormFrame) {
    feedbackFormFrame.addEventListener("load", () => {
      if (feedbackFormFrame.getAttribute("src") && feedbackLoadingState) {
        feedbackLoadingState.hidden = true;
      }
    });
  }

  function bindModalCloseTriggers(backdrop, closeBtn, footerCloseBtn, closeFn) {
    if (closeBtn) closeBtn.addEventListener("click", closeFn);
    if (footerCloseBtn) footerCloseBtn.addEventListener("click", closeFn);
    if (backdrop) {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) closeFn();
      });
    }
  }

  if (btnHelp) btnHelp.addEventListener("click", openHelpModal);
  if (btnTerms) btnTerms.addEventListener("click", openTermsModal);
  if (btnOpenTermsFromHelp) btnOpenTermsFromHelp.addEventListener("click", openTermsModal);
  if (btnFeedback) btnFeedback.addEventListener("click", openFeedbackModal);
  if (btnOpenFeedbackFromHelp) btnOpenFeedbackFromHelp.addEventListener("click", openFeedbackModal);

  if (btnCopyTermsCredit) {
    btnCopyTermsCredit.addEventListener("click", () => {
      trackAnalytics("credit_copied", { via: "terms_modal" });
      const text = "https://sekitan66325.github.io/box-diagram/ で作成";
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(text).then(() => {
          showAppToast("クレジット表記例をコピーしました");
        }).catch(() => {
          showAppToast("コピーできなかった場合は画面上の文字列を選択してください");
        });
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          showAppToast("クレジット表記例をコピーしました");
        } catch (err) {
          showAppToast("コピーできなかった場合は画面上の文字列を選択してください");
        }
        document.body.removeChild(ta);
      }
    });
  }

  bindModalCloseTriggers(helpModalBackdrop, btnCloseHelp, btnCloseHelpFooter, closeHelpModal);
  bindModalCloseTriggers(termsModalBackdrop, btnCloseTerms, btnCloseTermsFooter, closeTermsModal);
  bindModalCloseTriggers(feedbackModalBackdrop, btnCloseFeedback, btnCloseFeedbackFooter, closeFeedbackModal);
  bindModalCloseTriggers(oudImportModalBackdrop, btnCloseOudImport, btnCancelOudImport, closeOudImportModal);
  bindModalCloseTriggers(newDiagramModalBackdrop, btnCloseNewDiagram, btnCancelNewDiagram, closeNewDiagramModal);
  bindModalCloseTriggers(imageExportModalBackdrop, btnCloseImageExport, btnCloseImageExportFooter, closeImageExportModal);

  if (helpModalNav && helpModalBody) {
    helpModalNav.querySelectorAll(".help-nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.helpTarget;
        const sec = document.getElementById(targetId);
        helpModalNav.querySelectorAll(".help-nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
        trackAnalytics("help_section_clicked", { section: targetId });
      });
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "F1") {
      e.preventDefault();
      if (helpModalBackdrop && helpModalBackdrop.hidden) {
        openHelpModal();
      } else {
        closeHelpModal();
      }
    } else if (e.key === "Escape") {
      if (exportMenuDropdown && !exportMenuDropdown.hidden) {
        e.preventDefault();
        closeExportMenu();
      } else if (imageExportModalBackdrop && !imageExportModalBackdrop.hidden) {
        e.preventDefault();
        closeImageExportModal();
      } else if (newDiagramModalBackdrop && !newDiagramModalBackdrop.hidden) {
        e.preventDefault();
        closeNewDiagramModal();
      } else if (oudImportModalBackdrop && !oudImportModalBackdrop.hidden) {
        e.preventDefault();
        closeOudImportModal();
      } else if (termsModalBackdrop && !termsModalBackdrop.hidden) {
        e.preventDefault();
        closeTermsModal();
      } else if (feedbackModalBackdrop && !feedbackModalBackdrop.hidden) {
        e.preventDefault();
        closeFeedbackModal();
      } else if (helpModalBackdrop && !helpModalBackdrop.hidden) {
        e.preventDefault();
        closeHelpModal();
      }
    }
  });

  // モバイル アプリ内ブラウザ向け 1行ヒントバー
  if (mobileInAppHintBar) {
    let hintDismissed = false;
    try {
      hintDismissed = sessionStorage.getItem("hakodiagram_inapp_hint_dismissed") === "1";
    } catch (_) { /* ignore */ }
    if (isInAppWebView() && window.innerWidth <= 900 && !hintDismissed) {
      mobileInAppHintBar.hidden = false;
    }
    if (btnDismissInAppHint) {
      btnDismissInAppHint.addEventListener("click", () => {
        mobileInAppHintBar.hidden = true;
        try {
          sessionStorage.setItem("hakodiagram_inapp_hint_dismissed", "1");
        } catch (_) { /* ignore */ }
        trackAnalytics("inapp_banner_action", { action: "dismiss" });
      });
    }
  }

  // PWA Service Worker 登録＆インストール計測
  if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  window.addEventListener("beforeinstallprompt", () => {
    trackAnalytics("pwa_lifecycle", { state: "prompt_available" });
  });
  window.addEventListener("appinstalled", () => {
    trackAnalytics("pwa_lifecycle", { state: "installed" });
  });

  // 自動保存下書きの復元 & 初回プレビュー描画
  let startupRestoredFromDraft = false;
  let startupDraftStorage = "none";
  const syncDraft = readSyncDraft();
  if (syncDraft && syncDraft.data && !syncDraft.storage) {
    const val = dataModel.validateSchema(syncDraft.data);
    if (val.valid) {
      dataModel.load(syncDraft.data);
      if (syncDraft.activeRosterId) tableEditor.setActiveRoster(syncDraft.activeRosterId);
      if (syncDraft.activeTab) tableEditor.setActiveTab(syncDraft.activeTab);
      updateDocumentSourceUI("custom", formatDraftSourceLabel(syncDraft.data, syncDraft.sourceMode, syncDraft.sourceLabel));
      hasDirtyDraft = true;
      startupRestoredFromDraft = true;
      startupDraftStorage = "localstorage";
    }
  }

  if (!startupRestoredFromDraft) {
    updateDocumentSourceUI("sample", "sakuragawa_main");
    renderPreview();
    if (syncDraft && syncDraft.storage === "idb") {
      loadDraftFromIdb().then((idbDraft) => {
        if (!idbDraft || !idbDraft.data) return;
        const val = dataModel.validateSchema(idbDraft.data);
        if (!val.valid) return;
        dataModel.load(idbDraft.data);
        if (idbDraft.activeRosterId) tableEditor.setActiveRoster(idbDraft.activeRosterId);
        if (idbDraft.activeTab) tableEditor.setActiveTab(idbDraft.activeTab);
        updateDocumentSourceUI("custom", formatDraftSourceLabel(idbDraft.data, idbDraft.sourceMode, idbDraft.sourceLabel));
        hasDirtyDraft = true;
        showAppToast("前回の作業下書きを自動復元しました");
        trackAnalytics("draft_restored", { storage: "indexeddb" });
      }).catch(() => {});
    }
  } else {
    showAppToast("前回の作業下書きを自動復元しました");
    trackAnalytics("draft_restored", { storage: startupDraftStorage });
  }

  updateHistoryButtons();
  updatePrintPageStyle(dataModel.getData());

  const isStandalonePwa = !!(
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true
  );
  trackAnalytics("app_loaded", {
    device_layout: window.innerWidth <= 900 ? "mobile" : "desktop",
    is_inapp_browser: isInAppWebView(),
    webview_kind: window.BoxAnalytics ? window.BoxAnalytics.detectWebViewKind(navigator.userAgent) : "standard",
    pwa_standalone: isStandalonePwa,
    has_restored_draft: startupRestoredFromDraft,
    viewport_bucket: window.BoxAnalytics ? window.BoxAnalytics.viewportBucket(window.innerWidth) : "unknown"
  });
  if (window.BoxAnalytics && dataModel.getData()) {
    window.BoxAnalytics.snapshotDataSettings(dataModel.getData(), startupRestoredFromDraft ? "draft_restore" : "init");
  }
});
