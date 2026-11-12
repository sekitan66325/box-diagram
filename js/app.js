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

  // 初期プリセットの読み込み (moka14)
  dataModel.load(PRESET_MOKA14);

  const editorContainer = document.getElementById("editorPane");
  const tableEditor = new BoxDiagramTableEditor(editorContainer, dataModel);
  const diagramRenderer = new BoxDiagramRenderer({ interactive: true });

  // DOM要素参照
  const presetSelect = document.getElementById("presetSelect");
  const btnUndo = document.getElementById("btnUndo");
  const btnRedo = document.getElementById("btnRedo");
  const btnExportJson = document.getElementById("btnExportJson");
  const inputFileJson = document.getElementById("inputFileJson");
  const btnPrint = document.getElementById("btnPrint");

  const splitter = document.getElementById("workspaceSplitter");
  const previewViewport = document.getElementById("previewViewport");
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

  // 3. データ変更リスナー（プレビューの再描画 & Undo/Redo更新）
  dataModel.subscribe((data, actionType) => {
    updateHistoryButtons();
    renderPreview({ resetScroll: actionType === "load" });
    updatePrintPageStyle(data);
  });

  function updateHistoryButtons() {
    btnUndo.disabled = !dataModel.canUndo();
    btnRedo.disabled = !dataModel.canRedo();
  }

  function updatePrintPageStyle(data) {
    const set = data.settings || {};
    const size = set.pageSize || "A4";
    const orientation = set.orientation || "portrait";
    if (dynamicPrintStyle) {
      dynamicPrintStyle.textContent = `
        @page {
          size: ${size} ${orientation};
          margin: 0;
        }
      `;
    }
  }

  // 4. プレビュー描画処理
  function renderPreview(options = {}) {
    const data = dataModel.getData();
    if (!data) return;

    const prevScrollLeft = previewViewport.scrollLeft;
    const prevScrollTop = previewViewport.scrollTop;

    const renderedPages = diagramRenderer.renderPages(data);
    totalPageCount = renderedPages.length;

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

    // ページごとの用紙寸法計算 (基準: A4 794×1123px, B5 688×971px)
    const set = data.settings || {};
    const isLandscape = set.orientation === "landscape";
    const isB5 = set.pageSize === "B5";

    let baseW = isB5 ? 688 : 794;
    let baseH = isB5 ? 971 : 1123;
    if (isLandscape) {
      const tmp = baseW;
      baseW = baseH;
      baseH = tmp;
    }

    // ズーム倍率の計算
    const availW = Math.max(200, previewViewport.clientWidth - 48);
    const availH = Math.max(200, previewViewport.clientHeight - 48);

    if (zoomMode === "fit-width") {
      appliedScale = availW / baseW;
    } else if (zoomMode === "fit") {
      const scaleW = availW / baseW;
      const scaleH = availH / baseH;
      appliedScale = Math.min(scaleW, scaleH);
    } else {
      appliedScale = currentZoom;
    }
    appliedScale = Math.max(0.2, Math.min(2.5, appliedScale));

    // 描画対象ページを決定
    const pagesToDraw = showAll ? renderedPages : renderedPages.filter(p => p.pageIndex === currentPageIndex);

    pagesToDraw.forEach(page => {
      const wrapperEl = document.createElement("div");
      wrapperEl.className = "preview-page-wrapper";
      wrapperEl.style.width = `${Math.round(baseW * appliedScale)}px`;
      wrapperEl.style.height = `${Math.round(baseH * appliedScale)}px`;

      const sheetEl = document.createElement("div");
      sheetEl.className = "preview-page-sheet";
      sheetEl.dataset.pageIndex = page.pageIndex;
      sheetEl.style.width = `${baseW}px`;
      sheetEl.style.height = `${baseH}px`;
      sheetEl.style.transform = `scale(${appliedScale})`;
      sheetEl.style.transformOrigin = "top left";

      sheetEl.innerHTML = page.svgHtml;
      wrapperEl.appendChild(sheetEl);
      previewViewport.appendChild(wrapperEl);

      // SVG内の対話イベントを設定
      bindSvgInteractions(sheetEl.querySelector("svg"), page.pageIndex);
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
  function bindSvgInteractions(svgEl, pageIdx) {
    if (!svgEl) return;

    // 列車線クリック -> 該当行を選択
    svgEl.querySelectorAll(".train-line-group").forEach(group => {
      group.addEventListener("click", (e) => {
        e.stopPropagation();
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

        const MIN_X = 54.24;
        const MAX_X = 1064.0;
        const MIN_Y = 48.64;
        const MAX_Y = 1540.0;

        const initialRect = svgEl.getBoundingClientRect();
        function clientToSvg(clientX, clientY) {
          const liveRect = svgEl.getBoundingClientRect();
          const r = (liveRect && liveRect.width > 0 && liveRect.height > 0) ? liveRect : initialRect;
          return {
            x: (clientX - r.left) * (1122.56 / r.width),
            y: (clientY - r.top) * (1587.36 / r.height)
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
        const stationXs = dataModel.getVisibleStations().map(s => s.x);

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
  presetSelect.addEventListener("change", (e) => {
    const val = e.target.value;
    if (val === "moka14") {
      dataModel.load(PRESET_MOKA14);
    } else if (val === "de10") {
      dataModel.load(PRESET_DE10);
    } else if (val === "sl_pc") {
      dataModel.load(PRESET_SL_PC);
    }
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
        dataModel.load(parsed);
        alert(`JSONファイル「${file.name}」を読み込みました。`);
      } catch (err) {
        alert(`ファイル解析エラー: ${err.message}`);
      }
      inputFileJson.value = "";
    };
    reader.readAsText(file);
  });

  // 印刷 / PDF出力
  btnPrint.addEventListener("click", () => {
    preparePrintAndTrigger();
  });

  function preparePrintAndTrigger() {
    const prevShowAll = checkShowAllPages.checked;
    if (!prevShowAll) {
      checkShowAllPages.checked = true;
      renderPreview();
    }
    window.print();
    if (!prevShowAll) {
      checkShowAllPages.checked = false;
      renderPreview();
    }
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

  // 8. 使い方・ヘルプ モーダル制御
  const btnHelp = document.getElementById("btnHelp");
  const helpModalBackdrop = document.getElementById("helpModalBackdrop");
  const btnCloseHelp = document.getElementById("btnCloseHelp");
  const btnCloseHelpFooter = document.getElementById("btnCloseHelpFooter");
  const helpModalNav = document.getElementById("helpModalNav");
  const helpModalBody = document.getElementById("helpModalBody");

  function openHelpModal() {
    if (!helpModalBackdrop) return;
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

  if (btnHelp) btnHelp.addEventListener("click", openHelpModal);
  if (btnCloseHelp) btnCloseHelp.addEventListener("click", closeHelpModal);
  if (btnCloseHelpFooter) btnCloseHelpFooter.addEventListener("click", closeHelpModal);
  if (helpModalBackdrop) {
    helpModalBackdrop.addEventListener("click", (e) => {
      if (e.target === helpModalBackdrop) closeHelpModal();
    });
  }
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
    } else if (e.key === "Escape" && helpModalBackdrop && !helpModalBackdrop.hidden) {
      e.preventDefault();
      closeHelpModal();
    }
  });

  // 初回プレビュー描画
  renderPreview();
  updateHistoryButtons();
  updatePrintPageStyle(dataModel.getData());
});
