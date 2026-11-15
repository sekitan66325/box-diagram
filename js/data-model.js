/**
 * 箱ダイヤ描画ソフト - データモデル＆状態管理 (DataModel)
 * 
 * - スキーマ定義・検証
 * - 履歴管理 (Undo / Redo: 変更前スナップショット方式)
 * - 駅・種別・運用・列車・注記・設定のCRUD
 * - 変更検知リスナー
 */

class BoxDiagramDataModel {
  constructor() {
    this.data = null;
    this.historyStack = [];
    this.redoStack = [];
    this.listeners = [];
    this.maxHistory = 50;
    this.isApplyingHistory = false;
  }

  // 用紙サイズ定義（標準サイズは 1 : sqrt(2) 比率 ＋ 変形サイズ AUTO / CUSTOM）
  static get PAGE_SPECS() {
    return {
      AUTO: { label: "変形 (自動フィット)", isAuto: true, baseW: 1123, baseH: 794, canvasScale: 1.0, widthMm: 297, heightMm: 210, mmPortrait: "210mm 297mm", mmLandscape: "297mm 210mm" },
      CUSTOM: { label: "変形 (手動サイズ指定 mm)", isCustom: true, baseW: 1587, baseH: 832, canvasScale: 1.0, widthMm: 220, heightMm: 420, mmPortrait: "220mm 420mm", mmLandscape: "420mm 220mm" },
      A3: { label: "A3 (297 × 420 mm)", baseW: 1123, baseH: 1587, canvasScale: 1.414, widthMm: 297, heightMm: 420, mmPortrait: "A3 portrait", mmLandscape: "A3 landscape" },
      B4: { label: "B4 (257 × 364 mm)", baseW: 971, baseH: 1374, canvasScale: 1.224, widthMm: 257, heightMm: 364, mmPortrait: "JIS-B4 portrait", mmLandscape: "JIS-B4 landscape" },
      A4: { label: "A4 (210 × 297 mm)", baseW: 794, baseH: 1123, canvasScale: 1.0, widthMm: 210, heightMm: 297, mmPortrait: "A4 portrait", mmLandscape: "A4 landscape" },
      B5: { label: "B5 (182 × 257 mm)", baseW: 688, baseH: 971, canvasScale: 1.0, widthMm: 182, heightMm: 257, mmPortrait: "JIS-B5 portrait", mmLandscape: "JIS-B5 landscape" },
      A5: { label: "A5 (148 × 210 mm)", baseW: 559, baseH: 794, canvasScale: 0.78, widthMm: 148, heightMm: 210, mmPortrait: "A5 portrait", mmLandscape: "A5 landscape" },
      B6: { label: "B6 (128 × 182 mm)", baseW: 484, baseH: 688, canvasScale: 0.72, widthMm: 128, heightMm: 182, mmPortrait: "128mm 182mm", mmLandscape: "182mm 128mm" }
    };
  }

  // フォントプリセット定義（部位別・注記個別指定で共通利用）
  static get FONT_PRESETS() {
    return {
      F1: {
        id: "F1",
        label: "Ｐゴシック（標準）",
        css: '"MS PGothic", "ＭＳ Ｐゴシック", "MS UI Gothic", sans-serif'
      },
      F2: {
        id: "F2",
        label: "明朝（時刻標準）",
        css: '"MS Mincho", "ＭＳ 明朝", serif'
      },
      F3: {
        id: "F3",
        label: "ゴシック（等幅）",
        css: '"MS Gothic", "ＭＳ ゴシック", monospace'
      },
      YUGOTHIC: {
        id: "YUGOTHIC",
        label: "游ゴシック",
        css: '"Yu Gothic", "YuGothic", "游ゴシック体", sans-serif'
      },
      YUMINCHO: {
        id: "YUMINCHO",
        label: "游明朝",
        css: '"Yu Mincho", "YuMincho", "游明朝体", serif'
      },
      MEIRYO: {
        id: "MEIRYO",
        label: "メイリオ",
        css: '"Meiryo", "メイリオ", sans-serif'
      },
      BIZ_GOTHIC: {
        id: "BIZ_GOTHIC",
        label: "BIZ UDゴシック",
        css: '"BIZ UDPGothic", "BIZ UDGothic", "Meiryo", sans-serif'
      },
      BIZ_MINCHO: {
        id: "BIZ_MINCHO",
        label: "BIZ UD明朝",
        css: '"BIZ UDPMincho", "BIZ UDMincho", "Yu Mincho", serif'
      },
      CONSOLAS: {
        id: "CONSOLAS",
        label: "Consolas / 等幅数字",
        css: '"Consolas", "SFMono-Regular", "MS Gothic", monospace'
      }
    };
  }

  static get DEFAULT_ELEMENT_FONTS() {
    return {
      header: "F1",
      station: "F1",
      roster: "F1",
      trainNo: "F1",
      time: "F2"
    };
  }

  static normalizeFontId(fontId, fallback = "F1") {
    const presets = BoxDiagramDataModel.FONT_PRESETS;
    if (typeof fontId === "string" && presets[fontId]) return fontId;
    return presets[fallback] ? fallback : "F1";
  }

  static resolveFontCss(fontId, fallback = "F1") {
    const presets = BoxDiagramDataModel.FONT_PRESETS;
    const key = BoxDiagramDataModel.normalizeFontId(fontId, fallback);
    return (presets[key] && presets[key].css) || presets.F1.css;
  }

  static clampCustomMm(val, fallback, minMm = 80, maxMm = 1800) {
    const num = typeof val === "number" ? val : parseFloat(val);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(minMm, Math.min(maxMm, Math.round(num)));
  }

  /**
   * 任意ミリ寸法 (widthMm × heightMm) から CSS px・SVGキャンバス論理座標・@page寸法を算出
   */
  static computeDimensionsFromMm(widthMm, heightMm) {
    const wMm = BoxDiagramDataModel.clampCustomMm(widthMm, 420, 100, 1800);
    const hMm = BoxDiagramDataModel.clampCustomMm(heightMm, 220, 80, 1200);
    const round2 = (v) => Math.round(v * 100) / 100;
    const SVG_PX_PER_MM = 5.345;
    const CSS_PX_PER_MM = 96 / 25.4;
    const baseW = Math.round(wMm * CSS_PX_PER_MM);
    const baseH = Math.round(hMm * CSS_PX_PER_MM);
    const canvasW = round2(wMm * SVG_PX_PER_MM);
    const canvasH = round2(hMm * SVG_PX_PER_MM);
    const isLandscape = wMm >= hMm;
    return {
      widthMm: wMm,
      heightMm: hMm,
      orientation: isLandscape ? "landscape" : "portrait",
      isLandscape,
      baseW,
      baseH,
      canvasW,
      canvasH,
      canvasScale: 1.0,
      cssPageSize: `${wMm}mm ${hMm}mm`
    };
  }

