/**
 * 箱ダイヤ描画ソフト - OuDia (.oud) / OuDiaSecond (.oud2) パーサー＆コンバーター
 *
 * - 文字コード自動判定 (UTF-8 BOM / strict UTF-8 / Shift_JIS) + 手動切替対応
 * - 階層ドット区切りブロック AST 解析
 * - OuDiaSecond Ver2.06.24+ OperationTable. / OTRessya. 対応
 * - 旧 .oud2 OperationNumber[駅順] / Operation[駅順][B|A] 対応
 * - 従来 .oud / 運用機能無効時の仮運用フォールバック対応
 * - 既存の BoxDiagramDataModel (version: "2.0") 互換オブジェクト生成
 */

class OudParser {
  /**
   * ArrayBuffer を文字列へデコードする
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {"auto"|"utf-8"|"shift_jis"} forcedEncoding
   * @returns {{ text: string, encoding: "utf-8"|"shift_jis" }}
   */
  static decodeBuffer(buffer, forcedEncoding = "auto") {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

    if (forcedEncoding === "utf-8") {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return { text: this._stripBom(text), encoding: "utf-8" };
    }
    if (forcedEncoding === "shift_jis") {
      const text = new TextDecoder("shift_jis", { fatal: false }).decode(bytes);
      return { text: this._stripBom(text), encoding: "shift_jis" };
    }

    // UTF-8 BOM 検出
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(3));
      return { text: this._stripBom(text), encoding: "utf-8" };
    }

    // BOM なしの場合、まず strict UTF-8 を試行し、不正シーケンスなら Shift_JIS へフォールバック
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return { text: this._stripBom(text), encoding: "utf-8" };
    } catch (_) {
      const text = new TextDecoder("shift_jis", { fatal: false }).decode(bytes);
      return { text: this._stripBom(text), encoding: "shift_jis" };
    }
  }

  static _stripBom(str) {
    return str && str.charCodeAt(0) === 0xfeff ? str.slice(1) : str;
  }

  /**
   * 階層テキスト (.oud / .oud2) を AST に変換する
   * @param {string} text
   */
  static parseAst(text) {
    const root = this._createAstNode("Root");
    const stack = [root];
    const lines = String(text || "").split(/\r\n|\r|\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.trim() === "") continue;

      const trimmed = line.trim();
      if (trimmed === ".") {
        if (stack.length > 1) {
          stack.pop();
        }
        continue;
      }

      // <SectionName>. 形式（値に '.' を含む Key=Value を誤認しないよう '=' 不含を確認）
      const sectionMatch = trimmed.match(/^([A-Za-z0-9_]+)\.$/);
      if (sectionMatch) {
        const node = this._createAstNode(sectionMatch[1]);
        const parent = stack[stack.length - 1];
        parent.children.push(node);
        if (!parent.byType[node.type]) {
          parent.byType[node.type] = [];
        }
        parent.byType[node.type].push(node);
        stack.push(node);
        continue;
      }

      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1);
        const current = stack[stack.length - 1];
        current.props[key] = val;
      }
    }

    return root;
  }

  static _createAstNode(type) {
    return { type, props: {}, children: [], byType: {} };
  }

  /**
   * バイナリバッファから中間ドキュメントを解析する
   * @param {ArrayBuffer|Uint8Array} buffer
   * @param {"auto"|"utf-8"|"shift_jis"} encoding
   * @param {string} fileName
   */
  static parseDocument(buffer, encoding = "auto", fileName = "") {
    const decoded = this.decodeBuffer(buffer, encoding);
    const ast = this.parseAst(decoded.text);

    const fileType = (ast.props.FileType || "").trim();
    const rosen = (ast.byType.Rosen && ast.byType.Rosen[0]) || null;

    if (!rosen || (!/^OuDia/i.test(fileType) && !(rosen.byType.Eki && rosen.byType.Dia))) {
      throw new Error("有効な OuDia (.oud) / OuDiaSecond (.oud2) ファイル形式が見つかりません。");
    }

    const isOud2 = /OuDiaSecond/i.test(fileType);
    const rosenName = (rosen.props.Rosenmei || "").trim() || this._baseFileName(fileName) || "取込路線";
    const kitenParsed = this.parseRawTime(rosen.props.KitenJikoku || "400", "truncate");
    const kitenMinutes = kitenParsed ? kitenParsed.totalMinutes : 240;
    const enableOperation = rosen.props.EnableOperation !== "0";

    const ekiNodes = rosen.byType.Eki || [];
    if (ekiNodes.length < 2) {
      throw new Error("駅データ (Eki.) が2駅未満のため箱ダイヤを作成できません。");
    }

    const stations = ekiNodes.map((node, idx) => {
      const p = node.props;
      const name = (p.Ekimei || `駅${idx + 1}`).trim();
      const abbr = (p.EkimeiDiaRyaku || p.EkimeiJikokuhyouRyaku || this._makeShortAbbr(name)).trim();
      const ekikibo = p.Ekikibo || "Ekikibo_Ippan";
      const isMajor = /Syuyou/i.test(ekikibo) || idx === 0 || idx === ekiNodes.length - 1;
      return {
        index: idx,
        id: `st_${idx + 1}`,
        name,
        abbr: abbr || name[0] || "駅",
        ekikibo,
        isMajor
      };
    });

    const typeNodes = rosen.byType.Ressyasyubetsu || [];
    const trainTypes = this._buildTrainTypes(typeNodes);

    const diaNodes = rosen.byType.Dia || [];
    if (diaNodes.length === 0) {
      throw new Error("ダイヤ定義 (Dia.) が見つかりません。");
    }

    const diagrams = diaNodes.map((diaNode, idx) =>
      this._parseDiaNode(diaNode, idx, stations.length)
    );

    return {
      fileName,
      encoding: decoded.encoding,
      fileType: fileType || (isOud2 ? "OuDiaSecond" : "OuDia"),
      isOud2,
      rosenName,
      kitenMinutes,
      enableOperation,
      stations,
      trainTypes,
      diagrams
    };
  }

  static _baseFileName(fileName) {
    return String(fileName || "").replace(/\.(oud2?|txt)$/i, "");
  }

  static _makeShortAbbr(name) {
    if (!name) return "駅";
    return name.length <= 2 ? name : name[0];
  }

  static _buildTrainTypes(typeNodes) {
    if (!typeNodes || typeNodes.length === 0) {
      return [
        {
          id: "local",
          name: "普通",
          lineColor: "#000000",
          timeColor: "#000000",
          textColor: "#000000",
          lineWidth: 1.28,
          lineStyle: "solid",
          font: "F1",
          prefix: ""
        }
      ];
    }

    let usedLocalId = false;
    let usedDeadheadId = false;

    return typeNodes.map((node, idx) => {
      const p = node.props;
      const name = (p.Syubetsumei || `種別${idx + 1}`).trim();
      let id = `type_${idx + 1}`;
      if (!usedDeadheadId && name.includes("回送")) {
        id = "deadhead";
        usedDeadheadId = true;
      } else if (!usedLocalId && (name === "普通" || name.startsWith("普通"))) {
        id = "local";
        usedLocalId = true;
      } else if (idx === 0 && !usedLocalId && !name.includes("回送")) {
        id = "local";
        usedLocalId = true;
      }

      const lineColor = this.bgrHexToCss(p.DiagramSenColor, "#000000");
      const mojiColor = p.JikokuhyouMojiColor ? this.bgrHexToCss(p.JikokuhyouMojiColor, "#000000") : "#000000";
      const lineStyle = this.mapSenStyle(p.DiagramSenStyle);
      const isBold = p.DiagramSenIsBold === "1";

      return {
        id,
        name,
        lineColor,
        timeColor: mojiColor,
        textColor: mojiColor,
        lineWidth: isBold ? 1.92 : 1.28,
        lineStyle,
        font: "F1",
        prefix: (p.Ryakusyou || "").trim()
      };
    });
  }

  /**
   * Win32 COLORREF (00BBGGRR / BBGGRR) を CSS #RRGGBB に変換する
   */
  static bgrHexToCss(rawHex, fallback = "#000000") {
    if (!rawHex) return fallback;
    const trimmed = String(rawHex).trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    const cleaned = trimmed.replace(/^(0x|#)/i, "");
    let bb = "";
    let gg = "";
    let rr = "";
    if (/^[0-9A-Fa-f]{8}$/.test(cleaned)) {
      bb = cleaned.slice(2, 4);
      gg = cleaned.slice(4, 6);
      rr = cleaned.slice(6, 8);
    } else if (/^[0-9A-Fa-f]{6}$/.test(cleaned)) {
      bb = cleaned.slice(0, 2);
      gg = cleaned.slice(2, 4);
      rr = cleaned.slice(4, 6);
    } else {
      return fallback;
    }

    return `#${rr}${gg}${bb}`.toUpperCase();
  }

  static mapSenStyle(senStyle) {
    if (!senStyle) return "solid";
    if (senStyle === "SenStyle_Hasen" || senStyle === "SenStyle_Ittensasen") return "dashed";
    if (senStyle === "SenStyle_Tensen") return "dotted";
    return "solid";
  }

  static _parseDiaNode(diaNode, idx, stationCount) {
    const name = (diaNode.props.DiaName || `ダイヤ${idx + 1}`).trim();

    const kudariNode = (diaNode.byType.Kudari && diaNode.byType.Kudari[0]) || null;
    const noboriNode = (diaNode.byType.Nobori && diaNode.byType.Nobori[0]) || null;

    const kudari = (kudariNode && kudariNode.byType.Ressya ? kudariNode.byType.Ressya : [])
      .map((r, rIdx) => this._parseRessyaNode(r, "Kudari", rIdx, stationCount));
    const nobori = (noboriNode && noboriNode.byType.Ressya ? noboriNode.byType.Ressya : [])
      .map((r, rIdx) => this._parseRessyaNode(r, "Nobori", rIdx, stationCount));

    const operationTables = this._collectOperationTables(diaNode).map((ot, otIdx) =>
      this._parseOperationTableNode(ot, otIdx)
    );

    const allTrains = kudari.concat(nobori);
    const hasOperationNumbers = allTrains.some(tr => Object.keys(tr.operationNumbers).length > 0);
    const hasLegacyOperations = allTrains.some(tr => Object.keys(tr.operations).length > 0);
    const hasLegacyOpSeeds = allTrains.some(tr => this._extractLegacySeedOpsFromTrain(tr).length > 0);

    return {
      index: idx,
      name,
      kudari,
      nobori,
      operationTables,
      hasOperationNumbers,
      hasLegacyOperations,
      hasLegacyOpSeeds
    };
  }

  static _collectOperationTables(diaNode) {
    if (diaNode.byType.OperationTable && diaNode.byType.OperationTable.length > 0) {
      return diaNode.byType.OperationTable;
    }
    const found = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child.type === "OperationTable") {
          found.push(child);
        } else {
          visit(child);
        }
      }
    };
    visit(diaNode);
    return found;
  }

  static _parseOperationTableNode(node, idx) {
    const opNumber = (node.props.OTOperationNumber || `運用${idx + 1}`).trim();
    const otRessyaNodes = node.byType.OTRessya || [];
    const entries = otRessyaNodes.map(r => {
      const p = r.props;
      const houkou = /Nobori/i.test(p.OTHoukou || "") ? "Nobori" : "Kudari";
      return {
        houkou,
        ressyaIndex: parseInt(p.OTRessyaIndex, 10),
        sihatsuEkiOrder: parseInt(p.SihatsuEkiOrder, 10),
        syuuchakuEkiOrder: parseInt(p.SyuuchakuEkiOrder, 10),
        beforeType: (p.BeforeType || "BeforeAfterType_Unrelated").trim(),
        afterType: (p.AfterType || "BeforeAfterType_Unrelated").trim()
      };
    }).filter(e => !Number.isNaN(e.ressyaIndex));

    return { opNumber, entries };
  }

  static _parseRessyaNode(node, direction, index, stationCount) {
    const p = node.props;
    const syubetsuIndex = parseInt(p.Syubetsu, 10);
    const trainNo = (p.Ressyabangou || "").trim();
    const trainName = (p.Ressyamei || "").trim();
    const bikou = (p.Bikou || "").trim();

    const cancelRaw = p.IsCanceled ?? p.IsCanceld ?? p.Canceled ?? p.Cancel ?? p.Unkyu;
    const isCanceled = cancelRaw === "1" || String(cancelRaw).toLowerCase() === "true";

    const ekiTokens = (p.EkiJikoku || "").split(",");
    const stationEntries = [];
    for (let order = 0; order < stationCount; order++) {
      stationEntries.push(this._parseEkiJikokuToken(ekiTokens[order] || ""));
    }

    const operationNumbers = {};
    const operations = {};
    for (const [key, val] of Object.entries(p)) {
      const opNumMatch = key.match(/^OperationNumber(\d+)$/);
      if (opNumMatch) {
        const order = parseInt(opNumMatch[1], 10);
        const list = String(val || "").split(";").map(s => s.trim()).filter(Boolean);
        if (list.length > 0) {
          operationNumbers[order] = list;
        }
        continue;
      }

      const opMatch = key.match(/^Operation(\d+)([BA])$/);
      if (opMatch) {
        const order = parseInt(opMatch[1], 10);
        const side = opMatch[2];
        if (!operations[order]) operations[order] = {};
        operations[order][side] = String(val || "").trim();
      }
    }

    return {
      direction,
      index,
      syubetsuIndex: Number.isNaN(syubetsuIndex) ? 0 : syubetsuIndex,
      trainNo,
      trainName,
      bikou,
      isCanceled,
      stationEntries,
      operationNumbers,
      operations
    };
  }

  static _parseEkiJikokuToken(rawToken) {
    const token = String(rawToken || "").trim();
    if (!token) {
      return { status: "none", arrRaw: "", depRaw: "", hasSingleOnly: false, track: "" };
    }

    const dollarIdx = token.indexOf("$");
    const main = dollarIdx >= 0 ? token.slice(0, dollarIdx) : token;
    const track = dollarIdx >= 0 ? token.slice(dollarIdx + 1) : "";

    const semiIdx = main.indexOf(";");
    const rawStatus = semiIdx >= 0 ? main.slice(0, semiIdx).trim() : main.trim();
    const timePart = semiIdx >= 0 ? main.slice(semiIdx + 1).trim() : "";

    if (rawStatus === "3") {
      return { status: "keiyunasi", arrRaw: "", depRaw: "", hasSingleOnly: false, track };
    }

    let arrRaw = "";
    let depRaw = "";
    let hasSingleOnly = false;
    if (timePart) {
      const slashIdx = timePart.indexOf("/");
      if (slashIdx >= 0) {
        arrRaw = timePart.slice(0, slashIdx).trim();
        depRaw = timePart.slice(slashIdx + 1).trim();
      } else {
        depRaw = timePart;
        hasSingleOnly = true;
      }
    }

    return {
      status: rawStatus || "none",
      arrRaw,
      depRaw,
      hasSingleOnly,
      track
    };
  }

  /**
   * OuDia 時刻文字列 (HMM / HHMM / HHMMSS / H:MM) をパースする
   */
  static parseRawTime(rawTime, secondMode = "truncate", maxHour = 27) {
    const s = String(rawTime || "").trim();
    if (!s) return null;

    let h = 0;
    let m = 0;
    let sec = 0;

    const colonMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (colonMatch) {
      h = parseInt(colonMatch[1], 10);
      m = parseInt(colonMatch[2], 10);
      sec = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0;
    } else if (/^\d{3,6}$/.test(s)) {
      if (s.length <= 4) {
        const padded = s.padStart(4, "0");
        h = parseInt(padded.slice(0, 2), 10);
        m = parseInt(padded.slice(2, 4), 10);
      } else {
        const padded = s.padStart(6, "0");
        h = parseInt(padded.slice(0, 2), 10);
        m = parseInt(padded.slice(2, 4), 10);
        sec = parseInt(padded.slice(4, 6), 10);
      }
    } else {
      return null;
    }

    if (Number.isNaN(h) || Number.isNaN(m) || m < 0 || m >= 60 || sec < 0 || sec >= 60) {
      return null;
    }

    if (secondMode === "round" && sec >= 30) {
      m += 1;
      if (m >= 60) {
        m = 0;
        h += 1;
      }
    }

    const totalMinutes = h * 60 + m;
    const wrapped = h > maxHour;
    const displayH = wrapped ? (h % 24) : h;
    const text = `${displayH}:${String(m).padStart(2, "0")}`;

    return {
      text,
      rawText: `${h}:${String(m).padStart(2, "0")}`,
      totalMinutes,
      wrapped
    };
  }

  static stationIndexForOrder(direction, order, stationCount) {
    return direction === "Nobori" ? (stationCount - 1 - order) : order;
  }

  /**
   * 選択条件に従って BoxDiagramDataModel (version: "2.0") JSON を生成する
   */
  static convertToBoxDiagram(parsedDoc, options = {}) {
    const diagramIndex = Number.isInteger(options.diagramIndex) ? options.diagramIndex : 0;
    const dia = parsedDoc.diagrams[diagramIndex] || parsedDoc.diagrams[0];
    const excludeCanceled = options.excludeCanceled !== false;
    const fallbackMode = options.fallbackMode === "single" ? "single" : "direction";
    const secondMode = options.timeSecondMode === "round" ? "round" : "truncate";
    const propertySameStepRows = typeof options.propertySameStepRows === "number"
      ? options.propertySameStepRows
      : 0;

    const warnings = [];
    const warningSet = new Set();
    const addWarning = (msg) => {
      if (!warningSet.has(msg)) {
        warningSet.add(msg);
        warnings.push(msg);
      }
    };

    const stats = {
      diagramName: dia.name,
      operationSource: "",
      canceledSkippedCount: 0,
      omittedTrainCount: 0,
      wrappedTimeCount: 0,
      usedEndpointIds: new Set()
    };

    const context = {
      parsedDoc,
      dia,
      excludeCanceled,
      fallbackMode,
      secondMode,
      propertySameStepRows,
      stats,
      addWarning
    };

    let rosters = [];
    if (dia.operationTables.length > 0 && parsedDoc.enableOperation) {
      stats.operationSource = "OperationTable (OuDiaSecond 運用表)";
      rosters = this._buildRostersFromOperationTables(context);
    } else if (dia.hasOperationNumbers && parsedDoc.enableOperation) {
      stats.operationSource = "OperationNumber (運用番号抽出)";
      rosters = this._buildRostersFromOperationNumbers(context);
    } else if (dia.hasLegacyOperations && dia.hasLegacyOpSeeds && parsedDoc.enableOperation) {
      stats.operationSource = "Operation作業タグ (前/後作業チェーン自動復元)";
      rosters = this._buildRostersFromLegacyOperations(context);
    } else {
      stats.operationSource = (dia.hasLegacyOperations && parsedDoc.enableOperation)
        ? "運用作業タグのみ・運用番号未記載 (下り/上り仮運用)"
        : (fallbackMode === "single" ? "運用データなし (未割当仮運用)" : "運用データなし (下り/上り仮運用)");
      if (dia.hasLegacyOperations && parsedDoc.enableOperation && !dia.hasLegacyOpSeeds) {
        addWarning("選択されたダイヤには運用番号の起点（出区・運用指定）が含まれていないため仮運用に分類しました。");
      }
      rosters = this._buildRostersFallback(context);
    }

    if (stats.canceledSkippedCount > 0) {
      addWarning(`運休扱いの列車 ${stats.canceledSkippedCount} 本を除外しました。`);
    }
    if (stats.omittedTrainCount > 0) {
      addWarning(`発着時刻が2駅以上揃わない列車 ${stats.omittedTrainCount} 本をスキップしました。`);
    }
    if (stats.wrappedTimeCount > 0) {
      addWarning(`28時以降の深夜時刻 ${stats.wrappedTimeCount} 件を現行モデル上限（0:00〜27:59）に合わせて翌日時刻表記へ変換しました。`);
    }
    if (rosters.length === 0) {
      addWarning("描画可能な列車データが見つかりませんでした。条件や文字コードを確認してください。");
    }

    // 駅リストおよびX座標計算
    const recommendedVisibleIds = new Set();
    parsedDoc.stations.forEach(st => {
      if (st.isMajor || stats.usedEndpointIds.has(st.id)) {
        recommendedVisibleIds.add(st.id);
      }
    });

    const selectedVisibleSet = options.visibleStationIds
      ? new Set(options.visibleStationIds)
      : new Set(recommendedVisibleIds);

    // 最低2駅は表示を保証
    if (selectedVisibleSet.size < 2 && parsedDoc.stations.length >= 2) {
      selectedVisibleSet.add(parsedDoc.stations[0].id);
      selectedVisibleSet.add(parsedDoc.stations[parsedDoc.stations.length - 1].id);
    }

    const stations = this._buildPositionedStations(parsedDoc.stations, selectedVisibleSet);
    const totalTrains = rosters.reduce((sum, r) => sum + r.trains.length, 0);

    const data = {
      version: "2.0",
      metadata: {
        title: `${parsedDoc.rosenName}${dia.name ? ` (${dia.name})` : ""}`,
        copyright: "",
        updatedAt: new Date().toISOString().split("T")[0]
      },
      settings: {
        pageSize: "A4",
        orientation: "portrait",
        pageBreakMode: "auto",
        baseRowHeight: 12.96,
        rosterStepRows: 2,
        partialConnectStepRows: 1,
        blockPaddingRows: 2,
        stationHeaderDirection: "vertical",
        subHeaderMode: "omitFirst",
        selfHighlightStyle: "red",
        showLegend: false,
        symbolScale: 1.0,
        symbolFill: "preset",
        autoSyncCoupled: true,
        timeAxisStartHour: Math.max(0, Math.min(12, Math.floor((parsedDoc.kitenMinutes || 240) / 60)))
      },
      stations,
      trainTypes: JSON.parse(JSON.stringify(parsedDoc.trainTypes)),
      rosters,
      notes: []
    };

    return {
      data,
      warnings,
      recommendedVisibleIds: Array.from(recommendedVisibleIds),
      usedEndpointIds: Array.from(stats.usedEndpointIds),
      stats: {
        diagramName: dia.name,
        operationSource: stats.operationSource,
        totalStations: stations.length,
        visibleStationsCount: stations.filter(s => s.visible).length,
        trainTypesCount: data.trainTypes.length,
        rostersCount: rosters.length,
        trainsCount: totalTrains,
        canceledSkippedCount: stats.canceledSkippedCount,
        omittedTrainCount: stats.omittedTrainCount
      }
    };
  }

  static _buildPositionedStations(rawStations, visibleSet) {
    const stations = rawStations.map(st => ({
      id: st.id,
      name: st.name,
      abbr: st.abbr,
      visible: visibleSet.has(st.id),
      x: 200.32
    }));

    const visible = stations.filter(s => s.visible);
    if (visible.length >= 2) {
      const leftX = 200.32;
      const rightX = 987.52;
      const step = (rightX - leftX) / (visible.length - 1);
      visible.forEach((st, idx) => {
        st.x = Math.round((leftX + idx * step) * 100) / 100;
      });
    }

    // 非表示駅も前後表示駅間に線形補間した X を保持しておく
    for (let i = 0; i < stations.length; i++) {
      if (stations[i].visible) continue;
      let prevIdx = -1;
      for (let p = i - 1; p >= 0; p--) {
        if (stations[p].visible) { prevIdx = p; break; }
      }
      let nextIdx = -1;
      for (let n = i + 1; n < stations.length; n++) {
        if (stations[n].visible) { nextIdx = n; break; }
      }
      if (prevIdx !== -1 && nextIdx !== -1) {
        const ratio = (i - prevIdx) / (nextIdx - prevIdx);
        stations[i].x = Math.round((stations[prevIdx].x + ratio * (stations[nextIdx].x - stations[prevIdx].x)) * 100) / 100;
      } else if (nextIdx !== -1) {
        stations[i].x = stations[nextIdx].x;
      } else if (prevIdx !== -1) {
        stations[i].x = stations[prevIdx].x;
      }
    }

    return stations;
  }

  /**
   * 列車オブジェクト内の有効始発〜終着オーダー範囲と各時刻を取得する
   */
  static _getTrainTimedBounds(ressya, secondMode) {
    const parsedEntries = this._parseTrainEntries(ressya.stationEntries, secondMode);
    let firstOrder = -1;
    let lastOrder = -1;
    for (let i = 0; i < parsedEntries.length; i++) {
      if (parsedEntries[i].hasTime) {
        if (firstOrder === -1) firstOrder = i;
        lastOrder = i;
      }
    }
    return { parsedEntries, firstOrder, lastOrder };
  }

  static _parseTrainEntries(entries, secondMode) {
    return entries.map(e => {
      if (e.status === "keiyunasi") {
        return { hasTime: false, arrObj: null, depObj: null, status: e.status };
      }
      const arrObj = this.parseRawTime(e.arrRaw, secondMode);
      const depObj = this.parseRawTime(e.depRaw, secondMode);
      return {
        status: e.status,
        hasTime: Boolean(arrObj || depObj),
        arrObj,
        depObj
      };
    });
  }

  /**
   * Mode 1: OperationTable. セクションから運用＆列車を構築
   */
  static _buildRostersFromOperationTables(ctx) {
    const { parsedDoc, dia, excludeCanceled, secondMode, propertySameStepRows, stats } = ctx;
    const stationCount = parsedDoc.stations.length;
    const trainTypes = parsedDoc.trainTypes;

    const getRessya = (houkou, idx) => {
      const list = houkou === "Nobori" ? dia.nobori : dia.kudari;
      return list[idx] || null;
    };

    // 重複 OperationTable 名の安全化と列車スパンのインデックス化（併結判定用）
    const usedIds = new Set();
    const tableWraps = dia.operationTables.map(ot => {
      let rosterId = ot.opNumber;
      if (usedIds.has(rosterId)) {
        let suffix = 2;
        while (usedIds.has(`${ot.opNumber}_${suffix}`)) suffix++;
        rosterId = `${ot.opNumber}_${suffix}`;
      }
      usedIds.add(rosterId);
      return { ot, rosterId };
    });

    // (houkou, ressyaIndex) ごとに担当運用を収集
    const usagesByTrain = new Map();
    for (const tw of tableWraps) {
      for (const entry of tw.ot.entries) {
        const res = getRessya(entry.houkou, entry.ressyaIndex);
        if (!res) continue;
        if (excludeCanceled && res.isCanceled) continue;
        const key = `${entry.houkou}:${entry.ressyaIndex}`;
        if (!usagesByTrain.has(key)) usagesByTrain.set(key, []);
        usagesByTrain.get(key).push({
          rosterId: tw.rosterId,
          rawOpNumber: tw.ot.opNumber,
          sihatsu: Number.isNaN(entry.sihatsuEkiOrder) ? 0 : entry.sihatsuEkiOrder,
          syuuchaku: Number.isNaN(entry.syuuchakuEkiOrder) ? stationCount - 1 : entry.syuuchakuEkiOrder
        });
      }
    }

    const rosters = [];

    for (const tw of tableWraps) {
      const trains = [];
      let prevEntry = null;

      for (const entry of tw.ot.entries) {
        const res = getRessya(entry.houkou, entry.ressyaIndex);
        if (!res) continue;
        if (excludeCanceled && res.isCanceled) {
          stats.canceledSkippedCount++;
          continue;
        }

        const bounds = this._getTrainTimedBounds(res, secondMode);
        if (bounds.firstOrder === -1 || bounds.lastOrder === -1) {
          if (bounds.firstOrder !== -1 || res.trainNo) stats.omittedTrainCount++;
          continue;
        }

        let sOrder = Number.isNaN(entry.sihatsuEkiOrder) ? bounds.firstOrder : entry.sihatsuEkiOrder;
        let eOrder = Number.isNaN(entry.syuuchakuEkiOrder) ? bounds.lastOrder : entry.syuuchakuEkiOrder;
        sOrder = Math.max(0, Math.min(stationCount - 1, sOrder));
        eOrder = Math.max(0, Math.min(stationCount - 1, eOrder));

        const legTimes = this._extractLegEndpoints(res, bounds.parsedEntries, sOrder, eOrder, parsedDoc.stations, stats);
        if (!legTimes) {
          stats.omittedTrainCount++;
          continue;
        }

        const trainObj = this._createBaseTrainObject(res, legTimes, trainTypes);

        // 出発・到着記号のマッピング
        if (entry.beforeType === "BeforeAfterType_OutIn") {
          trainObj.depSymbol = "circle";
        }
        if (entry.afterType === "BeforeAfterType_OutIn") {
          trainObj.arrSymbol = "triangle";
        }

        // 途中駅での増解結（同一列車に別運用が一部区間で重複している場合）
        const trainKey = `${entry.houkou}:${entry.ressyaIndex}`;
        const usages = usagesByTrain.get(trainKey) || [];
        const overlapping = usages.filter(u =>
          Math.max(u.sihatsu, legTimes.startOrder) < Math.min(u.syuuchaku, legTimes.endOrder) ||
          (u.sihatsu === legTimes.startOrder && u.syuuchaku === legTimes.endOrder)
        );

        if (trainObj.depSymbol === "none" && legTimes.startOrder > bounds.firstOrder && overlapping.some(u => u.rosterId !== tw.rosterId && u.sihatsu < legTimes.startOrder)) {
          trainObj.depSymbol = "circle_filled";
        }
        if (trainObj.arrSymbol === "none" && legTimes.endOrder < bounds.lastOrder && overlapping.some(u => u.rosterId !== tw.rosterId && u.syuuchaku > legTimes.endOrder)) {
          trainObj.arrSymbol = "triangle_filled";
        }
        this._applyLegacyOperationSymbols(trainObj, res, legTimes.startOrder, legTimes.endOrder);

        // 併結相手・編成順の解決
        if (overlapping.length >= 2) {
          this._applyCouplingInfo(trainObj, tw.rosterId, tw.ot.opNumber, res, legTimes, overlapping, trainKey);
        }

        // 同一列車扱い継走 (BeforeAfterType_PropertySame) は同行表示（直前列車と駅一致時は 0 行）
        const prevTrain = trains[trains.length - 1] || null;
        if (entry.beforeType === "BeforeAfterType_PropertySame" && prevTrain && prevTrain.toStation === trainObj.fromStation) {
          trainObj.stepRows = propertySameStepRows;
        } else if (prevEntry && entry.beforeType === "BeforeAfterType_OperationNumberChange" && prevTrain && prevTrain.toStation === trainObj.fromStation) {
          trainObj.stepRows = propertySameStepRows;
        }

        stats.usedEndpointIds.add(trainObj.fromStation);
        stats.usedEndpointIds.add(trainObj.toStation);
        trains.push(trainObj);
        prevEntry = entry;
      }

      if (trains.length > 0) {
        rosters.push({
          id: tw.rosterId,
          name: tw.rosterId,
          customName: false,
          pageBreakAfter: false,
          trains
        });
      }
    }

    return rosters;
  }

  /**
   * Mode 2: OperationNumber[駅順] / Operation[駅順][B|A] からの運用復元
   */
  static _buildRostersFromOperationNumbers(ctx) {
    const { parsedDoc, dia, excludeCanceled, secondMode, propertySameStepRows, stats } = ctx;
    const stationCount = parsedDoc.stations.length;
    const trainTypes = parsedDoc.trainTypes;
    const legsByRoster = new Map();

    const processTrain = (res) => {
      if (excludeCanceled && res.isCanceled) {
        stats.canceledSkippedCount++;
        return;
      }
      const bounds = this._getTrainTimedBounds(res, secondMode);
      if (bounds.firstOrder === -1 || bounds.lastOrder === -1 || bounds.firstOrder === bounds.lastOrder) {
        if (bounds.firstOrder !== -1 || res.trainNo) stats.omittedTrainCount++;
        return;
      }

      // 有効区間内で運用番号が変化する駅順をセグメント分割
      const rawSegments = [];
      let currentOps = this._resolveActiveOpNumbersAtOrder(res, bounds.firstOrder);
      let segStart = bounds.firstOrder;

      for (let order = bounds.firstOrder + 1; order <= bounds.lastOrder; order++) {
        const nextOps = res.operationNumbers[order];
        if (nextOps && nextOps.length > 0 && nextOps.join(";") !== currentOps.join(";")) {
          if (currentOps.length > 0) {
            rawSegments.push({ startOrder: segStart, endOrder: order, ops: currentOps });
          }
          segStart = order;
          currentOps = nextOps;
        }
      }
      if (currentOps.length > 0 && segStart < bounds.lastOrder) {
        rawSegments.push({ startOrder: segStart, endOrder: bounds.lastOrder, ops: currentOps });
      }

      if (rawSegments.length === 0) {
        // 運用番号が付いていない列車は仮運用へ退避
        rawSegments.push({
          startOrder: bounds.firstOrder,
          endOrder: bounds.lastOrder,
          ops: [res.direction === "Nobori" ? "未割当_上り" : "未割当_下り"]
        });
      }

      rawSegments.forEach(seg => {
        const uniqueOps = [...new Set(seg.ops)];
        const legTimes = this._extractLegEndpoints(res, bounds.parsedEntries, seg.startOrder, seg.endOrder, parsedDoc.stations, stats);
        if (!legTimes) return;

        const usages = uniqueOps.map(op => ({
          rosterId: op,
          rawOpNumber: op,
          sihatsu: seg.startOrder,
          syuuchaku: seg.endOrder
        }));

        uniqueOps.forEach(opId => {
          const trainObj = this._createBaseTrainObject(res, legTimes, trainTypes);

          this._applyLegacyOperationSymbols(trainObj, res, legTimes.startOrder, legTimes.endOrder);
          if (trainObj.depSymbol === "none" && legTimes.startOrder > bounds.firstOrder) {
            trainObj.depSymbol = "circle_filled";
          }
          if (trainObj.arrSymbol === "none" && legTimes.endOrder < bounds.lastOrder) {
            trainObj.arrSymbol = "triangle_filled";
          }

          if (uniqueOps.length >= 2) {
            this._applyCouplingInfo(trainObj, opId, opId, res, legTimes, usages, `${res.direction}:${res.index}`);
          }

          stats.usedEndpointIds.add(trainObj.fromStation);
          stats.usedEndpointIds.add(trainObj.toStation);

          if (!legsByRoster.has(opId)) legsByRoster.set(opId, []);
          legsByRoster.get(opId).push({
            trainObj,
            sortMin: this._sortMinutes(legTimes.depObj || legTimes.arrObj, parsedDoc.kitenMinutes),
            isContinuation: seg.startOrder > bounds.firstOrder
          });
        });
      });
    };

    dia.kudari.forEach(processTrain);
    dia.nobori.forEach(processTrain);

    const rosters = [];
    for (const [opId, items] of legsByRoster.entries()) {
      items.sort((a, b) => a.sortMin - b.sortMin);
      const trains = items.map((item, idx) => {
        if (idx > 0 && item.isContinuation && items[idx - 1].trainObj.toStation === item.trainObj.fromStation) {
          item.trainObj.stepRows = propertySameStepRows;
        }
        return item.trainObj;
      });
      rosters.push({
        id: opId,
        name: opId,
        customName: false,
        pageBreakAfter: false,
        trains
      });
    }

    rosters.sort((a, b) => a.id.localeCompare(b.id, "ja", { numeric: true }));
    return rosters;
  }

  /**
   * 列車オブジェクト内の Operation[order][B|A] から明示的な運用番号シードを抽出する
   */
  static _extractLegacySeedOpsFromTrain(res) {
    const found = [];
    const opsMap = (res && res.operations) || {};
    for (const sideObj of Object.values(opsMap)) {
      if (!sideObj) continue;
      for (const side of ["B", "A"]) {
        if (!sideObj[side]) continue;
        const parsed = this._parseOperationTag(sideObj[side], side);
        if (parsed && parsed.ops.length > 0) {
          parsed.ops.forEach(op => found.push(op));
        }
      }
    }
    return found;
  }

  /**
   * Operation<order>[B|A] タグ文字列を解析する
   * 例:
   *   B: "3/522$/A1", "3/512$/A12;A2", "5/$", "5/$A601", "6/A1", "6/"
   *   A: "3/1133$", "5/$0", "5/$3"
   */
  static _parseOperationTag(rawVal, side) {
    const raw = String(rawVal || "").trim();
    if (!raw) return null;

    const m = raw.match(/^(\d+)\/(.*)$/);
    if (!m) return null;

    const code = m[1];
    const rest = m[2];
    const dollarIdx = rest.indexOf("$");
    const afterDollar = dollarIdx >= 0 ? rest.slice(dollarIdx + 1) : rest;

    const splitOps = (str) => String(str || "")
      .replace(/^\/+/, "")
      .split(";")
      .map(s => s.trim())
      .filter(Boolean);

    if (code === "3" || code === "33") {
      let opStr = "";
      if (dollarIdx >= 0) {
        opStr = afterDollar.startsWith("/") ? afterDollar.slice(1) : "";
      } else {
        const slashIdx = rest.indexOf("/");
        if (slashIdx >= 0) opStr = rest.slice(slashIdx + 1);
      }
      return {
        raw,
        code,
        isDepotOut: side === "B",
        isDepotIn: side === "A",
        isConnect: false,
        isOpChange: false,
        isReverse: false,
        isOuter: false,
        connectType: null,
        ops: side === "B" ? splitOps(opStr) : []
      };
    }

    if (code === "5" || code === "55") {
      const body = (dollarIdx >= 0 ? afterDollar : rest).trim();
      if (side === "A") {
        const slashIdx = body.indexOf("/");
        const flagPart = slashIdx >= 0 ? body.slice(0, slashIdx) : body;
        const connectType = /^\d+$/.test(flagPart) ? parseInt(flagPart, 10) : 0;
        return {
          raw,
          code,
          isDepotOut: false,
          isDepotIn: false,
          isConnect: true,
          isOpChange: false,
          isReverse: false,
          isOuter: false,
          connectType,
          ops: slashIdx >= 0 ? splitOps(body.slice(slashIdx + 1)) : []
        };
      }
      // 前作業 "5/$0/A1" 形式が来た場合は先頭フラグ "0/" を除いて運用番号を取得
      const cleanedB = /^[0-3]\//.test(body) ? body.slice(2) : body;
      return {
        raw,
        code,
        isDepotOut: false,
        isDepotIn: false,
        isConnect: true,
        isOpChange: false,
        isReverse: false,
        isOuter: false,
        connectType: null,
        ops: splitOps(cleanedB)
      };
    }

    if (code === "6" || code === "66") {
      const body = (dollarIdx >= 0 ? afterDollar : rest).trim();
      const ops = splitOps(body);
      return {
        raw,
        code,
        isDepotOut: false,
        isDepotIn: false,
        isConnect: false,
        isOpChange: true,
        isReverse: ops.length === 0,
        isOuter: false,
        connectType: null,
        ops
      };
    }

    if (code === "4" || code === "44") {
      const lastSlash = afterDollar.lastIndexOf("/");
      const ops = lastSlash >= 0 ? splitOps(afterDollar.slice(lastSlash + 1)) : [];
      return {
        raw,
        code,
        isDepotOut: false,
        isDepotIn: false,
        isConnect: false,
        isOpChange: false,
        isReverse: false,
        isOuter: true,
        connectType: null,
        ops: side === "B" ? ops : []
      };
    }

    return {
      raw,
      code,
      isDepotOut: false,
      isDepotIn: false,
      isConnect: false,
      isOpChange: false,
      isReverse: false,
      isOuter: false,
      connectType: null,
      ops: (side === "B" && dollarIdx >= 0 && afterDollar.includes("/"))
        ? splitOps(afterDollar.slice(afterDollar.lastIndexOf("/") + 1))
        : []
    };
  }

  /**
   * 起点時刻基準の絶対秒数 (ソートおよび高精度な折り返し判定用)
   */
  static _parseRawSeconds(rawTime, kitenMinutes = 240) {
    const s = String(rawTime || "").trim();
    if (!s) return null;
    let h = 0;
    let m = 0;
    let sec = 0;
    const colonMatch = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (colonMatch) {
      h = parseInt(colonMatch[1], 10);
      m = parseInt(colonMatch[2], 10);
      sec = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0;
    } else if (/^\d{3,6}$/.test(s)) {
      const padded = s.length <= 4 ? s.padStart(4, "0") : s.padStart(6, "0");
      h = parseInt(padded.slice(0, 2), 10);
      m = parseInt(padded.slice(2, 4), 10);
      sec = s.length > 4 ? parseInt(padded.slice(4, 6), 10) : 0;
    } else {
      return null;
    }
    if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(sec)) return null;
    const kitenSec = (kitenMinutes || 240) * 60;
    let totalSec = h * 3600 + m * 60 + sec;
    if (totalSec < kitenSec) totalSec += 86400;
    return totalSec;
  }

  /**
   * Mode 2.5: Operation<駅順>[B|A] タグ（OuDiaSecond Ver1.x〜1.17形式）から運用チェーンを復元
   */
  static _buildRostersFromLegacyOperations(ctx) {
    const { parsedDoc, dia, excludeCanceled, secondMode, propertySameStepRows, stats, addWarning } = ctx;
    const stations = parsedDoc.stations;
    const trainTypes = parsedDoc.trainTypes;
    const kitenMin = parsedDoc.kitenMinutes;

    const getOrderTag = (res, order, side) => {
      const sideObj = res.operations && res.operations[order];
      if (!sideObj || !sideObj[side]) return null;
      return this._parseOperationTag(sideObj[side], side);
    };

    const rawLegs = [];
    const buildTrainSegments = (res) => {
      if (excludeCanceled && res.isCanceled) {
        stats.canceledSkippedCount++;
        return;
      }
      const bounds = this._getTrainTimedBounds(res, secondMode);
      if (bounds.firstOrder === -1 || bounds.lastOrder === -1 || bounds.firstOrder === bounds.lastOrder) {
        if (bounds.firstOrder !== -1 || res.trainNo) stats.omittedTrainCount++;
        return;
      }

      // 途中駅で明示的 B タグや運用番号変更 (6/ 等) があればセグメント分割
      const splitOrders = [bounds.firstOrder];
      for (let o = bounds.firstOrder + 1; o < bounds.lastOrder; o++) {
        const midB = getOrderTag(res, o, "B");
        if (midB && (midB.ops.length > 0 || midB.isReverse || midB.isDepotOut)) {
          splitOrders.push(o);
        }
      }
      splitOrders.push(bounds.lastOrder);

      for (let i = 0; i < splitOrders.length - 1; i++) {
        const sO = splitOrders[i];
        const eO = splitOrders[i + 1];
        const legTimes = this._extractLegEndpoints(res, bounds.parsedEntries, sO, eO, stations, stats);
        if (!legTimes) continue;

        let bTag = getOrderTag(res, legTimes.startOrder, "B") || getOrderTag(res, sO, "B");
        if (!bTag && i === 0) {
          for (let scanO = 0; scanO <= legTimes.startOrder; scanO++) {
            const cand = getOrderTag(res, scanO, "B");
            if (cand && (cand.ops.length > 0 || cand.isDepotOut || cand.isConnect)) {
              bTag = cand;
              break;
            }
          }
        }
        let aTag = getOrderTag(res, legTimes.endOrder, "A") || getOrderTag(res, eO, "A");
        if (!aTag && i === splitOrders.length - 2) {
          for (let scanO = stations.length - 1; scanO >= legTimes.endOrder; scanO--) {
            const cand = getOrderTag(res, scanO, "A");
            if (cand && (cand.isDepotIn || cand.isConnect || cand.isOuter)) {
              aTag = cand;
              break;
            }
          }
        }

        const startEntry = res.stationEntries[legTimes.startOrder] || {};
        const endEntry = res.stationEntries[legTimes.endOrder] || {};
        const depRaw = startEntry.depRaw || startEntry.arrRaw;
        const arrRaw = endEntry.arrRaw || endEntry.depRaw;
        const turnDepRaw = (endEntry.arrRaw && endEntry.depRaw) ? endEntry.depRaw : "";

        const depSec = this._parseRawSeconds(depRaw, kitenMin) ?? ((legTimes.depObj.totalMinutes < kitenMin ? legTimes.depObj.totalMinutes + 1440 : legTimes.depObj.totalMinutes) * 60);
        const arrSec = this._parseRawSeconds(arrRaw, kitenMin) ?? ((legTimes.arrObj.totalMinutes < kitenMin ? legTimes.arrObj.totalMinutes + 1440 : legTimes.arrObj.totalMinutes) * 60);
        const turnDepSec = turnDepRaw ? this._parseRawSeconds(turnDepRaw, kitenMin) : null;

        const seedOps = (bTag && bTag.ops.length > 0) ? [...new Set(bTag.ops)] : null;
        const isConnectB = !!(bTag && (bTag.isConnect || bTag.isOpChange));
        const isReverseB = !!(bTag && bTag.isReverse);
        const canContinueAfter = !!(aTag ? (aTag.isConnect && !aTag.isDepotIn && !aTag.isOuter) : (turnDepSec !== null));

        rawLegs.push({
          res,
          legTimes,
          isIntraTrainContinuation: i > 0,
          intraTrainPrev: i > 0 ? rawLegs[rawLegs.length - 1] : null,
          depSec,
          arrSec,
          turnDepSec,
          depTrack: startEntry.track || "",
          arrTrack: endEntry.track || "",
          bTag,
          aTag,
          seedOps,
          isConnectB,
          isReverseB,
          canReceiveBefore: !seedOps && (isConnectB || isReverseB || i > 0),
          canContinueAfter,
          sortMin: this._sortMinutes(legTimes.depObj || legTimes.arrObj, kitenMin),
          trainKey: `${res.direction}:${res.index}:${i}`
        });
      }
    };

    dia.kudari.forEach(buildTrainSegments);
    dia.nobori.forEach(buildTrainSegments);

    const sortedLegs = rawLegs.slice().sort((a, b) => a.depSec - b.depSec || a.arrSec - b.arrSec);
    const opsOf = new Map();
    const prevLinkOf = new Map();
    const consumedArrivals = new Set();

    for (const leg of sortedLegs) {
      if (leg.seedOps && leg.seedOps.length > 0) {
        opsOf.set(leg, leg.seedOps);
      }
    }

    const arrivalsByStation = new Map();
    for (const leg of sortedLegs) {
      if (!leg.canContinueAfter) continue;
      const stId = leg.legTimes.toStation;
      if (!arrivalsByStation.has(stId)) arrivalsByStation.set(stId, []);
      arrivalsByStation.get(stId).push(leg);
    }

    const pickBestArrival = (candList, leg, preferOps = null) => {
      if (candList.length === 0) return null;
      const exactTurn = candList.find(a => a.turnDepSec !== null && a.turnDepSec === leg.depSec);
      if (exactTurn) return exactTurn;
      if (preferOps) {
        const sameOps = [...candList].reverse().find(a => {
          const aOps = opsOf.get(a);
          return aOps && aOps.join(";") === preferOps.join(";");
        });
        if (sameOps) return sameOps;
      }
      const sameTrackType = candList.filter(a =>
        leg.depTrack && a.arrTrack === leg.depTrack && a.res.syubetsuIndex === leg.res.syubetsuIndex
      );
      if (sameTrackType.length > 0) return sameTrackType[sameTrackType.length - 1];
      const sameType = candList.filter(a => a.res.syubetsuIndex === leg.res.syubetsuIndex);
      if (sameType.length > 0) return sameType[sameType.length - 1];
      return candList[candList.length - 1];
    };

    // 先行パス: 5/$A601 等の明示継続ラベルの到着元を先に引き当てて、後続の無記名列車に奪われないようにする
    for (const leg of sortedLegs) {
      if (!leg.seedOps || !leg.isConnectB) continue;
      const pool = (arrivalsByStation.get(leg.legTimes.fromStation) || [])
        .filter(a => !consumedArrivals.has(a) && a.arrSec <= leg.depSec);
      const match = pickBestArrival(pool, leg, leg.seedOps);
      if (match) {
        consumedArrivals.add(match);
        prevLinkOf.set(leg, match);
      }
    }

    // 時系列順の折り返し連鎖伝播 (LIFO: 最短折り返し優先)
    for (const leg of sortedLegs) {
      if (opsOf.has(leg)) continue;
      if (leg.isIntraTrainContinuation && leg.intraTrainPrev && opsOf.has(leg.intraTrainPrev)) {
        const baseOps = opsOf.get(leg.intraTrainPrev);
        opsOf.set(leg, leg.isReverseB ? baseOps.slice().reverse() : baseOps.slice());
        prevLinkOf.set(leg, leg.intraTrainPrev);
        continue;
      }
      if (!leg.canReceiveBefore) continue;

      const pool = (arrivalsByStation.get(leg.legTimes.fromStation) || [])
        .filter(a => !consumedArrivals.has(a) && a.arrSec <= leg.depSec && opsOf.has(a));
      const chosen = pickBestArrival(pool, leg, null);
      if (chosen) {
        consumedArrivals.add(chosen);
        const inherited = opsOf.get(chosen);
        opsOf.set(leg, leg.isReverseB ? inherited.slice().reverse() : inherited.slice());
        prevLinkOf.set(leg, chosen);
      }
    }

    const legsByRoster = new Map();
    let unassignedCount = 0;

    for (const leg of sortedLegs) {
      let resolvedOps = opsOf.get(leg);
      if (!resolvedOps || resolvedOps.length === 0) {
        resolvedOps = [leg.res.direction === "Nobori" ? "未割当_上り" : "未割当_下り"];
        unassignedCount++;
      }
      const uniqueOps = [...new Set(resolvedOps)];
      const usages = uniqueOps.map(op => ({
        rosterId: op,
        rawOpNumber: op,
        sihatsu: leg.legTimes.startOrder,
        syuuchaku: leg.legTimes.endOrder
      }));

      const prevLeg = prevLinkOf.get(leg);
      const isPropertySame = !!(leg.isIntraTrainContinuation || (prevLeg && prevLeg.aTag && prevLeg.aTag.connectType === 3));

      uniqueOps.forEach(opId => {
        const trainObj = this._createBaseTrainObject(leg.res, leg.legTimes, trainTypes);
        if (leg.bTag && leg.bTag.isDepotOut) {
          trainObj.depSymbol = "circle";
        } else if (leg.isIntraTrainContinuation) {
          trainObj.depSymbol = "circle_filled";
        }
        if (leg.aTag && leg.aTag.isDepotIn) {
          trainObj.arrSymbol = "triangle";
        }

        if (uniqueOps.length >= 2) {
          this._applyCouplingInfo(trainObj, opId, opId, leg.res, leg.legTimes, usages, leg.trainKey);
        }

        stats.usedEndpointIds.add(trainObj.fromStation);
        stats.usedEndpointIds.add(trainObj.toStation);

        if (!legsByRoster.has(opId)) legsByRoster.set(opId, []);
        legsByRoster.get(opId).push({
          trainObj,
          sortMin: leg.sortMin,
          isPropertySame
        });
      });
    }

    if (unassignedCount > 0) {
      addWarning(`折り返し元が途切れているため運用番号を特定できなかった列車 ${unassignedCount} 本を「未割当」にまとめました。`);
    }

    const rosters = [];
    for (const [opId, items] of legsByRoster.entries()) {
      items.sort((a, b) => a.sortMin - b.sortMin);
      const trains = items.map((item, idx) => {
        if (idx > 0 && item.isPropertySame && items[idx - 1].trainObj.toStation === item.trainObj.fromStation) {
          item.trainObj.stepRows = propertySameStepRows;
        }
        return item.trainObj;
      });
      rosters.push({
        id: opId,
        name: opId,
        customName: false,
        pageBreakAfter: false,
        trains
      });
    }

    rosters.sort((a, b) => a.id.localeCompare(b.id, "ja", { numeric: true }));
    return rosters;
  }

  /**
   * Mode 3: 運用データなし (.oud / EnableOperation=0) 用の仮運用構築
   */
  static _buildRostersFallback(ctx) {
    const { parsedDoc, dia, excludeCanceled, fallbackMode, secondMode, stats } = ctx;
    const trainTypes = parsedDoc.trainTypes;

    const extractAll = (list) => {
      const result = [];
      for (const res of list) {
        if (excludeCanceled && res.isCanceled) {
          stats.canceledSkippedCount++;
          continue;
        }
        const bounds = this._getTrainTimedBounds(res, secondMode);
        if (bounds.firstOrder === -1 || bounds.lastOrder === -1 || bounds.firstOrder === bounds.lastOrder) {
          if (bounds.firstOrder !== -1 || res.trainNo) stats.omittedTrainCount++;
          continue;
        }
        const legTimes = this._extractLegEndpoints(res, bounds.parsedEntries, bounds.firstOrder, bounds.lastOrder, parsedDoc.stations, stats);
        if (!legTimes) {
          stats.omittedTrainCount++;
          continue;
        }
        const trainObj = this._createBaseTrainObject(res, legTimes, trainTypes);
        this._applyLegacyOperationSymbols(trainObj, res, legTimes.startOrder, legTimes.endOrder);
        stats.usedEndpointIds.add(trainObj.fromStation);
        stats.usedEndpointIds.add(trainObj.toStation);
        result.push({
          trainObj,
          sortMin: this._sortMinutes(legTimes.depObj || legTimes.arrObj, parsedDoc.kitenMinutes)
        });
      }
      result.sort((a, b) => a.sortMin - b.sortMin);
      return result.map(item => item.trainObj);
    };

    const downTrains = extractAll(dia.kudari);
    const upTrains = extractAll(dia.nobori);

    if (fallbackMode === "single") {
      const merged = downTrains.concat(upTrains);
      if (merged.length === 0) return [];
      return [{
        id: "UNASSIGNED",
        name: "未割当",
        customName: true,
        pageBreakAfter: false,
        trains: merged
      }];
    }

    const rosters = [];
    if (downTrains.length > 0) {
      rosters.push({ id: "DOWN", name: "下り", customName: true, pageBreakAfter: false, trains: downTrains });
    }
    if (upTrains.length > 0) {
      rosters.push({ id: "UP", name: "上り", customName: true, pageBreakAfter: false, trains: upTrains });
    }
    return rosters;
  }

  static _resolveActiveOpNumbersAtOrder(res, targetOrder) {
    for (let o = targetOrder; o >= 0; o--) {
      if (res.operationNumbers[o] && res.operationNumbers[o].length > 0) {
        return res.operationNumbers[o];
      }
    }
    return [];
  }

  static _extractLegEndpoints(res, parsedEntries, rawStartOrder, rawEndOrder, stations, stats) {
    const startIdx = Math.min(rawStartOrder, rawEndOrder);
    const endIdx = Math.max(rawStartOrder, rawEndOrder);

    let activeStart = -1;
    for (let i = startIdx; i <= endIdx; i++) {
      if (parsedEntries[i] && parsedEntries[i].hasTime) {
        activeStart = i;
        break;
      }
    }
    let activeEnd = -1;
    for (let i = endIdx; i >= startIdx; i--) {
      if (parsedEntries[i] && parsedEntries[i].hasTime) {
        activeEnd = i;
        break;
      }
    }

    if (activeStart === -1 || activeEnd === -1 || activeStart === activeEnd) {
      return null;
    }

    const fromEntry = parsedEntries[activeStart];
    const toEntry = parsedEntries[activeEnd];

    const depObj = fromEntry.depObj || fromEntry.arrObj;
    const arrObj = toEntry.arrObj || toEntry.depObj;

    if (!depObj || !arrObj) return null;
    if (depObj.wrapped) stats.wrappedTimeCount++;
    if (arrObj.wrapped) stats.wrappedTimeCount++;

    const fromStationIdx = this.stationIndexForOrder(res.direction, activeStart, stations.length);
    const toStationIdx = this.stationIndexForOrder(res.direction, activeEnd, stations.length);
    const fromStation = stations[fromStationIdx] ? stations[fromStationIdx].id : "";
    const toStation = stations[toStationIdx] ? stations[toStationIdx].id : "";

    if (!fromStation || !toStation || fromStation === toStation) return null;

    return {
      startOrder: activeStart,
      endOrder: activeEnd,
      fromStation,
      toStation,
      depTime: depObj.text,
      arrTime: arrObj.text,
      depObj,
      arrObj
    };
  }

  static _createBaseTrainObject(res, legTimes, trainTypes) {
    const typeObj = trainTypes[res.syubetsuIndex] || trainTypes[0] || { id: "local" };
    return {
      trainNo: res.trainNo || "",
      typeId: typeObj.id,
      fromStation: legTimes.fromStation,
      depTime: legTimes.depTime,
      toStation: legTimes.toStation,
      arrTime: legTimes.arrTime,
      coupledPartner: "",
      coupledPosition: "after",
      coupledFormation: null,
      customCoupled: "",
      coupleGroupId: "",
      depSymbol: "none",
      arrSymbol: "none",
      depTimePos: "auto",
      arrTimePos: "auto",
      stepRows: 2
    };
  }

  static _applyCouplingInfo(trainObj, selfRosterId, selfRawOp, res, legTimes, overlappingUsages, trainKey) {
    // 編成順序は OperationNumber[startOrder] があれば優先、無ければ overlapping の順
    const rawOrder = this._resolveActiveOpNumbersAtOrder(res, legTimes.startOrder);
    const orderedIds = [];
    if (rawOrder.length >= 2) {
      for (const rawOp of rawOrder) {
        const match = overlappingUsages.find(u => u.rawOpNumber === rawOp && !orderedIds.includes(u.rosterId));
        if (match) orderedIds.push(match.rosterId);
      }
    }
    for (const u of overlappingUsages) {
      if (!orderedIds.includes(u.rosterId)) orderedIds.push(u.rosterId);
    }

    if (orderedIds.length < 2) return;

    const allSameSpan = overlappingUsages.every(u =>
      u.sihatsu === legTimes.startOrder && u.syuuchaku === legTimes.endOrder
    );

    if (!allSameSpan) {
      // 区間が異なる併結相手がいる場合、自動同期で始終着駅が上書きされないよう customCoupled で表記保持
      trainObj.customCoupled = `(${orderedIds.join("＋")})`;
      return;
    }

    const groupId = `cg_oud_${trainKey}_${legTimes.startOrder}_${legTimes.endOrder}`.replace(/[^A-Za-z0-9_]/g, "_");
    trainObj.coupleGroupId = groupId;

    if (orderedIds.length === 2) {
      const [first, second] = orderedIds;
      trainObj.coupledPartner = selfRosterId === first ? second : first;
      trainObj.coupledPosition = selfRosterId === first ? "after" : "before";
      trainObj.coupledFormation = null;
    } else {
      const others = orderedIds.filter(id => id !== selfRosterId);
      trainObj.coupledFormation = orderedIds;
      trainObj.coupledPartner = others[0] || "";
      trainObj.coupledPosition = orderedIds.indexOf(selfRosterId) === 0 ? "after" : "before";
    }
  }

  static _applyLegacyOperationSymbols(trainObj, res, startOrder, endOrder) {
    const beforeOp = res.operations[startOrder] ? res.operations[startOrder].B : "";
    const afterOp = res.operations[endOrder] ? res.operations[endOrder].A : "";
    if (trainObj.depSymbol === "none" && beforeOp && /^(?:3|33)\//.test(beforeOp)) {
      trainObj.depSymbol = "circle";
    }
    if (trainObj.arrSymbol === "none" && afterOp && /^(?:3|33)\//.test(afterOp)) {
      trainObj.arrSymbol = "triangle";
    }
  }

  static _sortMinutes(timeObj, kitenMinutes) {
    if (!timeObj) return 99999;
    let m = timeObj.totalMinutes;
    if (m < kitenMinutes) {
      m += 1440;
    }
    return m;
  }
}

window.OudParser = OudParser;
