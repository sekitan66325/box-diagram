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

// プリセット1（デフォルト）: 桜川電鉄 サクラ2000形 全機能体験サンプル（2ページ構成）
const PRESET_SAKURAGAWA_MAIN = {
  version: "2.0",
  metadata: {
    title: "桜川電鉄 サクラ2000形 (全機能サンプル)",
    copyright: "(C) 2026 せきたん",
    updatedAt: "2026-11-14"
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
    autoSyncCoupled: true
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
        { trainNo: "199", typeId: "deadhead", fromStation: "sakuragawa", depTime: "10:02", toStation: "kaedegaoka", arrTime: "10:20", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
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
        { trainNo: "105", typeId: "local", fromStation: "kaedegaoka", depTime: "8:35", toStation: "aoyamaonsen", arrTime: "9:02", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "301", typeId: "express", fromStation: "aoyamaonsen", depTime: "9:15", toStation: "sakuragawa", arrTime: "9:48", coupledPartner: "A1", coupledPosition: "before", coupledFormation: ["A1", "A2", "B1"], customCoupled: "", coupleGroupId: "cg_demo_301", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "110", typeId: "local", fromStation: "sakuragawa", depTime: "10:05", toStation: "misakicho", arrTime: "10:24", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "A3",
      name: "A3",
      customName: false,
      pageBreakAfter: false,
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
      pageBreakAfter: true,
      trains: [
        { trainNo: "122", typeId: "local", fromStation: "sakuragawa", depTime: "7:02", toStation: "kaedegaoka", arrTime: "7:30", coupledPartner: "A3", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_demo_122", depSymbol: "circle_filled", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "134", typeId: "local", fromStation: "kaedegaoka", depTime: "14:15", toStation: "sakuragawa", arrTime: "14:43", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "135", typeId: "local", fromStation: "sakuragawa", depTime: "15:00", toStation: "kaedegaoka", arrTime: "15:28", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
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
        { trainNo: "144", typeId: "local", fromStation: "sakuragawa", depTime: "18:05", toStation: "kaedegaoka", arrTime: "18:35", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
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
      id: "C1",
      name: "C1",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "901", typeId: "trial", fromStation: "kaedegaoka", depTime: "10:15", toStation: "sakuragawa", arrTime: "10:52", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "902", typeId: "trial", fromStation: "sakuragawa", depTime: "11:10", toStation: "aoyamaonsen", arrTime: "11:55", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "903", typeId: "trial", fromStation: "aoyamaonsen", depTime: "12:10", toStation: "kaedegaoka", arrTime: "12:42", coupledPartner: "", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    }
  ],
  notes: [
    {
      id: "note-p1-1",
      page: 1,
      text: "※ 土休日は桜川〜楓ヶ丘間2両運転",
      x: 758.0,
      y: 266.72,
      color: "#FF0000",
      fontSize: 10.72,
      font: "F1"
    },
    {
      id: "note-p2-1",
      page: 2,
      text: "※ 試901〜903は毎週水曜日のみ運転",
      x: 202.40,
      y: 448.16,
      color: "#047857",
      fontSize: 10.72,
      font: "F1"
    }
  ]
};

// プリセット2: 桜川電鉄 観光急行「あおば」・EL補機連結ダイヤ（機関車＋客車＋後押し運用）
const PRESET_SAKURAGAWA_EXPRESS = {
  version: "2.0",
  metadata: {
    title: "桜川電鉄 観光急行・EL補機連結ダイヤ",
    copyright: "(C) 2026 せきたん",
    updatedAt: "2026-11-14"
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
    selfHighlightStyle: "red-bold",
    showLegend: false,
    symbolScale: 1.0,
    symbolFill: "preset",
    autoSyncCoupled: true
  },
  stations: [
    { id: "sakuragawa", name: "桜川", abbr: "桜", visible: true, x: 200.32 },
    { id: "kaedegaoka", name: "楓ヶ丘", abbr: "楓", visible: true, x: 593.92 },
    { id: "aoyamaonsen", name: "青山温泉", abbr: "青", visible: true, x: 987.52 }
  ],
  trainTypes: JSON.parse(JSON.stringify(DEFAULT_TRAIN_TYPES)),
  rosters: [
    {
      id: "EL1",
      name: "EL1",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "8100", typeId: "deadhead", fromStation: "kaedegaoka", depTime: "9:20", toStation: "sakuragawa", arrTime: "9:52", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8100", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8001", typeId: "express", fromStation: "sakuragawa", depTime: "10:30", toStation: "aoyamaonsen", arrTime: "11:48", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8001", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8002", typeId: "express", fromStation: "aoyamaonsen", depTime: "14:25", toStation: "sakuragawa", arrTime: "15:45", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8002", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8103", typeId: "deadhead", fromStation: "sakuragawa", depTime: "16:02", toStation: "kaedegaoka", arrTime: "16:31", coupledPartner: "PC1", coupledPosition: "after", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8103", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "PC1",
      name: "50系",
      customName: true,
      pageBreakAfter: false,
      trains: [
        { trainNo: "8100", typeId: "deadhead", fromStation: "kaedegaoka", depTime: "9:20", toStation: "sakuragawa", arrTime: "9:52", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8100", depSymbol: "circle", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8001", typeId: "express", fromStation: "sakuragawa", depTime: "10:30", toStation: "aoyamaonsen", arrTime: "11:48", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8001", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8002", typeId: "express", fromStation: "aoyamaonsen", depTime: "14:25", toStation: "sakuragawa", arrTime: "15:45", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8002", depSymbol: "none", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8103", typeId: "deadhead", fromStation: "sakuragawa", depTime: "16:02", toStation: "kaedegaoka", arrTime: "16:31", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: null, customCoupled: "", coupleGroupId: "cg_el_8103", depSymbol: "none", arrSymbol: "triangle", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    },
    {
      id: "EL2",
      name: "EL2",
      customName: false,
      pageBreakAfter: false,
      trains: [
        { trainNo: "8001", typeId: "express", fromStation: "sakuragawa", depTime: "10:30", toStation: "aoyamaonsen", arrTime: "11:48", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8001", depSymbol: "circle_filled", arrSymbol: "none", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 },
        { trainNo: "8002", typeId: "express", fromStation: "aoyamaonsen", depTime: "14:25", toStation: "sakuragawa", arrTime: "15:45", coupledPartner: "EL1", coupledPosition: "before", coupledFormation: ["EL1", "PC1", "EL2"], customCoupled: "", coupleGroupId: "cg_el_8002", depSymbol: "none", arrSymbol: "triangle_filled", depTimePos: "auto", arrTimePos: "auto", stepRows: 2 }
      ]
    }
  ],
  notes: [
    {
      id: "note-el-1",
      page: 1,
      text: "※ EL2は観光急行のみ補機連結",
      x: 634.0,
      y: 344.48,
      color: "#B91C1C",
      fontSize: 10.72,
      font: "F1"
    }
  ]
};

// プリセット3: 緑川鉄道 シャトル運用（B5横・駅名横書きレイアウトサンプル）
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