  /**
   * 現在の軸モードおよび用紙設定から実効キャンバス／印刷サイズを解決する
   */
  static getEffectivePageConfig(settings = {}) {
    const s = settings || {};
    const specs = BoxDiagramDataModel.PAGE_SPECS;
    const xAxisMode = s.xAxisMode === "time" ? "time" : "station";
    const isSeparateMode = !!s.separatePageSettingsByAxisMode;
    const isSeparateTime = isSeparateMode && xAxisMode === "time";

    const rawSize = isSeparateTime
      ? (s.timeAxisPageSize || s.pageSize || "AUTO")
      : (s.pageSize || "A4");
    const pageSize = specs[rawSize] ? rawSize : "A4";
    const spec = specs[pageSize];

    if (pageSize === "CUSTOM") {
      const customW = BoxDiagramDataModel.clampCustomMm(
        isSeparateTime ? s.timeAxisCustomWidthMm : s.customPageWidthMm,
        isSeparateTime ? 560 : 420,
        100,
        1800
      );
      const customH = BoxDiagramDataModel.clampCustomMm(
        isSeparateTime ? s.timeAxisCustomHeightMm : s.customPageHeightMm,
        220,
        80,
        1200
      );
      const dims = BoxDiagramDataModel.computeDimensionsFromMm(customW, customH);
      return Object.assign({
        xAxisMode,
        isSeparateMode,
        pageSize: "CUSTOM",
        spec,
        isAutoPageSize: false,
        isCustomPageSize: true
      }, dims);
    }

    if (pageSize === "AUTO") {
      // レンダラーの resolveAutoPagePagesAndGeometry が実内容で最終決定する（ここはフォールバック仮寸法）
      const provisionalW = xAxisMode === "time" ? 420 : 210;
      const provisionalH = xAxisMode === "time" ? 210 : 297;
      const dims = BoxDiagramDataModel.computeDimensionsFromMm(provisionalW, provisionalH);
      return Object.assign({
        xAxisMode,
        isSeparateMode,
        pageSize: "AUTO",
        spec,
        isAutoPageSize: true,
        isCustomPageSize: false
      }, dims);
    }

    const rawOrient = isSeparateTime
      ? (s.timeAxisOrientation || "landscape")
      : (s.orientation || "portrait");
    const orientation = rawOrient === "landscape" ? "landscape" : "portrait";

    const isLandscape = orientation === "landscape";
    const baseW = isLandscape ? spec.baseH : spec.baseW;
    const baseH = isLandscape ? spec.baseW : spec.baseH;
    const widthMm = isLandscape ? spec.heightMm : spec.widthMm;
    const heightMm = isLandscape ? spec.widthMm : spec.heightMm;
    const baseSvgW = isLandscape ? 1587.36 : 1122.56;
    const baseSvgH = isLandscape ? 1122.56 : 1587.36;
    const canvasScale = spec.canvasScale || 1.0;
    const round2 = (v) => Math.round(v * 100) / 100;
    const canvasW = canvasScale === 1.0 ? baseSvgW : round2(baseSvgW * canvasScale);
    const canvasH = canvasScale === 1.0 ? baseSvgH : round2(baseSvgH * canvasScale);
    const cssPageSize = isLandscape ? spec.mmLandscape : spec.mmPortrait;

    return {
      xAxisMode,
      isSeparateMode,
      pageSize,
      orientation,
      isLandscape,
      spec,
      widthMm,
      heightMm,
      baseW,
      baseH,
      canvasW,
      canvasH,
      canvasScale,
      cssPageSize,
      isAutoPageSize: false,
      isCustomPageSize: false
    };
  }

  /**
   * 新規ダイヤ作成用のクリーンな初期データ(v2.0)を構築する
   */
  static createNewDiagramData(options = {}) {
    const title = (typeof options.title === "string" && options.title.trim())
      ? options.title.trim()
      : "新規路線 車両運用図";
    const copyright = typeof options.copyright === "string" ? options.copyright.trim() : "";

    const rawStations = Array.isArray(options.stations)
      ? options.stations.filter(s => s && String(s.name || "").trim())
      : [];
    const baseStations = rawStations.length >= 2
      ? rawStations
      : [
          { name: "始発駅", abbr: "始" },
          { name: "主要駅", abbr: "主" },
          { name: "終着駅", abbr: "終" }
        ];

    const leftX = 200.32;
    const rightX = 987.52;
    const span = rightX - leftX;
    const step = span / Math.max(1, baseStations.length - 1);
    const stations = baseStations.map((st, idx) => {
      const name = String(st.name || "").trim() || `駅${idx + 1}`;
      const rawAbbr = String(st.abbr || "").trim();
      const abbr = rawAbbr || name.slice(0, 1);
      return {
        id: `st_${idx + 1}`,
        name,
        abbr,
        visible: true,
        x: Math.round((leftX + idx * step) * 100) / 100
      };
    });

    const sourceTypes = (typeof DEFAULT_TRAIN_TYPES !== "undefined" && Array.isArray(DEFAULT_TRAIN_TYPES))
      ? DEFAULT_TRAIN_TYPES
      : [
          { id: "local", name: "普通", lineColor: "#000000", timeColor: "#000000", textColor: "#000000", lineWidth: 1.28, lineStyle: "solid", font: "F1", prefix: "" }
        ];
    const simpleIds = new Set(["local", "rapid", "deadhead"]);
    const filteredTypes = options.typePreset === "simple"
      ? sourceTypes.filter(t => simpleIds.has(t.id))
      : sourceTypes;
    const trainTypes = JSON.parse(JSON.stringify(filteredTypes.length > 0 ? filteredTypes : sourceTypes));

    const rosterCountRaw = parseInt(options.rosterCount, 10);
    const rosterCount = Number.isNaN(rosterCountRaw) ? 1 : Math.max(0, Math.min(6, rosterCountRaw));
    const includeStarterTrain = !!options.includeStarterTrain;

    const rosters = [];
    for (let i = 0; i < rosterCount; i++) {
      const rName = `A${i + 1}`;
      const trains = [];
      if (i === 0 && includeStarterTrain && stations.length >= 2) {
        trains.push({
          trainNo: "102",
          typeId: trainTypes[0].id || "local",
          fromStation: stations[0].id,
          depTime: "6:00",
          toStation: stations[stations.length - 1].id,
          arrTime: "6:45",
          coupledPartner: "",
          coupledPosition: "after",
          coupledFormation: null,
          customCoupled: "",
          coupleGroupId: "",
          depSymbol: "circle",
          arrSymbol: "none",
          depTimePos: "auto",
          arrTimePos: "auto",
          stepRows: 2
        });
      }
      rosters.push({
        id: rName,
        name: rName,
        customName: false,
        pageBreakAfter: false,
        trains
      });
    }

    const layoutPreset = options.layoutPreset || "station_a4_portrait";
    const settings = {
      pageSize: "A4",
      orientation: layoutPreset === "station_a4_landscape" ? "landscape" : "portrait",
      xAxisMode: layoutPreset === "time_auto" ? "time" : "station",
      separatePageSettingsByAxisMode: true,
      timeAxisPageSize: "AUTO",
      timeAxisOrientation: "landscape",
      pageBreakMode: "auto",
      baseRowHeight: 12.96,
      rosterStepRows: 2,
      partialConnectStepRows: 1,
      blockPaddingRows: 2,
      stationHeaderDirection: "vertical",
      stationAxisDirection: "ltr",
      subHeaderMode: "omitFirst",
      selfHighlightStyle: "red",
      showLegend: false,
      symbolScale: 1.0,
      symbolFill: "preset",
      autoSyncCoupled: true
    };

    return {
      version: "2.0",
      metadata: {
        title,
        copyright,
        updatedAt: new Date().toISOString().split("T")[0]
      },
      settings,
      stations,
      trainTypes,
      rosters,
      notes: []
    };
  }

  // 初期化（プリセットまたは保存データからロード）
  load(initialData) {
    this.data = this.normalizeData(JSON.parse(JSON.stringify(initialData)));
    this.historyStack = [];
    this.redoStack = [];
    this.notifyChange("load");
  }

