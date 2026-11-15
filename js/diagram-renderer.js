/**
 * 箱ダイヤ描画ソフト - ベクターSVGレンダリングエンジン (DiagramRenderer)
 * 
 * 参照PDF（moka14.pdf, dl.pdf, sl-pc.pdf）およびExcel（車両運用_箱ダイヤ.xlsm）の解析結果に基づく
 * ピクセル完全一致（0.00px精度）かつパラメトリック伸縮対応のベクターSVGレンダラー
 * 
 * - 基準キャンバス: 1122.56 × 1587.36 px (96 DPI A4、0.75pt/px、Excel量子化0.16px)
 * - 基準行高: R = settings.baseRowHeight (デフォルト 12.96 px)
 * - 運用行間: S = settings.rosterStepRows (デフォルト 2 行)
 * - ブロック余白: P = settings.blockPaddingRows (デフォルト 2 行)
 * - 境界太線 2.56px / 内部細線 1.28px (Δ = 0.64px)
 * - 先頭列車線: Y = headerBottom + P * R + Δ = 125.28px
 * - ブロック下線: Y = Y_lastTrain + P * R - Δ = Y_lastTrain + 25.28px
 * - 省略駅名線: Y = Y_border + 1 * R + Δ = Y_border + 13.60px
 * - 次ブロック先頭: Y = Y_subLine + P * R = Y_subLine + 25.92px
 * - 駅名ヘッダー: 縦書き（2文字/3文字以上均等配置）/ 横書き切替対応
 * - 注記: ページ単位（page: 1, 2, 3...）ごとの正確な分離描画
 */

class BoxDiagramRenderer {
  constructor(options = {}) {
    this.options = Object.assign({
      interactive: true,
      onTrainClick: null,
      onNoteDrag: null
    }, options);

    // 選択状態
    this.selectedRosterId = null;
    this.selectedTrainIndex = -1;
  }

  setSelection(rosterId, trainIndex) {
    this.selectedRosterId = rosterId;
    this.selectedTrainIndex = trainIndex;
  }

  /**
   * データを受け取り、ページごとのSVG文字列配列を返す
   * @param {Object} data 
   * @returns {Array<{ pageIndex: number, totalPages: number, svgHtml: string }>}
   */
  renderPages(data) {
    this.lastDiagnostics = null;
    if (!data || !data.rosters || data.rosters.length === 0) {
      return [{ pageIndex: 1, totalPages: 1, svgHtml: this.renderEmptySvg(data), pageConfig: null }];
    }

    const rawCfg = (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.getEffectivePageConfig)
      ? BoxDiagramDataModel.getEffectivePageConfig(data.settings)
      : null;
    const timeRange = (rawCfg ? rawCfg.xAxisMode : (data.settings && data.settings.xAxisMode)) === "time"
      ? this.computeTimeAxisRange(data)
      : null;

    let geom;
    let pages;
    if (rawCfg && rawCfg.isAutoPageSize) {
      const autoPlan = this.resolveAutoLayout(data, rawCfg, timeRange);
      geom = autoPlan.geom;
      pages = autoPlan.pages;
    } else {
      geom = this.getPageGeometry(data, rawCfg);
      pages = this.paginateRosters(data, geom);
    }

    const diagAcc = {
      omittedTimeLabelCount: 0,
      multiLaneRosterCount: 0,
      labelOverlapCount: 0,
      maxContentBottomY: 0
    };

    const totalPages = pages.length;

    const result = pages.map((pageRosters, pIdx) => {
      const pageIndex = pIdx + 1;
      const svgHtml = geom.xAxisMode === "time"
        ? this.renderTimeAxisSinglePage(data, pageRosters, pageIndex, totalPages, geom, timeRange, diagAcc)
        : this.renderSinglePage(data, pageRosters, pageIndex, totalPages, geom, diagAcc);
      return { pageIndex, totalPages, svgHtml, pageConfig: geom.pageConfig };
    });

    this.lastDiagnostics = this.buildLayoutDiagnostics(data, geom, timeRange, totalPages, diagAcc);
    return result;
  }

  /**
   * 変形（自動フィット）モード時に、時間帯／駅数と運用ブロック実高さから最適な用紙寸法(mm)を算出
   */
  resolveAutoLayout(data, rawCfg, timeRange) {
    const xAxisMode = rawCfg.xAxisMode === "time" ? "time" : "station";
    let autoWidthMm = 297;

    if (xAxisMode === "time" && timeRange) {
      const hours = Math.max(4, timeRange.endHour - timeRange.startHour);
      let totalTrains = 0;
      let shortTrains = 0;
      const dayStartMin = timeRange.dayStartMin;
      for (const r of (data.rosters || [])) {
        for (const tr of (r.trains || [])) {
          const dm = this._parseTimeAxisMinutes(tr.depTime, dayStartMin);
          const am0 = this._parseTimeAxisMinutes(tr.arrTime, dayStartMin);
          if (dm !== null && am0 !== null) {
            const am = (am0 < dm && am0 + 1440 - dm <= 720) ? am0 + 1440 : am0;
            const dur = Math.max(0, am - dm);
            totalTrains++;
            if (dur <= 22) shortTrains++;
          }
        }
      }
      const shortRatio = totalTrains > 0 ? shortTrains / totalTrains : 0;
      const densityFull = !!(data.settings && data.settings.timeAxisLabelDensity === "full");
      let targetPxPerHour = 135;
      if (densityFull) {
        targetPxPerHour = 165;
      } else if (shortRatio >= 0.4 || hours <= 10) {
        targetPxPerHour = 155;
      }
      const rawCanvasW = hours * targetPxPerHour + 245.92;
      const rawMmW = rawCanvasW / 5.345;
      autoWidthMm = Math.max(297, Math.min(1400, Math.ceil(rawMmW / 5) * 5));
    } else {
      const visibleStations = (data.stations || []).filter(s => s.visible !== false);
      if (visibleStations.length <= 4) {
        autoWidthMm = 210;
      } else {
        autoWidthMm = Math.max(210, Math.min(1000, Math.ceil((75 + Math.max(1, visibleStations.length - 1) * 52) / 5) * 5));
      }
    }

    // 最大印刷高さ上限 (380mm) 基準で改ページを計算し、実内容高さを測る
    const AUTO_MAX_HEIGHT_MM = 380;
    const capDims = BoxDiagramDataModel.computeDimensionsFromMm(autoWidthMm, AUTO_MAX_HEIGHT_MM);
    const capCfg = Object.assign({}, rawCfg, capDims, { isAutoPageSize: true, isCustomPageSize: false });
    const capGeom = this.getPageGeometry(data, capCfg);
    const pages = this.paginateRosters(data, capGeom);

    let maxNeededHeightMm = 115;
    const visibleNotes = (data.notes || []).filter(n => (n.axisMode === "time" ? "time" : "station") === xAxisMode);

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      const pageRosters = pages[pIdx];
      const pageNum = pIdx + 1;
      let bottomY = capGeom.headerBottom + capGeom.borderWidth;
      for (let i = 0; i < pageRosters.length; i++) {
        bottomY += xAxisMode === "time"
          ? this.calculateTimeAxisRosterBlockHeight(data, pageRosters[i], i === 0)
          : this.calculateRosterBlockHeight(data, pageRosters[i], i === 0);
      }

      let contentEndY = bottomY;
      for (const n of visibleNotes) {
        const np = (n.page === "all" || n.page === undefined) ? "all" : (typeof n.page === "number" ? n.page : parseInt(n.page, 10));
        if (np !== "all" && np !== pageNum) continue;
        if (Number.isFinite(n.y) && n.y <= capGeom.H - 40) {
          const nf = Number.isFinite(n.fontSize) ? n.fontSize : 10.72;
          contentEndY = Math.max(contentEndY, n.y + nf * 0.4 + 8);
        }
      }

      const neededCanvasH = contentEndY + 72.0;
      const neededMm = Math.ceil((neededCanvasH / 5.345) / 5) * 5;
      maxNeededHeightMm = Math.max(maxNeededHeightMm, Math.min(420, neededMm));
    }

