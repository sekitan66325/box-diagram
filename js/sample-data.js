/**
 * 鉄道車両運用表（箱ダイヤ）サンプルプリセットデータ
 *
 * 一般公開（β版）向け 架空路線ショウケースデータ
 * 折り返し・途中駅部分継走（1行/0行）・選択式連結位置・3両編成・自動同期・
 * 多彩な列車種別/線種・発着記号4種・自由注記・用紙/駅ヘッダー設定まで全機能を体感できます。
 */

// 架空路線「桜川電鉄 本線」全10駅マスタ（初期表示は主要4駅: 桜川・美咲町・楓ヶ丘・青山温泉）
const FICTIONAL_ALL_STATIONS = [
  { id: "sakuragawa", name: "桜川", abbr: "桜", visible: true, x: 200.32 },
  { id: "shinsakura", name: "新桜川", abbr: "新", visible: false, x: 287.79 },
  { id: "akanedai", name: "あかね台", abbr: "茜", visible: false, x: 375.25 },
  { id: "misakicho", name: "美咲町", abbr: "美", visible: true, x: 462.72 },
  { id: "kaedegaoka", name: "楓ヶ丘", abbr: "楓", visible: true, x: 725.12 },
  { id: "midorigamori", name: "緑ヶ森", abbr: "緑", visible: false, x: 790.72 },
  { id: "keikokuguchi", name: "渓谷口", abbr: "渓", visible: false, x: 856.32 },
  { id: "onsenmae", name: "温泉前", abbr: "温", visible: false, x: 921.92 },
  { id: "aoyamaonsen", name: "青山温泉", abbr: "青", visible: true, x: 987.52 },
  { id: "tembokoen", name: "展望公園", abbr: "展", visible: false, x: 1050.00 }
];

// 標準列車種別マスタ定義
const DEFAULT_TRAIN_TYPES = [
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
  },
  {
    id: "rapid",
    name: "快速",
    lineColor: "#0055AA",
    timeColor: "#0055AA",
    textColor: "#0055AA",
    lineWidth: 1.28,
    lineStyle: "solid",
    font: "F1",
    prefix: ""
  },
  {
    id: "express",
    name: "観光急行",
    lineColor: "#B91C1C",
    timeColor: "#B91C1C",
    textColor: "#B91C1C",
    lineWidth: 1.92,
    lineStyle: "solid",
    font: "F1",
    prefix: ""
  },
  {
    id: "deadhead",
    name: "回送",
    lineColor: "#E3702E",
    timeColor: "#3023F3",
    textColor: "#3023F3",
    lineWidth: 1.28,
    lineStyle: "solid",
    font: "F3",
    prefix: "回"
  },
  {
    id: "trial",
    name: "試運転",
    lineColor: "#047857",
    timeColor: "#047857",
    textColor: "#047857",
    lineWidth: 1.28,
    lineStyle: "dashed",
    font: "F1",
    prefix: ""
  }
];

