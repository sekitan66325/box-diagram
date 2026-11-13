/**
 * 箱ダイヤ描画ソフト - 表形式GUIエディタ (TableEditor)
 * 
 * - 基本設定 / 駅マスタ / 運用一覧 / 列車表 / 種別マスタ / 注記 / 生JSON
 * - スプレッドシートライクな操作性 (Tab/Enter, 複製, 削除, 並べ替え)
 * - リアルタイム入力検証 (時刻形式, 接続整合性)
 * - カラーパレット & カラーコード入力両対応
 * - 図面プレビューとの双方向連動
 * - 横スクロール完全撤廃の超高密度・高視認性グリッド
 * - 入力中・カラーピッカー操作時のフォーカス喪失＆ポップアップ早期クローズ完全防止
 */

class BoxDiagramTableEditor {
  constructor(containerEl, dataModel) {
    this.container = containerEl;
    this.model = dataModel;

    this.activeTab = "tab-trains"; // デフォルトは最も頻繁に触る「列車表」
    this.activeRosterId = null;
    this.isInternalInput = false;
    this.floatingPopover = null;
    this._docPopoverCloseHandler = null;
    this.lastSyncMessage = "";

    // リスナー登録
    this.model.subscribe((data, actionType, meta) => {
      if (actionType === "rosters-update" && meta && meta.oldId && meta.newId && meta.oldId !== meta.newId) {
        if (this.activeRosterId === meta.oldId) {
          this.activeRosterId = meta.newId;
        }
      }

      // 自身がトリガーした値更新中は再描画しない（フォーカス・ポップアップ維持）
      if (this.isInternalInput) {
        return;
      }

      // 構造的アクションの場合は全体再描画
      const structuralActions = [
        "load", "history",
        "stations-add", "stations-del", "stations-move", "stations-reset",
        "trainTypes-add", "trainTypes-del",
        "rosters-add", "rosters-del", "rosters-move", "rosters-dup", "rosters-update",
        "trains-add", "trains-del", "trains-move", "trains-dup", "trains-sync",
        "notes-add", "notes-del"
      ];

      if (structuralActions.includes(actionType)) {
        this.render();
        return;
      }

      // 値のみの更新の場合
      if (actionType === "trains-update") {
        this.handleTrainValueUpdate(meta);
      } else if (actionType === "notes-update") {
        this.handleNoteValueUpdate(meta);
      } else if (actionType === "settings-update" || actionType === "metadata-update") {
        if (!this.container.contains(document.activeElement)) {
          this.render();
        }
      }
    });

    // 初期アクティブ運用
    const rosters = this.model.getRosters();
    if (rosters.length > 0) {
      this.activeRosterId = rosters[0].id;
    }

    // 初回レンダリング
    if (this.model.getData()) {
      this.render();
    }
  }

  closeFloatingPopover() {
    if (this.floatingPopover && this.floatingPopover.parentNode) {
      this.floatingPopover.parentNode.removeChild(this.floatingPopover);
    }
    this.floatingPopover = null;
    if (this._docPopoverCloseHandler) {
      document.removeEventListener("mousedown", this._docPopoverCloseHandler);
      this._docPopoverCloseHandler = null;
    }
  }

