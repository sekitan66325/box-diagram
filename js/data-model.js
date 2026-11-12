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
    const d = {
      version: raw.version || "2.0",
      metadata: Object.assign({
        title: "真岡鐵道 モオカ14形",
        copyright: "(C) 2026 せきたん",
        updatedAt: new Date().toISOString().split("T")[0]
      }, raw.metadata || {}),
      settings: Object.assign({
        pageSize: "A4",
        orientation: "portrait",
        pageBreakMode: "auto",
        baseRowHeight: 12.96,
        rosterStepRows: 2,
        blockPaddingRows: 2,
        stationHeaderDirection: "vertical", // "vertical" | "horizontal"
        subHeaderMode: "omitFirst",
        selfHighlightStyle: "red",
        showLegend: false,
        symbolScale: 1.0,
        symbolFill: "preset"
      }, raw.settings || {}),
      stations: Array.isArray(raw.stations) && raw.stations.length > 0
        ? raw.stations.map((s, idx) => ({
            id: s.id || `st-${idx}`,
            name: s.name || "駅",
            abbr: s.abbr || (s.name ? s.name[0] : "駅"),
            visible: s.visible !== false,
            x: typeof s.x === "number" ? s.x : 200 + idx * 200
          }))
        : JSON.parse(JSON.stringify(MOKA_ALL_STATIONS.slice(0, 3))),
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
      rosters: Array.isArray(raw.rosters) ? raw.rosters.map(r => ({
        id: r.id || "A1",
        name: r.name || r.id || "A1",
        pageBreakAfter: !!r.pageBreakAfter,
        trains: Array.isArray(r.trains) ? r.trains.map(tr => ({
          trainNo: tr.trainNo || "",
          typeId: tr.typeId || "local",
          fromStation: tr.fromStation || "",
          depTime: tr.depTime || "",
          toStation: tr.toStation || "",
          arrTime: tr.arrTime || "",
          coupledPartner: tr.coupledPartner || "",
          customCoupled: tr.customCoupled || "",
          depSymbol: tr.depSymbol || "none",
          arrSymbol: tr.arrSymbol || "none",
          depTimePos: tr.depTimePos || "auto",
          arrTimePos: tr.arrTimePos || "auto",
          stepRows: typeof tr.stepRows === "number" ? tr.stepRows : 2
        })) : []
      })) : [],
      notes: Array.isArray(raw.notes) ? raw.notes.map((n, idx) => ({
        id: n.id || `note-${idx}`,
        page: typeof n.page === "number" ? n.page : (n.page ? parseInt(n.page, 10) : 1),
        text: n.text || "",
        x: typeof n.x === "number" ? n.x : 200,
        y: typeof n.y === "number" ? n.y : 300,
        color: n.color || "#FF0000",
        fontSize: typeof n.fontSize === "number" ? n.fontSize : 10.72,
        font: n.font || "F1"
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
    if (!this.data) return;
    let hasDiff = false;
    for (const key of Object.keys(patch)) {
      if (this.data.settings[key] !== patch[key]) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) return;
    this.mutate("settings-update", () => {
      Object.assign(this.data.settings, patch);
    }, { patch });
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
      this.data.stations = JSON.parse(JSON.stringify(MOKA_ALL_STATIONS.slice(0, 3)));
      this.data.stations[0].x = 200.32;
      this.data.stations[1].x = 593.92;
      this.data.stations[2].x = 987.52;
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

  addRoster(roster) {
    let id = roster.id || `A${this.data.rosters.length + 1}`;
    this.mutate("rosters-add", () => {
      this.data.rosters.push(Object.assign({
        id,
        name: id,
        pageBreakAfter: false,
        trains: []
      }, roster));
    });
    return id;
  }

  duplicateRoster(rosterId) {
    const original = this.getRoster(rosterId);
    if (!original) return null;
    let newId = `${original.id}_copy`;
    this.mutate("rosters-dup", () => {
      const cloned = JSON.parse(JSON.stringify(original));
      cloned.id = newId;
      cloned.name = `${original.name} (複製)`;
      this.data.rosters.push(cloned);
    });
    return newId;
  }

  updateRoster(rosterId, patch) {
    this.mutate("rosters-update", () => {
      const r = this.getRoster(rosterId);
      if (r) {
        Object.assign(r, patch);
      }
    }, { rosterId, patch });
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

  addTrain(rosterId, train = {}) {
    const r = this.getRoster(rosterId);
    if (!r) return;
    const lastTrain = r.trains[r.trains.length - 1];
    
    const defaultFrom = lastTrain ? lastTrain.toStation : (this.data.stations[0] ? this.data.stations[0].id : "shimodate");
    const defaultTo = lastTrain
      ? (lastTrain.toStation === "shimodate" ? "motegi" : (lastTrain.toStation === "motegi" ? "moka" : "shimodate"))
      : (this.data.stations[this.data.stations.length - 1] ? this.data.stations[this.data.stations.length - 1].id : "motegi");
    
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
      customCoupled: "",
      depSymbol: "none",
      arrSymbol: "none",
      depTimePos: "auto",
      arrTimePos: "auto",
      stepRows: 2
    }, train);

    this.mutate("trains-add", () => {
      r.trains.push(newTrain);
    }, { rosterId });
  }

  updateTrain(rosterId, trainIndex, patch) {
    const r = this.getRoster(rosterId);
    if (!r || !r.trains[trainIndex]) return;
    const current = r.trains[trainIndex];
    let hasDiff = false;
    for (const key of Object.keys(patch)) {
      if (current[key] !== patch[key]) {
        hasDiff = true;
        break;
      }
    }
    if (!hasDiff) return; // 差分がなければ不要な履歴追加を行わない

    this.mutate("trains-update", () => {
      Object.assign(current, patch);
    }, { rosterId, trainIndex, patch });
  }

  duplicateTrain(rosterId, trainIndex) {
    this.mutate("trains-dup", () => {
      const r = this.getRoster(rosterId);
      if (r && r.trains[trainIndex]) {
        const cloned = JSON.parse(JSON.stringify(r.trains[trainIndex]));
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
      const xVal = Number.isFinite(note.x) ? Math.round(note.x * 100) / 100 : 202.40;
      const yVal = Number.isFinite(note.y) ? Math.round(note.y * 100) / 100 : 340.48;
      const newNote = Object.assign({
        id: noteId,
        page: pageVal,
        text: "注記テキスト",
        x: xVal,
        y: yVal,
        color: "#FF0000",
        fontSize: 10.72,
        font: "F1"
      }, note, { page: pageVal, x: xVal, y: yVal });
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
    if (!m) return { valid: false, message: "時刻は H:MM または HH:MM 形式で入力してください（例: 6:31）" };
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h < 0 || h > 24 || mm < 0 || mm >= 60) {
      return { valid: false, message: "有効な時間範囲（0:00〜24:00）で入力してください" };
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