  // データ正規化（後方互換性・欠損プロパティの補完）
  normalizeData(raw) {
    if (!raw) raw = {};
    const specs = BoxDiagramDataModel.PAGE_SPECS;
    const rawSet = raw.settings || {};
    const normPageSize = specs[rawSet.pageSize] ? rawSet.pageSize : "A4";
    const normTimePageSize = specs[rawSet.timeAxisPageSize] ? rawSet.timeAxisPageSize : "AUTO";
    const normSeparatePage = typeof rawSet.separatePageSettingsByAxisMode === "boolean"
      ? rawSet.separatePageSettingsByAxisMode
      : true;
    const normCustomW = BoxDiagramDataModel.clampCustomMm(rawSet.customPageWidthMm, 420, 100, 1800);
    const normCustomH = BoxDiagramDataModel.clampCustomMm(rawSet.customPageHeightMm, 220, 80, 1200);
    const normTimeCustomW = BoxDiagramDataModel.clampCustomMm(rawSet.timeAxisCustomWidthMm, 560, 100, 1800);
    const normTimeCustomH = BoxDiagramDataModel.clampCustomMm(rawSet.timeAxisCustomHeightMm, 220, 80, 1200);
    const normStartHour = (typeof rawSet.timeAxisStartHour === "number" && !Number.isNaN(rawSet.timeAxisStartHour))
      ? Math.max(0, Math.min(12, Math.round(rawSet.timeAxisStartHour)))
      : 4;
    const normEndHour = (typeof rawSet.timeAxisEndHour === "number" && !Number.isNaN(rawSet.timeAxisEndHour))
      ? Math.max(normStartHour + 4, Math.min(28, Math.round(rawSet.timeAxisEndHour)))
      : 25;
    const normLateFmt = ["24plus", "zero", "yoku"].includes(rawSet.timeAxisLateNightFormat)
      ? rawSet.timeAxisLateNightFormat
      : "24plus";
    const defaultFonts = BoxDiagramDataModel.DEFAULT_ELEMENT_FONTS;
    const rawFonts = (rawSet.fonts && typeof rawSet.fonts === "object") ? rawSet.fonts : {};
    const normFonts = {
      header: BoxDiagramDataModel.normalizeFontId(rawFonts.header, defaultFonts.header),
      station: BoxDiagramDataModel.normalizeFontId(rawFonts.station, defaultFonts.station),
      roster: BoxDiagramDataModel.normalizeFontId(rawFonts.roster, defaultFonts.roster),
      trainNo: BoxDiagramDataModel.normalizeFontId(rawFonts.trainNo, defaultFonts.trainNo),
      time: BoxDiagramDataModel.normalizeFontId(rawFonts.time, defaultFonts.time)
    };

    const d = {
      version: raw.version || "2.0",
      metadata: Object.assign({
        title: "桜川電鉄 1日通しダイヤ（始発〜深夜・全機能サンプル）",
        copyright: "(C) 2026 せきたん",
        updatedAt: new Date().toISOString().split("T")[0]
      }, raw.metadata || {}),
      settings: Object.assign({
        pageSize: "A4",
        orientation: "portrait",
        pageBreakMode: "auto",
        baseRowHeight: 12.96,
        rosterStepRows: 2,
        partialConnectStepRows: 1,
        blockPaddingRows: 2,
        stationHeaderDirection: "vertical", // "vertical" | "horizontal"
        stationAxisDirection: "ltr", // "ltr" | "rtl"
        subHeaderMode: "omitFirst",
        selfHighlightStyle: "red",
        showLegend: false,
        symbolScale: 1.0,
        symbolFill: "preset",
        autoSyncCoupled: true,
        fonts: normFonts,
        xAxisMode: "station",
        separatePageSettingsByAxisMode: normSeparatePage,
        timeAxisPageSize: normTimePageSize,
        timeAxisOrientation: "landscape",
        customPageWidthMm: normCustomW,
        customPageHeightMm: normCustomH,
        timeAxisCustomWidthMm: normTimeCustomW,
        timeAxisCustomHeightMm: normTimeCustomH,
        timeAxisStartHour: normStartHour,
        timeAxisRangeMode: "auto",
        timeAxisEndHour: normEndHour,
        timeAxisGridMinutes: 30,
        timeAxisLateNightFormat: "24plus",
        timeAxisLabelDensity: "auto"
      }, rawSet, {
        pageSize: normPageSize,
        orientation: rawSet.orientation === "landscape" ? "landscape" : "portrait",
        stationAxisDirection: rawSet.stationAxisDirection === "rtl" ? "rtl" : "ltr",
        fonts: normFonts,
        xAxisMode: rawSet.xAxisMode === "time" ? "time" : "station",
        separatePageSettingsByAxisMode: normSeparatePage,
        timeAxisPageSize: normTimePageSize,
        timeAxisOrientation: rawSet.timeAxisOrientation === "portrait" ? "portrait" : "landscape",
        customPageWidthMm: normCustomW,
        customPageHeightMm: normCustomH,
        timeAxisCustomWidthMm: normTimeCustomW,
        timeAxisCustomHeightMm: normTimeCustomH,
        timeAxisStartHour: normStartHour,
        timeAxisRangeMode: rawSet.timeAxisRangeMode === "manual" ? "manual" : "auto",
        timeAxisEndHour: normEndHour,
        timeAxisGridMinutes: [10, 15, 30, 60].includes(rawSet.timeAxisGridMinutes) ? rawSet.timeAxisGridMinutes : 30,
        timeAxisLateNightFormat: normLateFmt,
        timeAxisLabelDensity: rawSet.timeAxisLabelDensity === "full" ? "full" : "auto",
        autoSyncCoupled: typeof rawSet.autoSyncCoupled === "boolean" ? rawSet.autoSyncCoupled : true,
        partialConnectStepRows: typeof rawSet.partialConnectStepRows === "number" && !Number.isNaN(rawSet.partialConnectStepRows)
          ? Math.max(0, rawSet.partialConnectStepRows)
          : 1
      }),
      stations: Array.isArray(raw.stations) && raw.stations.length > 0
        ? raw.stations.map((s, idx) => ({
            id: s.id || `st-${idx}`,
            name: s.name || "駅",
            abbr: s.abbr || (s.name ? s.name[0] : "駅"),
            visible: s.visible !== false,
            x: typeof s.x === "number" ? s.x : 200 + idx * 200
          }))
        : JSON.parse(JSON.stringify(FICTIONAL_ALL_STATIONS.filter(s => s.visible !== false))),
      trainTypes: Array.isArray(raw.trainTypes) && raw.trainTypes.length > 0
        ? raw.trainTypes.map(t => ({
            id: t.id || "local",
            name: t.name || "普通",
            lineColor: t.lineColor || "#000000",
            timeColor: t.timeColor || "#000000",
            textColor: t.textColor || "#000000",
            lineWidth: typeof t.lineWidth === "number" ? t.lineWidth : 1.28,
            lineStyle: t.lineStyle || "solid",
            font: t.font || "F1",
            prefix: t.prefix || ""
          }))
        : JSON.parse(JSON.stringify(DEFAULT_TRAIN_TYPES)),
      rosters: Array.isArray(raw.rosters) ? raw.rosters.map(r => {
        const rosterId = r.id || "A1";
        const rosterName = r.name || rosterId;
        const hasCustomName = typeof r.customName === "boolean"
          ? r.customName
          : Boolean(r.name && r.id && r.name !== r.id);
        return {
          id: rosterId,
          name: rosterName,
          customName: hasCustomName,
          pageBreakAfter: !!r.pageBreakAfter,
          trains: Array.isArray(r.trains) ? r.trains.map(tr => {
            const rawStep = typeof tr.stepRows === "number" && !Number.isNaN(tr.stepRows) ? Math.max(0, tr.stepRows) : 2;
            const formation = Array.isArray(tr.coupledFormation) && tr.coupledFormation.length > 0
              ? tr.coupledFormation.filter(Boolean)
              : null;
            return {
              trainNo: tr.trainNo || "",
              typeId: tr.typeId || "local",
              fromStation: tr.fromStation || "",
              depTime: tr.depTime || "",
              toStation: tr.toStation || "",
              arrTime: tr.arrTime || "",
              coupledPartner: tr.coupledPartner || "",
              coupledPosition: tr.coupledPosition === "before" ? "before" : "after",
              coupledFormation: formation,
              customCoupled: tr.customCoupled || "",
              coupleGroupId: tr.coupleGroupId || "",
              depSymbol: tr.depSymbol || "none",
              arrSymbol: tr.arrSymbol || "none",
              depTimePos: tr.depTimePos || "auto",
              arrTimePos: tr.arrTimePos || "auto",
              stepRows: rawStep
            };
          }) : []
        };
      }) : [],
      notes: Array.isArray(raw.notes) ? raw.notes.map((n, idx) => ({
        id: n.id || `note-${idx}`,
        page: n.page === "all" ? "all" : (typeof n.page === "number" ? n.page : (n.page ? (parseInt(n.page, 10) || 1) : 1)),
        axisMode: n.axisMode === "time" ? "time" : "station",
        text: n.text || "",
        x: typeof n.x === "number" ? n.x : 200,
        y: typeof n.y === "number" ? n.y : 300,
        color: n.color || "#FF0000",
        fontSize: typeof n.fontSize === "number" ? n.fontSize : 10.72,
        font: BoxDiagramDataModel.normalizeFontId(n.font, "F1")
      })) : []
    };

    return d;
  }