  positionFloatingPopover(pop, anchorEl) {
    const rect = anchorEl.getBoundingClientRect();
    document.body.appendChild(pop);
    const popRect = pop.getBoundingClientRect();
    const top = (rect.bottom + 4 + popRect.height <= window.innerHeight)
      ? rect.bottom + 4
      : Math.max(8, rect.top - popRect.height - 4);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - popRect.width - 12));
    pop.style.top = `${Math.round(top)}px`;
    pop.style.left = `${Math.round(left)}px`;

    setTimeout(() => {
      this._docPopoverCloseHandler = (ev) => {
        if (this.floatingPopover && !this.floatingPopover.contains(ev.target) && !anchorEl.contains(ev.target)) {
          this.closeFloatingPopover();
        }
      };
      document.addEventListener("mousedown", this._docPopoverCloseHandler);
    }, 0);
  }

  openFormationPopover(anchorEl, trainIndex) {
    this.closeFloatingPopover();
    const roster = this.model.getRoster(this.activeRosterId);
    if (!roster || !roster.trains[trainIndex]) return;
    const train = roster.trains[trainIndex];
    const allRosters = this.model.getRosters();

    let draftFormation = this.model.getFormationOrder(roster.id, train).slice();
    if (draftFormation.length === 0) draftFormation = [roster.id];

    const pop = document.createElement("div");
    pop.id = "editorFloatingPopover";
    pop.className = "editor-floating-popover";
    this.floatingPopover = pop;

    const renderPopoverBody = () => {
      const availableToAdd = allRosters.filter(r => !draftFormation.includes(r.id));
      const previewStr = draftFormation.length >= 2
        ? `${train.trainNo || ""}(${draftFormation.join("＋")})`
        : `${train.trainNo || ""}（単行 / 併結なし）`;

      pop.innerHTML = `
        <div class="editor-popover-header">
          <span>編成・連結順序の設定</span>
          <button type="button" class="btn-icon-xs" data-pop-act="close">✕</button>
        </div>
        <div class="formation-preview-chip">${this.escapeXml(previewStr)}</div>
        <div class="formation-slot-list">
          ${draftFormation.map((id, i) => `
            <div class="formation-slot-item ${id === roster.id ? 'is-self' : ''}">
              <span class="font-mono" style="color:var(--text-muted);width:16px;">${i + 1}.</span>
              <span class="formation-slot-label">${this.escapeXml(id)}${id === roster.id ? ' (自運用)' : ''}</span>
              <button type="button" class="btn-icon-xs" data-pop-act="move-up" data-idx="${i}" ${i === 0 ? 'disabled' : ''} title="前へ">↑</button>
              <button type="button" class="btn-icon-xs" data-pop-act="move-down" data-idx="${i}" ${i === draftFormation.length - 1 ? 'disabled' : ''} title="後へ">↓</button>
              ${id !== roster.id ? `<button type="button" class="btn-icon-xs text-danger" data-pop-act="remove" data-idx="${i}" title="この運用を外す">✕</button>` : ''}
            </div>
          `).join("")}
        </div>
        <div class="formation-add-row">
          <select class="cell-select" id="popAddPartnerSelect" style="flex:1;">
            <option value="">＋ 連結する運用を追加...</option>
            ${availableToAdd.map(r => `<option value="${this.escapeXml(r.id)}">${this.escapeXml(r.id)}${r.name && r.name !== r.id ? ` (${this.escapeXml(r.name)})` : ''}</option>`).join("")}
          </select>
          <button type="button" class="btn btn-xs btn-secondary" data-pop-act="add-partner">追加</button>
        </div>
        <div class="editor-popover-footer">
          <button type="button" class="btn btn-xs btn-secondary text-danger" data-pop-act="clear-all">単行に戻す</button>
          <button type="button" class="btn btn-xs btn-primary" data-pop-act="apply">適用</button>
        </div>
      `;
    };

    pop.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.popAct;
      const idx = parseInt(btn.dataset.idx, 10);

      if (act === "close") {
        this.closeFloatingPopover();
      } else if (act === "move-up" && idx > 0) {
        const tmp = draftFormation[idx - 1];
        draftFormation[idx - 1] = draftFormation[idx];
        draftFormation[idx] = tmp;
        renderPopoverBody();
      } else if (act === "move-down" && idx < draftFormation.length - 1) {
        const tmp = draftFormation[idx + 1];
        draftFormation[idx + 1] = draftFormation[idx];
        draftFormation[idx] = tmp;
        renderPopoverBody();
      } else if (act === "remove" && !Number.isNaN(idx)) {
        draftFormation.splice(idx, 1);
        renderPopoverBody();
      } else if (act === "add-partner") {
        const sel = pop.querySelector("#popAddPartnerSelect");
        if (sel && sel.value && !draftFormation.includes(sel.value)) {
          draftFormation.push(sel.value);
          renderPopoverBody();
        }
      } else if (act === "clear-all") {
        this.model.updateTrain(this.activeRosterId, trainIndex, {
          coupledFormation: [],
          coupledPartner: "",
          coupledPosition: "after",
          customCoupled: ""
        });
        this.closeFloatingPopover();
        this.render();
      } else if (act === "apply") {
        const sel = pop.querySelector("#popAddPartnerSelect");
        if (sel && sel.value && !draftFormation.includes(sel.value)) {
          draftFormation.push(sel.value);
        }
        this.model.updateTrain(this.activeRosterId, trainIndex, {
          coupledFormation: draftFormation.length >= 2 ? draftFormation : [],
          customCoupled: ""
        });
        this.closeFloatingPopover();
        this.render();
      }
    });

    renderPopoverBody();
    this.positionFloatingPopover(pop, anchorEl);
  }

  openSplitPopover(anchorEl, trainIndex) {
    this.closeFloatingPopover();
    const roster = this.model.getRoster(this.activeRosterId);
    if (!roster || !roster.trains[trainIndex]) return;
    const train = roster.trains[trainIndex];

    const vis = this.model.getVisibleStations().slice().sort((a, b) => a.x - b.x);
    const fromIdx = vis.findIndex(s => s.id === train.fromStation);
    const toIdx = vis.findIndex(s => s.id === train.toStation);

    let candidates = [];
    if (fromIdx !== -1 && toIdx !== -1 && Math.abs(toIdx - fromIdx) > 1) {
      const lo = Math.min(fromIdx, toIdx);
      const hi = Math.max(fromIdx, toIdx);
      candidates = vis.slice(lo + 1, hi);
      if (fromIdx > toIdx) candidates.reverse();
    } else {
      candidates = vis.filter(s => s.id !== train.fromStation && s.id !== train.toStation);
    }

    const pop = document.createElement("div");
    pop.id = "editorFloatingPopover";
    pop.className = "editor-floating-popover";
    this.floatingPopover = pop;

    pop.innerHTML = `
      <div class="editor-popover-header">
        <span>✂ 途中駅で継走分割</span>
        <button type="button" class="btn-icon-xs" data-split-close="1">✕</button>
      </div>
      ${candidates.length === 0 ? `
        <div style="font-size:11px;color:var(--text-muted);line-height:1.5;">
          分割できる中間駅がありません。<br />（「駅マスタ」で途中駅を表示チェックしてください）
        </div>
      ` : `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px;">
          分割する駅を選択すると、前後の2区間（継走列車）に分割します：
        </div>
        <div class="split-station-list">
          ${candidates.map(s => `
            <button type="button" class="btn btn-xs btn-secondary" style="justify-content:flex-start;" data-split-station="${this.escapeXml(s.id)}">
              ${this.escapeXml(s.name)} (${this.escapeXml(s.abbr || '')}) で分割
            </button>
          `).join("")}
        </div>
      `}
    `;

    pop.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-split-close]");
      if (closeBtn) {
        this.closeFloatingPopover();
        return;
      }
      const stBtn = e.target.closest("[data-split-station]");
      if (stBtn) {
        const viaId = stBtn.dataset.splitStation;
        this.closeFloatingPopover();
        this.model.splitTrainAtStation(this.activeRosterId, trainIndex, viaId);
      }
    });

    this.positionFloatingPopover(pop, anchorEl);
  }

  safeMutate(fn) {
    this.isInternalInput = true;
    try {
      fn();
    } finally {
      this.isInternalInput = false;
    }
  }

  handleTrainValueUpdate(meta) {
    if (this.activeTab !== "tab-trains") return;
    const roster = this.model.getRoster(this.activeRosterId);
    if (!roster) return;
    const trains = roster.trains || [];
    const idx = meta ? meta.trainIndex : -1;
    if (idx >= 0 && idx < trains.length) {
      const tr = trains[idx];
      const prevTr = (idx > 0) ? trains[idx - 1] : null;
      const valResult = this.model.validateTrain(tr, prevTr);
      const rowEl = this.container.querySelector(`tr[data-train-idx="${idx}"]`);
      if (rowEl) {
        rowEl.className = !valResult.valid ? "row-error" : (valResult.warnings.length > 0 ? "row-warning" : "");
        rowEl.title = !valResult.valid ? valResult.errors.join("; ") : (valResult.warnings.length > 0 ? valResult.warnings.join("; ") : "");
      }
    }
  }

  handleNoteValueUpdate(meta) {
    if (this.activeTab !== "tab-notes" || !meta || !meta.noteId) return;
    const rowEl = this.container.querySelector(`tr[data-note-id="${meta.noteId}"]`);
    if (!rowEl) return;
    const patch = meta.patch || {};
    for (const [key, val] of Object.entries(patch)) {
      const inp = rowEl.querySelector(`[data-note-field="${key}"]`);
      if (inp && document.activeElement !== inp) {
        inp.value = val;
      }
    }
  }

  setActiveTab(tabId) {
    this.activeTab = tabId;
    this.lastSyncMessage = "";
    this.render();
  }

  setActiveRoster(rosterId) {
    this.activeRosterId = rosterId;
    this.lastSyncMessage = "";
    this.render();
  }

  render() {
    this.closeFloatingPopover();
    const data = this.model.getData();
    if (!data) return;

    // アクティブ運用の確認
    const rosters = data.rosters || [];
    if (!this.activeRosterId && rosters.length > 0) {
      this.activeRosterId = rosters[0].id;
    } else if (this.activeRosterId && !rosters.some(r => r.id === this.activeRosterId)) {
      this.activeRosterId = rosters.length > 0 ? rosters[0].id : null;
    }

    this.container.innerHTML = `
      <div class="editor-tabs">
        <button class="editor-tab-btn ${this.activeTab === 'tab-trains' ? 'active' : ''}" data-tab="tab-trains">
          列車表
        </button>
        <button class="editor-tab-btn ${this.activeTab === 'tab-rosters' ? 'active' : ''}" data-tab="tab-rosters">
          運用一覧
        </button>
        <button class="editor-tab-btn ${this.activeTab === 'tab-types' ? 'active' : ''}" data-tab="tab-types">
          種別マスタ
        </button>
        <button class="editor-tab-btn ${this.activeTab === 'tab-stations' ? 'active' : ''}" data-tab="tab-stations">
          駅マスタ
        </button>
        <button class="editor-tab-btn ${this.activeTab === 'tab-notes' ? 'active' : ''}" data-tab="tab-notes">
          注記
        </button>
        <button class="editor-tab-btn ${this.activeTab === 'tab-settings' ? 'active' : ''}" data-tab="tab-settings">
          基本設定
        </button>
        <button class="editor-tab-btn ${this.activeTab === 'tab-raw-json' ? 'active' : ''}" data-tab="tab-raw-json">
          生JSON
        </button>
      </div>

      <div class="editor-body">
        ${this.renderActiveTabContent(data)}
      </div>
    `;

    this.bindEvents();
  }

  renderActiveTabContent(data) {
    switch (this.activeTab) {
      case "tab-trains":
        return this.renderTrainsTab(data);
      case "tab-rosters":
        return this.renderRostersTab(data);
      case "tab-types":
        return this.renderTypesTab(data);
      case "tab-stations":
        return this.renderStationsTab(data);
      case "tab-notes":
        return this.renderNotesTab(data);
      case "tab-settings":
        return this.renderSettingsTab(data);
      case "tab-raw-json":
        return this.renderRawJsonTab(data);
      default:
        return `<div class="p-4">タブを選択してください</div>`;
    }
  }

  // ==================== 1. 列車表 (Trains Tab) ====================
  renderTrainsTab(data) {
    const rosters = data.rosters || [];
    const currentRoster = rosters.find(r => r.id === this.activeRosterId) || rosters[0];

    if (!currentRoster) {
      return `
        <div class="empty-state">
          <p>運用が登録されていません。「運用一覧」タブから運用を追加してください。</p>
          <button id="btnCreateFirstRoster" class="btn btn-primary" style="margin-top: 10px;">A1 運用を作成</button>
        </div>
      `;
    }

    const trains = currentRoster.trains || [];
    const stations = data.stations || [];
    const trainTypes = data.trainTypes || [];

    // 運用切り替えセレクトオプション
    const rosterOptions = rosters.map(r => `
      <option value="${this.escapeXml(r.id)}" ${r.id === currentRoster.id ? 'selected' : ''}>
        ${this.escapeXml(r.name || r.id)} (${r.trains ? r.trains.length : 0}本)
      </option>
    `).join("");
    const set = data.settings || {};
    const autoSync = set.autoSyncCoupled !== false;
    const partialStep = typeof set.partialConnectStepRows === "number" ? set.partialConnectStepRows : 1;

    return `
      <div class="tab-toolbar" style="flex-wrap: wrap; gap: 6px;">
        <div class="roster-selector-group">
          <label class="control-label">運用:</label>
          <select id="selectActiveRoster" class="form-select font-bold">
            ${rosterOptions}
          </select>
        </div>

        <div class="action-buttons" style="flex-wrap: wrap; gap: 5px;">
          <button id="btnAddTrain" class="btn btn-sm btn-primary">＋ 列車追加</button>
          <button id="btnAddConnectingTrain" class="btn btn-sm btn-secondary" title="前列車から接続追加（途中駅なら列車番号・種別引継＋標準${partialStep}行、終端駅なら折り返し）">
            ＋ 継走列車追加
          </button>
        </div>

        <div class="sync-toolbar-group">
          <label class="sync-toggle-label" title="ONのとき、併結列車の列車番号・種別・発着駅・時刻・連結順序を変更すると相手運用にも即時反映します">
            <input type="checkbox" id="checkAutoSyncCoupled" ${autoSync ? 'checked' : ''} />
            <span>⚡ 併結自動同期</span>
          </label>
          <button id="btnSyncCoupledAll" class="btn btn-sm btn-secondary" title="この運用の併結列車の着発情報・位置順序を相手運用へ一括反映（相手側の不足行も生成）">
            🔗 相手へ一括同期
          </button>
          ${this.lastSyncMessage ? `<span id="syncStatusBadge" class="sync-status-badge">${this.escapeXml(this.lastSyncMessage)}</span>` : ''}
        </div>
      </div>

      <div class="table-scroll-container">
        <table class="grid-table" id="trainsGridTable">
          <thead>
            <tr>
              <th style="width: 22px;">#</th>
              <th style="width: 52px;">列番</th>
              <th style="width: 54px;">種別</th>
              <th style="width: 48px;">発駅</th>
              <th style="width: 42px;">発時刻</th>
              <th style="width: 48px;">着駅</th>
              <th style="width: 42px;">着時刻</th>
              <th style="width: 128px;">併結 (相手/位置)</th>
              <th style="width: 44px;">発記</th>
              <th style="width: 44px;">着記</th>
              <th style="width: 30px;" title="段下げ行数 (0行〜、標準2行)">行</th>
              <th style="width: 78px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${trains.map((tr, idx) => this.renderTrainRow(tr, idx, currentRoster, rosters, stations, trainTypes, idx > 0 ? trains[idx - 1] : null)).join("")}
          </tbody>
        </table>
      </div>

      <div class="table-footer-info">
        <span>全 ${trains.length} 本</span>
        <span class="text-muted" style="margin-left: 12px;">※ 「⚙」で3両以上の連結順序設定、「✂」で途中駅での継走分割ができます。</span>
      </div>
    `;
  }

  renderTrainRow(train, index, roster, allRosters, stations, trainTypes, prevTrain) {
    const valResult = this.model.validateTrain(train, prevTrain);
    const hasError = !valResult.valid;
    const hasWarning = valResult.warnings.length > 0;
    const rowClass = hasError ? "row-error" : (hasWarning ? "row-warning" : "");
    const titleAttr = hasError ? valResult.errors.join("; ") : (hasWarning ? valResult.warnings.join("; ") : "");

    // 駅プルダウン
    const fromOptions = stations.map(s => `
      <option value="${this.escapeXml(s.id)}" ${s.id === train.fromStation ? 'selected' : ''}>
        ${this.escapeXml(s.abbr || s.name)}
      </option>
    `).join("");

    const toOptions = stations.map(s => `
      <option value="${this.escapeXml(s.id)}" ${s.id === train.toStation ? 'selected' : ''}>
        ${this.escapeXml(s.abbr || s.name)}
      </option>
    `).join("");

    // 種別プルダウン
    const typeOptions = trainTypes.map(t => `
      <option value="${this.escapeXml(t.id)}" ${t.id === train.typeId ? 'selected' : ''}>
        ${this.escapeXml(t.name)}
      </option>
    `).join("");

    // 併結相手プルダウン (他運用)
    const partnerOptions = `
      <option value="">なし</option>
      ${allRosters.filter(r => r.id !== roster.id).map(r => `
        <option value="${this.escapeXml(r.id)}" ${r.id === train.coupledPartner ? 'selected' : ''}>
          ＋${this.escapeXml(r.name || r.id)}
        </option>
      `).join("")}
    `;

    // 併結列: 相手選択＋順序反転⇄＋自由記述✎
    const isCustom = !!train.customCoupled;
    const formation = this.model.getFormationOrder(roster.id, train);
    const isMultiCar = Array.isArray(train.coupledFormation) && train.coupledFormation.length >= 3;
    const coupledPos = train.coupledPosition === "before" ? "before" : "after";
    const partnerSelectHtml = `
      <div class="coupled-cell-flex">
        ${isCustom ? `
          <input type="text" class="cell-input cell-input-sm" data-field="customCoupled" value="${this.escapeXml(train.customCoupled)}" placeholder="自由記述" style="flex: 1; min-width: 45px;" />
          <button class="btn-icon-xs" data-action="toggle-custom-coupled" title="自動併結（選択式）に戻す">✕</button>
        ` : (isMultiCar ? `
          <button type="button" class="coupled-multi-badge" data-action="open-formation-popover" title="編成順序・連結位置を変更: (${this.escapeXml(formation.join('＋'))})">
            ${this.escapeXml(formation.join("＋"))}
          </button>
          <button type="button" class="btn-icon-xs" data-action="open-formation-popover" title="3両以上・詳細な編成順を設定">⚙</button>
          <button type="button" class="btn-icon-xs" data-action="toggle-custom-coupled" title="自由記述を入力">✎</button>
        ` : `
          <select class="cell-select cell-select-sm" data-field="coupledPartner" style="flex: 1; min-width: 36px;">
            ${partnerOptions}
          </select>
          <select class="cell-select cell-select-sm coupled-pos-select" data-field="coupledPosition" title="自運用の連結位置" ${!train.coupledPartner ? 'disabled' : ''}>
            <option value="after" ${coupledPos === 'after' ? 'selected' : ''}>後(自+相)</option>
            <option value="before" ${coupledPos === 'before' ? 'selected' : ''}>前(相+自)</option>
          </select>
          <button type="button" class="btn-icon-xs" data-action="open-formation-popover" title="3両以上・詳細な編成順を設定">⚙</button>
          <button type="button" class="btn-icon-xs" data-action="toggle-custom-coupled" title="自由記述を入力">✎</button>
        `)}
      </div>
    `;

    return `
      <tr class="${rowClass}" title="${this.escapeXml(titleAttr)}" data-train-idx="${index}">
        <td class="text-center font-mono">${index + 1}</td>
        <td>
          <input type="text" class="cell-input text-bold" data-field="trainNo" value="${this.escapeXml(train.trainNo)}" placeholder="104" />
        </td>
        <td>
          <select class="cell-select" data-field="typeId">
            ${typeOptions}
          </select>
        </td>
        <td>
          <select class="cell-select" data-field="fromStation">
            ${fromOptions}
          </select>
        </td>
        <td>
          <input type="text" class="cell-input text-center font-mono" data-field="depTime" value="${this.escapeXml(train.depTime)}" placeholder="5:23" />
        </td>
        <td>
          <select class="cell-select" data-field="toStation">
            ${toOptions}
          </select>
        </td>
        <td>
          <input type="text" class="cell-input text-center font-mono" data-field="arrTime" value="${this.escapeXml(train.arrTime)}" placeholder="6:31" />
        </td>
        <td>
          ${partnerSelectHtml}
        </td>
        <td>
          <select class="cell-select cell-select-sm" data-field="depSymbol">
            <option value="none" ${train.depSymbol === 'none' ? 'selected' : ''}>ー なし</option>
            <option value="circle" ${train.depSymbol === 'circle' ? 'selected' : ''}>○ 出区</option>
            <option value="circle_filled" ${train.depSymbol === 'circle_filled' ? 'selected' : ''}>● 黒丸</option>
          </select>
        </td>
        <td>
          <select class="cell-select cell-select-sm" data-field="arrSymbol">
            <option value="none" ${train.arrSymbol === 'none' ? 'selected' : ''}>ー なし</option>
            <option value="triangle" ${train.arrSymbol === 'triangle' ? 'selected' : ''}>△ 入区</option>
            <option value="triangle_filled" ${train.arrSymbol === 'triangle_filled' ? 'selected' : ''}>▲ 終結</option>
          </select>
        </td>
        <td>
          <input type="number" class="cell-input text-center font-mono" data-field="stepRows" value="${typeof train.stepRows === 'number' ? train.stepRows : 2}" min="0" max="10" />
        </td>
        <td class="action-cell">
          <button class="btn-icon" data-action="split-train" title="途中駅で継走分割（部分継走）">✂</button>
          <button class="btn-icon" data-action="dup-train" title="複製">📄</button>
          <button class="btn-icon text-danger" data-action="del-train" title="削除">✕</button>
          <button class="btn-icon" data-action="up-train" title="上へ移動" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn-icon" data-action="down-train" title="下へ移動">↓</button>
        </td>
      </tr>
    `;
  }

  // ==================== 2. 運用一覧 (Rosters Tab) ====================
  renderRostersTab(data) {
    const rosters = data.rosters || [];

    return `
      <div class="tab-toolbar">
        <span class="section-title-sm">運用管理 (全 ${rosters.length} 件)</span>
        <button id="btnAddRoster" class="btn btn-sm btn-primary">＋ 新規運用追加</button>
      </div>

      <div class="table-scroll-container">
        <table class="grid-table" id="rostersGridTable">
          <thead>
            <tr>
              <th style="width: 34px;">#</th>
              <th style="width: 115px;">運用番号 (ID)</th>
              <th style="width: 195px;">表示用運用番号</th>
              <th style="width: 60px;">本数</th>
              <th style="width: 78px;" title="手動改ページモード時にこの運用の直後でページを区切る">改ページ</th>
              <th style="width: 148px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rosters.map((r, idx) => `
              <tr data-roster-id="${this.escapeXml(r.id)}">
                <td class="text-center font-mono">${idx + 1}</td>
                <td>
                  <input type="text" class="cell-input font-bold" data-roster-field="id" value="${this.escapeXml(r.id)}" />
                </td>
                <td>
                  <div class="roster-name-cell">
                    <input type="text" class="cell-input" data-roster-field="name" value="${this.escapeXml(r.name || r.id)}" placeholder="${this.escapeXml(r.id)}" style="flex:1;min-width:60px;" />
                    <span class="roster-name-badge ${r.customName ? 'is-manual' : 'is-auto'}">${r.customName ? '手動' : '自動'}</span>
                    ${r.customName ? `<button type="button" class="btn-icon-xs" data-action="reset-roster-name" title="運用番号と同じ自動同期へ戻す">↺</button>` : ''}
                  </div>
                </td>
                <td class="text-center font-mono">
                  ${r.trains ? r.trains.length : 0} 本
                </td>
                <td class="text-center">
                  <label class="checkbox-simple">
                    <input type="checkbox" data-roster-field="pageBreakAfter" ${r.pageBreakAfter ? 'checked' : ''} />
                    <span>改ページ</span>
                  </label>
                </td>
                <td class="action-cell">
                  <button class="btn btn-xs btn-secondary" data-action="edit-roster-trains">編集 ✏️</button>
                  <button class="btn-icon" data-action="dup-roster" title="運用を複製">📄</button>
                  <button class="btn-icon text-danger" data-action="del-roster" title="運用を削除">✕</button>
                  <button class="btn-icon" data-action="up-roster" title="上へ移動" ${idx === 0 ? 'disabled' : ''}>↑</button>
                  <button class="btn-icon" data-action="down-roster" title="下へ移動" ${idx === rosters.length - 1 ? 'disabled' : ''}>↓</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div id="rosterEditErrorBox" class="editor-inline-alert" style="display:none;"></div>
      <div class="table-footer-info">
        <span>※ 「運用番号」を変更すると、「自動」の表示用運用番号や他運用の併結相手参照も自動追従します。「表示用運用番号」を直接編集すると「手動」上書きになります（↺で自動同期に戻せます）。</span>
      </div>
    `;
  }

  // ==================== 3. 種別マスタ (Train Types Tab) ====================
  renderTypesTab(data) {
    const types = data.trainTypes || [];

    return `
      <div class="tab-toolbar">
        <span class="section-title-sm">列車種別・配色マスタ (全 ${types.length} 件)</span>
        <div class="action-buttons">
          <div class="dropdown-inline">
            <button id="btnPalettePresets" class="btn btn-sm btn-secondary">🎨 パレット読込 ▾</button>
            <div id="paletteMenu" class="dropdown-menu" style="display: none;">
              <a href="#" class="dropdown-item" data-palette="standard">標準 (普通:黒 / 回送:橙 / SL:青 / 快速:赤)</a>
              <a href="#" class="dropdown-item" data-palette="jr_east">JR東日本風 (各駅:黄緑 / 快速:橙 / 特急:赤)</a>
              <a href="#" class="dropdown-item" data-palette="monochrome">モノクロ印刷用 (全て黒 / 破線区別)</a>
            </div>
          </div>
          <button id="btnAddTrainType" class="btn btn-sm btn-primary">＋ 新規種別追加</button>
        </div>
      </div>

      <div class="table-scroll-container">
        <table class="grid-table" id="typesGridTable">
          <thead>
            <tr>
              <th style="width: 100px;">種別名</th>
              <th style="width: 110px;">ダイヤ線色</th>
              <th style="width: 110px;">時刻色</th>
              <th style="width: 110px;">列車番号色</th>
              <th style="width: 80px;">線種</th>
              <th style="width: 60px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${types.map(t => `
              <tr data-type-id="${this.escapeXml(t.id)}">
                <td>
                  <input type="text" class="cell-input font-bold" data-type-field="name" value="${this.escapeXml(t.name)}" />
                </td>
                <td>
                  <div class="color-picker-cell">
                    <input type="color" class="color-swatch" data-type-field="lineColor" value="${t.lineColor || '#000000'}" />
                    <input type="text" class="color-hex-input font-mono" data-type-field="lineColor" value="${t.lineColor || '#000000'}" />
                  </div>
                </td>
                <td>
                  <div class="color-picker-cell">
                    <input type="color" class="color-swatch" data-type-field="timeColor" value="${t.timeColor || '#000000'}" />
                    <input type="text" class="color-hex-input font-mono" data-type-field="timeColor" value="${t.timeColor || '#000000'}" />
                  </div>
                </td>
                <td>
                  <div class="color-picker-cell">
                    <input type="color" class="color-swatch" data-type-field="textColor" value="${t.textColor || '#000000'}" />
                    <input type="text" class="color-hex-input font-mono" data-type-field="textColor" value="${t.textColor || '#000000'}" />
                  </div>
                </td>
                <td>
                  <select class="cell-select" data-type-field="lineStyle">
                    <option value="solid" ${t.lineStyle === 'solid' ? 'selected' : ''}>実線</option>
                    <option value="dashed" ${t.lineStyle === 'dashed' ? 'selected' : ''}>破線</option>
                    <option value="dotted" ${t.lineStyle === 'dotted' ? 'selected' : ''}>点線</option>
                  </select>
                </td>
                <td class="action-cell">
                  <button class="btn-icon text-danger" data-action="del-type" title="削除">✕</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  // ==================== 4. 駅マスタ (Stations Tab) ====================
  renderStationsTab(data) {
    const stations = data.stations || [];

    return `
      <div class="tab-toolbar">
        <span class="section-title-sm">駅マスタ (全 ${stations.length} 駅)</span>
        <div class="action-buttons">
          <button id="btnResetMain3Stations" class="btn btn-sm btn-secondary" title="桜川・美咲町・楓ヶ丘・青山温泉の主要4駅にリセット">主要4駅にリセット</button>
          <button id="btnLoadAllSampleStations" class="btn btn-sm btn-secondary" title="全10駅を展開">サンプル全10駅</button>
          <button id="btnAddStation" class="btn btn-sm btn-primary">＋ 駅追加</button>
        </div>
      </div>

      <div class="table-scroll-container">
        <table class="grid-table" id="stationsGridTable">
          <thead>
            <tr>
              <th style="width: 44px;">表示</th>
              <th style="width: 140px;">駅名</th>
              <th style="width: 70px;">略称</th>
              <th style="width: 90px;">X座標 (px)</th>
              <th style="width: 90px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${stations.map((s, idx) => `
              <tr data-station-id="${this.escapeXml(s.id)}">
                <td class="text-center">
                  <input type="checkbox" data-station-field="visible" ${s.visible !== false ? 'checked' : ''} />
                </td>
                <td>
                  <input type="text" class="cell-input font-bold" data-station-field="name" value="${this.escapeXml(s.name)}" />
                </td>
                <td>
                  <input type="text" class="cell-input text-center" data-station-field="abbr" value="${this.escapeXml(s.abbr || '')}" maxlength="2" />
                </td>
                <td>
                  <input type="number" class="cell-input text-right font-mono" data-station-field="x" value="${s.x !== undefined ? s.x : 0}" step="0.16" />
                </td>
                <td class="action-cell">
                  <button class="btn-icon" data-action="up-station" title="上へ" ${idx === 0 ? 'disabled' : ''}>↑</button>
                  <button class="btn-icon" data-action="down-station" title="下へ" ${idx === stations.length - 1 ? 'disabled' : ''}>↓</button>
                  <button class="btn-icon text-danger" data-action="del-station" title="削除">✕</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="table-footer-info">
        <span>※ 表示チェックを切り替えると、ダイヤ領域内で駅のX座標が自動再配置されます。</span>
      </div>
    `;
  }

  // ==================== 5. 注記 (Notes Tab) ====================
  renderNotesTab(data) {
    const notes = data.notes || [];

    return `
      <div class="tab-toolbar">
        <span class="section-title-sm">図面自由注記 (全 ${notes.length} 件)</span>
        <button id="btnAddNote" class="btn btn-sm btn-primary">＋ 注記追加</button>
      </div>

      <div class="table-scroll-container">
        <table class="grid-table" id="notesGridTable">
          <thead>
            <tr>
              <th style="width: 75px;">ページ</th>
              <th style="width: 190px;">テキスト内容</th>
              <th style="width: 70px;">X (px)</th>
              <th style="width: 70px;">Y (px)</th>
              <th style="width: 110px;">文字色</th>
              <th style="width: 65px;">サイズ</th>
              <th style="width: 50px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${notes.map(n => `
              <tr data-note-id="${this.escapeXml(n.id)}">
                <td>
                  <select class="cell-select" data-note-field="page">
                    <option value="1" ${(n.page === 1 || !n.page) ? 'selected' : ''}>1ページ</option>
                    <option value="2" ${n.page === 2 ? 'selected' : ''}>2ページ</option>
                    <option value="3" ${n.page === 3 ? 'selected' : ''}>3ページ</option>
                    <option value="all" ${n.page === 'all' ? 'selected' : ''}>全ページ</option>
                  </select>
                </td>
                <td>
                  <input type="text" class="cell-input font-bold" data-note-field="text" value="${this.escapeXml(n.text)}" placeholder="SL運転日は運休 等" />
                </td>
                <td>
                  <input type="number" class="cell-input text-right font-mono" data-note-field="x" value="${Number.isFinite(n.x) ? n.x : 202.4}" step="0.16" />
                </td>
                <td>
                  <input type="number" class="cell-input text-right font-mono" data-note-field="y" value="${Number.isFinite(n.y) ? n.y : 340.48}" step="0.16" />
                </td>
                <td>
                  <div class="color-picker-cell">
                    <input type="color" class="color-swatch" data-note-field="color" value="${n.color || '#FF0000'}" />
                    <input type="text" class="color-hex-input font-mono" data-note-field="color" value="${n.color || '#FF0000'}" />
                  </div>
                </td>
                <td>
                  <input type="number" class="cell-input text-center font-mono" data-note-field="fontSize" value="${n.fontSize || 10.72}" step="0.5" />
                </td>
                <td class="action-cell">
                  <button class="btn-icon text-danger" data-action="del-note" title="削除">✕</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      <div class="table-footer-info">
        <span>※ 図面プレビュー上で注記テキストを直接ドラッグして位置を微調整できます（<strong>Altキーを押しながらドラッグで列車線に自動吸着</strong>）。</span>
      </div>
    `;
  }

  // ==================== 6. 基本設定 (Settings Tab) ====================
  renderSettingsTab(data) {
    const meta = data.metadata || {};
    const set = data.settings || {};

    return `
      <div class="form-settings-container">
        <div class="settings-group">
          <div class="group-title">ヘッダー・タイトル情報</div>
          <div class="form-row">
            <label class="form-label">図面タイトル:</label>
            <input type="text" class="form-control" id="inputMetaTitle" value="${this.escapeXml(meta.title || '')}" />
          </div>
          <div class="form-row">
            <label class="form-label">著作権・作成者:</label>
            <input type="text" class="form-control" id="inputMetaCopyright" value="${this.escapeXml(meta.copyright || '')}" />
          </div>
        </div>

        <div class="settings-group">
          <div class="group-title">用紙・改ページ設定</div>
          <div class="form-row-grid">
            <div class="form-col">
              <label class="form-label">用紙サイズ:</label>
              <select class="form-select" id="selectPageSize">
                <option value="A4" ${set.pageSize === 'A4' ? 'selected' : ''}>A4 (210 × 297 mm)</option>
                <option value="B5" ${set.pageSize === 'B5' ? 'selected' : ''}>B5 (182 × 257 mm)</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">用紙の向き:</label>
              <select class="form-select" id="selectOrientation">
                <option value="portrait" ${set.orientation === 'portrait' ? 'selected' : ''}>縦向き (Portrait)</option>
                <option value="landscape" ${set.orientation === 'landscape' ? 'selected' : ''}>横向き (Landscape)</option>
              </select>
            </div>
          </div>
          <div class="form-row" style="margin-top: 10px;">
            <label class="form-label">改ページ方式:</label>
            <div class="radio-group-horizontal">
              <label class="radio-label">
                <input type="radio" name="setPageBreakMode" value="auto" ${set.pageBreakMode !== 'manual' ? 'checked' : ''} />
                <span>自動改ページ (高さ上限で自動分割)</span>
              </label>
              <label class="radio-label">
                <input type="radio" name="setPageBreakMode" value="manual" ${set.pageBreakMode === 'manual' ? 'checked' : ''} />
                <span>手動改ページ (運用ごとの改ページ指定に従う)</span>
              </label>
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="group-title">スタイル・レイアウト規則</div>
          <div class="form-row">
            <label class="form-label">駅名ヘッダーの向き:</label>
            <select class="form-select" id="selectStationHeaderDirection">
              <option value="vertical" ${set.stationHeaderDirection !== 'horizontal' ? 'selected' : ''}>縦書き（2文字縦並び / 3文字以上均等配置）</option>
              <option value="horizontal" ${set.stationHeaderDirection === 'horizontal' ? 'selected' : ''}>横書き（ヘッダー中央1行配置）</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">省略駅名行 (下 真 茂) の表示:</label>
            <select class="form-select" id="selectSubHeaderMode">
              <option value="omitFirst" ${set.subHeaderMode === 'omitFirst' ? 'selected' : ''}>先頭運用は省略 (元PDF準拠)</option>
              <option value="all" ${set.subHeaderMode === 'all' ? 'selected' : ''}>全運用ブロックに表示</option>
              <option value="none" ${set.subHeaderMode === 'none' ? 'selected' : ''}>表示しない</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">自運用番号の強調スタイル:</label>
            <select class="form-select" id="selectSelfHighlightStyle">
              <option value="red" ${set.selfHighlightStyle === 'red' ? 'selected' : ''}>赤文字のみ (元PDF完全一致)</option>
              <option value="bold" ${set.selfHighlightStyle === 'bold' ? 'selected' : ''}>太字</option>
              <option value="underline" ${set.selfHighlightStyle === 'underline' ? 'selected' : ''}>下線</option>
              <option value="red-bold" ${set.selfHighlightStyle === 'red-bold' ? 'selected' : ''}>赤文字＋太字</option>
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">途中駅 部分継走の標準段下げ:</label>
            <select class="form-select" id="selectPartialConnectStepRows">
              <option value="1" ${(typeof set.partialConnectStepRows !== 'number' || set.partialConnectStepRows >= 1) ? 'selected' : ''}>1行（標準：他資料準拠の段差）</option>
              <option value="0" ${set.partialConnectStepRows === 0 ? 'selected' : ''}>0行（同じ横線上に詰める）</option>
            </select>
          </div>
          <div class="form-row-grid" style="margin-top: 10px;">
            <div class="form-col">
              <label class="form-label">基準Excel行高 (px):</label>
              <input type="number" class="form-control font-mono" id="inputBaseRowHeight" value="${set.baseRowHeight || 12.96}" step="0.16" />
            </div>
            <div class="form-col">
              <label class="form-label">標準折り返しステップ (行数):</label>
              <input type="number" class="form-control font-mono" id="inputRosterStepRows" value="${set.rosterStepRows || 2}" min="1" max="5" />
            </div>
            <div class="form-col">
              <label class="form-label">ブロック上下余白 (行数):</label>
              <input type="number" class="form-control font-mono" id="inputBlockPaddingRows" value="${set.blockPaddingRows !== undefined ? set.blockPaddingRows : 2}" min="1" max="5" step="0.5" />
            </div>
          </div>
        </div>

        <div class="settings-group" style="border-top: 1px solid var(--border-color); padding-top: 16px; display: flex; justify-content: flex-end;">
          <button id="btnResetSettingsToDefaults" class="btn btn-sm btn-secondary">設定を初期値に戻す</button>
        </div>
      </div>
    `;
  }

  // ==================== 7. 生JSON (Raw JSON Tab) ====================
  renderRawJsonTab(data) {
    const jsonStr = this.model.toJSON(true);

    return `
      <div class="raw-json-container">
        <div class="alert-box alert-warning">
          <strong>⚠️ 上級者向け生JSON編集</strong><br>
          JSONを直接編集すると構造破綻のリスクがあります。通常の編集は「列車表」「運用一覧」などのGUIタブを使用してください。<br>
          編集する場合は下記のチェックボックスをONにして「適用する」ボタンを押してください。スキーマ検証が行われます。
        </div>

        <div class="json-actions-bar">
          <label class="checkbox-simple">
            <input type="checkbox" id="checkEnableRawEdit" />
            <span class="font-bold">JSONの直接編集を有効化する</span>
          </label>
          <div>
            <button id="btnCopyJson" class="btn btn-sm btn-secondary">📋 コピー</button>
            <button id="btnApplyRawJson" class="btn btn-sm btn-primary" disabled>適用する</button>
          </div>
        </div>

        <div id="rawJsonErrorBox" class="alert-box alert-danger" style="display: none;"></div>

        <textarea id="rawJsonTextarea" class="json-textarea font-mono" readonly>${this.escapeXml(jsonStr)}</textarea>
      </div>
    `;
  }

  // ==================== イベントリスナー登録 ====================
  bindEvents() {
    // タブ切り替え
    this.container.querySelectorAll(".editor-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        this.setActiveTab(btn.dataset.tab);
      });
    });

    // 列車表タブ
    if (this.activeTab === "tab-trains") {
      const rosterSelect = this.container.querySelector("#selectActiveRoster");
      if (rosterSelect) {
        rosterSelect.addEventListener("change", (e) => {
          this.setActiveRoster(e.target.value);
        });
      }

      const btnAddTrain = this.container.querySelector("#btnAddTrain");
      if (btnAddTrain) {
        btnAddTrain.addEventListener("click", () => {
          this.model.addTrain(this.activeRosterId);
        });
      }

      const btnAddConn = this.container.querySelector("#btnAddConnectingTrain");
      if (btnAddConn) {
        btnAddConn.addEventListener("click", () => {
          this.model.addConnectingTrain(this.activeRosterId);
        });
      }

      const checkAutoSync = this.container.querySelector("#checkAutoSyncCoupled");
      if (checkAutoSync) {
        checkAutoSync.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ autoSyncCoupled: e.target.checked });
          });
        });
      }

      const btnSyncAll = this.container.querySelector("#btnSyncCoupledAll");
      if (btnSyncAll) {
        btnSyncAll.addEventListener("click", () => {
          let res = { updatedCount: 0, createdCount: 0 };
          this.safeMutate(() => {
            res = this.model.syncRosterCoupledTrains(this.activeRosterId);
          });
          this.lastSyncMessage = `同期完了 (更新 ${res.updatedCount}件 / 新規 ${res.createdCount}件)`;
          this.render();
        });
      }

      const btnFirstRoster = this.container.querySelector("#btnCreateFirstRoster");
      if (btnFirstRoster) {
        btnFirstRoster.addEventListener("click", () => {
          const id = this.model.addRoster({ id: "A1", name: "A1" });
          this.setActiveRoster(id);
        });
      }

      // 列車テーブル内セル変更
      const trainTable = this.container.querySelector("#trainsGridTable");
      if (trainTable) {
        trainTable.addEventListener("input", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const idx = parseInt(tr.dataset.trainIdx, 10);
          const field = e.target.dataset.field;
          if (field) {
            let val = e.target.value;
            if (field === "stepRows") {
              const parsed = parseInt(val, 10);
              val = Number.isNaN(parsed) ? 2 : Math.max(0, parsed);
            }
            this.safeMutate(() => {
              this.model.updateTrain(this.activeRosterId, idx, { [field]: val });
            });
          }
        });

        trainTable.addEventListener("change", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const idx = parseInt(tr.dataset.trainIdx, 10);
          const field = e.target.dataset.field;
          if (field) {
            let val = e.target.value;
            if (field === "stepRows") {
              const parsed = parseInt(val, 10);
              val = Number.isNaN(parsed) ? 2 : Math.max(0, parsed);
            }
            if (field === "coupledPartner" || field === "coupledPosition") {
              this.model.updateTrain(this.activeRosterId, idx, { [field]: val, customCoupled: "" });
              this.render();
            } else {
              this.safeMutate(() => {
                this.model.updateTrain(this.activeRosterId, idx, { [field]: val });
              });
            }
          }
        });

        // アクションボタン
        trainTable.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const tr = btn.closest("tr");
          if (!tr) return;
          const idx = parseInt(tr.dataset.trainIdx, 10);
          const act = btn.dataset.action;

          if (act === "split-train") {
            this.openSplitPopover(btn, idx);
          } else if (act === "dup-train") {
            this.model.duplicateTrain(this.activeRosterId, idx);
          } else if (act === "del-train") {
            this.model.deleteTrain(this.activeRosterId, idx);
          } else if (act === "up-train") {
            this.model.moveTrain(this.activeRosterId, idx, idx - 1);
          } else if (act === "down-train") {
            this.model.moveTrain(this.activeRosterId, idx, idx + 1);
          } else if (act === "open-formation-popover") {
            this.openFormationPopover(btn, idx);
          } else if (act === "toggle-custom-coupled") {
            const roster = this.model.getRoster(this.activeRosterId);
            const train = roster.trains[idx];
            if (train.customCoupled) {
              this.model.updateTrain(this.activeRosterId, idx, { customCoupled: "" });
            } else {
              const formation = this.model.getFormationOrder(roster.id, train);
              const defaultCustom = formation.length >= 2 ? `(${formation.join("＋")})` : "";
              this.model.updateTrain(this.activeRosterId, idx, { customCoupled: defaultCustom || "併結" });
            }
            this.render();
          }
        });
      }
    }

    // 運用一覧タブ
    if (this.activeTab === "tab-rosters") {
      const btnAddRoster = this.container.querySelector("#btnAddRoster");
      if (btnAddRoster) {
        btnAddRoster.addEventListener("click", () => {
          const id = this.model.addRoster({});
          this.setActiveRoster(id);
        });
      }

      const rostersTable = this.container.querySelector("#rostersGridTable");
      const rosterErrBox = this.container.querySelector("#rosterEditErrorBox");
      if (rostersTable) {
        const updateRosterBadgeDom = (tr, rosterObj) => {
          const badge = tr.querySelector(".roster-name-badge");
          if (badge && rosterObj) {
            badge.className = `roster-name-badge ${rosterObj.customName ? 'is-manual' : 'is-auto'}`;
            badge.textContent = rosterObj.customName ? "手動" : "自動";
          }
          const cell = tr.querySelector(".roster-name-cell");
          if (cell && rosterObj) {
            let resetBtn = cell.querySelector("[data-action='reset-roster-name']");
            if (rosterObj.customName && !resetBtn) {
              resetBtn = document.createElement("button");
              resetBtn.type = "button";
              resetBtn.className = "btn-icon-xs";
              resetBtn.dataset.action = "reset-roster-name";
              resetBtn.title = "運用番号と同じ自動同期へ戻す";
              resetBtn.textContent = "↺";
              cell.appendChild(resetBtn);
            } else if (!rosterObj.customName && resetBtn) {
              resetBtn.remove();
            }
          }
        };

        rostersTable.addEventListener("input", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const id = tr.dataset.rosterId;
          const field = e.target.dataset.rosterField;
          if (field === "name") {
            let res;
            this.safeMutate(() => {
              res = this.model.updateRoster(id, { name: e.target.value });
            });
            if (res && res.ok && res.roster) {
              updateRosterBadgeDom(tr, res.roster);
            }
          }
        });

        rostersTable.addEventListener("change", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const id = tr.dataset.rosterId;
          const field = e.target.dataset.rosterField;
          if (field) {
            const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
            let res;
            this.safeMutate(() => {
              res = this.model.updateRoster(id, { [field]: val });
            });
            if (res && !res.ok) {
              if (field === "id") e.target.value = id;
              if (rosterErrBox) {
                rosterErrBox.textContent = res.error || "更新できませんでした";
                rosterErrBox.style.display = "block";
              }
              return;
            }
            if (rosterErrBox) rosterErrBox.style.display = "none";
            if (res && res.ok && res.roster) {
              if (res.oldId !== res.newId) {
                tr.dataset.rosterId = res.newId;
                const nameInp = tr.querySelector("[data-roster-field='name']");
                if (nameInp) {
                  nameInp.placeholder = res.newId;
                  if (!res.roster.customName && document.activeElement !== nameInp) {
                    nameInp.value = res.roster.name;
                  }
                }
              }
              updateRosterBadgeDom(tr, res.roster);
            }
          }
        });

        rostersTable.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const tr = btn.closest("tr");
          if (!tr) return;
          const id = tr.dataset.rosterId;
          const act = btn.dataset.action;

          if (act === "edit-roster-trains") {
            this.setActiveRoster(id);
            this.setActiveTab("tab-trains");
          } else if (act === "reset-roster-name") {
            this.model.updateRoster(id, { resetName: true });
          } else if (act === "dup-roster") {
            this.model.duplicateRoster(id);
          } else if (act === "del-roster") {
            if (confirm(`運用 ${id} を削除しますか？`)) {
              this.model.deleteRoster(id);
            }
          } else if (act === "up-roster" || act === "down-roster") {
            const rosters = this.model.getRosters();
            const curIdx = rosters.findIndex(r => r.id === id);
            const targetIdx = act === "up-roster" ? curIdx - 1 : curIdx + 1;
            this.model.moveRoster(curIdx, targetIdx);
          }
        });
      }
    }

    // 種別マスタタブ
    if (this.activeTab === "tab-types") {
      const btnAddType = this.container.querySelector("#btnAddTrainType");
      if (btnAddType) {
        btnAddType.addEventListener("click", () => {
          this.model.addTrainType({});
        });
      }

      // パレットメニュー
      const btnPalette = this.container.querySelector("#btnPalettePresets");
      const paletteMenu = this.container.querySelector("#paletteMenu");
      if (btnPalette && paletteMenu) {
        btnPalette.addEventListener("click", (e) => {
          e.stopPropagation();
          paletteMenu.style.display = paletteMenu.style.display === "block" ? "none" : "block";
        });
        document.addEventListener("click", () => {
          paletteMenu.style.display = "none";
        });

        paletteMenu.querySelectorAll(".dropdown-item").forEach(item => {
          item.addEventListener("click", (e) => {
            e.preventDefault();
            this.applyPalettePreset(item.dataset.palette);
          });
        });
      }

      // カラーピッカー・入力値同期
      const typesTable = this.container.querySelector("#typesGridTable");
      if (typesTable) {
        typesTable.addEventListener("input", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const typeId = tr.dataset.typeId;
          const field = e.target.dataset.typeField;
          if (!field) return;

          const cell = e.target.closest(".color-picker-cell");
          if (cell) {
            const inputs = cell.querySelectorAll(`[data-type-field="${field}"]`);
            inputs.forEach(inp => {
              if (inp !== e.target) inp.value = e.target.value;
            });
          }

          this.safeMutate(() => {
            this.model.updateTrainType(typeId, { [field]: e.target.value });
          });
        });

        typesTable.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const tr = btn.closest("tr");
          if (!tr) return;
          const typeId = tr.dataset.typeId;
          const act = btn.dataset.action;

          if (act === "del-type") {
            this.model.deleteTrainType(typeId);
          }
        });
      }
    }

    // 駅マスタタブ
    if (this.activeTab === "tab-stations") {
      const btnAddSt = this.container.querySelector("#btnAddStation");
      if (btnAddSt) {
        btnAddSt.addEventListener("click", () => {
          this.model.addStation({});
        });
      }

      const btnAllSample = this.container.querySelector("#btnLoadAllSampleStations");
      if (btnAllSample) {
        btnAllSample.addEventListener("click", () => {
          this.model.mutate("stations-reset", () => {
            this.model.data.stations = JSON.parse(JSON.stringify(FICTIONAL_ALL_STATIONS));
            this.model.recalculateStationX();
          });
        });
      }

      const btnMain3 = this.container.querySelector("#btnResetMain3Stations");
      if (btnMain3) {
        btnMain3.addEventListener("click", () => {
          this.model.resetMainStations();
        });
      }

      const stTable = this.container.querySelector("#stationsGridTable");
      if (stTable) {
        stTable.addEventListener("change", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const id = tr.dataset.stationId;
          const field = e.target.dataset.stationField;
          if (field) {
            this.safeMutate(() => {
              if (field === "visible") {
                this.model.setStationVisibility(id, e.target.checked);
              } else if (field === "x") {
                this.model.updateStation(id, { x: parseFloat(e.target.value) || 0 });
              } else {
                this.model.updateStation(id, { [field]: e.target.value });
              }
            });
          }
        });

        stTable.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const tr = btn.closest("tr");
          if (!tr) return;
          const id = tr.dataset.stationId;
          const act = btn.dataset.action;

          if (act === "del-station") {
            this.model.deleteStation(id);
          } else if (act === "up-station" || act === "down-station") {
            const stations = this.model.getStations();
            const curIdx = stations.findIndex(s => s.id === id);
            const targetIdx = act === "up-station" ? curIdx - 1 : curIdx + 1;
            this.model.moveStation(curIdx, targetIdx);
          }
        });
      }
    }

    // 注記タブ
    if (this.activeTab === "tab-notes") {
      const btnAddNote = this.container.querySelector("#btnAddNote");
      if (btnAddNote) {
        btnAddNote.addEventListener("click", () => {
          const defaultPage = (typeof window.currentPageIndex === "number" && window.currentPageIndex >= 1) ? window.currentPageIndex : 1;
          this.model.addNote({ page: defaultPage });
        });
      }

      const notesTable = this.container.querySelector("#notesGridTable");
      if (notesTable) {
        notesTable.addEventListener("input", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const id = tr.dataset.noteId;
          const field = e.target.dataset.noteField;
          if (!field) return;

          const cell = e.target.closest(".color-picker-cell");
          if (cell) {
            const inputs = cell.querySelectorAll(`[data-note-field="${field}"]`);
            inputs.forEach(inp => {
              if (inp !== e.target) inp.value = e.target.value;
            });
          }

          let val = e.target.value;
          if (field === "x" || field === "y" || field === "fontSize") {
            const parsed = parseFloat(val);
            val = Number.isFinite(parsed) ? parsed : (field === "fontSize" ? 10.72 : (field === "x" ? 202.40 : 340.48));
          } else if (field === "page") {
            val = (val === "all") ? "all" : (parseInt(val, 10) || 1);
          }

          this.safeMutate(() => {
            this.model.updateNote(id, { [field]: val });
          });
        });

        notesTable.addEventListener("change", (e) => {
          const tr = e.target.closest("tr");
          if (!tr) return;
          const id = tr.dataset.noteId;
          const field = e.target.dataset.noteField;
          if (!field) return;

          let val = e.target.value;
          if (field === "x" || field === "y" || field === "fontSize") {
            const parsed = parseFloat(val);
            val = Number.isFinite(parsed) ? parsed : (field === "fontSize" ? 10.72 : (field === "x" ? 202.40 : 340.48));
          } else if (field === "page") {
            val = (val === "all") ? "all" : (parseInt(val, 10) || 1);
          }

          this.safeMutate(() => {
            this.model.updateNote(id, { [field]: val });
          });
        });

        notesTable.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const tr = btn.closest("tr");
          if (!tr) return;
          const id = tr.dataset.noteId;
          const act = btn.dataset.action;

          if (act === "del-note") {
            this.model.deleteNote(id);
          }
        });
      }
    }

    // 基本設定タブ
    if (this.activeTab === "tab-settings") {
      const metaTitle = this.container.querySelector("#inputMetaTitle");
      if (metaTitle) {
        metaTitle.addEventListener("input", (e) => {
          this.safeMutate(() => {
            this.model.updateMetadata({ title: e.target.value });
          });
        });
      }

      const metaCopy = this.container.querySelector("#inputMetaCopyright");
      if (metaCopy) {
        metaCopy.addEventListener("input", (e) => {
          this.safeMutate(() => {
            this.model.updateMetadata({ copyright: e.target.value });
          });
        });
      }

      const selectPageSize = this.container.querySelector("#selectPageSize");
      if (selectPageSize) {
        selectPageSize.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ pageSize: e.target.value });
          });
        });
      }

      const selectOrientation = this.container.querySelector("#selectOrientation");
      if (selectOrientation) {
        selectOrientation.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ orientation: e.target.value });
          });
        });
      }

      const radioBreakModes = this.container.querySelectorAll("input[name='setPageBreakMode']");
      radioBreakModes.forEach(r => {
        r.addEventListener("change", (e) => {
          if (e.target.checked) {
            this.safeMutate(() => {
              this.model.updateSettings({ pageBreakMode: e.target.value });
            });
          }
        });
      });

      const selectStationHeaderDirection = this.container.querySelector("#selectStationHeaderDirection");
      if (selectStationHeaderDirection) {
        selectStationHeaderDirection.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ stationHeaderDirection: e.target.value });
          });
        });
      }

      const selectSubHeader = this.container.querySelector("#selectSubHeaderMode");
      if (selectSubHeader) {
        selectSubHeader.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ subHeaderMode: e.target.value });
          });
        });
      }

      const selectSelfHighlight = this.container.querySelector("#selectSelfHighlightStyle");
      if (selectSelfHighlight) {
        selectSelfHighlight.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ selfHighlightStyle: e.target.value });
          });
        });
      }

      const selectPartialStep = this.container.querySelector("#selectPartialConnectStepRows");
      if (selectPartialStep) {
        selectPartialStep.addEventListener("change", (e) => {
          const parsed = parseInt(e.target.value, 10);
          this.safeMutate(() => {
            this.model.updateSettings({ partialConnectStepRows: Number.isNaN(parsed) ? 1 : Math.max(0, parsed) });
          });
        });
      }

      const inputRowHeight = this.container.querySelector("#inputBaseRowHeight");
      if (inputRowHeight) {
        inputRowHeight.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ baseRowHeight: parseFloat(e.target.value) || 12.96 });
          });
        });
      }

      const inputStepRows = this.container.querySelector("#inputRosterStepRows");
      if (inputStepRows) {
        inputStepRows.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ rosterStepRows: parseInt(e.target.value, 10) || 2 });
          });
        });
      }

      const inputBlockPadding = this.container.querySelector("#inputBlockPaddingRows");
      if (inputBlockPadding) {
        inputBlockPadding.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ blockPaddingRows: parseFloat(e.target.value) || 2 });
          });
        });
      }

      const btnResetSettings = this.container.querySelector("#btnResetSettingsToDefaults");
      if (btnResetSettings) {
        btnResetSettings.addEventListener("click", () => {
          this.model.updateSettings({
            baseRowHeight: 12.96,
            rosterStepRows: 2,
            partialConnectStepRows: 1,
            blockPaddingRows: 2,
            stationHeaderDirection: "vertical",
            subHeaderMode: "omitFirst",
            selfHighlightStyle: "red",
            autoSyncCoupled: true
          });
          this.render();
        });
      }
    }

    // 生JSONタブ
    if (this.activeTab === "tab-raw-json") {
      const checkEnable = this.container.querySelector("#checkEnableRawEdit");
      const textarea = this.container.querySelector("#rawJsonTextarea");
      const btnApply = this.container.querySelector("#btnApplyRawJson");
      const btnCopy = this.container.querySelector("#btnCopyJson");
      const errorBox = this.container.querySelector("#rawJsonErrorBox");

      if (checkEnable && textarea && btnApply) {
        checkEnable.addEventListener("change", (e) => {
          textarea.readOnly = !e.target.checked;
          btnApply.disabled = !e.target.checked;
          if (e.target.checked) {
            textarea.focus();
          }
        });

        btnApply.addEventListener("click", () => {
          try {
            const parsed = JSON.parse(textarea.value);
            const val = this.model.validateSchema(parsed);
            if (!val.valid) {
              errorBox.textContent = `スキーマ検証エラー:\n${val.errors.join("\n")}`;
              errorBox.style.display = "block";
              return;
            }
            errorBox.style.display = "none";
            this.model.load(parsed);
            alert("生JSONデータを適用しました。");
          } catch (err) {
            errorBox.textContent = `JSON構文エラー: ${err.message}`;
            errorBox.style.display = "block";
          }
        });
      }

      if (btnCopy && textarea) {
        btnCopy.addEventListener("click", () => {
          navigator.clipboard.writeText(textarea.value).then(() => {
            btnCopy.textContent = "コピー完了 ✓";
            setTimeout(() => { btnCopy.textContent = "📋 コピー"; }, 1500);
          });
        });
      }
    }
  }

  // カラーパレット適用
  applyPalettePreset(presetName) {
    if (!this.model.data || !this.model.data.trainTypes) return;

    if (presetName === "standard") {
      this.model.data.trainTypes = JSON.parse(JSON.stringify(DEFAULT_TRAIN_TYPES));
    } else if (presetName === "jr_east") {
      this.model.data.trainTypes = [
        { id: "local", name: "普通", lineColor: "#80C342", timeColor: "#000000", textColor: "#000000", lineWidth: 1.28, lineStyle: "solid" },
        { id: "rapid", name: "快速", lineColor: "#F68B1F", timeColor: "#F68B1F", textColor: "#F68B1F", lineWidth: 1.28, lineStyle: "solid" },
        { id: "limited", name: "特急", lineColor: "#E60012", timeColor: "#E60012", textColor: "#E60012", lineWidth: 1.92, lineStyle: "solid" },
        { id: "deadhead", name: "回送", lineColor: "#888888", timeColor: "#888888", textColor: "#888888", lineWidth: 1.28, lineStyle: "dashed" }
      ];
    } else if (presetName === "monochrome") {
      this.model.data.trainTypes = [
        { id: "local", name: "普通", lineColor: "#000000", timeColor: "#000000", textColor: "#000000", lineWidth: 1.28, lineStyle: "solid" },
        { id: "sl", name: "SL", lineColor: "#000000", timeColor: "#000000", textColor: "#000000", lineWidth: 2.20, lineStyle: "solid" },
        { id: "deadhead", name: "回送", lineColor: "#000000", timeColor: "#000000", textColor: "#000000", lineWidth: 1.28, lineStyle: "dashed" }
      ];
    }
    this.model.notifyChange("trainTypes-reset");
    this.render();
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
}

// グローバルインスタンス
window.BoxDiagramTableEditor = BoxDiagramTableEditor;