    const finalDims = BoxDiagramDataModel.computeDimensionsFromMm(autoWidthMm, maxNeededHeightMm);
    const finalCfg = Object.assign({}, rawCfg, finalDims, { isAutoPageSize: true, isCustomPageSize: false });
    const geom = this.getPageGeometry(data, finalCfg);
    return { geom, pages };
  }

  /**
   * 直近の renderPages 実行で算出されたレイアウト診断・用紙提案情報を返す
   */
  getLastDiagnostics() {
    return this.lastDiagnostics || null;
  }

  /**
   * 現在の設定から論理SVGキャンバス＆枠座標を解決する
   * （A4・B5縦向きでは従来座標と0.00px完全一致を維持）
   */
  getPageGeometry(data, overridePageCfg = null) {
    const settings = (data && data.settings) || {};
    const cfg = overridePageCfg || ((typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.getEffectivePageConfig)
      ? BoxDiagramDataModel.getEffectivePageConfig(settings)
      : {
        xAxisMode: settings.xAxisMode === "time" ? "time" : "station",
        isSeparateMode: !!settings.separatePageSettingsByAxisMode,
        pageSize: settings.pageSize || "A4",
        orientation: settings.orientation === "landscape" ? "landscape" : "portrait",
        isLandscape: settings.orientation === "landscape",
        canvasW: settings.orientation === "landscape" ? 1587.36 : 1122.56,
        canvasH: settings.orientation === "landscape" ? 1122.56 : 1587.36,
        canvasScale: 1.0,
        isAutoPageSize: false,
        isCustomPageSize: false
      });

    const round2 = (v) => Math.round(v * 100) / 100;
    const W = cfg.canvasW;
    const H = cfg.canvasH;
    const isLandscape = cfg.isLandscape;
    const isDynamicSize = !!(cfg.isAutoPageSize || cfg.isCustomPageSize);
    const isExactClassicA4B5Portrait = (!isDynamicSize && cfg.canvasScale === 1.0 && !isLandscape);
    const isCompact = !isDynamicSize && cfg.canvasScale < 0.9;

    const borderWidth = 2.56;
    const tableLeft = isCompact ? 38.0 : 53.92;
    const rosterColW = isCompact ? 56.0 : 66.40;
    const tableInnerX = round2(tableLeft + rosterColW);
    const tableRight = isExactClassicA4B5Portrait ? 1064.96 : round2(W - tableLeft - 3.68);
    const headerTop = 48.64;
    const headerBottom = 98.72;
    const Y_MAX = isExactClassicA4B5Portrait
      ? 1420.0
      : (isDynamicSize ? round2(H - 72.0) : round2(H - (isCompact ? 112.0 : 167.36)));
    const footerX = isExactClassicA4B5Portrait ? 550.72 : round2(W / 2);
    const footerY = isExactClassicA4B5Portrait
      ? 1552.96
      : (isDynamicSize ? round2(H - 28.0) : round2(H - (isCompact ? 26.0 : 34.40)));

    const stationPlotLeft = isExactClassicA4B5Portrait ? 200.32 : round2(tableInnerX + (isCompact ? 56.0 : 80.0));
    const stationPlotRight = isExactClassicA4B5Portrait ? 987.52 : round2(tableRight - (isCompact ? 54.0 : 77.44));

    const timePlotLeft = round2(tableInnerX + (isCompact ? 24.0 : 34.0));
    const timePlotRight = round2(tableRight - (isCompact ? 24.0 : 34.0));

    return {
      pageConfig: cfg,
      xAxisMode: cfg.xAxisMode,
      isSeparateMode: cfg.isSeparateMode,
      stationAxisDirection: settings.stationAxisDirection === "rtl" ? "rtl" : "ltr",
      pageSize: cfg.pageSize,
      orientation: cfg.orientation,
      isLandscape,
      isDynamicSize,
      canvasScale: cfg.canvasScale,
      W,
      H,
      borderWidth,
      tableLeft,
      rosterColW,
      tableInnerX,
      tableRight,
      headerTop,
      headerBottom,
      Y_MAX,
      footerX,
      footerY,
      titleLeftX: isExactClassicA4B5Portrait ? 54.24 : round2(tableLeft + 0.32),
      copyRightX: isExactClassicA4B5Portrait ? 1066.24 : round2(tableRight + 1.28),
      rosterLabelX: isExactClassicA4B5Portrait ? 88.40 : round2(tableLeft + rosterColW * 0.519),
      stationPlotLeft,
      stationPlotRight,
      timePlotLeft,
      timePlotRight,
      isExactClassicA4B5Portrait
    };
  }

  /**
   * 運用のページ分割計算
   */
  paginateRosters(data, geom = null) {
    const g = geom || this.getPageGeometry(data);
    const settings = data.settings || {};
    const mode = settings.pageBreakMode || "auto";
    const rosters = data.rosters;

    if (mode === "manual" && g.xAxisMode !== "time") {
      const pages = [];
      let currentPage = [];
      for (let i = 0; i < rosters.length; i++) {
        currentPage.push(rosters[i]);
        if (rosters[i].pageBreakAfter && i < rosters.length - 1) {
          pages.push(currentPage);
          currentPage = [];
        }
      }
      if (currentPage.length > 0) {
        pages.push(currentPage);
      }
      return pages.length > 0 ? pages : [rosters];
    }

    // 自動改ページ (Auto Mode)
    const Y_MAX = g.Y_MAX;
    const pages = [];
    let currentPage = [];
    let currentY = g.headerBottom + g.borderWidth; // ヘッダー枠下端 101.28

    for (let i = 0; i < rosters.length; i++) {
      const roster = rosters[i];
      const isFirst = currentPage.length === 0;
      const blockHeight = g.xAxisMode === "time"
        ? this.calculateTimeAxisRosterBlockHeight(data, roster, isFirst)
        : this.calculateRosterBlockHeight(data, roster, isFirst);

      const forceBreak = g.xAxisMode !== "time" && !!roster.pageBreakAfter;
      if (!isFirst && (currentY + blockHeight > Y_MAX || forceBreak)) {
        pages.push(currentPage);
        currentPage = [roster];
        const nextBlockHeight = g.xAxisMode === "time"
          ? this.calculateTimeAxisRosterBlockHeight(data, roster, true)
          : this.calculateRosterBlockHeight(data, roster, true);
        currentY = g.headerBottom + g.borderWidth + nextBlockHeight;
      } else {
        currentPage.push(roster);
        currentY += blockHeight;
      }
    }

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }
    return pages.length > 0 ? pages : [rosters];
  }

  /**
   * 運用ブロックの所要高さを計算（パラメトリック公式）
   */
  calculateRosterBlockHeight(data, roster, isFirstOnPage) {
    const settings = data.settings || {};
    const R = typeof settings.baseRowHeight === "number" ? settings.baseRowHeight : 12.96;
    const S = typeof settings.rosterStepRows === "number" ? settings.rosterStepRows : 2;
    const P = typeof settings.blockPaddingRows === "number" ? settings.blockPaddingRows : 2;
    const subHeaderMode = settings.subHeaderMode || "omitFirst";
    const scale = typeof roster.rowScale === "number" ? roster.rowScale : 1.0;

    const borderWidth = 2.56;
    const subLineWidth = 1.28;
    const delta = (borderWidth - subLineWidth) / 2; // 0.64

    let h = 0;
    const showSubHeader = subHeaderMode === "all" || (!isFirstOnPage && subHeaderMode !== "none");
    if (!isFirstOnPage && showSubHeader) {
      h += 1 * R + delta; // 13.60px
    }

    const trains = roster.trains || [];
    if (trains.length === 0) {
      h += 40.0;
    } else {
      h += P * R * scale; // 開始余白
      for (let k = 1; k < trains.length; k++) {
        const stepRows = typeof trains[k].stepRows === "number" ? trains[k].stepRows : S;
        h += stepRows * R * scale;
      }
      h += P * R * scale - delta; // 終了余白 (25.28px)
    }

    h += borderWidth; // 境界線 2.56px
    return h;
  }

  /**
   * 論理駅 X 座標 [200.32, 987.52] を現在ページのキャンバスプロット範囲へ写像する
   */
  mapStationXToCanvas(logicalX, geom) {
    if (!Number.isFinite(logicalX)) return geom.stationPlotLeft;
    const isRtl = geom.stationAxisDirection === "rtl";
    if (geom.isExactClassicA4B5Portrait) {
      return isRtl ? Math.round((200.32 + 987.52 - logicalX) * 100) / 100 : logicalX;
    }
    const srcSpan = 987.52 - 200.32;
    const dstSpan = geom.stationPlotRight - geom.stationPlotLeft;
    const t = (logicalX - 200.32) / srcSpan;
    const mappedT = isRtl ? (1 - t) : t;
    return Math.round((geom.stationPlotLeft + mappedT * dstSpan) * 100) / 100;
  }

  /**
   * 外枠縦線・注記・フッター・SVG全体の組み立て共通ヘルパー
   */
  finalizeSvgPage(elements, data, geom, prevBlockBorderBottom, pageIndex, totalPages, activeAxisMode) {
    const {
      W, H, borderWidth, tableLeft, tableInnerX, tableRight, headerTop,
      titleLeftX, copyRightX, footerX, footerY
    } = geom;

    const titleText = data.metadata ? (data.metadata.title || "") : "";
    const copyText = data.metadata ? (data.metadata.copyright || "") : "";
    const set = (data && data.settings) || {};
    const showTitle = set.showHeaderTitle !== false;
    const showCopy = set.showHeaderCopyright !== false;
    const colHeaderText = typeof set.rosterColHeaderText === "string" ? set.rosterColHeaderText : "運用番号";

    const headerChrome = `
      ${(showTitle && titleText) ? `<text class="font-f1 font-header" x="${titleLeftX}" y="43.20" font-size="13.28" fill="#000000" text-anchor="start">${this.escapeXml(titleText)}</text>` : ""}
      ${(showCopy && copyText) ? `<text class="font-f1 font-header" x="${copyRightX}" y="43.20" font-size="13.28" fill="#000000" text-anchor="end">${this.escapeXml(copyText)}</text>` : ""}
      <!-- ヘッダー上枠線 -->
      <rect x="${tableLeft}" y="${headerTop}" width="${(tableRight + borderWidth - tableLeft).toFixed(2)}" height="${borderWidth}" fill="#000000" />
      <!-- ヘッダー下枠線 -->
      <rect x="${tableLeft}" y="${geom.headerBottom}" width="${(tableRight + borderWidth - tableLeft).toFixed(2)}" height="${borderWidth}" fill="#000000" />
      <text class="font-f1 font-header" x="${(tableLeft + 8.48).toFixed(2)}" y="79.84" font-size="13.28" fill="#000000" text-anchor="start">${this.escapeXml(colHeaderText)}</text>
    `;

    // 左右の外枠縦線 (表全体の高さをカバー)
    const tableTotalH = prevBlockBorderBottom - headerTop;
    elements.push(`
      <!-- 左外枠線 -->
      <rect x="${tableLeft}" y="${headerTop}" width="${borderWidth}" height="${tableTotalH.toFixed(2)}" fill="#000000" />
      <!-- 運用番号列境界線 -->
      <rect x="${tableInnerX}" y="${(headerTop + borderWidth).toFixed(2)}" width="${borderWidth}" height="${(tableTotalH - borderWidth).toFixed(2)}" fill="#000000" />
      <!-- 右外枠線 -->
      <rect x="${tableRight}" y="${headerTop}" width="${borderWidth}" height="${tableTotalH.toFixed(2)}" fill="#000000" />
    `);

    const resolveFontCss = (fontId, fallback = "F1") => {
      if (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.resolveFontCss) {
        return BoxDiagramDataModel.resolveFontCss(fontId, fallback);
      }
      return '"MS PGothic", "ＭＳ Ｐゴシック", "MS UI Gothic", sans-serif';
    };
    const normalizeFontId = (fontId, fallback = "F1") => {
      if (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.normalizeFontId) {
        return BoxDiagramDataModel.normalizeFontId(fontId, fallback);
      }
      return fontId || fallback;
    };

    // 注記テキスト (Notes) の描画（該当ページ・該当軸モードのみ描画）
    if (data.notes && data.notes.length > 0) {
      for (const n of data.notes) {
        const noteAxis = n.axisMode === "time" ? "time" : "station";
        if (noteAxis !== activeAxisMode) continue;

        const notePage = (n.page === "all" || n.page === undefined) ? "all" : (typeof n.page === "number" ? n.page : parseInt(n.page, 10));
        if (notePage !== "all" && notePage !== pageIndex) {
          continue;
        }

        const noteX = Number.isFinite(n.x) ? n.x : 202.40;
        const noteY = Number.isFinite(n.y) ? n.y : 340.48;
        const noteColor = n.color || "#FF0000";
        const noteSize = Number.isFinite(n.fontSize) ? n.fontSize : 10.72;
        const noteFontId = normalizeFontId(n.font, "F1");

        elements.push(`
          <g class="diagram-note" data-note-id="${this.escapeXml(n.id)}" transform="translate(${noteX.toFixed(2)}, ${noteY.toFixed(2)})" style="cursor: move;">
            <text class="font-f1 font-preset-${this.escapeXml(noteFontId)}" x="0" y="0" font-size="${noteSize}" fill="${noteColor}">${this.escapeXml(n.text)}</text>
          </g>
        `);
      }
    }

    // フッター・ヘッダーページ番号（設定により有無・書式・位置を切替）
    const pageNumEnabled = set.pageNumberEnabled !== false;
    const hideSinglePageNum = !!set.pageNumberHideSingle;
    if (pageNumEnabled && !(hideSinglePageNum && totalPages <= 1)) {
      const pnFmt = set.pageNumberFormat || "slash";
      const pnPos = set.pageNumberPosition || "bottom-center";
      const pnText = this.formatPageNumberText(pageIndex, totalPages, pnFmt);
      let pnX = footerX;
      let pnY = footerY;
      let pnAnchor = "middle";
      if (pnPos === "bottom-right") {
        pnX = copyRightX;
        pnAnchor = "end";
      } else if (pnPos === "bottom-left") {
        pnX = titleLeftX;
        pnAnchor = "start";
      } else if (pnPos === "top-center") {
        pnX = footerX;
        pnY = "43.20";
        pnAnchor = "middle";
      }
      elements.push(`
        <text class="font-f1 font-header diagram-page-number" x="${pnX}" y="${pnY}" font-size="13.28" fill="#000000" text-anchor="${pnAnchor}">${this.escapeXml(pnText)}</text>
      `);
    }

    const rawFonts = (data && data.settings && data.settings.fonts) || {};
    const fontHeaderCss = resolveFontCss(rawFonts.header, "F1");
    const fontStationCss = resolveFontCss(rawFonts.station, "F1");
    const fontSubStationCss = (rawFonts.station && rawFonts.station !== "F1")
      ? fontStationCss
      : resolveFontCss("F3", "F3");
    const fontRosterCss = resolveFontCss(rawFonts.roster, "F1");
    const fontTrainNoCss = resolveFontCss(rawFonts.trainNo, "F1");
    const fontTimeCss = resolveFontCss(rawFonts.time, "F2");

    const presetMap = (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.FONT_PRESETS)
      ? BoxDiagramDataModel.FONT_PRESETS
      : {
        F1: { css: resolveFontCss("F1", "F1") },
        F2: { css: resolveFontCss("F2", "F2") },
        F3: { css: resolveFontCss("F3", "F3") }
      };
    const presetRules = Object.keys(presetMap)
      .map(k => `.font-preset-${k} { font-family: ${presetMap[k].css}; }`)
      .join("\n            ");

    return `
      <svg class="box-diagram-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>
            .font-f1 { font-family: "MS PGothic", "ＭＳ Ｐゴシック", "MS UI Gothic", sans-serif; }
            .font-f2 { font-family: "MS Mincho", "ＭＳ 明朝", serif; }
            .font-f3 { font-family: "MS Gothic", "ＭＳ ゴシック", monospace; }
            .font-header { font-family: ${fontHeaderCss}; }
            .font-station { font-family: ${fontStationCss}; }
            .font-substation { font-family: ${fontSubStationCss}; }
            .font-roster { font-family: ${fontRosterCss}; }
            .font-trainno { font-family: ${fontTrainNoCss}; }
            .font-time { font-family: ${fontTimeCss}; }
            ${presetRules}
            .train-line-group { cursor: pointer; }
            .train-line-group line { transition: stroke-width 0.14s ease, opacity 0.14s ease; }
            .train-line-group:hover line { stroke-width: 2.3px; }
            .diagram-note:hover text { text-decoration: underline; }
            .diagram-empty-hint { pointer-events: none; }
            @media print { .diagram-empty-hint { display: none; } .train-line-group line { transition: none; } }
          </style>
        </defs>
        <rect width="${W}" height="${H}" fill="#FFFFFF" />
        ${headerChrome}
        ${elements.join("\n")}
      </svg>
    `;
  }

  /**
   * 単一ページのSVG描画（横軸＝駅モード）
   */
  renderSinglePage(data, pageRosters, pageIndex, totalPages, geomArg = null, diagAcc = null) {
    const geom = geomArg || this.getPageGeometry(data);
    const settings = data.settings || {};
    const R = typeof settings.baseRowHeight === "number" ? settings.baseRowHeight : 12.96;
    const S = typeof settings.rosterStepRows === "number" ? settings.rosterStepRows : 2;
    const P = typeof settings.blockPaddingRows === "number" ? settings.blockPaddingRows : 2;
    const stationHeaderDir = settings.stationHeaderDirection || "vertical";
    const subHeaderMode = settings.subHeaderMode || "omitFirst";
    const highlightStyle = settings.selfHighlightStyle || "red";
    const stationGridStyle = settings.stationGridStyle || "none";
    const turnaroundColorMode = settings.turnaroundColorMode || "next";
    const lineWidthScale = this.getScaleSetting(settings, "lineWidthScale", 1.0, 0.5, 2.5);
    const rosterZebraFill = !!settings.rosterZebraFill;

    const borderWidth = geom.borderWidth;
    const subLineWidth = 1.28;
    const delta = (borderWidth - subLineWidth) / 2; // 0.64

    const { tableLeft, tableInnerX, tableRight, headerBottom } = geom;

    // 主要駅と座標（非表示駅も駅順から線形補間して解決＋キャンバス写像）
    const visibleStations = (data.stations || []).filter(s => s.visible !== false);
    const rawResolveStationX = this.createStationXResolver(data.stations || [], visibleStations);
    const resolveStationX = (stationId, fallbackLogicalX) => {
      const lx = rawResolveStationX(stationId, fallbackLogicalX);
      if (lx === undefined) return undefined;
      return this.mapStationXToCanvas(lx, geom);
    };

    let elements = [];

    // 駅名ヘッダー描画 (縦書き vs 横書き)
    for (const st of visibleStations) {
      const stX = this.mapStationXToCanvas(st.x, geom);
      const name = st.name || "";
      if (stationHeaderDir === "horizontal") {
        elements.push(`
          <text class="font-f1 font-station" x="${stX}" y="78.00" font-size="13.28" fill="#000000" text-anchor="middle">${this.escapeXml(name)}</text>
        `);
      } else {
        // 縦書きモード
        if (name.length <= 2) {
          const char1 = name.length > 0 ? name[0] : "";
          const char2 = name.length > 1 ? name[1] : "";
          if (name.length === 1) {
            elements.push(`
              <text class="font-f1 font-station" x="${stX}" y="79.68" font-size="14.72" fill="#000000" text-anchor="middle">${this.escapeXml(char1)}</text>
            `);
          } else {
            elements.push(`
              <text class="font-f1 font-station" x="${stX}" y="71.52" font-size="14.72" fill="#000000" text-anchor="middle">${this.escapeXml(char1)}</text>
              <text class="font-f1 font-station" x="${stX}" y="87.84" font-size="14.72" fill="#000000" text-anchor="middle">${this.escapeXml(char2)}</text>
            `);
          }
        } else {
          // 3文字以上は枠内側の上下中央 (innerTop..innerBottom) を基準に均等・上下対称配置
          const len = name.length;
          const innerTop = geom.headerTop + geom.borderWidth;
          const innerBottom = geom.headerBottom;
          const innerH = innerBottom - innerTop;
          const boxCenterY = (innerTop + innerBottom) / 2;
          const edgePad = Math.max(2.5, Math.min(4.6, 13.5 / len));
          const fSize = Math.min(12.2, Math.max(6.8, (innerH - 2 * edgePad) / (len * 1.12)));
          const spanCenters = Math.max(0, innerH - 2 * edgePad - fSize);
          const startCenterY = boxCenterY - spanCenters / 2;
          const stepY = spanCenters / (len - 1);
          for (let ci = 0; ci < len; ci++) {
            const chY = startCenterY + ci * stepY;
            elements.push(`
              <text class="font-f1 font-station" x="${stX}" y="${chY.toFixed(2)}" font-size="${fSize.toFixed(1)}" fill="#000000" text-anchor="middle" dominant-baseline="central">${this.escapeXml(name[ci])}</text>
            `);
          }
        }
      }
    }

    // 2. 運用ブロックの描画
    let prevBlockBorderTop = null;
    let prevBlockBorderBottom = headerBottom + borderWidth; // 101.28

    const subHeaderLineX = tableInnerX + borderWidth;
    const subHeaderLineW = tableRight - subHeaderLineX;
    const blockBorderX = tableLeft + borderWidth;
    const blockBorderW = tableRight + borderWidth - blockBorderX;
    const labelOffsetScale = geom.canvasScale < 0.9 ? geom.canvasScale : 1.0;

    for (let rIdx = 0; rIdx < pageRosters.length; rIdx++) {
      const roster = pageRosters[rIdx];
      const isFirstOnPage = (rIdx === 0);
      const showSubHeader = subHeaderMode === "all" || (!isFirstOnPage && subHeaderMode !== "none");
      const scale = typeof roster.rowScale === "number" ? roster.rowScale : 1.0;

      let subHeaderLineY = null;
      let firstTrainY = 0;

      if (isFirstOnPage) {
        firstTrainY = headerBottom + P * R + delta; // 98.72 + 2 * 12.96 + 0.64 = 125.28
      } else {
        const refBorderTop = (prevBlockBorderTop !== null) ? prevBlockBorderTop : headerBottom;
        if (showSubHeader) {
          subHeaderLineY = refBorderTop + 1 * R + delta; // 267.20 + 13.60 = 280.80
          firstTrainY = subHeaderLineY + P * R; // 280.80 + 25.92 = 306.72
        } else {
          firstTrainY = prevBlockBorderBottom + P * R;
        }
      }

      // 省略駅名行（サブヘッダー）の描画
      if (!isFirstOnPage && showSubHeader && subHeaderLineY !== null) {
        // 省略駅名文字 (下 真 茂)
        for (const st of visibleStations) {
          const stX = this.mapStationXToCanvas(st.x, geom);
          const abbr = st.abbr || (st.name ? st.name[0] : "");
          // 元PDFでは下と茂は擬似太字、真は標準
          const isBold = (abbr === "下" || abbr === "茂");
          const strokeAttr = isBold ? `stroke="#000000" stroke-width="0.107"` : ``;
          // テキスト基準線は線の上 1.76px
          const textY = subHeaderLineY - 1.76;
          elements.push(`
            <text class="font-f3 font-substation" x="${stX}" y="${textY.toFixed(2)}" font-size="10.72" fill="#000000" ${strokeAttr} text-anchor="middle">${this.escapeXml(abbr)}</text>
          `);
        }

        elements.push(`
          <rect x="${subHeaderLineX.toFixed(2)}" y="${subHeaderLineY.toFixed(2)}" width="${subHeaderLineW.toFixed(2)}" height="1.28" fill="#000000" />
        `);
      }

      // 列車線の配置
      const trains = roster.trains || [];
      const trainPositions = [];
      let trainLineY = firstTrainY;

      for (let k = 0; k < trains.length; k++) {
        if (k > 0) {
          const stepRows = typeof trains[k].stepRows === "number" ? trains[k].stepRows : S;
          trainLineY += stepRows * R * scale;
        }
        trainPositions.push({
          train: trains[k],
          index: k,
          y: trainLineY
        });
      }

      // 運用ブロック下部太線 Y (ページ末尾は 2*R、後続ブロックがある場合は 2*R - delta)
      const isLastOnPage = (rIdx === pageRosters.length - 1);
      const bottomDelta = isLastOnPage ? 0 : delta;
      const blockBottomBorderTop = (trainPositions.length > 0)
        ? trainLineY + P * R * scale - bottomDelta
        : firstTrainY + 2 * R * scale;
      const blockBottomBorderBottom = blockBottomBorderTop + borderWidth;

      // 運用ブロックゼブラ背景 & 駅縦ガイド線（列車線より下層）
      const blockContentTopY = (!isFirstOnPage && showSubHeader && subHeaderLineY !== null)
        ? subHeaderLineY + subLineWidth
        : prevBlockBorderBottom;
      if (rosterZebraFill && rIdx % 2 === 1) {
        const zebraW = tableRight - (tableLeft + borderWidth);
        const zebraH = blockBottomBorderTop - prevBlockBorderBottom;
        if (zebraW > 0 && zebraH > 0) {
          elements.push(`
            <rect x="${(tableLeft + borderWidth).toFixed(2)}" y="${prevBlockBorderBottom.toFixed(2)}" width="${zebraW.toFixed(2)}" height="${zebraH.toFixed(2)}" fill="#F8FAFC" />
          `);
        }
      }
      if (stationGridStyle === "dashed" || stationGridStyle === "solid") {
        const dashGridAttr = stationGridStyle === "dashed" ? `stroke="#CBD5E1" stroke-dasharray="3,2.5"` : `stroke="#E2E8F0"`;
        const gridHBottom = blockBottomBorderTop;
        for (const st of visibleStations) {
          const stX = this.mapStationXToCanvas(st.x, geom);
          elements.push(`
            <line x1="${stX}" y1="${blockContentTopY.toFixed(2)}" x2="${stX}" y2="${gridHBottom.toFixed(2)}" ${dashGridAttr} stroke-width="0.72" />
          `);
        }
      }

      // 運用番号（左列の中央に配置）
      // Y座標: (prevBlockBorderBottom + blockBottomBorderTop) / 2 + 6.32
      const rosterCenterY = (prevBlockBorderBottom + blockBottomBorderTop) / 2 + 6.32;
      elements.push(`
        <text class="font-f1 font-roster" x="${geom.rosterLabelX}" y="${rosterCenterY.toFixed(2)}" font-size="18.72" fill="#000000" text-anchor="middle">${this.escapeXml(roster.name || roster.id)}</text>
      `);
      if (this.options.interactive && rIdx === 0 && pageRosters.every(r => (r.trains || []).length === 0)) {
        this.appendEmptyRosterHint(elements, geom.stationPlotLeft, geom.stationPlotRight, prevBlockBorderBottom, blockBottomBorderTop);
      }

      // 列車と折り返し線を描画
      for (let k = 0; k < trainPositions.length; k++) {
        const item = trainPositions[k];
        const tr = item.train;
        const yTop = item.y;
        const fromX = resolveStationX(tr.fromStation, 200.32);
        const toX = resolveStationX(tr.toStation, 987.52);

        const type = this.getTrainType(data, tr.typeId);
        const lineColor = type.lineColor || "#000000";
        const timeColor = type.timeColor || "#000000";
        const textColor = type.textColor || "#000000";

        // 前の列車との折り返し縦線（駅が一致し、連続する場合）
        let hasIncomingTurnaround = false;
        if (k > 0) {
          const prevItem = trainPositions[k - 1];
          const prevTr = prevItem.train;
          const prevEndX = resolveStationX(prevTr.toStation, undefined);

          if (prevEndX !== undefined && Math.abs(prevEndX - fromX) < 1.0) {
            hasIncomingTurnaround = true;
            // 入庫 (△/▲) -> 出庫 (○/●) の間は車両基地入庫中のため垂直接続線を描画しない
            if (!this.isDepotTurnaroundBreak(prevTr, tr)) {
              const vY1 = prevItem.y;
              const vY2 = yTop + 1.28;
              const vW = 1.28 * lineWidthScale;
              const vX = fromX - vW / 2;
              let vColor = lineColor || "#000000";
              if (turnaroundColorMode === "prev") {
                const prevType = this.getTrainType(data, prevTr.typeId);
                vColor = (prevType && prevType.lineColor) || "#000000";
              } else if (turnaroundColorMode === "black") {
                vColor = "#000000";
              }
              elements.push(`
                <rect x="${vX.toFixed(2)}" y="${vY1.toFixed(2)}" width="${vW.toFixed(2)}" height="${(vY2 - vY1).toFixed(2)}" fill="${vColor}" />
              `);
            }
          }
        }

        // 水平列車線
        const minX = Math.min(fromX, toX);
        const maxX = Math.max(fromX, toX);
        const lineW = maxX - minX;

        const isSelected = (this.selectedRosterId === roster.id && this.selectedTrainIndex === k);
        const selectedGlow = isSelected ? `stroke="#2F6F73" stroke-width="4" stroke-opacity="0.4"` : ``;

        // 破線スタイル
        const dashAttr = type.lineStyle === "dashed" ? `stroke-dasharray="6,3"` : (type.lineStyle === "dotted" ? `stroke-dasharray="2,2"` : ``);
        const yLineCenter = yTop + 0.64;
        const baseStrokeW = (typeof type.lineWidth === "number" && type.lineWidth > 0) ? type.lineWidth : 1.28;
        const scaledStrokeW = (baseStrokeW * lineWidthScale).toFixed(2);
        const hitW = Math.max(lineW, 6);
        const hitX = lineW >= 6 ? minX : (minX - (6 - lineW) / 2);

        elements.push(`
          <g class="train-line-group ${isSelected ? 'selected' : ''}" data-roster-id="${this.escapeXml(roster.id)}" data-train-index="${k}">
            ${isSelected ? `<line x1="${minX.toFixed(2)}" y1="${yLineCenter.toFixed(2)}" x2="${maxX.toFixed(2)}" y2="${yLineCenter.toFixed(2)}" ${selectedGlow} />` : ''}
            <line x1="${minX.toFixed(2)}" y1="${yLineCenter.toFixed(2)}" x2="${maxX.toFixed(2)}" y2="${yLineCenter.toFixed(2)}" stroke="${lineColor}" stroke-width="${scaledStrokeW}" ${dashAttr} />
            ${this.options.interactive ? `<rect x="${hitX.toFixed(2)}" y="${(yLineCenter - 5).toFixed(2)}" width="${hitW.toFixed(2)}" height="10" fill="transparent" />` : ''}
          </g>
        `);

        // 発時刻と着時刻の配置
        // 上段ベースライン: yTop - 1.76
        // 下段ベースライン: yTop + 11.20 (ちょうど 12.96px 下)
        const aboveY = yTop - 1.76;
        const belowY = yTop + 11.20;

        // 出発時刻の位置決定
        let depY = aboveY;
        if (tr.depTimePos === "below" || (tr.depTimePos === "auto" && hasIncomingTurnaround)) {
          depY = belowY;
        } else if (tr.depTimePos === "above") {
          depY = aboveY;
        }

        // 到着時刻の位置決定 (到着時刻は通常常に aboveY)
        let arrY = aboveY;
        if (tr.arrTimePos === "below") {
          arrY = belowY;
        }

        const dispDepTime = this.formatTrainTime(tr.depTime, settings);
        const dispArrTime = this.formatTrainTime(tr.arrTime, settings);

        if (dispDepTime) {
          elements.push(`
            <text class="font-f2 font-time" x="${fromX.toFixed(2)}" y="${depY.toFixed(2)}" font-size="10.72" fill="${timeColor}" stroke="${timeColor}" stroke-width="0.107" letter-spacing="0.18px" text-anchor="middle">${this.escapeXml(dispDepTime)}</text>
          `);
        }

        if (dispArrTime) {
          elements.push(`
            <text class="font-f2 font-time" x="${toX.toFixed(2)}" y="${arrY.toFixed(2)}" font-size="10.72" fill="${timeColor}" stroke="${timeColor}" stroke-width="0.107" letter-spacing="0.18px" text-anchor="middle">${this.escapeXml(dispArrTime)}</text>
          `);
        }

        // 列車番号 & 併結表記
        // 配置ルール:
        // 下り (toX > fromX): 出発駅 X + 80.80px を左端 (start)
        // 上り (toX < fromX): 出発駅 X - 84.00px を右端 (end)
        const isDown = toX > fromX;
        const labelBaselineY = aboveY;

        const labelHtml = this.formatTrainLabelHtml(tr, roster.id, highlightStyle, textColor);

        if (isDown) {
          const labelX = fromX + 80.80 * labelOffsetScale;
          elements.push(`
            <text class="font-f1 font-trainno" x="${labelX.toFixed(2)}" y="${labelBaselineY.toFixed(2)}" font-size="10.72" text-anchor="start">${labelHtml}</text>
          `);
        } else {
          const labelX = fromX - 84.00 * labelOffsetScale;
          elements.push(`
            <text class="font-f1 font-trainno" x="${labelX.toFixed(2)}" y="${labelBaselineY.toFixed(2)}" font-size="10.72" text-anchor="end">${labelHtml}</text>
          `);
        }

        // 記号 (出区○・入区△等)
        this.renderSymbols(elements, tr, fromX, toX, yTop, lineColor, settings);
      }

      // 運用ブロック下部太線
      elements.push(`
        <rect x="${blockBorderX.toFixed(2)}" y="${blockBottomBorderTop.toFixed(2)}" width="${blockBorderW.toFixed(2)}" height="${borderWidth}" fill="#000000" />
      `);

      prevBlockBorderTop = blockBottomBorderTop;
      prevBlockBorderBottom = blockBottomBorderBottom;
    }

    if (diagAcc) {
      diagAcc.maxContentBottomY = Math.max(diagAcc.maxContentBottomY || 0, prevBlockBorderBottom);
    }
    return this.finalizeSvgPage(elements, data, geom, prevBlockBorderBottom, pageIndex, totalPages, "station");
  }

  /**
   * 列車番号と併結表記のHTML組み立て（自運用番号の強調）
   */
  formatTrainLabelHtml(train, selfRosterId, highlightStyle, defaultTextColor) {
    const rawNo = train.trainNo || "";
    let coupledText = train.customCoupled || "";

    if (!coupledText) {
      if (Array.isArray(train.coupledFormation) && train.coupledFormation.length >= 2) {
        const parts = train.coupledFormation.filter(Boolean);
        if (selfRosterId && !parts.includes(selfRosterId)) {
          parts.unshift(selfRosterId);
        }
        coupledText = `(${parts.join("＋")})`;
      } else if (train.coupledPartner) {
        coupledText = train.coupledPosition === "before"
          ? `(${train.coupledPartner}＋${selfRosterId})`
          : `(${selfRosterId}＋${train.coupledPartner})`;
      }
    }

    if (!coupledText) {
      return `<tspan fill="${defaultTextColor}">${this.escapeXml(rawNo)}</tspan>`;
    }

    let fullText = coupledText;
    if (!coupledText.startsWith(rawNo) && rawNo !== "") {
      fullText = `${rawNo}${coupledText}`;
    }

    // 自運用IDの部分一致誤爆（例: 変A11 内の A1）を防ぐため境界トークンを優先一致させる
    let selfIdx = -1;
    if (selfRosterId) {
      const escapedSelf = selfRosterId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tokenRegex = new RegExp(`(^|[\\(（＋+\\s])${escapedSelf}(?=[\\)）＋+\\s]|$)`);
      const m = tokenRegex.exec(fullText);
      if (m) {
        selfIdx = m.index + m[1].length;
      } else {
        selfIdx = fullText.indexOf(selfRosterId);
      }
    }
    if (selfIdx !== -1) {
      const before = fullText.substring(0, selfIdx);
      const matched = fullText.substring(selfIdx, selfIdx + selfRosterId.length);
      const after = fullText.substring(selfIdx + selfRosterId.length);

      let selfColor = "#FF0000";
      let selfWeight = "normal";
      let selfDecor = "none";

      if (highlightStyle === "bold") {
        selfColor = defaultTextColor;
        selfWeight = "bold";
      } else if (highlightStyle === "underline") {
        selfColor = defaultTextColor;
        selfDecor = "underline";
      } else if (highlightStyle === "red-bold") {
        selfColor = "#FF0000";
        selfWeight = "bold";
      }

      return `
        <tspan fill="${defaultTextColor}">${this.escapeXml(before)}</tspan><tspan fill="${selfColor}" font-weight="${selfWeight}" text-decoration="${selfDecor}">${this.escapeXml(matched)}</tspan><tspan fill="${defaultTextColor}">${this.escapeXml(after)}</tspan>
      `;
    }

    return `<tspan fill="${defaultTextColor}">${this.escapeXml(fullText)}</tspan>`;
  }

  /**
   * 前列車が入庫/終結 (△/▲) かつ次列車が出庫/出区 (○/●) の場合は
   * 同一駅でも折り返し接続線（垂直線／待機線）を描画しない
   */
  isDepotTurnaroundBreak(prevTrain, curTrain) {
    if (!prevTrain || !curTrain) return false;
    const isPrevInDepot = prevTrain.arrSymbol === "triangle" || prevTrain.arrSymbol === "triangle_filled";
    const isCurOutDepot = curTrain.depSymbol === "circle" || curTrain.depSymbol === "circle_filled";
    return isPrevInDepot && isCurOutDepot;
  }

  /**
   * 記号（丸印・三角印）の描画
   */
  renderSymbols(elements, train, fromX, toX, yTop, lineColor, settings) {
    const centerY = yTop + 0.64;
    const symScale = this.getScaleSetting(settings, "symbolScale", 1.0, 0.5, 2.0);

    // 出発記号 (depSymbol: circle, circle_filled)
    if (train.depSymbol === "circle" || train.depSymbol === "circle_filled") {
      const rx = (3.60 * symScale).toFixed(2);
      const ry = (3.36 * symScale).toFixed(2);
      const fill = (train.depSymbol === "circle_filled") ? "#000000" : "#FFFFFF";
      elements.push(`
        <ellipse cx="${fromX.toFixed(2)}" cy="${centerY.toFixed(2)}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="#000000" stroke-width="0.32" />
      `);
    }

    // 到着記号 (arrSymbol: triangle, triangle_filled)
    if (train.arrSymbol === "triangle" || train.arrSymbol === "triangle_filled") {
      const fill = (train.arrSymbol === "triangle_filled") ? "#000000" : "#FFFFFF";
      // 幅 7.20px * scale, 高さ 5.60px * scale, 枠線色 #223F59
      const wHalf = 3.60 * symScale;
      const topOff = 3.04 * symScale;
      const botOff = 2.56 * symScale;
      const p1 = `${toX.toFixed(2)},${(centerY - topOff).toFixed(2)}`;
      const p2 = `${(toX - wHalf).toFixed(2)},${(centerY + botOff).toFixed(2)}`;
      const p3 = `${(toX + wHalf).toFixed(2)},${(centerY + botOff).toFixed(2)}`;

      elements.push(`
        <polygon points="${p1} ${p2} ${p3}" fill="${fill}" stroke="#223F59" stroke-width="0.32" />
      `);
    }
  }

  /**
   * 駅IDからSVGのX座標を解決する関数を生成する（非表示駅は前後表示駅の間に線形補間）
   */
  createStationXResolver(allStations, visibleStations) {
    const visibleMap = new Map();
    visibleStations.forEach(s => visibleMap.set(s.id, s.x));

    const indexMap = new Map();
    allStations.forEach((s, idx) => indexMap.set(s.id, idx));

    return (stationId, fallbackX) => {
      if (visibleMap.has(stationId)) {
        return visibleMap.get(stationId);
      }
      const idx = indexMap.get(stationId);
      if (idx === undefined) {
        return fallbackX;
      }

      let prevIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (allStations[i].visible !== false) { prevIdx = i; break; }
      }
      let nextIdx = -1;
      for (let i = idx + 1; i < allStations.length; i++) {
        if (allStations[i].visible !== false) { nextIdx = i; break; }
      }

      if (prevIdx !== -1 && nextIdx !== -1) {
        const prevX = allStations[prevIdx].x;
        const nextX = allStations[nextIdx].x;
        const ratio = (idx - prevIdx) / (nextIdx - prevIdx);
        return Math.round((prevX + ratio * (nextX - prevX)) * 100) / 100;
      }
      if (nextIdx !== -1) return allStations[nextIdx].x;
      if (prevIdx !== -1) return allStations[prevIdx].x;
      return fallbackX;
    };
  }

  // ==================== 横軸＝時刻モード（運用線図／棒ダイヤ） ====================

  _parseTimeMinutes(timeStr) {
    if (!timeStr) return null;
    const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  _parseTimeAxisMinutes(timeStr, dayStartMinutes = 240) {
    const m = this._parseTimeMinutes(timeStr);
    if (m === null) return null;
    return m < dayStartMinutes ? m + 1440 : m;
  }

  _estimateTextWidth(text, fontSize = 10.72) {
    if (!text) return 0;
    let w = 0;
    for (const ch of String(text)) {
      const code = ch.charCodeAt(0);
      w += (code <= 0x00ff) ? fontSize * 0.56 : fontSize * 0.96;
    }
    return w;
  }

  _getTrainLabelPlainText(train, selfRosterId) {
    const rawNo = train.trainNo || "";
    let coupledText = train.customCoupled || "";
    if (!coupledText) {
      if (Array.isArray(train.coupledFormation) && train.coupledFormation.length >= 2) {
        const parts = train.coupledFormation.filter(Boolean);
        if (selfRosterId && !parts.includes(selfRosterId)) parts.unshift(selfRosterId);
        coupledText = `(${parts.join("＋")})`;
      } else if (train.coupledPartner) {
        coupledText = train.coupledPosition === "before"
          ? `(${train.coupledPartner}＋${selfRosterId})`
          : `(${selfRosterId}＋${train.coupledPartner})`;
      }
    }
    if (!coupledText) return rawNo;
    if (!coupledText.startsWith(rawNo) && rawNo !== "") return `${rawNo}${coupledText}`;
    return coupledText;
  }

  computeTimeAxisRange(data) {
    const settings = (data && data.settings) || {};
    const startHourBase = (typeof settings.timeAxisStartHour === "number" && !Number.isNaN(settings.timeAxisStartHour))
      ? Math.max(0, Math.min(12, Math.round(settings.timeAxisStartHour)))
      : 4;
    const dayStartMin = startHourBase * 60;

    if (settings.timeAxisRangeMode === "manual") {
      const endHourManual = (typeof settings.timeAxisEndHour === "number" && !Number.isNaN(settings.timeAxisEndHour))
        ? Math.max(startHourBase + 4, Math.min(28, Math.round(settings.timeAxisEndHour)))
        : 25;
      return {
        startHour: startHourBase,
        endHour: endHourManual,
        startMin: startHourBase * 60,
        endMin: endHourManual * 60,
        dayStartMin
      };
    }

    let minM = Infinity;
    let maxM = -Infinity;

    for (const r of (data.rosters || [])) {
      for (const tr of (r.trains || [])) {
        let dm = this._parseTimeAxisMinutes(tr.depTime, dayStartMin);
        let am = this._parseTimeAxisMinutes(tr.arrTime, dayStartMin);
        if (dm !== null && am !== null && am < dm && am + 1440 - dm <= 720) {
          am += 1440;
        }
        if (dm !== null) {
          if (dm < minM) minM = dm;
          if (dm > maxM) maxM = dm;
        }
        if (am !== null) {
          if (am < minM) minM = am;
          if (am > maxM) maxM = am;
        }
      }
    }

    if (!Number.isFinite(minM) || !Number.isFinite(maxM)) {
      return { startHour: 5, endHour: 24, startMin: 300, endMin: 1440, dayStartMin };
    }

    const startHour = Math.max(startHourBase, Math.min(23, Math.floor(minM / 60)));
    const endHour = Math.min(28, Math.max(startHour + 4, Math.ceil(maxM / 60)));
    return {
      startHour,
      endHour,
      startMin: startHour * 60,
      endMin: endHour * 60,
      dayStartMin
    };
  }

  formatHourTickLabel(hour, lateNightFormat = "24plus") {
    if (hour < 24) return String(hour);
    const modH = hour - 24;
    if (lateNightFormat === "zero") return String(modH);
    if (lateNightFormat === "yoku") return `翌${modH}`;
    return String(hour);
  }

  buildTimeAxisLanes(roster, dayStartMin = 240) {
    const trains = (roster && roster.trains) || [];
    if (trains.length === 0) return [[]];

    const lanes = [];
    const laneEnds = [];

    for (let k = 0; k < trains.length; k++) {
      const tr = trains[k];
      let dm = this._parseTimeAxisMinutes(tr.depTime, dayStartMin);
      let am = this._parseTimeAxisMinutes(tr.arrTime, dayStartMin);

      if (dm !== null && am !== null && am < dm) {
        if (am + 1440 - dm <= 720) {
          am += 1440;
        } else {
          am = dm;
        }
      }

      const hasDep = dm !== null;
      const hasArr = am !== null;
      if (!hasDep && !hasArr) continue;

      const plotStartMin = hasDep ? dm : Math.max(dayStartMin, am - 12);
      const plotEndMin = hasArr ? am : (dm + 12);

      const item = {
        train: tr,
        index: k,
        depMin: dm,
        arrMin: am,
        hasDep,
        hasArr,
        plotStartMin,
        plotEndMin
      };

      let placedLane = -1;
      for (let li = 0; li < lanes.length; li++) {
        if (laneEnds[li] <= plotStartMin + 1) {
          placedLane = li;
          break;
        }
      }
      if (placedLane === -1) {
        lanes.push([item]);
        laneEnds.push(plotEndMin);
      } else {
        lanes[placedLane].push(item);
        laneEnds[placedLane] = Math.max(laneEnds[placedLane], plotEndMin);
      }
    }

    return lanes.length > 0 ? lanes : [[]];
  }

  calculateTimeAxisRosterBlockHeight(data, roster, isFirstOnPage) {
    const settings = data.settings || {};
    const R = typeof settings.baseRowHeight === "number" ? settings.baseRowHeight : 12.96;
    const scale = typeof roster.rowScale === "number" ? roster.rowScale : 1.0;
    const subHeaderMode = settings.subHeaderMode || "omitFirst";
    const borderWidth = 2.56;
    const subLineWidth = 1.28;
    const delta = (borderWidth - subLineWidth) / 2;

    const startHourBase = (typeof settings.timeAxisStartHour === "number" && !Number.isNaN(settings.timeAxisStartHour))
      ? Math.max(0, Math.min(12, Math.round(settings.timeAxisStartHour)))
      : 4;
    const lanes = this.buildTimeAxisLanes(roster, startHourBase * 60);
    const laneCount = Math.max(1, lanes.length);

    let h = 0;
    if (!isFirstOnPage && subHeaderMode === "all") {
      h += 1 * R + delta;
    }

    const topPad = Math.max(25.0, 2.05 * R * scale);
    const lanePitch = Math.max(54.0, 4.4 * R * scale);
    const bottomPad = Math.max(32.5, 2.55 * R * scale);

    h += topPad + (laneCount - 1) * lanePitch + bottomPad + borderWidth;
    return h;
  }

  _canPlaceHorizontalSpan(intervals, left, right, margin = 3.0) {
    for (const iv of intervals) {
      if (left < iv.right + margin && right > iv.left - margin) {
        return false;
      }
    }
    return true;
  }

  renderTimeAxisSinglePage(data, pageRosters, pageIndex, totalPages, geomArg = null, timeRangeArg = null, diagAcc = null) {
    const geom = geomArg || this.getPageGeometry(data);
    const timeRange = timeRangeArg || this.computeTimeAxisRange(data);
    const settings = data.settings || {};
    const R = typeof settings.baseRowHeight === "number" ? settings.baseRowHeight : 12.96;
    const subHeaderMode = settings.subHeaderMode || "omitFirst";
    const highlightStyle = settings.selfHighlightStyle || "red";
    const gridMin = settings.timeAxisGridMinutes === 60 ? 60 : 30;
    const lateFmt = settings.timeAxisLateNightFormat || "24plus";
    const density = settings.timeAxisLabelDensity === "full" ? "full" : "auto";
    const timeGridStyle = settings.timeAxisGridStyle || "default";
    const lineWidthScale = this.getScaleSetting(settings, "lineWidthScale", 1.0, 0.5, 2.5);
    const rosterZebraFill = !!settings.rosterZebraFill;

    const borderWidth = geom.borderWidth;
    const subLineWidth = 1.28;
    const delta = (borderWidth - subLineWidth) / 2;
    const { tableLeft, tableInnerX, tableRight, headerTop, headerBottom, timePlotLeft, timePlotRight } = geom;

    const spanMin = Math.max(60, timeRange.endMin - timeRange.startMin);
    const plotW = timePlotRight - timePlotLeft;
    const pxPerMin = plotW / spanMin;
    const pxPerHour = pxPerMin * 60;
    const round2 = (v) => Math.round(v * 100) / 100;
    const timeToX = (m) => round2(timePlotLeft + Math.max(0, Math.min(spanMin, m - timeRange.startMin)) * pxPerMin);

    const stationAbbrMap = new Map();
    (data.stations || []).forEach(st => {
      stationAbbrMap.set(st.id, st.abbr || (st.name ? st.name[0] : ""));
    });

    const elements = [];

    // 1. ヘッダー時間目盛り描画
    const hourStep = pxPerHour < 28 ? 2 : 1;
    const tickFontSize = lateFmt === "yoku" && pxPerHour < 48 ? 10.5 : (pxPerHour < 42 ? 11.2 : 12.8);

    for (let h = timeRange.startHour; h <= timeRange.endHour; h++) {
      const hx = timeToX(h * 60);
      elements.push(`
        <line x1="${hx}" y1="${(headerBottom - 7.5).toFixed(2)}" x2="${hx}" y2="${headerBottom}" stroke="#000000" stroke-width="1.1" />
      `);
      if ((h - timeRange.startHour) % hourStep === 0) {
        const lbl = this.formatHourTickLabel(h, lateFmt);
        elements.push(`
          <text class="font-f1 font-station" x="${hx}" y="79.20" font-size="${tickFontSize}" fill="#000000" text-anchor="middle">${this.escapeXml(lbl)}</text>
        `);
      }
      if (gridMin === 30 && h < timeRange.endHour) {
        const x30 = timeToX(h * 60 + 30);
        elements.push(`
          <line x1="${x30}" y1="${(headerBottom - 4.0).toFixed(2)}" x2="${x30}" y2="${headerBottom}" stroke="#475569" stroke-width="0.8" />
        `);
      }
    }

    // 2. 運用ブロックの描画
    let prevBlockBorderTop = null;
    let prevBlockBorderBottom = headerBottom + borderWidth;

    const subHeaderLineX = tableInnerX + borderWidth;
    const subHeaderLineW = tableRight - subHeaderLineX;
    const blockBorderX = tableLeft + borderWidth;
    const blockBorderW = tableRight + borderWidth - blockBorderX;

    for (let rIdx = 0; rIdx < pageRosters.length; rIdx++) {
      const roster = pageRosters[rIdx];
      const isFirstOnPage = (rIdx === 0);
      const showSubHeader = !isFirstOnPage && subHeaderMode === "all";
      const scale = typeof roster.rowScale === "number" ? roster.rowScale : 1.0;

      const lanes = this.buildTimeAxisLanes(roster, timeRange.dayStartMin);
      if (lanes.length > 1 && diagAcc) diagAcc.multiLaneRosterCount++;

      let subHeaderLineY = null;
      let blockTop = prevBlockBorderBottom;

      if (showSubHeader) {
        const refBorderTop = (prevBlockBorderTop !== null) ? prevBlockBorderTop : headerBottom;
        subHeaderLineY = refBorderTop + 1 * R + delta;
        for (let h = timeRange.startHour; h <= timeRange.endHour; h++) {
          if ((h - timeRange.startHour) % hourStep !== 0) continue;
          const hx = timeToX(h * 60);
          const lbl = this.formatHourTickLabel(h, lateFmt);
          elements.push(`
            <text class="font-f3 font-substation" x="${hx}" y="${(subHeaderLineY - 1.76).toFixed(2)}" font-size="9.6" fill="#334155" text-anchor="middle">${this.escapeXml(lbl)}</text>
          `);
        }
        elements.push(`
          <rect x="${subHeaderLineX.toFixed(2)}" y="${subHeaderLineY.toFixed(2)}" width="${subHeaderLineW.toFixed(2)}" height="1.28" fill="#000000" />
        `);
        blockTop = subHeaderLineY + 1.28;
      }

      const topPad = Math.max(25.0, 2.05 * R * scale);
      const lanePitch = Math.max(54.0, 4.4 * R * scale);
      const bottomPad = Math.max(32.5, 2.55 * R * scale);

      const firstLaneY = blockTop + topPad;
      const lastLaneY = firstLaneY + (Math.max(1, lanes.length) - 1) * lanePitch;
      const blockBottomBorderTop = round2(lastLaneY + bottomPad);
      const blockBottomBorderBottom = round2(blockBottomBorderTop + borderWidth);

      // 背景ゼブラ & 時間軸グリッド（列車線の下層）
      const gridTopY = blockTop;
      const gridBottomY = blockBottomBorderTop;
      if (rosterZebraFill && rIdx % 2 === 1) {
        const zebraW = tableRight - (tableLeft + borderWidth);
        const zebraH = blockBottomBorderTop - prevBlockBorderBottom;
        if (zebraW > 0 && zebraH > 0) {
          elements.push(`
            <rect x="${(tableLeft + borderWidth).toFixed(2)}" y="${prevBlockBorderBottom.toFixed(2)}" width="${zebraW.toFixed(2)}" height="${zebraH.toFixed(2)}" fill="#F8FAFC" />
          `);
        }
      }
      if (timeGridStyle !== "none") {
        const hourStroke = timeGridStyle === "subtle" ? "#E2E8F0" : "#CBD5E1";
        const halfStroke = timeGridStyle === "subtle" ? "#F1F5F9" : "#E2E8F0";
        for (let h = timeRange.startHour; h <= timeRange.endHour; h++) {
          const hx = timeToX(h * 60);
          elements.push(`
            <line x1="${hx}" y1="${gridTopY.toFixed(2)}" x2="${hx}" y2="${gridBottomY.toFixed(2)}" stroke="${hourStroke}" stroke-width="0.80" />
          `);
          if (gridMin === 30 && h < timeRange.endHour) {
            const x30 = timeToX(h * 60 + 30);
            elements.push(`
              <line x1="${x30}" y1="${gridTopY.toFixed(2)}" x2="${x30}" y2="${gridBottomY.toFixed(2)}" stroke="${halfStroke}" stroke-width="0.64" stroke-dasharray="2.5,2.5" />
            `);
          }
        }
      }

      // 運用番号（左列中央）
      const rosterCenterY = (prevBlockBorderBottom + blockBottomBorderTop) / 2 + 6.32;
      elements.push(`
        <text class="font-f1 font-roster" x="${geom.rosterLabelX}" y="${rosterCenterY.toFixed(2)}" font-size="18.72" fill="#000000" text-anchor="middle">${this.escapeXml(roster.name || roster.id)}</text>
      `);
      if (this.options.interactive && rIdx === 0 && pageRosters.every(r => (r.trains || []).length === 0)) {
        this.appendEmptyRosterHint(elements, timePlotLeft, timePlotRight, prevBlockBorderBottom, blockBottomBorderTop);
      }

      // 各レーン描画
      for (let li = 0; li < lanes.length; li++) {
        const laneY = firstLaneY + li * lanePitch;
        this.renderTimeAxisLane(
          elements, data, roster, lanes[li], laneY,
          timeToX, stationAbbrMap,
          { plotLeft: timePlotLeft, plotRight: timePlotRight, highlightStyle, density, settings },
          diagAcc
        );
      }

      // ブロック下境界太線
      elements.push(`
        <rect x="${blockBorderX.toFixed(2)}" y="${blockBottomBorderTop.toFixed(2)}" width="${blockBorderW.toFixed(2)}" height="${borderWidth}" fill="#000000" />
      `);

      prevBlockBorderTop = blockBottomBorderTop;
      prevBlockBorderBottom = blockBottomBorderBottom;
    }

    if (diagAcc) {
      diagAcc.maxContentBottomY = Math.max(diagAcc.maxContentBottomY || 0, prevBlockBorderBottom);
    }
    return this.finalizeSvgPage(elements, data, geom, prevBlockBorderBottom, pageIndex, totalPages, "time");
  }

  renderTimeAxisLane(elements, data, roster, laneItems, laneY, timeToX, stationAbbrMap, opts, diagAcc) {
    if (!laneItems || laneItems.length === 0) return;

    const round2 = (v) => Math.round(v * 100) / 100;
    const { plotLeft, plotRight, highlightStyle, density, settings } = opts;
    const yCenter = round2(laneY + 0.64);
    const lineWidthScale = this.getScaleSetting(settings, "lineWidthScale", 1.0, 0.5, 2.5);
    const showTurnaroundDash = !(settings && settings.showTimeAxisTurnaroundDash === false);

    // 座標解決
    const geomItems = laneItems.map(it => {
      const rawX1 = timeToX(it.plotStartMin);
      const rawX2 = timeToX(it.plotEndMin);
      const x1 = Math.min(rawX1, rawX2);
      const x2 = Math.max(rawX1, rawX2);
      const visualX2 = (x2 - x1 < 2.0) ? Math.min(plotRight, x1 + 2.0) : x2;
      return Object.assign({}, it, { x1, x2: visualX2, exactX2: x2 });
    });

    // 1. 連続折り返し待機線（前着駅 === 次発駅、かつ入庫→出庫でない場合）
    if (showTurnaroundDash) {
      for (let i = 1; i < geomItems.length; i++) {
        const prev = geomItems[i - 1];
        const cur = geomItems[i];
        if (
          prev.train.toStation &&
          cur.train.fromStation &&
          prev.train.toStation === cur.train.fromStation &&
          !this.isDepotTurnaroundBreak(prev.train, cur.train) &&
          cur.x1 - prev.exactX2 >= 1.5
        ) {
          elements.push(`
            <line x1="${prev.exactX2.toFixed(2)}" y1="${yCenter.toFixed(2)}" x2="${cur.x1.toFixed(2)}" y2="${yCenter.toFixed(2)}" stroke="#64748B" stroke-width="1.0" stroke-dasharray="3,2" />
          `);
        }
      }
    }

    // 2. 列車線＆端ティック＆シンボル
    for (const item of geomItems) {
      const tr = item.train;
      const type = this.getTrainType(data, tr.typeId);
      const lineColor = type.lineColor || "#000000";
      const isSelected = (this.selectedRosterId === roster.id && this.selectedTrainIndex === item.index);
      const selectedGlow = isSelected ? `stroke="#2F6F73" stroke-width="4" stroke-opacity="0.4"` : ``;
      const dashAttr = type.lineStyle === "dashed" ? `stroke-dasharray="6,3"` : (type.lineStyle === "dotted" ? `stroke-dasharray="2,2"` : ``);
      const lineWidth = ((type.lineWidth || 1.28) * lineWidthScale).toFixed(2);
      const tickWidth = (1.2 * lineWidthScale).toFixed(2);

      const hitW = Math.max(item.x2 - item.x1, 6);
      elements.push(`
        <g class="train-line-group ${isSelected ? 'selected' : ''}" data-roster-id="${this.escapeXml(roster.id)}" data-train-index="${item.index}">
          ${isSelected ? `<line x1="${item.x1.toFixed(2)}" y1="${yCenter.toFixed(2)}" x2="${item.x2.toFixed(2)}" y2="${yCenter.toFixed(2)}" ${selectedGlow} />` : ''}
          <line x1="${item.x1.toFixed(2)}" y1="${yCenter.toFixed(2)}" x2="${item.x2.toFixed(2)}" y2="${yCenter.toFixed(2)}" stroke="${lineColor}" stroke-width="${lineWidth}" ${dashAttr} />
          <rect x="${item.x1.toFixed(2)}" y="${(yCenter - 5).toFixed(2)}" width="${hitW.toFixed(2)}" height="10" fill="transparent" />
        </g>
      `);

      // 端点が明確に見える小ティック（シンボルが無い端のみ）
      if (tr.depSymbol !== "circle" && tr.depSymbol !== "circle_filled") {
        elements.push(`
          <line x1="${item.x1.toFixed(2)}" y1="${(yCenter - 3.0).toFixed(2)}" x2="${item.x1.toFixed(2)}" y2="${(yCenter + 3.0).toFixed(2)}" stroke="${lineColor}" stroke-width="${tickWidth}" />
        `);
      }
      if (tr.arrSymbol !== "triangle" && tr.arrSymbol !== "triangle_filled") {
        elements.push(`
          <line x1="${item.x2.toFixed(2)}" y1="${(yCenter - 3.0).toFixed(2)}" x2="${item.x2.toFixed(2)}" y2="${(yCenter + 3.0).toFixed(2)}" stroke="${lineColor}" stroke-width="${tickWidth}" />
        `);
      }

      this.renderSymbols(elements, tr, item.x1, item.x2, laneY, lineColor, settings);
    }

    // 3. 上側ラベル：列番（＋併結＆自運用強調）2段スタガー衝突回避
    const topRow1 = [];
    const topRow2 = [];
    const topY1 = round2(laneY - 5.2);
    const topY2 = round2(laneY - 16.0);

    for (let i = 0; i < geomItems.length; i++) {
      const item = geomItems[i];
      const tr = item.train;
      const type = this.getTrainType(data, tr.typeId);
      const textColor = type.textColor || "#000000";
      const plain = this._getTrainLabelPlainText(tr, roster.id);
      if (!plain) continue;

      const fontSize = 10.0;
      const w = this._estimateTextWidth(plain, fontSize);
      const halfW = w / 2;
      const midX = Math.max(plotLeft - 20 + halfW, Math.min(plotRight + 20 - halfW, (item.x1 + item.x2) / 2));
      const left = midX - halfW;
      const right = midX + halfW;

      let chosenY = topY1;
      if (this._canPlaceHorizontalSpan(topRow1, left, right, 3.0)) {
        topRow1.push({ left, right });
      } else if (this._canPlaceHorizontalSpan(topRow2, left, right, 3.0)) {
        chosenY = topY2;
        topRow2.push({ left, right });
      } else {
        chosenY = (i % 2 === 0) ? topY1 : topY2;
        if (chosenY === topY1) topRow1.push({ left, right });
        else topRow2.push({ left, right });
        if (diagAcc) diagAcc.labelOverlapCount++;
      }

      const labelHtml = this.formatTrainLabelHtml(tr, roster.id, highlightStyle, textColor);
      elements.push(`
        <text class="font-f1 font-trainno" x="${midX.toFixed(2)}" y="${chosenY.toFixed(2)}" font-size="${fontSize}" text-anchor="middle">${labelHtml}</text>
      `);
    }

    // 4. 下側1段目：駅略称（近接折り返し共通駅マージ ＋ 短列車外寄せ）
    const abbrTokens = [];
    for (let i = 0; i < geomItems.length; i++) {
      const item = geomItems[i];
      const tr = item.train;
      const type = this.getTrainType(data, tr.typeId);
      const textColor = type.textColor || "#000000";
      const fromAbbr = stationAbbrMap.get(tr.fromStation) || "";
      const toAbbr = stationAbbrMap.get(tr.toStation) || "";

      const prev = i > 0 ? geomItems[i - 1] : null;
      const mergeWithPrev = !!(
        prev &&
        prev.train.toStation &&
        prev.train.toStation === tr.fromStation &&
        item.x1 - prev.exactX2 < 24.0 &&
        abbrTokens.length > 0 &&
        abbrTokens[abbrTokens.length - 1].trainIndex === prev.index &&
        abbrTokens[abbrTokens.length - 1].kind === "arr"
      );

      let depX = item.x1;
      let arrX = item.x2;
      if (!mergeWithPrev && item.x2 - item.x1 < 18.0 && fromAbbr && toAbbr) {
        depX = Math.max(plotLeft - 22, item.x1 - 4.5);
        arrX = Math.min(plotRight + 22, item.x2 + 4.5);
      }

      if (mergeWithPrev) {
        const lastTok = abbrTokens[abbrTokens.length - 1];
        lastTok.x = (prev.exactX2 + item.x1) / 2;
        lastTok.kind = "turn";
        lastTok.color = "#1E293B";
        lastTok.bold = true;
      } else if (fromAbbr) {
        abbrTokens.push({ x: depX, text: fromAbbr, color: textColor, kind: "dep", trainIndex: item.index });
      }

      if (toAbbr) {
        abbrTokens.push({ x: arrX, text: toAbbr, color: textColor, kind: "arr", trainIndex: item.index });
      }
    }

    const abbrPlaced = [];
    const abbrY = round2(laneY + 12.2);
    for (const tok of abbrTokens) {
      const fSize = 10.0;
      const w = this._estimateTextWidth(tok.text, fSize);
      let x = tok.x;
      if (!this._canPlaceHorizontalSpan(abbrPlaced, x - w / 2, x + w / 2, 1.5)) {
        const rightCand = x + 6.0;
        const leftCand = x - 6.0;
        if (this._canPlaceHorizontalSpan(abbrPlaced, rightCand - w / 2, rightCand + w / 2, 1.0)) {
          x = rightCand;
        } else if (this._canPlaceHorizontalSpan(abbrPlaced, leftCand - w / 2, leftCand + w / 2, 1.0)) {
          x = leftCand;
        }
      }
      abbrPlaced.push({ left: x - w / 2, right: x + w / 2 });
      const fwAttr = tok.bold ? `font-weight="700"` : "";
      elements.push(`
        <text class="font-f1 font-station" x="${x.toFixed(2)}" y="${abbrY.toFixed(2)}" font-size="${fSize}" fill="${tok.color}" ${fwAttr} text-anchor="middle">${this.escapeXml(tok.text)}</text>
      `);
    }

    // 5. 下側2段目（＋交互逃がし3段目）：発着時刻（auto時は過度な衝突箇所を間引き）
    const timeCandidates = [];
    for (const item of geomItems) {
      const tr = item.train;
      const type = this.getTrainType(data, tr.typeId);
      const timeColor = type.timeColor || "#000000";
      if (item.hasDep && tr.depTime) {
        const dt = this.formatTrainTime(tr.depTime, settings);
        if (dt) timeCandidates.push({ x: item.x1, text: dt, color: timeColor, isShortSpan: item.x2 - item.x1 < 22, side: "dep" });
      }
      if (item.hasArr && tr.arrTime) {
        const at = this.formatTrainTime(tr.arrTime, settings);
        if (at) timeCandidates.push({ x: item.x2, text: at, color: timeColor, isShortSpan: item.x2 - item.x1 < 22, side: "arr" });
      }
    }

    const timeRow1 = [];
    const timeRow2 = [];
    const timeY1 = round2(laneY + 22.0);
    const timeY2 = round2(laneY + 30.2);
    let prevAcceptedTimeCand = null;

    for (let i = 0; i < timeCandidates.length; i++) {
      const cand = timeCandidates[i];
      if (
        prevAcceptedTimeCand &&
        prevAcceptedTimeCand.text === cand.text &&
        Math.abs(prevAcceptedTimeCand.rawX - cand.x) < 4.0
      ) {
        continue;
      }
      const fSize = 8.8;
      const w = this._estimateTextWidth(cand.text, fSize);
      const halfW = w / 2;
      let cx = Math.max(plotLeft - 24 + halfW, Math.min(plotRight + 24 - halfW, cand.x));
      if (cand.isShortSpan) {
        cx = cand.side === "dep"
          ? Math.max(plotLeft - 24 + halfW, cand.x - 4.0)
          : Math.min(plotRight + 24 - halfW, cand.x + 4.0);
      }
      const left = cx - halfW;
      const right = cx + halfW;

      if (this._canPlaceHorizontalSpan(timeRow1, left, right, 2.0)) {
        timeRow1.push({ left, right });
        prevAcceptedTimeCand = { text: cand.text, rawX: cand.x };
        elements.push(`
          <text class="font-f2 font-time" x="${cx.toFixed(2)}" y="${timeY1.toFixed(2)}" font-size="${fSize}" fill="${cand.color}" text-anchor="middle">${this.escapeXml(cand.text)}</text>
        `);
      } else if (this._canPlaceHorizontalSpan(timeRow2, left, right, 2.0)) {
        timeRow2.push({ left, right });
        prevAcceptedTimeCand = { text: cand.text, rawX: cand.x };
        elements.push(`
          <text class="font-f2 font-time" x="${cx.toFixed(2)}" y="${timeY2.toFixed(2)}" font-size="${fSize}" fill="${cand.color}" text-anchor="middle">${this.escapeXml(cand.text)}</text>
        `);
      } else if (density === "full") {
        // 全表示モードは段2の交互配置を強行して表示し衝突を記録
        timeRow2.push({ left, right });
        prevAcceptedTimeCand = { text: cand.text, rawX: cand.x };
        if (diagAcc) diagAcc.labelOverlapCount++;
        elements.push(`
          <text class="font-f2 font-time" x="${cx.toFixed(2)}" y="${timeY2.toFixed(2)}" font-size="${fSize}" fill="${cand.color}" text-anchor="middle">${this.escapeXml(cand.text)}</text>
        `);
      } else {
        if (diagAcc) diagAcc.omittedTimeLabelCount++;
      }
    }
  }

  /**
   * 描画結果の余白・密度を評価して、はみ出し／過密解消向けの用紙提案を生成
   */
  buildLayoutDiagnostics(data, geom, timeRange, totalPages, diagAcc) {
    const visibleStations = (data.stations || []).filter(s => s.visible !== false);
    const diag = {
      xAxisMode: geom.xAxisMode,
      pageSize: geom.pageSize,
      orientation: geom.orientation,
      isSeparateMode: geom.isSeparateMode,
      effectivePageConfig: geom.pageConfig || null,
      totalPages,
      omittedTimeLabelCount: diagAcc.omittedTimeLabelCount,
      multiLaneRosterCount: diagAcc.multiLaneRosterCount,
      labelOverlapCount: diagAcc.labelOverlapCount,
      visibleStationCount: visibleStations.length,
      pxPerHour: null,
      stationMinGapPx: null,
      suggestion: null
    };

    const nextBiggerSize = (sz) => {
      const order = ["B6", "A5", "B5", "A4", "B4", "A3"];
      const idx = order.indexOf(sz);
      return (idx >= 0 && idx < order.length - 1) ? order[idx + 1] : null;
    };

    const isAuto = !!(geom.pageConfig && geom.pageConfig.isAutoPageSize);
    const isCustom = !!(geom.pageConfig && geom.pageConfig.isCustomPageSize);

    if (geom.xAxisMode === "time" && timeRange) {
      const hours = Math.max(1, timeRange.endHour - timeRange.startHour);
      const pxPerHour = (geom.timePlotRight - geom.timePlotLeft) / hours;
      diag.pxPerHour = Math.round(pxPerHour * 10) / 10;

      if (!isAuto && !isCustom) {
        const autoFitPatch = geom.isSeparateMode
          ? { timeAxisPageSize: "AUTO" }
          : { separatePageSettingsByAxisMode: true, timeAxisPageSize: "AUTO" };

        if (!geom.isLandscape && (pxPerHour < 58 || diagAcc.omittedTimeLabelCount > 0 || diagAcc.labelOverlapCount > 0 || geom.canvasScale < 0.9)) {
          const actions = [
            {
              id: "set-time-auto-fit",
              label: "時間軸を 変形(自動) にする（推奨）",
              patch: autoFitPatch
            },
            {
              id: "set-time-a4-landscape",
              label: "A4横 にする",
              patch: { separatePageSettingsByAxisMode: true, timeAxisPageSize: "A4", timeAxisOrientation: "landscape" }
            },
            {
              id: "set-orientation-landscape",
              label: "共通向きを 横 に変更",
              patch: geom.isSeparateMode ? { timeAxisOrientation: "landscape" } : { orientation: "landscape" }
            }
          ];
          diag.suggestion = {
            key: `time-portrait-narrow-${geom.pageSize}-${geom.orientation}`,
            message: `縦向き用紙では横幅がやや狭く（1時間あたり約 ${Math.round(pxPerHour)}px${diagAcc.omittedTimeLabelCount > 0 ? `・過密により時刻 ${diagAcc.omittedTimeLabelCount} 件省略` : ""}）、文字が詰まりやすい状態です。横長・変形（自動フィット）をおすすめします。`,
            actions
          };
        } else if (diagAcc.omittedTimeLabelCount >= 2 || diagAcc.labelOverlapCount >= 2 || pxPerHour < 85) {
          const actions = [
            {
              id: "set-time-auto-fit",
              label: "変形(自動フィット) にする（推奨）",
              patch: autoFitPatch
            }
          ];
          const bigger = nextBiggerSize(geom.pageSize);
          if (bigger) {
            actions.push({
              id: `upgrade-to-${bigger}`,
              label: `${bigger} ${geom.isLandscape ? "横" : "縦"}にする`,
              patch: geom.isSeparateMode ? { timeAxisPageSize: bigger } : { pageSize: bigger }
            });
          }
          diag.suggestion = {
            key: `time-size-crowded-${geom.pageSize}-${geom.orientation}`,
            message: `運行時間帯が長く定型用紙では横幅が窮屈です（${diagAcc.omittedTimeLabelCount > 0 ? `時刻 ${diagAcc.omittedTimeLabelCount} 件省略` : `約 ${Math.round(pxPerHour)}px/時間`}）。時間帯に合わせて横幅を広げる「変形（自動フィット）」をおすすめします。`,
            actions
          };
        } else if (totalPages === 1 && diagAcc.maxContentBottomY > 0) {
          const verticalFillRatio = diagAcc.maxContentBottomY / Math.max(1, geom.Y_MAX);
          if (verticalFillRatio < 0.45) {
            diag.suggestion = {
              key: `time-vertical-excess-${geom.pageSize}-${geom.orientation}`,
              message: `定型用紙では縦方向の余白が多く残っています（縦使用率 約 ${Math.round(verticalFillRatio * 100)}%）。運用数に合わせて高さを詰める「変形（自動フィット）」もおすすめです。`,
              actions: [
                {
                  id: "set-time-auto-fit-trim",
                  label: "変形(自動フィット) で余白を詰める（推奨）",
                  patch: autoFitPatch
                }
              ]
            };
          }
        }
      }
    } else if (geom.xAxisMode === "station" && !isAuto && !isCustom) {
      if (visibleStations.length >= 2) {
        const xs = visibleStations.map(s => this.mapStationXToCanvas(s.x, geom)).sort((a, b) => a - b);
        let minGap = Infinity;
        for (let i = 1; i < xs.length; i++) minGap = Math.min(minGap, xs[i] - xs[i - 1]);
        diag.stationMinGapPx = Math.round(minGap * 10) / 10;

        if ((geom.canvasScale < 0.9 && visibleStations.length >= 4) || (!geom.isLandscape && minGap < 120) || visibleStations.length >= 6) {
          const actions = [];
          if (!geom.isLandscape) {
            actions.push({
              id: "station-landscape",
              label: "横向きにする",
              patch: { orientation: "landscape" }
            });
          }
          const bigger = nextBiggerSize(geom.pageSize);
          if (bigger && (geom.pageSize === "B6" || geom.pageSize === "A5" || geom.pageSize === "A4" || geom.pageSize === "B5")) {
            actions.push({
              id: `station-size-${bigger}`,
              label: `${bigger} にする`,
              patch: { pageSize: bigger }
            });
          }
          if (visibleStations.length >= 5) {
            actions.push({
              id: "station-auto-fit",
              label: "変形(自動フィット) にする",
              patch: { pageSize: "AUTO" }
            });
          }
          if (actions.length > 0) {
            diag.suggestion = {
              key: `station-crowded-${geom.pageSize}-${geom.orientation}-${visibleStations.length}`,
              message: `表示駅数（${visibleStations.length}駅）に対して駅間隔がやや狭くなっています（最小間隔 約 ${Math.round(minGap)}px）。`,
              actions
            };
          }
        }
      }
    }

    return diag;
  }

  getScaleSetting(settings, key, fallback = 1.0, minVal = 0.5, maxVal = 2.5) {
    if (!settings || settings[key] === undefined) return fallback;
    if (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.clampScale) {
      return BoxDiagramDataModel.clampScale(settings[key], fallback, minVal, maxVal);
    }
    const n = typeof settings[key] === "number" ? settings[key] : parseFloat(settings[key]);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(Math.max(minVal, Math.min(maxVal, n)) * 100) / 100;
  }

  formatPageNumberText(pageIndex, totalPages, format = "slash") {
    if (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.formatPageNumberText) {
      return BoxDiagramDataModel.formatPageNumberText(pageIndex, totalPages, format);
    }
    if (format === "dash") return `- ${pageIndex} -`;
    if (format === "number") return `${pageIndex}`;
    return `${pageIndex}/${totalPages}`;
  }

  formatTrainTime(rawTime, settings) {
    const fmt = (settings && settings.timeDisplayFormat) || "h:mm";
    if (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.formatTrainTimeText) {
      return BoxDiagramDataModel.formatTrainTimeText(rawTime, fmt);
    }
    return rawTime || "";
  }

  getTrainType(data, typeId) {
    if (data.trainTypes && Array.isArray(data.trainTypes)) {
      const t = data.trainTypes.find(x => x.id === typeId);
      if (t) return t;
    }
    return DEFAULT_TRAIN_TYPES[0];
  }

  escapeXml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  appendEmptyRosterHint(elements, leftX, rightX, topY, bottomY) {
    const hintX = ((leftX + rightX) / 2).toFixed(2);
    const hintY = ((topY + bottomY) / 2 + 4.0).toFixed(2);
    elements.push(`
      <text class="font-f1 diagram-empty-hint" x="${hintX}" y="${hintY}" font-size="11.5" fill="#94A3B8" text-anchor="middle">「列車表」→「＋ 列車追加」から1本目の列車を入力できます</text>
    `);
  }

  renderEmptySvg(data) {
    const geom = this.getPageGeometry(data || {});
    const cx = (geom.W / 2).toFixed(2);
    const cy = (geom.H / 2).toFixed(2);
    return `
      <svg class="box-diagram-svg" viewBox="0 0 ${geom.W} ${geom.H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="${geom.W}" height="${geom.H}" fill="#FFFFFF" />
        <text x="${cx}" y="${(geom.H / 2 - 14).toFixed(2)}" font-size="19" fill="#64748B" text-anchor="middle">表示可能な運用データがありません</text>
        <text class="diagram-empty-hint" x="${cx}" y="${(geom.H / 2 + 16).toFixed(2)}" font-size="13" fill="#94A3B8" text-anchor="middle">「運用一覧」タブから運用（A1など）を追加するか、上部の「＋ 新規作成」をご利用ください</text>
      </svg>
    `;
  }
}

// グローバルインスタンス
window.BoxDiagramRenderer = BoxDiagramRenderer;
