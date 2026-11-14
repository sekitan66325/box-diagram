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
    if (!data || !data.rosters || data.rosters.length === 0) {
      return [{ pageIndex: 1, totalPages: 1, svgHtml: this.renderEmptySvg(data) }];
    }

    // ページの分割（自動改ページ / 手動改ページ）
    const pages = this.paginateRosters(data);
    const totalPages = pages.length;

    return pages.map((pageRosters, pIdx) => {
      const pageIndex = pIdx + 1;
      const svgHtml = this.renderSinglePage(data, pageRosters, pageIndex, totalPages);
      return { pageIndex, totalPages, svgHtml };
    });
  }

  /**
   * 運用のページ分割計算
   */
  paginateRosters(data) {
    const settings = data.settings || {};
    const mode = settings.pageBreakMode || "auto";
    const rosters = data.rosters;

    if (mode === "manual") {
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
    // ページ上限高さ Y_max = 1420 px (フッター余白考慮)
    const Y_MAX = 1420.0;
    const pages = [];
    let currentPage = [];
    let currentY = 101.28; // ヘッダー枠下端

    for (let i = 0; i < rosters.length; i++) {
      const roster = rosters[i];
      const isFirst = currentPage.length === 0;
      const blockHeight = this.calculateRosterBlockHeight(data, roster, isFirst);

      if (!isFirst && (currentY + blockHeight > Y_MAX || roster.pageBreakAfter)) {
        pages.push(currentPage);
        currentPage = [roster];
        currentY = 101.28 + this.calculateRosterBlockHeight(data, roster, true);
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
   * 単一ページのSVG描画
   */
  renderSinglePage(data, pageRosters, pageIndex, totalPages) {
    const settings = data.settings || {};
    const R = typeof settings.baseRowHeight === "number" ? settings.baseRowHeight : 12.96;
    const S = typeof settings.rosterStepRows === "number" ? settings.rosterStepRows : 2;
    const P = typeof settings.blockPaddingRows === "number" ? settings.blockPaddingRows : 2;
    const stationHeaderDir = settings.stationHeaderDirection || "vertical";
    const subHeaderMode = settings.subHeaderMode || "omitFirst";
    const highlightStyle = settings.selfHighlightStyle || "red";

    const borderWidth = 2.56;
    const subLineWidth = 1.28;
    const delta = (borderWidth - subLineWidth) / 2; // 0.64

    const W = 1122.56;
    const H = 1587.36;

    // 主要駅と座標（非表示駅も駅順から線形補間して解決）
    const visibleStations = (data.stations || []).filter(s => s.visible !== false);
    const resolveStationX = this.createStationXResolver(data.stations || [], visibleStations);

    let elements = [];

    // 1. 表外枠とメインヘッダーの固定座標
    const tableLeft = 53.92;
    const tableInnerX = 120.32;
    const tableRight = 1064.96;

    const headerTop = 48.64;
    const headerBottom = 98.72;

    // 左上タイトル & 右上著作権表記
    const titleText = data.metadata ? (data.metadata.title || "") : "";
    const copyText = data.metadata ? (data.metadata.copyright || "") : "";

    elements.push(`
      <text class="font-f1" x="54.24" y="43.20" font-size="13.28" fill="#000000" text-anchor="start">${this.escapeXml(titleText)}</text>
      <text class="font-f1" x="1066.24" y="43.20" font-size="13.28" fill="#000000" text-anchor="end">${this.escapeXml(copyText)}</text>
    `);

    // メインヘッダー枠線
    elements.push(`
      <!-- ヘッダー上枠線 -->
      <rect x="${tableLeft}" y="${headerTop}" width="${tableRight + borderWidth - tableLeft}" height="${borderWidth}" fill="#000000" />
      <!-- ヘッダー下枠線 -->
      <rect x="${tableLeft}" y="${headerBottom}" width="${tableRight + borderWidth - tableLeft}" height="${borderWidth}" fill="#000000" />
    `);

    // ヘッダー内テキスト「運用番号」
    elements.push(`
      <text class="font-f1" x="62.40" y="79.84" font-size="13.28" fill="#000000" text-anchor="start">運用番号</text>
    `);

    // 駅名ヘッダー描画 (縦書き vs 横書き)
    for (const st of visibleStations) {
      const name = st.name || "";
      if (stationHeaderDir === "horizontal") {
        elements.push(`
          <text class="font-f1" x="${st.x}" y="78.00" font-size="13.28" fill="#000000" text-anchor="middle">${this.escapeXml(name)}</text>
        `);
      } else {
        // 縦書きモード
        if (name.length <= 2) {
          const char1 = name.length > 0 ? name[0] : "";
          const char2 = name.length > 1 ? name[1] : "";
          if (name.length === 1) {
            elements.push(`
              <text class="font-f1" x="${st.x}" y="79.68" font-size="14.72" fill="#000000" text-anchor="middle">${this.escapeXml(char1)}</text>
            `);
          } else {
            elements.push(`
              <text class="font-f1" x="${st.x}" y="71.52" font-size="14.72" fill="#000000" text-anchor="middle">${this.escapeXml(char1)}</text>
              <text class="font-f1" x="${st.x}" y="87.84" font-size="14.72" fill="#000000" text-anchor="middle">${this.escapeXml(char2)}</text>
            `);
          }
        } else {
          // 3文字以上: Y=62.00からY=89.00に均等配置
          const len = name.length;
          const startY = 62.00;
          const endY = 89.00;
          const stepY = (endY - startY) / (len - 1);
          const fSize = Math.min(14.72, Math.max(9.0, 36.0 / len));
          for (let ci = 0; ci < len; ci++) {
            const chY = startY + ci * stepY;
            elements.push(`
              <text class="font-f1" x="${st.x}" y="${chY.toFixed(2)}" font-size="${fSize.toFixed(1)}" fill="#000000" text-anchor="middle">${this.escapeXml(name[ci])}</text>
            `);
          }
        }
      }
    }

    // 2. 運用ブロックの描画
    let prevBlockBorderTop = null;
    let prevBlockBorderBottom = headerBottom + borderWidth; // 101.28

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
          const abbr = st.abbr || (st.name ? st.name[0] : "");
          // 元PDFでは下と茂は擬似太字、真は標準
          const isBold = (abbr === "下" || abbr === "茂");
          const strokeAttr = isBold ? `stroke="#000000" stroke-width="0.107"` : ``;
          // テキスト基準線は線の上 1.76px
          const textY = subHeaderLineY - 1.76;
          elements.push(`
            <text class="font-f3" x="${st.x}" y="${textY.toFixed(2)}" font-size="10.72" fill="#000000" ${strokeAttr} text-anchor="middle">${this.escapeXml(abbr)}</text>
          `);
        }

        // サブヘッダー下部細線 (運用番号列は貫通せず 122.88 .. 1064.96 のみ)
        elements.push(`
          <rect x="122.88" y="${subHeaderLineY.toFixed(2)}" width="942.08" height="1.28" fill="#000000" />
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

      // 運用番号（左列の中央に配置）
      // Y座標: (prevBlockBorderBottom + blockBottomBorderTop) / 2 + 6.32
      const rosterCenterY = (prevBlockBorderBottom + blockBottomBorderTop) / 2 + 6.32;
      elements.push(`
        <text class="font-f1" x="88.40" y="${rosterCenterY.toFixed(2)}" font-size="18.72" fill="#000000" text-anchor="middle">${this.escapeXml(roster.name || roster.id)}</text>
      `);

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
            // 縦線描画
            const vY1 = prevItem.y;
            const vY2 = yTop + 1.28;
            const vX = fromX - 0.64;
            // 折り返し線の色（自身が回送または前が回送なら回送色）
            const vColor = (tr.typeId === "deadhead" || prevTr.typeId === "deadhead") ? (type.lineColor || "#E3702E") : "#000000";
            elements.push(`
              <rect x="${vX.toFixed(2)}" y="${vY1.toFixed(2)}" width="1.28" height="${(vY2 - vY1).toFixed(2)}" fill="${vColor}" />
            `);
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

        elements.push(`
          <g class="train-line-group ${isSelected ? 'selected' : ''}" data-roster-id="${this.escapeXml(roster.id)}" data-train-index="${k}">
            ${isSelected ? `<line x1="${minX.toFixed(2)}" y1="${(yTop + 0.64).toFixed(2)}" x2="${maxX.toFixed(2)}" y2="${(yTop + 0.64).toFixed(2)}" ${selectedGlow} />` : ''}
            <line x1="${minX.toFixed(2)}" y1="${(yTop + 0.64).toFixed(2)}" x2="${maxX.toFixed(2)}" y2="${(yTop + 0.64).toFixed(2)}" stroke="${lineColor}" stroke-width="1.28" ${dashAttr} />
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

        if (tr.depTime) {
          elements.push(`
            <text class="font-f2" x="${fromX.toFixed(2)}" y="${depY.toFixed(2)}" font-size="10.72" fill="${timeColor}" stroke="${timeColor}" stroke-width="0.107" letter-spacing="0.18px" text-anchor="middle">${this.escapeXml(tr.depTime)}</text>
          `);
        }

        if (tr.arrTime) {
          elements.push(`
            <text class="font-f2" x="${toX.toFixed(2)}" y="${arrY.toFixed(2)}" font-size="10.72" fill="${timeColor}" stroke="${timeColor}" stroke-width="0.107" letter-spacing="0.18px" text-anchor="middle">${this.escapeXml(tr.arrTime)}</text>
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
          const labelX = fromX + 80.80;
          elements.push(`
            <text class="font-f1" x="${labelX.toFixed(2)}" y="${labelBaselineY.toFixed(2)}" font-size="10.72" text-anchor="start">${labelHtml}</text>
          `);
        } else {
          const labelX = fromX - 84.00;
          elements.push(`
            <text class="font-f1" x="${labelX.toFixed(2)}" y="${labelBaselineY.toFixed(2)}" font-size="10.72" text-anchor="end">${labelHtml}</text>
          `);
        }

        // 記号 (出区○・入区△等)
        this.renderSymbols(elements, tr, fromX, toX, yTop, lineColor, settings);
      }

      // 運用ブロック下部太線 (56.48 .. 1067.52, 高さ 2.56px)
      elements.push(`
        <rect x="56.48" y="${blockBottomBorderTop.toFixed(2)}" width="1011.04" height="${borderWidth}" fill="#000000" />
      `);

      prevBlockBorderTop = blockBottomBorderTop;
      prevBlockBorderBottom = blockBottomBorderBottom;
    }

    // 左右の外枠縦線 (表全体の高さをカバー)
    const tableTotalH = prevBlockBorderBottom - headerTop;
    elements.push(`
      <!-- 左外枠線 -->
      <rect x="${tableLeft}" y="${headerTop}" width="${borderWidth}" height="${tableTotalH.toFixed(2)}" fill="#000000" />
      <!-- 運用番号列境界線 -->
      <rect x="${tableInnerX}" y="${headerTop + borderWidth}" width="${borderWidth}" height="${(tableTotalH - borderWidth).toFixed(2)}" fill="#000000" />
      <!-- 右外枠線 -->
      <rect x="${tableRight}" y="${headerTop}" width="${borderWidth}" height="${tableTotalH.toFixed(2)}" fill="#000000" />
    `);

    // 3. 注記テキスト (Notes) の描画（該当ページのみ描画）
    if (data.notes && data.notes.length > 0) {
      for (const n of data.notes) {
        const notePage = (n.page === "all" || n.page === undefined) ? "all" : (typeof n.page === "number" ? n.page : parseInt(n.page, 10));
        if (notePage !== "all" && notePage !== pageIndex) {
          continue; // 他のページの注記は描画しない
        }

        const noteX = Number.isFinite(n.x) ? n.x : 202.40;
        const noteY = Number.isFinite(n.y) ? n.y : 340.48;
        const noteColor = n.color || "#FF0000";
        const noteSize = Number.isFinite(n.fontSize) ? n.fontSize : 10.72;

        elements.push(`
          <g class="diagram-note" data-note-id="${this.escapeXml(n.id)}" transform="translate(${noteX.toFixed(2)}, ${noteY.toFixed(2)})" style="cursor: move;">
            <text class="font-f1" x="0" y="0" font-size="${noteSize}" fill="${noteColor}">${this.escapeXml(n.text)}</text>
          </g>
        `);
      }
    }

    // 4. フッターページ番号 (X = 550.72, Y = 1552.96)
    elements.push(`
      <text class="font-f1" x="550.72" y="1552.96" font-size="13.28" fill="#000000" text-anchor="middle">${pageIndex}/${totalPages}</text>
    `);

    // SVG全体の組み立て
    return `
      <svg class="box-diagram-svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>
            .font-f1 { font-family: "MS PGothic", "ＭＳ Ｐゴシック", "MS UI Gothic", sans-serif; }
            .font-f2 { font-family: "MS Mincho", "ＭＳ 明朝", serif; }
            .font-f3 { font-family: "MS Gothic", "ＭＳ ゴシック", monospace; }
            .train-line-group { cursor: pointer; }
            .train-line-group:hover line { stroke-width: 2.2px; }
            .diagram-note:hover text { text-decoration: underline; }
          </style>
        </defs>
        <rect width="${W}" height="${H}" fill="#FFFFFF" />
        ${elements.join("\n")}
      </svg>
    `;
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
   * 記号（丸印・三角印）の描画
   */
  renderSymbols(elements, train, fromX, toX, yTop, lineColor, settings) {
    const centerY = yTop + 0.64;

    // 出発記号 (depSymbol: circle, circle_filled)
    if (train.depSymbol === "circle" || train.depSymbol === "circle_filled") {
      const rx = 3.60;
      const ry = 3.36;
      const fill = (train.depSymbol === "circle_filled") ? "#000000" : "#FFFFFF";
      elements.push(`
        <ellipse cx="${fromX.toFixed(2)}" cy="${centerY.toFixed(2)}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="#000000" stroke-width="0.32" />
      `);
    }

    // 到着記号 (arrSymbol: triangle, triangle_filled)
    if (train.arrSymbol === "triangle" || train.arrSymbol === "triangle_filled") {
      const fill = (train.arrSymbol === "triangle_filled") ? "#000000" : "#FFFFFF";
      // 幅 7.20px, 高さ 5.60px, 枠線色 #223F59
      // 頂点上向き
      const p1 = `${toX.toFixed(2)},${(centerY - 3.04).toFixed(2)}`;
      const p2 = `${(toX - 3.60).toFixed(2)},${(centerY + 2.56).toFixed(2)}`;
      const p3 = `${(toX + 3.60).toFixed(2)},${(centerY + 2.56).toFixed(2)}`;

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

  renderEmptySvg(data) {
    return `
      <svg class="box-diagram-svg" viewBox="0 0 1122.56 1587.36" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <rect width="1122.56" height="1587.36" fill="#FFFFFF" />
        <text x="561.28" y="793.68" font-size="20" fill="#999999" text-anchor="middle">表示可能な運用データがありません</text>
      </svg>
    `;
  }
}

// グローバルインスタンス
window.BoxDiagramRenderer = BoxDiagramRenderer;
