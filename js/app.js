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
  const presetSelect = document.getElementById("presetSelect");
  const btnUndo = document.getElementById("btnUndo");
  const btnRedo = document.getElementById("btnRedo");
  const btnExportJson = document.getElementById("btnExportJson");
  const inputFileJson = document.getElementById("inputFileJson");
  const inputFileOud = document.getElementById("inputFileOud");
  const btnPrint = document.getElementById("btnPrint");

  const splitter = document.getElementById("workspaceSplitter");
  const previewViewport = document.getElementById("previewViewport");
  const btnAxisStation = document.getElementById("btnAxisStation");
  const btnAxisTime = document.getElementById("btnAxisTime");
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
  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomOut = document.getElementById("btnZoomOut");
  const dynamicPrintStyle = document.getElementById("dynamic-print-style");

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
    "timeAxisLabelDensity"
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

  // 3. データ変更リスナー（プレビューの再描画 & Undo/Redo更新）
  dataModel.subscribe((data, actionType) => {
    if (actionType === "load") {
      dismissedSuggestionKeys.clear();
    } else if (actionType === "settings-update") {
      hasStickyPreviewSettings = true;
    }
    updateHistoryButtons();
    renderPreview({ resetScroll: actionType === "load" });
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
    iconSpan.textContent = "💡";
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

        // 該当行へスクロール & ハイライト
        setTimeout(() => {
          const row = editorContainer.querySelector(`tr[data-train-idx="${trainIdx}"]`);
          if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            row.style.outline = "2px solid var(--primary)";
            setTimeout(() => { row.style.outline = ""; }, 1500);
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
            dataModel.updateNote(noteId, { x: curX, y: curY });
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
  // プリセット切り替え
  const PRESET_MAP = {
    sakuragawa_main: PRESET_SAKURAGAWA_MAIN,
    midorikawa_compact: PRESET_MIDORIKAWA_COMPACT
  };

  presetSelect.addEventListener("change", (e) => {
    const rawPreset = PRESET_MAP[e.target.value];
    if (!rawPreset) return;
    const prepared = applyStickyPreviewSettings(rawPreset);
    dataModel.load(prepared);
    tableEditor.setActiveRoster(null);
  });

  // Undo / Redo
  btnUndo.addEventListener("click", () => {
    dataModel.undo();
  });

  btnRedo.addEventListener("click", () => {
    dataModel.redo();
  });

  // キーボードショートカット
  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (e.shiftKey) {
        dataModel.redo();
      } else {
        dataModel.undo();
      }
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      dataModel.redo();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
      preparePrintAndTrigger();
      e.preventDefault();
    }
  });

  // JSON エクスポート
  btnExportJson.addEventListener("click", () => {
    const jsonStr = dataModel.toJSON(true);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const meta = dataModel.getMetadata();
    const fileName = `${meta.title || "hakodiagram"}_${new Date().toISOString().split("T")[0]}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // JSON インポート
  inputFileJson.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const val = dataModel.validateSchema(parsed);
        if (!val.valid) {
          alert(`インポート失敗:\n${val.errors.join("\n")}`);
          return;
        }
        hasStickyPreviewSettings = false;
        dataModel.load(parsed);
        tableEditor.setActiveRoster(null);
        alert(`JSONファイル「${file.name}」を読み込みました。`);
      } catch (err) {
        alert(`ファイル解析エラー: ${err.message}`);
      }
      inputFileJson.value = "";
    };
    reader.readAsText(file);
  });

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
    oudImportModalBackdrop.hidden = false;
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

  if (inputFileOud) {
    inputFileOud.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        oudState.buffer = await file.arrayBuffer();
        oudState.fileName = file.name;
        if (oudSelectEncoding) oudSelectEncoding.value = "auto";
        reparseOudDocument();
        openOudImportModal();
      } catch (err) {
        alert(`OuDiaファイル解析エラー:\n${err.message}`);
      }
      inputFileOud.value = "";
    });
  }

  if (oudSelectEncoding) {
    oudSelectEncoding.addEventListener("change", () => {
      try {
        reparseOudDocument();
      } catch (err) {
        alert(`文字コード切替エラー:\n${err.message}`);
      }
    });
  }
  if (oudSelectDiagram) {
    oudSelectDiagram.addEventListener("change", () => {
      oudState.selectedVisibleIds = null;
      refreshOudPreview();
    });
  }
  [oudSelectFallback, oudCheckExcludeCanceled, oudCheckSameRow].forEach(el => {
    if (el) el.addEventListener("change", refreshOudPreview);
  });
  if (btnOudVisRecommended) btnOudVisRecommended.addEventListener("click", () => applyStationPreset("recommended"));
  if (btnOudVisMajor) btnOudVisMajor.addEventListener("click", () => applyStationPreset("major"));
  if (btnOudVisEndpoints) btnOudVisEndpoints.addEventListener("click", () => applyStationPreset("endpoints"));
  if (btnOudVisAll) btnOudVisAll.addEventListener("click", () => applyStationPreset("all"));

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
      closeOudImportModal();
    });
  }

  function syncBeforePrintState() {
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

  // 印刷 / PDF出力
  btnPrint.addEventListener("click", () => {
    preparePrintAndTrigger();
  });

  function preparePrintAndTrigger() {
    syncBeforePrintState();
    window.print();
    restoreAfterPrintState();
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
      renderPreview({ resetScroll: !checkShowAllPages.checked });
    }
  });

  btnNextPage.addEventListener("click", () => {
    if (currentPageIndex < totalPageCount) {
      currentPageIndex++;
      renderPreview({ resetScroll: !checkShowAllPages.checked });
    }
  });

  checkShowAllPages.addEventListener("change", () => {
    renderPreview();
  });

  // ズームコントロール
  selectZoom.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "fit" || val === "fit-width") {
      zoomMode = val;
    } else {
      zoomMode = "manual";
      currentZoom = parseFloat(val) || 1.0;
    }
    renderPreview();
  });

  btnZoomIn.addEventListener("click", () => {
    zoomMode = "manual";
    currentZoom = Math.min(2.0, Math.round((appliedScale + 0.15) * 100) / 100);
    syncZoomSelect();
    renderPreview();
  });

  btnZoomOut.addEventListener("click", () => {
    zoomMode = "manual";
    currentZoom = Math.max(0.3, Math.round((appliedScale - 0.15) * 100) / 100);
    syncZoomSelect();
    renderPreview();
  });

  function syncZoomSelect() {
    if (zoomMode === "fit") {
      selectZoom.value = "fit";
    } else if (zoomMode === "fit-width") {
      selectZoom.value = "fit-width";
    } else {
      const opt = Array.from(selectZoom.options).find(o => Math.abs(parseFloat(o.value) - currentZoom) < 0.05);
      if (opt) {
        selectZoom.value = opt.value;
      }
    }
  }

  window.addEventListener("resize", () => {
    if (zoomMode === "fit" || zoomMode === "fit-width") {
      renderPreview();
    }
  });

  // 8. 使い方・ヘルプ / お問い合わせ モーダル制御
  const btnHelp = document.getElementById("btnHelp");
  const helpModalBackdrop = document.getElementById("helpModalBackdrop");
  const btnCloseHelp = document.getElementById("btnCloseHelp");
  const btnCloseHelpFooter = document.getElementById("btnCloseHelpFooter");
  const btnOpenFeedbackFromHelp = document.getElementById("btnOpenFeedbackFromHelp");
  const helpModalNav = document.getElementById("helpModalNav");
  const helpModalBody = document.getElementById("helpModalBody");

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
    helpModalBackdrop.hidden = false;
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

  function openFeedbackModal() {
    if (!feedbackModalBackdrop) return;
    closeHelpModal();
    closeOudImportModal();
    feedbackModalBackdrop.hidden = false;
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
  if (btnFeedback) btnFeedback.addEventListener("click", openFeedbackModal);
  if (btnOpenFeedbackFromHelp) btnOpenFeedbackFromHelp.addEventListener("click", openFeedbackModal);

  bindModalCloseTriggers(helpModalBackdrop, btnCloseHelp, btnCloseHelpFooter, closeHelpModal);
  bindModalCloseTriggers(feedbackModalBackdrop, btnCloseFeedback, btnCloseFeedbackFooter, closeFeedbackModal);
  bindModalCloseTriggers(oudImportModalBackdrop, btnCloseOudImport, btnCancelOudImport, closeOudImportModal);

  if (helpModalNav && helpModalBody) {
    helpModalNav.querySelectorAll(".help-nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetId = btn.dataset.helpTarget;
        const sec = document.getElementById(targetId);
        helpModalNav.querySelectorAll(".help-nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        if (sec) sec.scrollIntoView({ behavior: "smooth", block: "start" });
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
      if (oudImportModalBackdrop && !oudImportModalBackdrop.hidden) {
        e.preventDefault();
        closeOudImportModal();
      } else if (feedbackModalBackdrop && !feedbackModalBackdrop.hidden) {
        e.preventDefault();
        closeFeedbackModal();
      } else if (helpModalBackdrop && !helpModalBackdrop.hidden) {
        e.preventDefault();
        closeHelpModal();
      }
    }
  });

  // 初回プレビュー描画
  renderPreview();
  updateHistoryButtons();
  updatePrintPageStyle(dataModel.getData());
});