  // 変更リスナー登録
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }

  // 変更適用ヘルパー（変更直前のスナップショットを履歴に退避してから実行）
  mutate(actionType, fn, meta = {}) {
    if (!this.data) return;
    if (!this.isApplyingHistory && actionType !== "load" && actionType !== "history") {
      this.pushHistory(actionType);
    }
    fn();
    this.notifyChange(actionType, meta);
  }

  // 変更通知
  notifyChange(actionType = "update", meta = {}) {
    for (const listener of this.listeners) {
      try {
        listener(this.data, actionType, meta);
      } catch (err) {
        console.error("Listener error:", err);
      }
    }
  }

  // Undo / Redo
  pushHistory(description) {
    if (this.isApplyingHistory || !this.data) return;
    const snapshot = JSON.stringify(this.data);
    this.historyStack.push({ snapshot, description });
    if (this.historyStack.length > this.maxHistory) {
      this.historyStack.shift();
    }
    this.redoStack = []; // 新たな変更でRedoスタックをクリア
  }

  canUndo() {
    return this.historyStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    const current = JSON.stringify(this.data);
    const item = this.historyStack.pop();
    this.redoStack.push({ snapshot: current, description: "redo" });
    
    this.isApplyingHistory = true;
    this.data = JSON.parse(item.snapshot);
    this.isApplyingHistory = false;
    this.notifyChange("history");
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    const current = JSON.stringify(this.data);
    const item = this.redoStack.pop();
    this.historyStack.push({ snapshot: current, description: "undo" });
    
    this.isApplyingHistory = true;
    this.data = JSON.parse(item.snapshot);
    this.isApplyingHistory = false;
    this.notifyChange("history");
    return true;
  }

  // データ全体取得 / エクスポート
  getData() {
    return this.data;
  }

  toJSON(pretty = true) {
    return JSON.stringify(this.data, null, pretty ? 2 : 0);
  }

  // ==================== 基本設定 / メタデータ ====================
  getMetadata() {
    return this.data ? this.data.metadata : {};
  }

  updateMetadata(patch) {
    if (!this.data) return;
    let hasDiff = false;
    for (const key of Object.keys(patch)) {
      if (this.data.metadata[key] !== patch[key]) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) return;
    this.mutate("metadata-update", () => {
      Object.assign(this.data.metadata, patch);
    }, { patch });
  }

  getSettings() {
    return this.data ? this.data.settings : {};
  }

  updateSettings(patch) {
    if (!this.data || !patch) return;
    const normalizedPatch = Object.assign({}, patch);
    let hasDiff = false;
    for (const key of Object.keys(normalizedPatch)) {
      if (key === "fonts" && normalizedPatch.fonts && typeof normalizedPatch.fonts === "object") {
        const curFonts = Object.assign({}, BoxDiagramDataModel.DEFAULT_ELEMENT_FONTS, this.data.settings.fonts || {});
        const nextFonts = Object.assign({}, curFonts);
        let fontChanged = false;
        for (const fk of Object.keys(normalizedPatch.fonts)) {
          const val = BoxDiagramDataModel.normalizeFontId(normalizedPatch.fonts[fk], curFonts[fk] || "F1");
          if (nextFonts[fk] !== val) {
            nextFonts[fk] = val;
            fontChanged = true;
          }
        }
        if (fontChanged) {
          normalizedPatch.fonts = nextFonts;
          hasDiff = true;
        } else {
          delete normalizedPatch.fonts;
        }
      } else if (this.data.settings[key] !== normalizedPatch[key]) {
        hasDiff = true;
      }
    }
    if (!hasDiff) return;
    this.mutate("settings-update", () => {
      Object.assign(this.data.settings, normalizedPatch);
    }, { patch: normalizedPatch });
  }

  // ==================== 駅マスタ ====================
  getStations() {
    return this.data ? this.data.stations : [];
  }

  getVisibleStations() {
    return this.data ? this.data.stations.filter(s => s.visible !== false) : [];
  }

  setStationVisibility(stationId, visible) {
    this.mutate("stations-update", () => {
      const st = this.data.stations.find(s => s.id === stationId);
      if (st) {
        st.visible = !!visible;
        this.recalculateStationX();
      }
    }, { stationId, visible });
  }

  recalculateStationX() {
    const visible = this.getVisibleStations();
    if (visible.length < 2) return;
    
    // 3駅の標準位置: 下館 200.32, 真岡 593.92, 茂木 987.52 (総幅 787.20px)
    const leftX = 200.32;
    const rightX = 987.52;
    const span = rightX - leftX;
    
    // 特別扱い: もし表示駅が「下館」「真岡」「茂木」の3駅だけなら正確な実測値に合わせる
    if (visible.length === 3 && visible[0].name.includes("下館") && visible[1].name.includes("真岡") && visible[2].name.includes("茂木")) {
      visible[0].x = 200.32;
      visible[1].x = 593.92;
      visible[2].x = 987.52;
      return;
    }

    const step = span / (visible.length - 1);
    visible.forEach((st, idx) => {
      st.x = Math.round((leftX + idx * step) * 100) / 100;
    });
  }

  addStation(station) {
    this.mutate("stations-add", () => {
      this.data.stations.push(Object.assign({
        id: "st-" + Date.now(),
        name: "新駅",
        abbr: "新",
        visible: true,
        x: 500
      }, station));
      this.recalculateStationX();
    });
  }

  updateStation(stationId, patch) {
    this.mutate("stations-update", () => {
      const st = this.data.stations.find(s => s.id === stationId);
      if (st) {
        Object.assign(st, patch);
      }
    }, { stationId, patch });
  }

  deleteStation(stationId) {
    this.mutate("stations-del", () => {
      this.data.stations = this.data.stations.filter(s => s.id !== stationId);
      this.recalculateStationX();
    }, { stationId });
  }

  moveStation(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.data.stations.length || toIdx < 0 || toIdx >= this.data.stations.length) return;
    this.mutate("stations-move", () => {
      const item = this.data.stations.splice(fromIdx, 1)[0];
      this.data.stations.splice(toIdx, 0, item);
      this.recalculateStationX();
    });
  }

  resetMainStations() {
    this.mutate("stations-reset", () => {
      this.data.stations = JSON.parse(JSON.stringify(FICTIONAL_ALL_STATIONS.filter(s => s.visible !== false)));
      this.recalculateStationX();
    });
  }

  // ==================== 種別マスタ ====================
  getTrainTypes() {
    return this.data ? this.data.trainTypes : [];
  }

  getTrainType(typeId) {
    if (!this.data || !this.data.trainTypes) return null;
    return this.data.trainTypes.find(t => t.id === typeId) || this.data.trainTypes[0];
  }

  addTrainType(type) {
    const id = type.id || "type-" + Date.now();
    this.mutate("trainTypes-add", () => {
      this.data.trainTypes.push(Object.assign({
        id,
        name: "新規種別",
        lineColor: "#000000",
        timeColor: "#000000",
        textColor: "#000000",
        lineWidth: 1.28,
        lineStyle: "solid",
        font: "F1",
        prefix: ""
      }, type));
    });
  }

  updateTrainType(typeId, patch) {
    this.mutate("trainTypes-update", () => {
      const t = this.data.trainTypes.find(x => x.id === typeId);
      if (t) {
        Object.assign(t, patch);
      }
    }, { typeId, patch });
  }

  deleteTrainType(typeId, replacementTypeId = "local") {
    if (this.data.trainTypes.length <= 1) {
      alert("種別マスタは最低1つ必要です。");
      return false;
    }
    this.mutate("trainTypes-del", () => {
      for (const r of this.data.rosters) {
        for (const tr of r.trains) {
          if (tr.typeId === typeId) {
            tr.typeId = replacementTypeId;
          }
        }
      }
      this.data.trainTypes = this.data.trainTypes.filter(x => x.id !== typeId);
    }, { typeId });
    return true;
  }

  // ==================== 運用マスタ ====================
  getRosters() {
    return this.data ? this.data.rosters : [];
  }

  getRoster(rosterId) {
    if (!this.data || !this.data.rosters) return null;
    return this.data.rosters.find(r => r.id === rosterId);
  }

  addRoster(roster = {}) {
    let id = roster.id ? String(roster.id).trim() : "";
    if (!id) {
      let n = this.data.rosters.length + 1;
      id = `A${n}`;
      while (this.getRoster(id)) {
        n++;
        id = `A${n}`;
      }
    }
    const name = roster.name || id;
    const customName = typeof roster.customName === "boolean" ? roster.customName : Boolean(roster.name && roster.name !== id);
    this.mutate("rosters-add", () => {
      this.data.rosters.push(Object.assign({
        id,
        name,
        customName,
        pageBreakAfter: false,
        trains: []
      }, roster, { id, name, customName }));
    });
    return id;
  }

  duplicateRoster(rosterId) {
    const original = this.getRoster(rosterId);
    if (!original) return null;
    let newId = `${original.id}_copy`;
    let suffix = 2;
    while (this.getRoster(newId)) {
      newId = `${original.id}_copy${suffix}`;
      suffix++;
    }
    this.mutate("rosters-dup", () => {
      const cloned = JSON.parse(JSON.stringify(original));
      cloned.id = newId;
      cloned.name = newId;
      cloned.customName = false;
      if (Array.isArray(cloned.trains)) {
        cloned.trains.forEach(tr => {
          tr.coupleGroupId = "";
        });
      }
      this.data.rosters.push(cloned);
    });
    return newId;
  }

  updateRoster(rosterId, patch = {}) {
    const r = this.getRoster(rosterId);
    if (!r) return { ok: false, error: "運用が見つかりません" };

    const oldId = r.id;
    let nextId = oldId;
    if ("id" in patch) {
      nextId = String(patch.id || "").trim();
      if (!nextId) {
        return { ok: false, error: "運用番号は空にできません" };
      }
      if (nextId !== oldId && this.getRoster(nextId)) {
        return { ok: false, error: `運用番号「${nextId}」は既に存在します` };
      }
    }

    const willRenameId = "id" in patch && nextId !== oldId;
    const willChangeName = "name" in patch && patch.name !== r.name;
    const willResetName = !!patch.resetName && (r.customName || r.name !== oldId);
    const willChangeBreak = "pageBreakAfter" in patch && !!patch.pageBreakAfter !== !!r.pageBreakAfter;
    if (!willRenameId && !willChangeName && !willResetName && !willChangeBreak) {
      return { ok: true, noChange: true, oldId, newId: oldId, roster: r };
    }

    this.mutate("rosters-update", () => {
      if (willRenameId) {
        r.id = nextId;
        // 他運用の併結相手・編成順IDもカスケード更新
        for (const roster of this.data.rosters) {
          for (const tr of roster.trains || []) {
            if (tr.coupledPartner === oldId) {
              tr.coupledPartner = nextId;
            }
            if (Array.isArray(tr.coupledFormation)) {
              tr.coupledFormation = tr.coupledFormation.map(id => (id === oldId ? nextId : id));
            }
          }
        }
        if (!r.customName && !("name" in patch)) {
          r.name = nextId;
        }
      }

      if (patch.resetName) {
        r.name = r.id;
        r.customName = false;
      } else if ("name" in patch) {
        const nextName = String(patch.name || "");
        if (nextName.trim() === "" || nextName === r.id) {
          r.name = r.id;
          r.customName = false;
        } else {
          r.name = nextName;
          r.customName = true;
        }
      }

      if ("pageBreakAfter" in patch) {
        r.pageBreakAfter = !!patch.pageBreakAfter;
      }
    }, { rosterId: r.id, oldId, newId: r.id, patch });

    return { ok: true, oldId, newId: r.id, roster: r };
  }

  deleteRoster(rosterId) {
    this.mutate("rosters-del", () => {
      this.data.rosters = this.data.rosters.filter(r => r.id !== rosterId);
    }, { rosterId });
  }

  moveRoster(fromIdx, toIdx) {
    if (fromIdx < 0 || fromIdx >= this.data.rosters.length || toIdx < 0 || toIdx >= this.data.rosters.length) return;
    this.mutate("rosters-move", () => {
      const item = this.data.rosters.splice(fromIdx, 1)[0];
      this.data.rosters.splice(toIdx, 0, item);
    });
  }

  // ==================== 列車表 (Trains for Roster) ====================
  getTrains(rosterId) {
    const r = this.getRoster(rosterId);
    return r ? r.trains : [];
  }

  _parseTimeMinutes(timeStr) {
    if (!timeStr) return null;
    const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  /**
   * 営業開始時刻（起点分）を基準として時間軸座標用の通し分を計算（例: 起点4:00のとき 0:15 → 1455分）
   */
  _parseTimeAxisMinutes(timeStr, dayStartMinutes = 240) {
    const m = this._parseTimeMinutes(timeStr);
    if (m === null) return null;
    return m < dayStartMinutes ? m + 1440 : m;
  }

  getFormationOrder(rosterId, train) {
    if (!train) return rosterId ? [rosterId] : [];
    if (Array.isArray(train.coupledFormation) && train.coupledFormation.length >= 2) {
      const unique = [...new Set(train.coupledFormation.filter(Boolean))];
      if (rosterId && !unique.includes(rosterId)) {
        unique.unshift(rosterId);
      }
      return unique;
    }
    if (train.coupledPartner && train.coupledPartner !== rosterId) {
      return train.coupledPosition === "before"
        ? [train.coupledPartner, rosterId]
        : [rosterId, train.coupledPartner];
    }
    return rosterId ? [rosterId] : [];
  }

  getCoupledPartners(rosterId, train) {
    return this.getFormationOrder(rosterId, train).filter(id => id && id !== rosterId);
  }

  _applyFormationToTrain(targetRosterId, train, formation, groupId = null) {
    const unique = [...new Set((formation || []).filter(Boolean))];
    if (unique.length <= 1) {
      train.coupledPartner = "";
      train.coupledPosition = "after";
      train.coupledFormation = null;
      train.coupleGroupId = "";
      return;
    }
    if (unique.length === 2) {
      const [first, second] = unique;
      train.coupledPartner = (targetRosterId === first) ? second : first;
      train.coupledPosition = (targetRosterId === first) ? "after" : "before";
      train.coupledFormation = null;
      if (groupId !== null) train.coupleGroupId = groupId;
      return;
    }
    const others = unique.filter(id => id !== targetRosterId);
    train.coupledFormation = unique.slice();
    train.coupledPartner = others[0] || "";
    train.coupledPosition = unique.indexOf(targetRosterId) === 0 ? "after" : "before";
    if (groupId !== null) train.coupleGroupId = groupId;
  }

  _findPairedTrain(sourceRosterId, partnerRosterId, criteria = {}, excludeTrains = null) {
    const partnerRoster = this.getRoster(partnerRosterId);
    if (!partnerRoster) return null;
    const trains = (partnerRoster.trains || []).filter(t => !excludeTrains || !excludeTrains.has(t));
    if (trains.length === 0) return null;

    // 1. ペアリングID完全一致
    if (criteria.coupleGroupId) {
      const byGroup = trains.find(t => t.coupleGroupId && t.coupleGroupId === criteria.coupleGroupId);
      if (byGroup) return byGroup;
    }

    // 2. 相手列車側が既に自運用と併結指定されている候補から探索
    const coupledBack = trains.filter(t => this.getCoupledPartners(partnerRosterId, t).includes(sourceRosterId));
    if (coupledBack.length > 0) {
      if (criteria.trainNo && criteria.fromStation && criteria.toStation) {
        const exact = coupledBack.find(t =>
          t.trainNo === criteria.trainNo &&
          t.fromStation === criteria.fromStation &&
          t.toStation === criteria.toStation
        );
        if (exact) return exact;
      }
      if (criteria.fromStation && criteria.toStation) {
        const sameSection = coupledBack.filter(t =>
          t.fromStation === criteria.fromStation &&
          t.toStation === criteria.toStation
        );
        if (sameSection.length === 1) return sameSection[0];
        if (sameSection.length > 1) {
          const srcMin = this._parseTimeMinutes(criteria.depTime);
          if (srcMin !== null) {
            return sameSection.slice().sort((a, b) => {
              const am = this._parseTimeMinutes(a.depTime);
              const bm = this._parseTimeMinutes(b.depTime);
              const ad = am === null ? 9999 : Math.abs(am - srcMin);
              const bd = bm === null ? 9999 : Math.abs(bm - srcMin);
              return ad - bd;
            })[0];
          }
          return sameSection[0];
        }
      }
      if (criteria.trainNo) {
        const byNo = coupledBack.find(t => t.trainNo === criteria.trainNo);
        if (byNo) return byNo;
      }
    }

    // 3. 初回連結・一括同期時のみ: 列車番号＋発着駅一致の未連結（または自運用指定）列車を探索
    if (criteria.allowUnpairedStationMatch && criteria.trainNo && criteria.fromStation && criteria.toStation) {
      const bySection = trains.find(t =>
        t.trainNo === criteria.trainNo &&
        t.fromStation === criteria.fromStation &&
        t.toStation === criteria.toStation &&
        (!t.coupledPartner || t.coupledPartner === sourceRosterId)
      );
      if (bySection) return bySection;
    }

    return null;
  }

  addTrain(rosterId, train = {}, insertAt = null) {
    const r = this.getRoster(rosterId);
    if (!r) return;
    const lastIdx = (typeof insertAt === "number" && insertAt > 0) ? Math.min(insertAt - 1, r.trains.length - 1) : r.trains.length - 1;
    const lastTrain = lastIdx >= 0 ? r.trains[lastIdx] : null;
    
    const visible = this.getVisibleStations();
    const firstSt = (visible[0] && visible[0].id) || (this.data.stations[0] ? this.data.stations[0].id : "sakuragawa");
    const lastSt = (visible[visible.length - 1] && visible[visible.length - 1].id) || (this.data.stations[this.data.stations.length - 1] ? this.data.stations[this.data.stations.length - 1].id : "aoyamaonsen");

    const defaultFrom = lastTrain ? lastTrain.toStation : firstSt;
    const defaultTo = lastTrain
      ? (lastTrain.toStation === firstSt ? lastSt : firstSt)
      : lastSt;
    
    let defaultDepTime = "";
    if (lastTrain && lastTrain.arrTime) {
      const m = lastTrain.arrTime.match(/^(\d{1,2}):(\d{2})$/);
      if (m) {
        let mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + 10;
        const h = Math.floor(mins / 60) % 24;
        const mm = String(mins % 60).padStart(2, "0");
        defaultDepTime = `${h}:${mm}`;
      }
    }

    const newTrain = Object.assign({
      trainNo: "",
      typeId: "local",
      fromStation: defaultFrom,
      depTime: defaultDepTime,
      toStation: defaultTo,
      arrTime: "",
      coupledPartner: "",
      coupledPosition: "after",
      coupledFormation: null,
      customCoupled: "",
      coupleGroupId: "",
      depSymbol: "none",
      arrSymbol: "none",
      depTimePos: "auto",
      arrTimePos: "auto",
      stepRows: typeof train.stepRows === "number" ? Math.max(0, train.stepRows) : 2
    }, train);

    this.mutate("trains-add", () => {
      if (typeof insertAt === "number" && insertAt >= 0 && insertAt <= r.trains.length) {
        r.trains.splice(insertAt, 0, newTrain);
      } else {
        r.trains.push(newTrain);
      }
    }, { rosterId, trainIndex: typeof insertAt === "number" ? insertAt : r.trains.length - 1 });
  }

  addConnectingTrain(rosterId, afterIndex = null) {
    const r = this.getRoster(rosterId);
    if (!r || !Array.isArray(r.trains) || r.trains.length === 0) {
      this.addTrain(rosterId);
      return 0;
    }

    const idx = (typeof afterIndex === "number" && afterIndex >= 0 && afterIndex < r.trains.length)
      ? afterIndex
      : (r.trains.length - 1);
    const prevTrain = r.trains[idx];

    const vis = this.getVisibleStations().slice().sort((a, b) => a.x - b.x);
    const fromIdx = vis.findIndex(s => s.id === prevTrain.fromStation);
    const toIdx = vis.findIndex(s => s.id === prevTrain.toStation);
    const isMidStation = (toIdx > 0 && toIdx < vis.length - 1 && fromIdx !== -1 && fromIdx !== toIdx);

    const partialStep = typeof this.data.settings.partialConnectStepRows === "number"
      ? Math.max(0, this.data.settings.partialConnectStepRows)
      : 1;
    const standardStep = typeof this.data.settings.rosterStepRows === "number"
      ? Math.max(0, this.data.settings.rosterStepRows)
      : 2;

    if (isMidStation) {
      // 途中駅からの同一方向部分継走列車
      const nextToId = toIdx > fromIdx ? vis[vis.length - 1].id : vis[0].id;
      this.addTrain(rosterId, {
        trainNo: prevTrain.trainNo || "",
        typeId: prevTrain.typeId || "local",
        fromStation: prevTrain.toStation,
        depTime: "",
        toStation: nextToId,
        arrTime: "",
        stepRows: partialStep
      }, idx + 1);
    } else {
      // 終端駅からの折り返し接続列車
      let nextToId = prevTrain.fromStation || (vis[0] ? vis[0].id : "shimodate");
      if (vis.length >= 2) {
        if (toIdx === 0) nextToId = vis[vis.length - 1].id;
        else if (toIdx === vis.length - 1) nextToId = vis[0].id;
      }
      this.addTrain(rosterId, {
        fromStation: prevTrain.toStation || (vis[0] ? vis[0].id : "shimodate"),
        toStation: nextToId,
        stepRows: standardStep
      }, idx + 1);
    }
    return idx + 1;
  }

  splitTrainAtStation(rosterId, trainIndex, viaStationId) {
    const r = this.getRoster(rosterId);
    if (!r || !r.trains[trainIndex]) return false;
    const orig = r.trains[trainIndex];
    if (!viaStationId || viaStationId === orig.fromStation || viaStationId === orig.toStation) {
      return false;
    }

    const partialStep = typeof this.data.settings.partialConnectStepRows === "number"
      ? Math.max(0, this.data.settings.partialConnectStepRows)
      : 1;

    const part1 = Object.assign(JSON.parse(JSON.stringify(orig)), {
      toStation: viaStationId,
      arrTime: "",
      arrSymbol: "none",
      arrTimePos: "auto"
    });
    const part2 = Object.assign(JSON.parse(JSON.stringify(orig)), {
      fromStation: viaStationId,
      depTime: "",
      depSymbol: "none",
      depTimePos: "auto",
      stepRows: partialStep,
      coupledPartner: "",
      coupledPosition: "after",
      coupledFormation: null,
      customCoupled: "",
      coupleGroupId: ""
    });

    this.mutate("trains-add", () => {
      r.trains.splice(trainIndex, 1, part1, part2);
    }, { rosterId, trainIndex, splitAt: viaStationId });

    return true;
  }

  updateTrain(rosterId, trainIndex, patch = {}) {
    const r = this.getRoster(rosterId);
    if (!r || !r.trains[trainIndex]) return;
    const current = r.trains[trainIndex];

    const sanitizedPatch = Object.assign({}, patch);
    if ("coupledPartner" in sanitizedPatch && sanitizedPatch.coupledPartner === rosterId) {
      sanitizedPatch.coupledPartner = "";
    }
    if ("coupledPosition" in sanitizedPatch) {
      sanitizedPatch.coupledPosition = sanitizedPatch.coupledPosition === "before" ? "before" : "after";
    }
    if ("stepRows" in sanitizedPatch) {
      const parsed = Number(sanitizedPatch.stepRows);
      sanitizedPatch.stepRows = Number.isNaN(parsed) ? 2 : Math.max(0, parsed);
    }
    if (("coupledPartner" in sanitizedPatch || "coupledPosition" in sanitizedPatch || "coupledFormation" in sanitizedPatch)
        && !("customCoupled" in sanitizedPatch) && current.customCoupled) {
      sanitizedPatch.customCoupled = "";
    }

    let hasDiff = false;
    for (const key of Object.keys(sanitizedPatch)) {
      if (key === "coupledFormation") {
        if (JSON.stringify(current.coupledFormation || null) !== JSON.stringify(sanitizedPatch.coupledFormation || null)) {
          hasDiff = true;
          break;
        }
      } else if (current[key] !== sanitizedPatch[key]) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) return;

    const SYNC_TIMETABLE_FIELDS = ["trainNo", "typeId", "fromStation", "depTime", "toStation", "arrTime"];
    const SYNC_COUPLING_FIELDS = ["coupledPartner", "coupledPosition", "coupledFormation"];
    const touchedTimetable = SYNC_TIMETABLE_FIELDS.some(k => k in sanitizedPatch);
    const touchedCoupling = SYNC_COUPLING_FIELDS.some(k => k in sanitizedPatch);

    let syncedRosters = [];

    this.mutate("trains-update", () => {
      const prevCriteria = {
        trainNo: current.trainNo,
        fromStation: current.fromStation,
        toStation: current.toStation,
        depTime: current.depTime,
        arrTime: current.arrTime,
        coupleGroupId: current.coupleGroupId
      };
      const prevPartners = this.getCoupledPartners(rosterId, current);

      // 自列車の構造更新
      if ("coupledFormation" in sanitizedPatch) {
        const arr = Array.isArray(sanitizedPatch.coupledFormation)
          ? [...new Set(sanitizedPatch.coupledFormation.filter(Boolean))]
          : [];
        if (arr.length >= 2) {
          this._applyFormationToTrain(rosterId, current, arr);
        } else {
          this._applyFormationToTrain(rosterId, current, [rosterId]);
        }
        delete sanitizedPatch.coupledFormation;
        delete sanitizedPatch.coupledPartner;
        delete sanitizedPatch.coupledPosition;
      } else if ("coupledPartner" in sanitizedPatch) {
        if (!sanitizedPatch.coupledPartner) {
          sanitizedPatch.coupledFormation = null;
          sanitizedPatch.coupleGroupId = "";
        } else {
          // 2両構成へ切り替わった場合は3両以上配列を解除
          sanitizedPatch.coupledFormation = null;
        }
      }

      Object.assign(current, sanitizedPatch);

      // リアルタイム併結相手同期
      if (this.data.settings.autoSyncCoupled !== false && (touchedTimetable || touchedCoupling)) {
        const nextFormation = this.getFormationOrder(rosterId, current);
        const nextPartners = nextFormation.filter(id => id && id !== rosterId);

        // 併結相手が外された場合: 旧パートナー側の併結情報も外す（列車行自体は残す）
        if (touchedCoupling) {
          for (const removedId of prevPartners) {
            if (!nextPartners.includes(removedId)) {
              const pTr = this._findPairedTrain(rosterId, removedId, prevCriteria);
              if (pTr) {
                const pFormation = this.getFormationOrder(removedId, pTr).filter(id => id !== rosterId);
                this._applyFormationToTrain(removedId, pTr, pFormation);
                pTr.customCoupled = "";
                syncedRosters.push(removedId);
              }
            }
          }
        }

        if (nextPartners.length > 0) {
          let groupId = current.coupleGroupId;
          for (const partnerId of nextPartners) {
            const pTr = this._findPairedTrain(rosterId, partnerId, {
              trainNo: prevCriteria.trainNo || current.trainNo,
              fromStation: prevCriteria.fromStation || current.fromStation,
              toStation: prevCriteria.toStation || current.toStation,
              depTime: prevCriteria.depTime || current.depTime,
              coupleGroupId: groupId,
              allowUnpairedStationMatch: touchedCoupling
            });

            if (!pTr) continue;
            if (!groupId) {
              groupId = pTr.coupleGroupId || ("cg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
              current.coupleGroupId = groupId;
            }
            pTr.coupleGroupId = groupId;

            if (touchedTimetable) {
              for (const field of SYNC_TIMETABLE_FIELDS) {
                if (field in sanitizedPatch) {
                  pTr[field] = current[field];
                }
              }
            }

            if (touchedCoupling) {
              this._applyFormationToTrain(partnerId, pTr, nextFormation, groupId);
              pTr.customCoupled = "";
              // 初回連結時、自列車の非空着発情報を相手側にも反映（空なら上書きしない）
              for (const field of SYNC_TIMETABLE_FIELDS) {
                if (current[field]) {
                  pTr[field] = current[field];
                }
              }
            }
            syncedRosters.push(partnerId);
          }
        }
      }
    }, { rosterId, trainIndex, patch: sanitizedPatch, syncedRosters });
  }

  syncRosterCoupledTrains(rosterId) {
    const srcRoster = this.getRoster(rosterId);
    if (!srcRoster) return { updatedCount: 0, createdCount: 0 };

    const SYNC_FIELDS = ["trainNo", "typeId", "fromStation", "depTime", "toStation", "arrTime"];
    let updatedCount = 0;
    let createdCount = 0;
    const matchedPartnerTrains = new Set();

    this.mutate("trains-sync", () => {
      for (const sTr of srcRoster.trains || []) {
        const formation = this.getFormationOrder(rosterId, sTr);
        const partners = formation.filter(id => id && id !== rosterId);
        if (partners.length === 0 || !sTr.fromStation || !sTr.toStation) continue;

        const groupId = sTr.coupleGroupId || ("cg_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
        sTr.coupleGroupId = groupId;
        this._applyFormationToTrain(rosterId, sTr, formation, groupId);

        for (const partnerId of partners) {
          const partnerRoster = this.getRoster(partnerId);
          if (!partnerRoster) continue;

          let pTr = this._findPairedTrain(rosterId, partnerId, {
            trainNo: sTr.trainNo,
            fromStation: sTr.fromStation,
            toStation: sTr.toStation,
            depTime: sTr.depTime,
            coupleGroupId: groupId,
            allowUnpairedStationMatch: true
          }, matchedPartnerTrains);

          if (pTr) {
            matchedPartnerTrains.add(pTr);
            for (const f of SYNC_FIELDS) {
              pTr[f] = sTr[f];
            }
            this._applyFormationToTrain(partnerId, pTr, formation, groupId);
            pTr.customCoupled = "";
            updatedCount++;
          } else {
            pTr = {
              trainNo: sTr.trainNo || "",
              typeId: sTr.typeId || "local",
              fromStation: sTr.fromStation || "",
              depTime: sTr.depTime || "",
              toStation: sTr.toStation || "",
              arrTime: sTr.arrTime || "",
              coupledPartner: "",
              coupledPosition: "after",
              coupledFormation: null,
              customCoupled: "",
              coupleGroupId: groupId,
              depSymbol: "none",
              arrSymbol: "none",
              depTimePos: "auto",
              arrTimePos: "auto",
              stepRows: typeof this.data.settings.rosterStepRows === "number" ? this.data.settings.rosterStepRows : 2
            };
            this._applyFormationToTrain(partnerId, pTr, formation, groupId);
            matchedPartnerTrains.add(pTr);

            // 発時刻順に適切な位置へ挿入
            const srcMin = this._parseTimeMinutes(sTr.depTime) ?? this._parseTimeMinutes(sTr.arrTime);
            let insertPos = partnerRoster.trains.length;
            if (srcMin !== null) {
              const idxAfter = partnerRoster.trains.findIndex(existing => {
                const m = this._parseTimeMinutes(existing.depTime) ?? this._parseTimeMinutes(existing.arrTime);
                return m !== null && m > srcMin;
              });
              if (idxAfter !== -1) insertPos = idxAfter;
            }
            partnerRoster.trains.splice(insertPos, 0, pTr);
            createdCount++;
          }
        }
      }
    }, { rosterId, updatedCount, createdCount });

    return { updatedCount, createdCount };
  }

  duplicateTrain(rosterId, trainIndex) {
    this.mutate("trains-dup", () => {
      const r = this.getRoster(rosterId);
      if (r && r.trains[trainIndex]) {
        const cloned = JSON.parse(JSON.stringify(r.trains[trainIndex]));
        cloned.coupleGroupId = "";
        r.trains.splice(trainIndex + 1, 0, cloned);
      }
    }, { rosterId, trainIndex });
  }

  deleteTrain(rosterId, trainIndex) {
    this.mutate("trains-del", () => {
      const r = this.getRoster(rosterId);
      if (r && r.trains[trainIndex]) {
        r.trains.splice(trainIndex, 1);
      }
    }, { rosterId, trainIndex });
  }

  moveTrain(rosterId, fromIdx, toIdx) {
    this.mutate("trains-move", () => {
      const r = this.getRoster(rosterId);
      if (r && fromIdx >= 0 && fromIdx < r.trains.length && toIdx >= 0 && toIdx < r.trains.length) {
        const item = r.trains.splice(fromIdx, 1)[0];
        r.trains.splice(toIdx, 0, item);
      }
    }, { rosterId, fromIdx, toIdx });
  }

  // ==================== 注記マスタ ====================
  getNotes() {
    return this.data ? this.data.notes : [];
  }

  addNote(note = {}) {
    let noteId = "note-" + Date.now();
    this.mutate("notes-add", () => {
      const pageVal = (note.page === "all" || Number.isFinite(note.page)) ? note.page : 1;
      const defaultAxisMode = (this.data && this.data.settings && this.data.settings.xAxisMode === "time") ? "time" : "station";
      const axisMode = note.axisMode === "time" ? "time" : (note.axisMode === "station" ? "station" : defaultAxisMode);
      const xVal = Number.isFinite(note.x) ? Math.round(note.x * 100) / 100 : 202.40;
      const yVal = Number.isFinite(note.y) ? Math.round(note.y * 100) / 100 : 340.48;
      const newNote = Object.assign({
        id: noteId,
        page: pageVal,
        axisMode,
        text: "注記テキスト",
        x: xVal,
        y: yVal,
        color: "#FF0000",
        fontSize: 10.72,
        font: "F1"
      }, note, { page: pageVal, axisMode, x: xVal, y: yVal });
      this.data.notes.push(newNote);
    });
    return noteId;
  }

  updateNote(noteId, patch) {
    this.mutate("notes-update", () => {
      const n = this.data.notes.find(x => x.id === noteId);
      if (n) {
        const sanitized = Object.assign({}, patch);
        if ("x" in sanitized) {
          sanitized.x = Number.isFinite(sanitized.x) ? Math.round(sanitized.x * 100) / 100 : n.x;
        }
        if ("y" in sanitized) {
          sanitized.y = Number.isFinite(sanitized.y) ? Math.round(sanitized.y * 100) / 100 : n.y;
        }
        if ("fontSize" in sanitized) {
          sanitized.fontSize = Number.isFinite(sanitized.fontSize) ? sanitized.fontSize : n.fontSize;
        }
        Object.assign(n, sanitized);
      }
    }, { noteId, patch });
  }

  deleteNote(noteId) {
    this.mutate("notes-del", () => {
      this.data.notes = this.data.notes.filter(x => x.id !== noteId);
    }, { noteId });
  }

  // ==================== 入力検証ロジック ====================
  validateTime(timeStr) {
    if (!timeStr || timeStr.trim() === "") return { valid: true };
    const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return { valid: false, message: "時刻は H:MM または HH:MM 形式で入力してください（例: 6:31, 25:15）" };
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h < 0 || h > 27 || mm < 0 || mm >= 60) {
      return { valid: false, message: "有効な時間範囲（0:00〜27:59）で入力してください" };
    }
    return { valid: true };
  }

  validateTrain(train, prevTrain = null) {
    const warnings = [];
    const errors = [];

    // 時刻形式
    const depVal = this.validateTime(train.depTime);
    if (!depVal.valid) errors.push(`発時刻: ${depVal.message}`);
    const arrVal = this.validateTime(train.arrTime);
    if (!arrVal.valid) errors.push(`着時刻: ${arrVal.message}`);

    // 発着駅
    if (train.fromStation === train.toStation && train.fromStation !== "") {
      warnings.push("出発駅と到着駅が同じ駅に設定されています");
    }

    // 前列車との連続性
    if (prevTrain && prevTrain.toStation && train.fromStation) {
      if (prevTrain.toStation !== train.fromStation) {
        warnings.push(`前列車の到着駅 (${this.getStationName(prevTrain.toStation)}) と今回の出発駅 (${this.getStationName(train.fromStation)}) が一致していません`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  getStationName(stationId) {
    const st = this.data.stations.find(s => s.id === stationId);
    return st ? st.name : stationId;
  }

  // スキーマ全体検証（インポート時用）
  validateSchema(jsonObj) {
    const errors = [];
    if (!jsonObj || typeof jsonObj !== "object") {
      return { valid: false, errors: ["JSONオブジェクトではありません"] };
    }
    if (!Array.isArray(jsonObj.stations)) {
      errors.push("stations 配列が存在しません");
    }
    if (!Array.isArray(jsonObj.rosters)) {
      errors.push("rosters 配列が存在しません");
    }
    return { valid: errors.length === 0, errors };
  }
}

// グローバルインスタンス
window.BoxDiagramDataModel = BoxDiagramDataModel;