// プリセット1（デフォルト）: 桜川電鉄 1日通しダイヤ（始発〜深夜27:15・全機能体験フルサンプル）
const PRESET_SAKURAGAWA_MAIN = {
  version: "2.0",
  metadata: {
    title: "桜川電鉄 1日通しダイヤ（5:40〜27:15・全機能サンプル）",
    copyright: "(C) 2026 せきたん",
    updatedAt: "2026-11-15"
  },
  settings: {
    pageSize: "A4",
    orientation: "portrait",
    pageBreakMode: "manual",
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
    separatePageSettingsByAxisMode: true,
    timeAxisPageSize: "AUTO",
    timeAxisStartHour: 4,
    timeAxisRangeMode: "auto",
    timeAxisLateNightFormat: "24plus"
  },
  stations: [
    { id: "sakuragawa", name: "桜川", abbr: "桜", visible: true, x: 200.32 },
    { id: "misakicho", name: "美咲町", abbr: "美", visible: true, x: 462.72 },
    { id: "kaedegaoka", name: "楓ヶ丘", abbr: "楓", visible: true, x: 725.12 },
    { id: "aoyamaonsen", name: "青山温泉", abbr: "青", visible: true, x: 987.52 }
  ],
  trainTypes: JSON.parse(JSON.stringify(DEFAULT_TRAIN_TYPES)),
  rosters: [
    {
      id: "A1",
      name: "A1",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "101", typeId: "deadhead", fromStation: "kaedegaoka", depTime: "5:40", toStation: "sakuragawa", arrTime: "5:58", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "102", typeId: "local", fromStation: "sakuragawa", depTime: "6:08", toStation: "aoyamaonsen", arrTime: "6:52", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "201", typeId: "rapid", fromStation: "aoyamaonsen", depTime: "7:05", toStation: "sakuragawa", arrTime: "7:42", coupledPartner: "A2", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_201", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "104", typeId: "local", fromStation: "sakuragawa", depTime: "7:55", toStation: "kaedegaoka", arrTime: "8:26", coupledPartner: "A2", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_104", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "104", typeId: "local", fromStation: "kaedegaoka", depTime: "8:30", toStation: "aoyamaonsen", arrTime: "8:55", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 1 },
        { trainNo: "301", typeId: "express", fromStation: "aoyamaonsen", depTime: "9:15", toStation: "sakuragawa", arrTime: "9:48", coupledPartner: "A2", coupledPosition: "after", coupledFormation: ["A1", "A2", "B1"], customCoupled: "", coupleGroupId: "cg_demo_301", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "198", typeId: "deadhead", fromStation: "sakuragawa", depTime: "10:02", toStation: "kaedegaoka", arrTime: "10:20", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "A2",
      name: "A2",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "100", typeId: "local", fromStation: "misakicho", depTime: "6:15", toStation: "aoyamaonsen", arrTime: "6:52", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle_filled", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "201", typeId: "rapid", fromStation: "aoyamaonsen", depTime: "7:05", toStation: "sakuragawa", arrTime: "7:42", coupledPartner: "A1", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_201", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "104", typeId: "local", fromStation: "sakuragawa", depTime: "7:55", toStation: "kaedegaoka", arrTime: "8:26", coupledPartner: "A1", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_104", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "106", typeId: "local", fromStation: "kaedegaoka", depTime: "8:35", toStation: "aoyamaonsen", arrTime: "9:02", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "301", typeId: "express", fromStation: "aoyamaonsen", depTime: "9:15", toStation: "sakuragawa", arrTime: "9:48", coupledPartner: "A1", coupledPosition: "before", coupledFormation: ["A1", "A2", "B1"], customCoupled: "", coupleGroupId: "cg_demo_301", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "110", typeId: "local", fromStation: "sakuragawa", depTime: "10:05", toStation: "misakicho", arrTime: "10:24", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "A3",
      name: "A3",
      customName: false,
      pageBreakAfter: true,
      trains: [
        { trainNo: "121", typeId: "local", fromStation: "kaedegaoka", depTime: "6:20", toStation: "sakuragawa", arrTime: "6:50", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "122", typeId: "local", fromStation: "sakuragawa", depTime: "7:02", toStation: "kaedegaoka", arrTime: "7:30", coupledPartner: "変A3", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_122", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "122", typeId: "local", fromStation: "kaedegaoka", depTime: "7:34", toStation: "aoyamaonsen", arrTime: "8:01", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 0 },
        { trainNo: "125", typeId: "local", fromStation: "aoyamaonsen", depTime: "8:20", toStation: "sakuragawa", arrTime: "9:05", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "210", typeId: "rapid", fromStation: "sakuragawa", depTime: "11:00", toStation: "aoyamaonsen", arrTime: "11:36", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "変A3",
      name: "変A3",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "122", typeId: "local", fromStation: "sakuragawa", depTime: "7:02", toStation: "kaedegaoka", arrTime: "7:30", coupledPartner: "A3", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_122", depSymbol: "circle_filled", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "133", typeId: "local", fromStation: "kaedegaoka", depTime: "14:15", toStation: "sakuragawa", arrTime: "14:43", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "134", typeId: "local", fromStation: "sakuragawa", depTime: "15:00", toStation: "kaedegaoka", arrTime: "15:28", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "B1",
      name: "観光B1",
      customName: true,
      pageBreakAfter: false,
      trains: [
        { trainNo: "300", typeId: "deadhead", fromStation: "kaedegaoka", depTime: "8:40", toStation: "aoyamaonsen", arrTime: "9:06", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "301", typeId: "express", fromStation: "aoyamaonsen", depTime: "9:15", toStation: "sakuragawa", arrTime: "9:48", coupledPartner: "A1", coupledPosition: "before", coupledFormation: ["A1", "A2", "B1"], customCoupled: "", coupleGroupId: "cg_demo_301", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "302", typeId: "express", fromStation: "sakuragawa", depTime: "13:00", toStation: "aoyamaonsen", arrTime: "13:34", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "EL1",
      name: "EL1",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "8101", typeId: "deadhead", fromStation: "kaedegaoka", depTime: "9:20", toStation: "sakuragawa", arrTime: "9:52", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8100", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8002", typeId: "express", fromStation: "sakuragawa", depTime: "10:30", toStation: "aoyamaonsen", arrTime: "11:48", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8001", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8001", typeId: "express", fromStation: "aoyamaonsen", depTime: "14:25", toStation: "sakuragawa", arrTime: "15:45", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8002", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8102", typeId: "deadhead", fromStation: "sakuragawa", depTime: "16:02", toStation: "kaedegaoka", arrTime: "16:31", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8103", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "PC1",
      name: "50系",
      customName: true,
      pageBreakAfter: false,
      trains: [
        { trainNo: "8101", typeId: "deadhead", fromStation: "kaedegaoka", depTime: "9:20", toStation: "sakuragawa", arrTime: "9:52", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8100", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8002", typeId: "express", fromStation: "sakuragawa", depTime: "10:30", toStation: "aoyamaonsen", arrTime: "11:48", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8001", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8001", typeId: "express", fromStation: "aoyamaonsen", depTime: "14:25", toStation: "sakuragawa", arrTime: "15:45", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8002", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8102", typeId: "deadhead", fromStation: "sakuragawa", depTime: "16:02", toStation: "kaedegaoka", arrTime: "16:31", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8103", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "EL2",
      name: "EL2",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "8002", typeId: "express", fromStation: "sakuragawa", depTime: "10:30", toStation: "aoyamaonsen", arrTime: "11:48", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8001", depSymbol: "circle_filled", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8001", typeId: "express", fromStation: "aoyamaonsen", depTime: "14:25", toStation: "sakuragawa", arrTime: "15:45", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8002", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "C1",
      name: "C1",
      customName: false,
      pageBreakAfter: true,
      trains: [
        { trainNo: "901", typeId: "trial", fromStation: "kaedegaoka", depTime: "10:15", toStation: "sakuragawa", arrTime: "10:52", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "902", typeId: "trial", fromStation: "sakuragawa", depTime: "11:10", toStation: "aoyamaonsen", arrTime: "11:55", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "903", typeId: "trial", fromStation: "aoyamaonsen", depTime: "12:10", toStation: "kaedegaoka", arrTime: "12:42", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "A4",
      name: "A4",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "140", typeId: "local", fromStation: "sakuragawa", depTime: "16:10", toStation: "aoyamaonsen", arrTime: "16:56", coupledPartner: "A5", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_140", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "215", typeId: "rapid", fromStation: "aoyamaonsen", depTime: "17:12", toStation: "sakuragawa", arrTime: "17:48", coupledPartner: "A5", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_215", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "144", typeId: "local", fromStation: "sakuragawa", depTime: "18:05", toStation: "aoyamaonsen", arrTime: "18:50", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "147", typeId: "local", fromStation: "aoyamaonsen", depTime: "19:08", toStation: "sakuragawa", arrTime: "19:54", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "A5",
      name: "A5",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "140", typeId: "local", fromStation: "sakuragawa", depTime: "16:10", toStation: "aoyamaonsen", arrTime: "16:56", coupledPartner: "A4", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_140", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "215", typeId: "rapid", fromStation: "aoyamaonsen", depTime: "17:12", toStation: "sakuragawa", arrTime: "17:48", coupledPartner: "A4", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_215", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "N1",
      name: "N1",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "502", typeId: "rapid", fromStation: "sakuragawa", depTime: "20:05", toStation: "aoyamaonsen", arrTime: "20:42", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "505", typeId: "rapid", fromStation: "aoyamaonsen", depTime: "21:00", toStation: "sakuragawa", arrTime: "21:38", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "520", typeId: "local", fromStation: "sakuragawa", depTime: "24:05", toStation: "aoyamaonsen", arrTime: "24:50", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "523", typeId: "local", fromStation: "aoyamaonsen", depTime: "25:02", toStation: "sakuragawa", arrTime: "25:42", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "N2",
      name: "N2",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "510", typeId: "local", fromStation: "sakuragawa", depTime: "21:10", toStation: "aoyamaonsen", arrTime: "21:54", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "511", typeId: "local", fromStation: "aoyamaonsen", depTime: "22:08", toStation: "sakuragawa", arrTime: "22:52", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "512", typeId: "local", fromStation: "sakuragawa", depTime: "23:10", toStation: "kaedegaoka", arrTime: "23:38", coupledPartner: "N3", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_night_512", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "514", typeId: "local", fromStation: "kaedegaoka", depTime: "23:45", toStation: "aoyamaonsen", arrTime: "24:12", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "597", typeId: "deadhead", fromStation: "aoyamaonsen", depTime: "24:22", toStation: "kaedegaoka", arrTime: "24:48", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "N3",
      name: "N3",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "512", typeId: "local", fromStation: "sakuragawa", depTime: "23:10", toStation: "kaedegaoka", arrTime: "23:38", coupledPartner: "N2", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_night_512", depSymbol: "circle_filled", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "515", typeId: "local", fromStation: "kaedegaoka", depTime: "23:50", toStation: "sakuragawa", arrTime: "0:18", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "516", typeId: "local", fromStation: "sakuragawa", depTime: "0:30", toStation: "misakicho", arrTime: "0:48", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "N4",
      name: "N4",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "530", typeId: "express", fromStation: "sakuragawa", depTime: "22:30", toStation: "aoyamaonsen", arrTime: "23:06", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "531", typeId: "local", fromStation: "aoyamaonsen", depTime: "23:25", toStation: "kaedegaoka", arrTime: "23:54", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "533", typeId: "deadhead", fromStation: "kaedegaoka", depTime: "1:10", toStation: "sakuragawa", arrTime: "1:36", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "598", typeId: "trial", fromStation: "sakuragawa", depTime: "26:50", toStation: "kaedegaoka", arrTime: "27:15", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    }
  ],
  notes: [
    {
      id: "note-p1-1",
      page: 1,
      axisMode: "station",
      text: "※ 土休日は桜川〜楓ヶ丘2両 ／ 104(1行段差)・122(同段0行)",
      x: 752.0,
      y: 266.72,
      color: "#FF0000",
      fontSize: 9.5,
      font: "F1"
    },
    {
      id: "note-p2-1",
      page: 2,
      axisMode: "station",
      text: "※ EL2は観光急行(8001・8002)のみ補機連結 ／ 試901〜903は水曜日のみ運転",
      x: 202.40,
      y: 860.00,
      color: "#B91C1C",
      fontSize: 10.72,
      font: "F1"
    },
    {
      id: "note-p3-1",
      page: 3,
      axisMode: "station",
      text: "※ N1(505△→520○)・N4(531△→533○→598○)は入庫〜出庫のため垂直接続線なし",
      x: 202.40,
      y: 938.00,
      color: "#1E293B",
      fontSize: 10.72,
      font: "F1"
    },
    {
      id: "note-night-tm-1",
      page: 1,
      axisMode: "time",
      text: "※ 日界=4:00 設定により 5:40〜27:15（0:18〜1:36含む）を1日通しで連続表示。時刻軸は「変形 (自動フィット)」で横長・縦余白なしに自動調整されます。",
      x: 140.00,
      y: 1062.00,
      color: "#047857",
      fontSize: 10.72,
      font: "F1"
    }
  ]
};

// プリセット2: 緑川鉄道 シャトル運用（B5横・駅名横書きレイアウトサンプル）
const PRESET_MIDORIKAWA_COMPACT = {
  version: "2.0",
  metadata: {
    title: "緑川鉄道 シャトル運用 (B5横サンプル)",
    copyright: "(C) 2026 せきたん",
    updatedAt: "2026-11-14"
  },
  settings: {
    pageSize: "B5",
    orientation: "landscape",
    pageBreakMode: "auto",
    baseRowHeight: 12.96,
    rosterStepRows: 2,
    partialConnectStepRows: 1,
    blockPaddingRows: 2,
    stationHeaderDirection: "horizontal",
    subHeaderMode: "all",
    selfHighlightStyle: "red-bold",
    showLegend: false,
    symbolScale: 1.0,
    symbolFill: "preset",
    autoSyncCoupled: true
  },
  stations: [
    { id: "midori_kita", name: "北緑川", abbr: "北", visible: true, x: 200.32 },
    { id: "midori_chuo", name: "緑川公園", abbr: "公", visible: true, x: 593.92 },
    { id: "midori_minami", name: "南緑川", abbr: "南", visible: true, x: 987.52 }
  ],
  trainTypes: JSON.parse(JSON.stringify(DEFAULT_TRAIN_TYPES)),
  rosters: [
    {
      id: "M1",
      name: "M1",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "501", typeId: "local", fromStation: "midori_kita", depTime: "6:00", toStation: "midori_minami", arrTime: "6:18", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "502", typeId: "local", fromStation: "midori_minami", depTime: "6:25", toStation: "midori_kita", arrTime: "6:43", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "503", typeId: "rapid", fromStation: "midori_kita", depTime: "7:00", toStation: "midori_minami", arrTime: "7:14", coupledPartner: "M2", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_m_503", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "M2",
      name: "M2",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "503", typeId: "rapid", fromStation: "midori_kita", depTime: "7:00", toStation: "midori_minami", arrTime: "7:14", coupledPartner: "M1", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_m_503", depSymbol: "circle_filled", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    }
  ],
  notes: []
};
