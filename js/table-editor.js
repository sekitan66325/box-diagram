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
    this._animateNextBody = false;
    this.lastSyncMessage = "";

    // 選択・クリップボード・移動ポケット・D&D状態
    this.selectedTrainIndices = new Set();
    this.lastTrainSelectAnchor = null;
    this.selectedRosterIds = new Set();
    this.lastRosterSelectAnchor = null;
    this.clipboard = null;
    this.pocketOpen = false;
    this.pocketMinimized = false;
    this.pocketDragMode = "cut";
    this.pocketPos = null;
    this.pocketItems = [];
    this._uidSeq = 1;
    this._flashTarget = null;
    this._activeDrag = null;
    this._dragGhostEl = null;
    this._lastRenderTab = null;
    this._lastRenderRosterId = null;
    this.floatingPocketEl = null;

    // UIアニメーション発火用の状態遷移フラグ
    this._prevSelectedTrainCount = 0;
    this._prevSelectedRosterCount = 0;
    this._wasPocketOpen = false;
    this._animateNextPocketOpen = false;
    this._newPocketUids = new Set();
    this._justArmedClip = false;
    this.expandedRosterIds = new Set();
    this.showTrainDistanceCol = false;

    this._bindGlobalShortcuts();

    // リスナー登録
    this.model.subscribe((data, actionType, meta) => {
      if (actionType === "load") {
        this.selectedTrainIndices.clear();
        this.lastTrainSelectAnchor = null;
        this.selectedRosterIds.clear();
        this.lastRosterSelectAnchor = null;
        this.expandedRosterIds.clear();
        this.clipboard = null;
        this.pocketItems = [];
      }

      if (actionType === "rosters-update" && meta && meta.oldId && meta.newId && meta.oldId !== meta.newId) {
        if (this.activeRosterId === meta.oldId) {
          this.activeRosterId = meta.newId;
        }
        if (this.expandedRosterIds.has(meta.oldId)) {
          this.expandedRosterIds.delete(meta.oldId);
          this.expandedRosterIds.add(meta.newId);
        }
        if (this.selectedRosterIds.has(meta.oldId)) {
          this.selectedRosterIds.delete(meta.oldId);
          this.selectedRosterIds.add(meta.newId);
        }
        if (this.clipboard) {
          if (this.clipboard.kind === "trains" && this.clipboard.sourceRosterId === meta.oldId) {
            this.clipboard.sourceRosterId = meta.newId;
          } else if (this.clipboard.kind === "rosters" && Array.isArray(this.clipboard.sourceRosterIds)) {
            this.clipboard.sourceRosterIds = this.clipboard.sourceRosterIds.map(id => id === meta.oldId ? meta.newId : id);
          }
        }
        this.pocketItems.forEach(item => {
          if (item.sourceRosterId === meta.oldId) {
            item.sourceRosterId = meta.newId;
          }
        });
      }

      // 自身がトリガーした値更新中は再描画しない（フォーカス・ポップアップ維持）
      if (this.isInternalInput) {
        return;
      }

      // 構造的アクションの場合は全体再描画
      const structuralActions = [
        "load", "history",
        "stations-add", "stations-del", "stations-move", "stations-reset",
        "trainTypes-add", "trainTypes-del", "trainTypes-reset",
        "rosters-add", "rosters-del", "rosters-move", "rosters-dup", "rosters-update", "rosters-transfer",
        "trains-add", "trains-del", "trains-move", "trains-dup", "trains-sync", "trains-transfer",
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
        <span>途中駅で継走分割</span>
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
      if (key === "bold" || key === "italic") {
        const sBtn = rowEl.querySelector(`[data-note-style="${key}"]`);
        if (sBtn) {
          sBtn.classList.toggle("active", !!val);
          sBtn.setAttribute("aria-pressed", String(!!val));
        }
      }
    }
  }

  _track(eventName, params = {}) {
    if (window.BoxAnalytics && typeof window.BoxAnalytics.track === "function") {
      window.BoxAnalytics.track(eventName, params);
    }
  }

  _setCtx(ctx) {
    if (window.BoxAnalytics && typeof window.BoxAnalytics.setNextActionContext === "function") {
      window.BoxAnalytics.setNextActionContext(ctx);
    }
  }

  setActiveTab(tabId, fromUser = false) {
    if (this.activeTab !== tabId) {
      this._animateNextBody = true;
      if (fromUser) {
        this._track("editor_tab_switched", { tab_id: tabId });
      }
    }
    this.activeTab = tabId;
    this.lastSyncMessage = "";
    this.render();
  }

  setActiveRoster(rosterId, fromUser = false) {
    if (this.activeRosterId !== rosterId) {
      this._animateNextBody = true;
      this.selectedTrainIndices.clear();
      this.lastTrainSelectAnchor = null;
      if (fromUser) {
        const rosters = this.model.getRosters ? this.model.getRosters() : [];
        this._track("active_roster_switched", { rosters_total: rosters.length });
      }
    }
    this.activeRosterId = rosterId;
    this.lastSyncMessage = "";
    this.render();
  }

  _captureFocusSelector() {
    const active = document.activeElement;
    if (!active || !this.container.contains(active)) return null;
    const esc = (s) => (window.CSS && typeof window.CSS.escape === "function") ? window.CSS.escape(String(s)) : String(s).replace(/["\\]/g, "\\$&");
    if (active.id) return `#${esc(active.id)}`;
    if (active.dataset.field) {
      const tr = active.closest("tr[data-train-idx]");
      if (tr) return `#trainsGridTable tr[data-train-idx="${esc(tr.dataset.trainIdx)}"] [data-field="${esc(active.dataset.field)}"]`;
    }
    if (active.dataset.rosterField) {
      const tr = active.closest("tr[data-roster-id]");
      if (tr) return `#rostersGridTable tr[data-roster-id="${esc(tr.dataset.rosterId)}"] [data-roster-field="${esc(active.dataset.rosterField)}"]`;
    }
    if (active.dataset.stationField) {
      const tr = active.closest("tr[data-station-id]");
      if (tr) return `#stationsGridTable tr[data-station-id="${esc(tr.dataset.stationId)}"] [data-station-field="${esc(active.dataset.stationField)}"]`;
    }
    if (active.dataset.noteField) {
      const tr = active.closest("tr[data-note-id]");
      if (tr) return `#notesGridTable tr[data-note-id="${esc(tr.dataset.noteId)}"] [data-note-field="${esc(active.dataset.noteField)}"]`;
    }
    if (active.dataset.typeField) {
      const tr = active.closest("tr[data-type-id]");
      if (tr) return `#typesGridTable tr[data-type-id="${esc(tr.dataset.typeId)}"] [data-type-field="${esc(active.dataset.typeField)}"]`;
    }
    return null;
  }

  render() {
    this.closeFloatingPopover();
    const data = this.model.getData();
    if (!data) return;

    const scrollSelector = ".table-scroll-container, .form-settings-container, .json-textarea, .raw-json-container";
    const keepScroll = this._lastRenderTab === this.activeTab && this._lastRenderRosterId === this.activeRosterId;
    const prevScrollEl = this.container.querySelector(scrollSelector);
    const prevBodyEl = this.container.querySelector(".editor-body");
    const prevPaneEl = this.container.closest(".editor-pane");
    const prevScrollTop = (keepScroll && prevScrollEl) ? prevScrollEl.scrollTop : 0;
    const prevScrollLeft = (keepScroll && prevScrollEl) ? prevScrollEl.scrollLeft : 0;
    const prevBodyTop = (keepScroll && prevBodyEl) ? prevBodyEl.scrollTop : 0;
    const prevBodyLeft = (keepScroll && prevBodyEl) ? prevBodyEl.scrollLeft : 0;
    const prevContainerTop = keepScroll ? this.container.scrollTop : 0;
    const prevContainerLeft = keepScroll ? this.container.scrollLeft : 0;
    const prevPaneTop = (keepScroll && prevPaneEl) ? prevPaneEl.scrollTop : 0;
    const prevPaneLeft = (keepScroll && prevPaneEl) ? prevPaneEl.scrollLeft : 0;
    const prevWinX = window.scrollX || 0;
    const prevWinY = window.scrollY || 0;
    const focusSelector = keepScroll ? this._captureFocusSelector() : null;

    const animateClass = this._animateNextBody ? "anim-panel-enter" : "";
    this._animateNextBody = false;

    // アクティブ運用の確認
    const rosters = data.rosters || [];
    if (!this.activeRosterId && rosters.length > 0) {
      this.activeRosterId = rosters[0].id;
    } else if (this.activeRosterId && !rosters.some(r => r.id === this.activeRosterId)) {
      this.activeRosterId = rosters.length > 0 ? rosters[0].id : null;
    }

    this._sanitizeSelections(data);

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

      <div class="editor-body ${animateClass}">
        ${this.renderActiveTabContent(data)}
      </div>

      ${this.renderClipboardBarHtml(data)}
    `;

    this._lastRenderTab = this.activeTab;
    this._lastRenderRosterId = this.activeRosterId;

    this.bindEvents();

    const newScrollEl = this.container.querySelector(scrollSelector);
    const newBodyEl = this.container.querySelector(".editor-body");
    const restoreScrollPositions = () => {
      if (!keepScroll) return;
      if (newScrollEl) {
        newScrollEl.scrollTop = prevScrollTop;
        newScrollEl.scrollLeft = prevScrollLeft;
      }
      if (newBodyEl) {
        newBodyEl.scrollTop = prevBodyTop;
        newBodyEl.scrollLeft = prevBodyLeft;
      }
      this.container.scrollTop = prevContainerTop;
      this.container.scrollLeft = prevContainerLeft;
      if (prevPaneEl) {
        prevPaneEl.scrollTop = prevPaneTop;
        prevPaneEl.scrollLeft = prevPaneLeft;
      }
      if ((window.scrollX || 0) !== prevWinX || (window.scrollY || 0) !== prevWinY) {
        window.scrollTo(prevWinX, prevWinY);
      }
    };
    restoreScrollPositions();
    if (focusSelector && !this._flashTarget) {
      try {
        const refocusEl = this.container.querySelector(focusSelector);
        if (refocusEl && !refocusEl.disabled && typeof refocusEl.focus === "function") {
          refocusEl.focus({ preventScroll: true });
          restoreScrollPositions();
        }
      } catch (_) { /* ignore invalid selector */ }
    }

    this._syncSelectAllStates();
    this._applyPendingFlash(newScrollEl);
    this.renderFloatingPocket();

    this._justArmedClip = false;
    this._prevSelectedTrainCount = this.selectedTrainIndices.size;
    this._prevSelectedRosterCount = this.selectedRosterIds.size;
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

        <div class="action-buttons" style="flex-wrap: wrap; gap: 4px;">
          <button id="btnAddTrain" class="btn btn-sm btn-primary">＋ 列車追加</button>
          <button id="btnAddConnectingTrain" class="btn btn-sm btn-secondary" title="前列車から接続追加（途中駅なら列車番号・種別引継＋標準${partialStep}行、終端駅なら折り返し）">
            ＋ 継走列車追加
          </button>
          ${this.clipboard ? `
            <button type="button" id="btnPasteTrainsToolbar" class="btn btn-sm btn-secondary btn-icon-clip-paste" title="保持中の項目（${this.escapeXml(this.clipboard.summaryText)}）をこの運用に貼り付け">
              ${this._uiIcon("paste")} 貼付${this.clipboard.items.length > 1 ? ` (${this.clipboard.items.length})` : ''}
            </button>
          ` : ''}
        </div>

        <div class="sync-toolbar-group">
          <label class="toggle-switch toggle-switch-sm" title="ONのとき、併結列車の列車番号・種別・発着駅・時刻・連結順序を変更すると相手運用にも即時反映します">
            <input type="checkbox" class="toggle-input toggle-sm" id="checkAutoSyncCoupled" ${autoSync ? 'checked' : ''} />
            <span>併結自動同期</span>
          </label>
          <button id="btnSyncCoupledAll" class="btn btn-sm btn-secondary" title="この運用の併結列車の着発情報・位置順序を相手運用へ一括反映（相手側の不足行も生成）">
            相手へ一括同期
          </button>
          <label class="toggle-switch toggle-switch-sm" title="各列車ごとの手動走行距離(km)入力列を表示・編集">
            <input type="checkbox" class="toggle-input toggle-sm" id="checkShowTrainDistanceCol" ${this.showTrainDistanceCol ? 'checked' : ''} />
            <span>距離(km)</span>
          </label>
          ${this.lastSyncMessage ? `<span id="syncStatusBadge" class="sync-status-badge">${this.escapeXml(this.lastSyncMessage)}</span>` : ''}
        </div>
      </div>

      ${this.selectedTrainIndices.size > 0 ? `
        <div class="selection-action-bar ${this._prevSelectedTrainCount === 0 ? 'anim-enter' : ''}" id="trainsSelectionBar">
          <span class="selection-count-badge">
            <span class="ui-dot-primary" aria-hidden="true"></span>
            ${this.selectedTrainIndices.size}本の列車を選択中
          </span>
          <div class="selection-actions-btns">
            <button type="button" class="btn btn-xs btn-secondary" data-sel-act="copy">${this._uiIcon("copy")} コピー</button>
            <button type="button" class="btn btn-xs btn-secondary" data-sel-act="cut">${this._uiIcon("cut")} 切り取り</button>
            <button type="button" class="btn btn-xs btn-secondary" data-sel-act="pocket-cut" title="元運用から外して移動ポケットへ一時退避">${this._uiIcon("pocket")} ポケットへ移動</button>
            <button type="button" class="btn btn-xs btn-secondary" data-sel-act="pocket-copy" title="元のまま残して移動ポケットへコピー">${this._uiIcon("pocket")} ポケット(複製)</button>
            <button type="button" class="btn btn-xs btn-primary" id="btnSendSelectedToRoster">別運用へ送る</button>
            <button type="button" class="btn btn-xs btn-secondary text-danger" data-sel-act="delete">削除</button>
            <button type="button" class="btn btn-xs btn-secondary" data-sel-act="clear">解除</button>
          </div>
        </div>
      ` : ''}

      <div class="table-scroll-container">
        <table class="grid-table" id="trainsGridTable">
          <thead>
            <tr>
              <th style="width: ${this.showTrainDistanceCol ? '24px' : '26px'};" title="左端のドットをドラッグして行順を入替">#</th>
              <th style="width: 24px;">
                <label class="th-select-stack" title="この運用の全列車を選択 / 解除">
                  <span class="th-select-text">選択</span>
                  <input type="checkbox" id="selectAllTrainsCheck" class="row-select-check" aria-label="全列車を選択" />
                </label>
              </th>
              <th style="width: ${this.showTrainDistanceCol ? '36px' : '42px'};">列番</th>
              <th style="width: ${this.showTrainDistanceCol ? '36px' : '40px'};">種別</th>
              <th style="width: 34px;">発駅</th>
              <th style="width: ${this.showTrainDistanceCol ? '34px' : '35px'};">発時刻</th>
              <th style="width: 34px;">着駅</th>
              <th style="width: ${this.showTrainDistanceCol ? '34px' : '35px'};">着時刻</th>
              <th style="width: ${this.showTrainDistanceCol ? '82px' : '98px'};">併結 (相手/位置)</th>
              <th style="width: ${this.showTrainDistanceCol ? '25px' : '26px'};">発記</th>
              <th style="width: ${this.showTrainDistanceCol ? '25px' : '26px'};">着記</th>
              ${this.showTrainDistanceCol ? `<th style="width: 40px;" title="駅キロ程差分以外の個別距離を手入力で上書き">距離km</th>` : ''}
              <th style="width: ${this.showTrainDistanceCol ? '23px' : '24px'};" title="段下げ行数 (0行〜、標準2行)">行</th>
              <th style="width: 162px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${trains.map((tr, idx) => this.renderTrainRow(tr, idx, currentRoster, rosters, stations, trainTypes, idx > 0 ? trains[idx - 1] : null)).join("")}
          </tbody>
        </table>
        ${trains.length === 0 ? `
          <div class="empty-trains-guide">
            <p>この運用（${this.escapeXml(currentRoster.name || currentRoster.id)}）にはまだ列車が登録されていません。</p>
            <div class="empty-trains-actions">
              <button type="button" id="btnAddFirstTrainInline" class="btn btn-sm btn-primary">＋ 1本目の列車を追加</button>
              ${this.clipboard ? `
                <button type="button" id="btnPasteTrainsEmpty" class="btn btn-sm btn-secondary btn-icon-clip-paste">
                  ${this._uiIcon("paste")} 保持中の列車（${this.escapeXml(this.clipboard.summaryText)}）を貼付
                </button>
              ` : ''}
              ${this.pocketItems.length > 0 ? `
                <button type="button" id="btnOpenPocketEmpty" class="btn btn-sm btn-secondary">
                  ${this._uiIcon("pocket")} 移動ポケット (${this.pocketItems.length}件) から貼付
                </button>
              ` : ''}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="table-footer-info">
        <span>全 ${trains.length} 本</span>
        <span class="text-muted" style="margin-left: 10px;">※ 左端のドットをドラッグして並替／「選択」列で複数選択（Shift範囲選択対応）して他運用へコピー・移動できます。</span>
      </div>
    `;
  }

  renderTrainRow(train, index, roster, allRosters, stations, trainTypes, prevTrain) {
    const valResult = this.model.validateTrain(train, prevTrain);
    const hasError = !valResult.valid;
    const hasWarning = valResult.warnings.length > 0;
    const isSelected = this.selectedTrainIndices.has(index);
    const isClipSource = !!(
      this.clipboard &&
      this.clipboard.kind === "trains" &&
      this.clipboard.sourceRosterId === roster.id &&
      Array.isArray(this.clipboard.sourceRefs) &&
      this.clipboard.sourceRefs.includes(train)
    );
    const clipClass = isClipSource ? (this.clipboard.mode === "cut" ? "row-clip-cut" : "row-clip-copy") : "";
    const rowClasses = [
      hasError ? "row-error" : (hasWarning ? "row-warning" : ""),
      isSelected ? "row-selected" : "",
      clipClass
    ].filter(Boolean).join(" ");
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
          <input type="text" class="cell-input cell-input-sm" data-field="customCoupled" value="${this.escapeXml(train.customCoupled)}" placeholder="自由記述" style="flex: 1; min-width: 0;" />
          <button class="btn-icon-xs" data-action="toggle-custom-coupled" title="自動併結（選択式）に戻す">✕</button>
        ` : (isMultiCar ? `
          <button type="button" class="coupled-multi-badge" data-action="open-formation-popover" title="編成順序・連結位置を変更: (${this.escapeXml(formation.join('＋'))})">
            ${this.escapeXml(formation.join("＋"))}
          </button>
          <button type="button" class="btn-icon-xs" data-action="open-formation-popover" title="3両以上・詳細な編成順を設定">編</button>
          <button type="button" class="btn-icon-xs" data-action="toggle-custom-coupled" title="自由記述を入力">文</button>
        ` : `
          <select class="cell-select cell-select-sm" data-field="coupledPartner" style="flex: 1; min-width: 0;">
            ${partnerOptions}
          </select>
          <select class="cell-select cell-select-sm coupled-pos-select" data-field="coupledPosition" title="自運用の連結位置" ${!train.coupledPartner ? 'disabled' : ''}>
            <option value="after" ${coupledPos === 'after' ? 'selected' : ''}>後(自+相)</option>
            <option value="before" ${coupledPos === 'before' ? 'selected' : ''}>前(相+自)</option>
          </select>
          <button type="button" class="btn-icon-xs" data-action="open-formation-popover" title="3両以上・詳細な編成順を設定">編</button>
          <button type="button" class="btn-icon-xs" data-action="toggle-custom-coupled" title="自由記述を入力">文</button>
        `)}
      </div>
    `;

    return `
      <tr class="${rowClasses}" title="${this.escapeXml(titleAttr)}" data-train-idx="${index}">
        <td class="row-order-col">
          <div class="row-order-wrap">
            <span class="row-drag-handle" data-drag-kind="train" title="ドラッグして上下入替／ポケットへ移動" aria-label="${index + 1}行目をドラッグして並べ替え">${this._uiIcon("grip", 10)}</span>
            <span class="row-index-num font-mono">${index + 1}</span>
          </div>
        </td>
        <td class="row-select-col">
          <label class="row-select-hit" title="${index + 1}行目を選択（Shiftキーで範囲選択）">
            <input type="checkbox" class="row-select-check" data-select-train="${index}" ${isSelected ? 'checked' : ''} aria-label="${index + 1}行目を選択" />
          </label>
        </td>
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
        ${this.showTrainDistanceCol ? `
          <td>
            <input type="number" class="cell-input text-right font-mono" data-field="distanceKm" value="${typeof train.distanceKm === 'number' ? train.distanceKm : ''}" min="0" step="0.1" placeholder="${(() => {
              const sm = new Map((stations || []).map(s => [s.id, s]));
              const d = BoxDiagramDataModel.calculateTrainDistanceKm ? BoxDiagramDataModel.calculateTrainDistanceKm({ fromStation: train.fromStation, toStation: train.toStation }, sm) : null;
              return d !== null ? d.toFixed(1) : '-';
            })()}" />
          </td>
        ` : ''}
        <td>
          <input type="number" class="cell-input text-center font-mono" data-field="stepRows" value="${typeof train.stepRows === 'number' ? train.stepRows : 2}" min="0" max="10" />
        </td>
        <td class="action-cell">
          <div class="action-btns-row">
            <button type="button" class="btn-icon btn-icon-label" data-action="split-train" title="途中駅で継走分割（部分継走）">分割</button>
            <button type="button" class="btn-icon btn-icon-label btn-icon-clip-copy" data-action="copy-train" title="この列車をコピー（別運用へ貼付可）">コピー</button>
            <button type="button" class="btn-icon btn-icon-label btn-icon-clip-cut" data-action="cut-train" title="この列車を切り取り（別運用へ移動）">切取</button>
            <button type="button" class="btn-icon btn-icon-label" data-action="dup-train" title="複製">複製</button>
            <button type="button" class="btn-icon" data-action="up-train" title="上へ移動" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button type="button" class="btn-icon" data-action="down-train" title="下へ移動">↓</button>
            <button type="button" class="btn-icon text-danger" data-action="del-train" title="削除">✕</button>
          </div>
        </td>
      </tr>
    `;
  }

  // ==================== 2. 運用一覧 (Rosters Tab) ====================
  renderRostersTab(data) {
    const rosters = data.rosters || [];
    const clipRosterIds = (this.clipboard && this.clipboard.kind === "rosters" && Array.isArray(this.clipboard.sourceRosterIds))
      ? new Set(this.clipboard.sourceRosterIds)
      : null;

    return `
      <div class="tab-toolbar" style="flex-wrap: wrap; gap: 6px;">
        <span class="section-title-sm">運用管理 (全 ${rosters.length} 件)</span>
        <div class="action-buttons" style="flex-wrap: wrap; gap: 4px;">
          <button type="button" id="btnToggleAllRosterDetails" class="btn btn-sm btn-secondary" title="全運用の出区・入区上書き・距離・個別縦倍率を一括で開く/閉じる">
            ${this.expandedRosterIds.size > 0 ? '詳細を閉じる' : '詳細を開く'}
          </button>
          ${this.clipboard ? `
            <button type="button" id="btnPasteRostersToolbar" class="btn btn-sm btn-secondary btn-icon-clip-paste" title="保持中の項目（${this.escapeXml(this.clipboard.summaryText)}）を運用一覧へ貼り付け">
              ${this._uiIcon("paste")} ${this.clipboard.kind === "rosters" ? "運用を貼付" : "列車を新規運用として貼付"}
            </button>
          ` : ''}
          <button id="btnAddRoster" class="btn btn-sm btn-primary">＋ 新規運用追加</button>
        </div>
      </div>

      ${this.selectedRosterIds.size > 0 ? `
        <div class="selection-action-bar ${this._prevSelectedRosterCount === 0 ? 'anim-enter' : ''}" id="rostersSelectionBar">
          <span class="selection-count-badge">
            <span class="ui-dot-primary" aria-hidden="true"></span>
            ${this.selectedRosterIds.size}件の運用を選択中
          </span>
          <div class="selection-actions-btns">
            <button type="button" class="btn btn-xs btn-secondary" data-roster-sel-act="copy">${this._uiIcon("copy")} コピー</button>
            <button type="button" class="btn btn-xs btn-secondary" data-roster-sel-act="cut">${this._uiIcon("cut")} 切り取り</button>
            <button type="button" class="btn btn-xs btn-secondary" data-roster-sel-act="pocket-cut">${this._uiIcon("pocket")} ポケットへ移動</button>
            <button type="button" class="btn btn-xs btn-secondary" data-roster-sel-act="pocket-copy">${this._uiIcon("pocket")} ポケット(複製)</button>
            <button type="button" class="btn btn-xs btn-secondary text-danger" data-roster-sel-act="delete">削除</button>
            <button type="button" class="btn btn-xs btn-secondary" data-roster-sel-act="clear">解除</button>
          </div>
        </div>
      ` : ''}

      <div class="table-scroll-container">
        <table class="grid-table" id="rostersGridTable">
          <thead>
            <tr>
              <th style="width: 28px;" title="左端のドットをドラッグして運用順を入替">#</th>
              <th style="width: 26px;">
                <label class="th-select-stack" title="全運用を選択 / 解除">
                  <span class="th-select-text">選択</span>
                  <input type="checkbox" id="selectAllRostersCheck" class="row-select-check" aria-label="全運用を選択" />
                </label>
              </th>
              <th style="width: 82px;">運用番号 (ID)</th>
              <th style="width: 138px;">表示用運用番号</th>
              <th style="width: 44px;">本数</th>
              <th style="width: 66px;" title="手動改ページモード時にこの運用の直後でページを区切る">改ページ</th>
              <th style="width: 220px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${rosters.map((r, idx) => {
              const isSelected = this.selectedRosterIds.has(r.id);
              const isExpanded = this.expandedRosterIds.has(r.id);
              const isClipSrc = clipRosterIds ? clipRosterIds.has(r.id) : false;
              const clipClass = isClipSrc ? (this.clipboard.mode === "cut" ? "row-clip-cut" : "row-clip-copy") : "";
              const trClass = [isSelected ? "row-selected" : "", clipClass].filter(Boolean).join(" ");
              const pasteTitle = this.clipboard
                ? (this.clipboard.kind === "trains" ? "保持中の列車をこの運用へ貼り付け" : "保持中の運用をこの直後へ貼り付け")
                : "";
              const hasOverride = !!(
                (r.depotOutOverride && r.depotOutOverride.trim()) ||
                (r.depotInOverride && r.depotInOverride.trim()) ||
                (typeof r.manualDistanceKm === "number" && Number.isFinite(r.manualDistanceKm)) ||
                (typeof r.rowScale === "number" && Math.abs(r.rowScale - 1.0) > 0.01)
              );
              let detailRowHtml = "";
              if (isExpanded) {
                const outDisp = BoxDiagramDataModel.resolveRosterDepotDisplay
                  ? BoxDiagramDataModel.resolveRosterDepotDisplay(r, data, "out")
                  : { autoLines: [] };
                const inDisp = BoxDiagramDataModel.resolveRosterDepotDisplay
                  ? BoxDiagramDataModel.resolveRosterDepotDisplay(r, data, "in")
                  : { autoLines: [] };
                const distInfo = BoxDiagramDataModel.calculateRosterDistanceKm
                  ? BoxDiagramDataModel.calculateRosterDistanceKm(r, data)
                  : { autoKm: null };
                const decPlaces = (data.settings && data.settings.distanceDecimalPlaces === 0) ? 0 : 1;
                const autoOutStr = outDisp.autoLines.length > 0 ? outDisp.autoLines.join(" / ") : "なし";
                const autoInStr = inDisp.autoLines.length > 0 ? inDisp.autoLines.join(" / ") : "なし";
                const autoKmStr = distInfo.autoKm !== null
                  ? BoxDiagramDataModel.formatDistanceLabel(distInfo.autoKm, decPlaces)
                  : "駅キロ程未設定";
                const rowScalePct = Math.round((typeof r.rowScale === "number" ? r.rowScale : 1.0) * 100);
                detailRowHtml = `
                  <tr class="roster-detail-row" data-roster-detail-for="${this.escapeXml(r.id)}">
                    <td colspan="7">
                      <div class="roster-detail-panel">
                        <div class="roster-detail-item">
                          <div class="roster-detail-head">
                            <span>出区場所 上書き</span>
                            <span class="roster-detail-preview" title="${this.escapeXml(autoOutStr)}">自動: ${this.escapeXml(autoOutStr)}</span>
                          </div>
                          <div class="roster-detail-input-row">
                            <input type="text" class="cell-input" data-roster-detail-field="depotOutOverride" value="${this.escapeXml(r.depotOutOverride || '')}" placeholder="空欄時は自動抽出値を使用" />
                          </div>
                        </div>
                        <div class="roster-detail-item">
                          <div class="roster-detail-head">
                            <span>入区場所 上書き</span>
                            <span class="roster-detail-preview" title="${this.escapeXml(autoInStr)}">自動: ${this.escapeXml(autoInStr)}</span>
                          </div>
                          <div class="roster-detail-input-row">
                            <input type="text" class="cell-input" data-roster-detail-field="depotInOverride" value="${this.escapeXml(r.depotInOverride || '')}" placeholder="空欄時は自動抽出値を使用" />
                          </div>
                        </div>
                        <div class="roster-detail-item">
                          <div class="roster-detail-head">
                            <span>走行距離 手動指定 (km)</span>
                            <span class="roster-detail-preview">自動計: ${this.escapeXml(autoKmStr)}</span>
                          </div>
                          <div class="roster-detail-input-row">
                            <input type="number" class="cell-input text-right font-mono" data-roster-detail-field="manualDistanceKm" value="${typeof r.manualDistanceKm === 'number' ? r.manualDistanceKm : ''}" min="0" step="0.1" placeholder="${distInfo.autoKm !== null ? distInfo.autoKm.toFixed(decPlaces) : '自動計算'}" />
                          </div>
                        </div>
                        <div class="roster-detail-item">
                          <div class="roster-detail-head">
                            <span>個別 縦倍率 (%)</span>
                            <span class="roster-detail-preview">50%〜200% (標準100%)</span>
                          </div>
                          <div class="roster-detail-input-row">
                            <input type="number" class="cell-input text-right font-mono" data-roster-detail-field="rowScale" value="${rowScalePct}" min="50" max="200" step="5" />
                            <button type="button" class="btn btn-xs btn-secondary" data-action="reset-roster-rowscale" title="100%へ戻す">100%</button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                `;
              }
              return `
              <tr class="${trClass}" data-roster-id="${this.escapeXml(r.id)}">
                <td class="row-order-col">
                  <div class="row-order-wrap">
                    <span class="row-drag-handle" data-drag-kind="roster" title="ドラッグして運用の並び順を変更／ポケットへ移動" aria-label="運用 ${this.escapeXml(r.id)} をドラッグして並べ替え">${this._uiIcon("grip", 10)}</span>
                    <span class="row-index-num font-mono">${idx + 1}</span>
                  </div>
                </td>
                <td class="row-select-col">
                  <label class="row-select-hit" title="運用 ${this.escapeXml(r.id)} を選択（Shiftキーで範囲選択）">
                    <input type="checkbox" class="row-select-check" data-select-roster="${this.escapeXml(r.id)}" ${isSelected ? 'checked' : ''} aria-label="運用 ${this.escapeXml(r.id)} を選択" />
                  </label>
                </td>
                <td>
                  <input type="text" class="cell-input font-bold" data-roster-field="id" value="${this.escapeXml(r.id)}" />
                </td>
                <td>
                  <div class="roster-name-cell">
                    <input type="text" class="cell-input" data-roster-field="name" value="${this.escapeXml(r.name || r.id)}" placeholder="${this.escapeXml(r.id)}" style="flex:1;min-width:44px;" />
                    <span class="roster-name-badge ${r.customName ? 'is-manual' : 'is-auto'}">${r.customName ? '手動' : '自動'}</span>
                    ${r.customName ? `<button type="button" class="btn-icon-xs" data-action="reset-roster-name" title="運用番号と同じ自動同期へ戻す">↺</button>` : ''}
                  </div>
                </td>
                <td class="text-center font-mono">
                  ${r.trains ? r.trains.length : 0} 本
                </td>
                <td class="text-center">
                  <label class="toggle-switch toggle-switch-sm">
                    <input type="checkbox" class="toggle-input toggle-sm" data-roster-field="pageBreakAfter" ${r.pageBreakAfter ? 'checked' : ''} />
                    <span>改ページ</span>
                  </label>
                </td>
                <td class="action-cell">
                  <div class="action-btns-row">
                    <button type="button" class="btn btn-xs btn-secondary" data-action="edit-roster-trains">列車編集</button>
                    <button type="button" class="btn-icon btn-icon-label ${isExpanded ? 'active' : ''}" data-action="toggle-roster-detail" aria-expanded="${isExpanded ? 'true' : 'false'}" title="出区・入区上書き、走行距離、個別縦倍率を編集">${hasOverride ? '詳細*' : '詳細'}</button>
                    <button type="button" class="btn-icon btn-icon-label btn-icon-clip-copy" data-action="copy-roster" title="この運用をコピー">コピー</button>
                    <button type="button" class="btn-icon btn-icon-label btn-icon-clip-cut" data-action="cut-roster" title="この運用を切り取り">切取</button>
                    ${this.clipboard ? `<button type="button" class="btn-icon btn-icon-label btn-icon-clip-paste" data-action="paste-into-roster" title="${pasteTitle}">貼付</button>` : ''}
                    <button type="button" class="btn-icon btn-icon-label" data-action="dup-roster" title="運用を複製">複製</button>
                    <button type="button" class="btn-icon" data-action="up-roster" title="上へ移動" ${idx === 0 ? 'disabled' : ''}>↑</button>
                    <button type="button" class="btn-icon" data-action="down-roster" title="下へ移動" ${idx === rosters.length - 1 ? 'disabled' : ''}>↓</button>
                    <button type="button" class="btn-icon text-danger" data-action="del-roster" title="運用を削除">✕</button>
                  </div>
                </td>
              </tr>
              ${detailRowHtml}
            `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div id="rosterEditErrorBox" class="editor-inline-alert" style="display:none;"></div>
      <div class="table-footer-info">
        <span>※ 左端ドットをドラッグして順番入替・ポケットへ移動／他運用から列車をコピーしてこの一覧の「貼付」またはポケットドロップで直接流し込めます。</span>
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
            <button id="btnPalettePresets" class="btn btn-sm btn-secondary">配色プリセット ▾</button>
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
              <th style="width: 28px;">順</th>
              <th style="width: 42px;">表示</th>
              <th style="width: 130px;">駅名</th>
              <th style="width: 66px;">略称</th>
              <th style="width: 74px;" title="起点からの累計営業キロ (走行距離の自動計算に使用)">キロ程(km)</th>
              <th style="width: 82px;">X座標 (px)</th>
              <th style="width: 90px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${stations.map((s, idx) => `
              <tr data-station-id="${this.escapeXml(s.id)}" data-station-idx="${idx}">
                <td class="station-drag-cell">
                  <span class="row-drag-handle" data-drag-kind="station" title="上下にドラッグして駅順を入替" aria-label="駅をドラッグして並べ替え">${this._uiIcon("grip", 10)}</span>
                </td>
                <td class="text-center">
                  <input type="checkbox" class="toggle-input toggle-sm" data-station-field="visible" aria-label="駅表示" ${s.visible !== false ? 'checked' : ''} />
                </td>
                <td>
                  <input type="text" class="cell-input font-bold" data-station-field="name" value="${this.escapeXml(s.name)}" />
                </td>
                <td>
                  <input type="text" class="cell-input text-center" data-station-field="abbr" value="${this.escapeXml(s.abbr || '')}" maxlength="2" />
                </td>
                <td>
                  <input type="number" class="cell-input text-right font-mono" data-station-field="km" value="${typeof s.km === 'number' ? s.km : ''}" step="0.1" min="0" placeholder="-" />
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

  renderFontRoleCard(roleKey, label, sampleText, fontId, styleObj, fallbackId = "F1") {
    const st = (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.normalizeFontStyleItem)
      ? BoxDiagramDataModel.normalizeFontStyleItem(styleObj)
      : Object.assign({ bold: false, italic: false, underline: false, sizeScale: 1.0, letterSpacing: 0, tabularNums: false, customFamily: "" }, styleObj || {});
    const resolvedCss = (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.resolveFontCss)
      ? BoxDiagramDataModel.resolveFontCss(fontId, fallbackId, st.customFamily)
      : '"MS PGothic", sans-serif';
    const scalePct = Math.round((st.sizeScale || 1.0) * 100);
    const idMap = {
      header: "selectFontHeader",
      station: "selectFontStation",
      roster: "selectFontRoster",
      trainNo: "selectFontTrainNo",
      time: "selectFontTime"
    };
    const selIdAttr = idMap[roleKey] ? `id="${idMap[roleKey]}" ` : "";
    const sampleStyle = [
      `font-family: ${resolvedCss}`,
      `font-weight: ${st.bold ? "700" : "400"}`,
      `font-style: ${st.italic ? "italic" : "normal"}`,
      `text-decoration: ${st.underline ? "underline" : "none"}`,
      `letter-spacing: ${st.letterSpacing || 0}px`,
      st.tabularNums ? "font-variant-numeric: tabular-nums" : ""
    ].filter(Boolean).join("; ");

    return `
      <div class="font-role-card" data-font-card="${roleKey}">
        <div class="font-role-top">
          <span class="font-role-name">${this.escapeXml(label)}</span>
          <span class="font-role-sample" data-font-sample="${roleKey}" style="${this.escapeXml(sampleStyle)}">${this.escapeXml(sampleText)}</span>
        </div>
        <div class="font-role-controls">
          <select ${selIdAttr}class="form-select font-family-select" data-font-role="${roleKey}" aria-label="${this.escapeXml(label)}のフォント">
            ${this.renderFontPresetOptions(fontId, fallbackId)}
          </select>
          <div class="font-style-toggle-group" role="group" aria-label="${this.escapeXml(label)}の装飾">
            <button type="button" class="btn-style-mini ${st.bold ? 'active' : ''}" data-font-style-toggle="bold" data-font-target="${roleKey}" aria-pressed="${st.bold}" title="太字 (Bold)">B</button>
            <button type="button" class="btn-style-mini is-italic ${st.italic ? 'active' : ''}" data-font-style-toggle="italic" data-font-target="${roleKey}" aria-pressed="${st.italic}" title="斜体 (Italic)">I</button>
            <button type="button" class="btn-style-mini is-underline ${st.underline ? 'active' : ''}" data-font-style-toggle="underline" data-font-target="${roleKey}" aria-pressed="${st.underline}" title="下線 (Underline)">U</button>
            <button type="button" class="btn-style-mini is-tabular ${st.tabularNums ? 'active' : ''}" data-font-style-toggle="tabularNums" data-font-target="${roleKey}" aria-pressed="${st.tabularNums}" title="数字の幅を揃える（等幅数字）">01</button>
          </div>
          <label class="font-metric-field" title="基準サイズに対する拡大率 (65%〜160%)">
            <span>サイズ</span>
            <input type="number" class="form-control font-mono" data-font-scale-role="${roleKey}" value="${scalePct}" min="65" max="160" step="5" />
            <span>%</span>
          </label>
          <label class="font-metric-field" title="文字の間隔 (-1.0〜+3.0 px)">
            <span>字間</span>
            <input type="number" class="form-control font-mono" data-font-spacing-role="${roleKey}" value="${st.letterSpacing || 0}" min="-1" max="3" step="0.2" />
            <span>px</span>
          </label>
        </div>
        <div class="font-custom-family-row" data-font-custom-wrap="${roleKey}" ${fontId === "CUSTOM" ? "" : "hidden"}>
          <input type="text" class="form-control font-custom-input" data-font-custom-role="${roleKey}" value="${this.escapeXml(st.customFamily || "")}" placeholder="任意の書体名を入力（例: Noto Sans JP, Hiragino Sans）" />
        </div>
      </div>
    `;
  }

  renderFontPresetOptions(selectedId, fallback = "F1") {
    const presets = (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.FONT_PRESETS)
      ? BoxDiagramDataModel.FONT_PRESETS
      : { F1: { id: "F1", label: "Ｐゴシック（標準）" }, F2: { id: "F2", label: "明朝（時刻標準）" }, F3: { id: "F3", label: "ゴシック（等幅）" } };
    const norm = (typeof BoxDiagramDataModel !== "undefined" && BoxDiagramDataModel.normalizeFontId)
      ? BoxDiagramDataModel.normalizeFontId(selectedId, fallback)
      : (selectedId || fallback);
    return Object.values(presets).map(p => `
      <option value="${this.escapeXml(p.id)}" ${p.id === norm ? 'selected' : ''}>${this.escapeXml(p.label)}</option>
    `).join("");
  }

  // ==================== 5. 注記 (Notes Tab) ====================
  renderNotesTab(data) {
    const notes = data.notes || [];
    const currentAxisMode = (data.settings && data.settings.xAxisMode === "time") ? "time" : "station";
    const activeModeCount = notes.filter(n => (n.axisMode === "time" ? "time" : "station") === currentAxisMode).length;
    const modeLabel = currentAxisMode === "time" ? "時刻軸" : "駅軸";

    return `
      <div class="tab-toolbar">
        <span class="section-title-sm">図面自由注記 (全 ${notes.length} 件 / ${modeLabel}表示中: ${activeModeCount} 件)</span>
        <button id="btnAddNote" class="btn btn-sm btn-primary">＋ 注記追加</button>
      </div>

      <div class="table-scroll-container">
        <table class="grid-table" id="notesGridTable">
          <thead>
            <tr>
              <th style="width: 68px;">ページ</th>
              <th style="width: 68px;">モード</th>
              <th style="width: 140px;">テキスト内容</th>
              <th style="width: 56px;">X (px)</th>
              <th style="width: 56px;">Y (px)</th>
              <th style="width: 96px;">文字色</th>
              <th style="width: 52px;">サイズ</th>
              <th style="width: 110px;">フォント</th>
              <th style="width: 40px;">操作</th>
            </tr>
          </thead>
          <tbody>
            ${notes.map(n => {
              const noteMode = n.axisMode === "time" ? "time" : "station";
              const isInactive = noteMode !== currentAxisMode;
              return `
              <tr data-note-id="${this.escapeXml(n.id)}" style="${isInactive ? 'opacity: 0.72; background: #f8fafc;' : ''}">
                <td>
                  <select class="cell-select" data-note-field="page">
                    <option value="1" ${(n.page === 1 || !n.page) ? 'selected' : ''}>1ページ</option>
                    <option value="2" ${n.page === 2 ? 'selected' : ''}>2ページ</option>
                    <option value="3" ${n.page === 3 ? 'selected' : ''}>3ページ</option>
                    <option value="all" ${n.page === 'all' ? 'selected' : ''}>全ページ</option>
                  </select>
                </td>
                <td>
                  <select class="cell-select" data-note-field="axisMode" title="この注記を表示する横軸モード">
                    <option value="station" ${noteMode === 'station' ? 'selected' : ''}>駅軸</option>
                    <option value="time" ${noteMode === 'time' ? 'selected' : ''}>時刻軸</option>
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
                <td>
                  <div class="note-font-cell">
                    <select class="cell-select" data-note-field="font" title="この注記ボックス個別のフォント" style="flex:1;min-width:0;">
                      ${this.renderFontPresetOptions(n.font || "F1", "F1")}
                    </select>
                    <button type="button" class="btn-style-mini ${n.bold ? 'active' : ''}" data-note-style="bold" aria-pressed="${!!n.bold}" title="この注記を太字にする">B</button>
                    <button type="button" class="btn-style-mini is-italic ${n.italic ? 'active' : ''}" data-note-style="italic" aria-pressed="${!!n.italic}" title="この注記を斜体にする">I</button>
                  </div>
                </td>
                <td class="action-cell">
                  <button class="btn-icon text-danger" data-action="del-note" title="削除">✕</button>
                </td>
              </tr>
            `;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="table-footer-info">
        <span>※ 注記は「駅軸」「時刻軸」モードごとに分けて保持・描画され、個別のフォントを指定できます。プレビュー上で直接ドラッグ（<strong>Altキー押下で列車線に自動吸着</strong>）して位置調整できます。</span>
      </div>
    `;
  }

  // ==================== 6. 基本設定 (Settings Tab) ====================
  renderSettingsTab(data) {
    const meta = data.metadata || {};
    const set = data.settings || {};
    const pageSpecs = BoxDiagramDataModel.PAGE_SPECS;
    const isSeparatePage = !!set.separatePageSettingsByAxisMode;
    const isManualTimeRange = set.timeAxisRangeMode === "manual";
    const startHour = typeof set.timeAxisStartHour === "number" ? set.timeAxisStartHour : 4;
    const endHour = typeof set.timeAxisEndHour === "number" ? set.timeAxisEndHour : 25;
    const fonts = Object.assign({}, BoxDiagramDataModel.DEFAULT_ELEMENT_FONTS, set.fonts || {});
    const pageNumEnabled = set.pageNumberEnabled !== false;
    const pageNumFormats = BoxDiagramDataModel.PAGE_NUMBER_FORMATS || [];
    const pageNumPositions = BoxDiagramDataModel.PAGE_NUMBER_POSITIONS || [];
    const showHeaderTitle = set.showHeaderTitle !== false;
    const showHeaderCopyright = set.showHeaderCopyright !== false;
    const colHeaderText = typeof set.rosterColHeaderText === "string" ? set.rosterColHeaderText : "運用番号";
    const lineWidthScale = typeof set.lineWidthScale === "number" ? set.lineWidthScale : 1.0;
    const symbolScale = typeof set.symbolScale === "number" ? set.symbolScale : 1.0;
    const showTurnDash = set.showTimeAxisTurnaroundDash !== false;

    return `
      <div class="form-settings-container">
        <div class="settings-group">
          <div class="group-title">ヘッダー・ページ番号設定</div>
          <div class="setting-toggles-grid">
            <label class="setting-toggle-card">
              <span class="setting-toggle-text">タイトルを表示</span>
              <input type="checkbox" class="toggle-input toggle-sm" id="checkShowHeaderTitle" ${showHeaderTitle ? 'checked' : ''} />
            </label>
            <label class="setting-toggle-card">
              <span class="setting-toggle-text">著作権・作成者を表示</span>
              <input type="checkbox" class="toggle-input toggle-sm" id="checkShowHeaderCopyright" ${showHeaderCopyright ? 'checked' : ''} />
            </label>
          </div>
          <div class="form-row-grid" style="margin-top: 8px;">
            <div class="form-col" style="flex: 1.4;">
              <label class="form-label">図面タイトル:</label>
              <input type="text" class="form-control" id="inputMetaTitle" value="${this.escapeXml(meta.title || '')}" ${!showHeaderTitle ? 'disabled' : ''} />
            </div>
            <div class="form-col" style="flex: 0.7;">
              <label class="form-label">左端見出し文字:</label>
              <input type="text" class="form-control" id="inputRosterColHeaderText" value="${this.escapeXml(colHeaderText)}" placeholder="運用番号" maxlength="10" />
            </div>
          </div>
          <div class="form-row" style="margin-top: 6px;">
            <label class="form-label">著作権・作成者（公開時クレジット記載欄としても使えます）:</label>
            <div class="inline-input-with-btn">
              <input type="text" class="form-control" id="inputMetaCopyright" value="${this.escapeXml(meta.copyright || '')}" placeholder="例: (C) 2026 作成者名" ${!showHeaderCopyright ? 'disabled' : ''} />
              <button type="button" id="btnAppendCredit" class="btn btn-xs btn-secondary" title="利用規約に沿った公開用URLクレジット表記を末尾に追記します">＋ クレジットを追記</button>
            </div>
          </div>

          <div class="settings-subpanel">
            <div class="setting-toggles-grid">
              <label class="setting-toggle-card">
                <span class="setting-toggle-text">ページ番号を表示する</span>
                <input type="checkbox" class="toggle-input toggle-sm" id="checkPageNumberEnabled" ${pageNumEnabled ? 'checked' : ''} />
              </label>
              <label class="setting-toggle-card">
                <span class="setting-toggle-text">1ページのみ時は隠す</span>
                <input type="checkbox" class="toggle-input toggle-sm" id="checkPageNumberHideSingle" ${set.pageNumberHideSingle ? 'checked' : ''} ${!pageNumEnabled ? 'disabled' : ''} />
              </label>
            </div>
            <div class="form-row-grid" style="margin-top: 8px;">
              <div class="form-col">
                <label class="form-label">ページ番号の表記パターン:</label>
                <select class="form-select" id="selectPageNumberFormat" ${!pageNumEnabled ? 'disabled' : ''}>
                  ${pageNumFormats.map(f => `
                    <option value="${f.value}" ${(set.pageNumberFormat || 'slash') === f.value ? 'selected' : ''}>${this.escapeXml(f.label)}</option>
                  `).join("")}
                </select>
              </div>
              <div class="form-col">
                <label class="form-label">ページ番号の配置:</label>
                <select class="form-select" id="selectPageNumberPosition" ${!pageNumEnabled ? 'disabled' : ''}>
                  ${pageNumPositions.map(p => `
                    <option value="${p.value}" ${(set.pageNumberPosition || 'bottom-center') === p.value ? 'selected' : ''}>${this.escapeXml(p.label)}</option>
                  `).join("")}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="group-title">用紙・改ページ設定</div>
          <div class="form-row-grid">
            <div class="form-col">
              <label class="form-label">${isSeparatePage ? '駅軸の用紙サイズ:' : '用紙サイズ:'}</label>
              <select class="form-select" id="selectPageSize">
                ${Object.entries(pageSpecs).map(([key, spec]) => `
                  <option value="${key}" ${set.pageSize === key ? 'selected' : ''}>${this.escapeXml(spec.label)}</option>
                `).join("")}
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">${isSeparatePage ? '駅軸の用紙の向き:' : '用紙の向き:'}</label>
              <select class="form-select" id="selectOrientation" ${(set.pageSize === 'AUTO' || set.pageSize === 'CUSTOM') ? 'disabled' : ''}>
                <option value="portrait" ${set.orientation === 'portrait' ? 'selected' : ''}>縦向き (Portrait)</option>
                <option value="landscape" ${set.orientation === 'landscape' ? 'selected' : ''}>横向き (Landscape)</option>
              </select>
            </div>
          </div>
          ${set.pageSize === 'AUTO' ? `
            <div class="text-muted" style="font-size: 11px; margin-top: 6px;">
              ※ データ量（駅数・時間帯・運用数）に合わせて用紙幅・高さを自動調整します。
            </div>
          ` : ''}
          ${set.pageSize === 'CUSTOM' ? `
            <div class="form-row-grid settings-subpanel">
              <div class="form-col">
                <label class="form-label">用紙幅 (mm):</label>
                <input type="number" class="form-control font-mono" id="inputCustomPageWidthMm" value="${set.customPageWidthMm || 420}" min="100" max="1800" step="5" />
              </div>
              <div class="form-col">
                <label class="form-label">用紙高さ (mm):</label>
                <input type="number" class="form-control font-mono" id="inputCustomPageHeightMm" value="${set.customPageHeightMm || 220}" min="80" max="1200" step="5" />
              </div>
            </div>
          ` : ''}
          <div class="form-row" style="margin-top: 10px;">
            <label class="toggle-switch">
              <input type="checkbox" class="toggle-input" id="checkSeparatePageByAxis" ${isSeparatePage ? 'checked' : ''} />
              <span>駅軸と時刻軸で別の用紙サイズ・向きを使う（例: 駅軸はA4縦、時刻軸は変形自動フィット）</span>
            </label>
          </div>
          ${isSeparatePage ? `
            <div class="form-row-grid settings-subpanel">
              <div class="form-col">
                <label class="form-label">時刻軸の用紙サイズ:</label>
                <select class="form-select" id="selectTimeAxisPageSize">
                  ${Object.entries(pageSpecs).map(([key, spec]) => `
                    <option value="${key}" ${(set.timeAxisPageSize || 'AUTO') === key ? 'selected' : ''}>${this.escapeXml(spec.label)}</option>
                  `).join("")}
                </select>
              </div>
              <div class="form-col">
                <label class="form-label">時刻軸の用紙の向き:</label>
                <select class="form-select" id="selectTimeAxisOrientation" ${((set.timeAxisPageSize || 'AUTO') === 'AUTO' || set.timeAxisPageSize === 'CUSTOM') ? 'disabled' : ''}>
                  <option value="portrait" ${set.timeAxisOrientation === 'portrait' ? 'selected' : ''}>縦向き (Portrait)</option>
                  <option value="landscape" ${set.timeAxisOrientation !== 'portrait' ? 'selected' : ''}>横向き (Landscape)</option>
                </select>
              </div>
            </div>
            ${(set.timeAxisPageSize || 'AUTO') === 'AUTO' ? `
              <div class="text-muted" style="font-size: 11px; margin-top: 4px; padding-left: 4px;">
                ※ 時間帯の長さと運用ブロック数に合わせて横長サイズ・余白なし高さを自動設定します。
              </div>
            ` : ''}
            ${set.timeAxisPageSize === 'CUSTOM' ? `
              <div class="form-row-grid settings-subpanel" style="margin-top: 6px;">
                <div class="form-col">
                  <label class="form-label">時刻軸の用紙幅 (mm):</label>
                  <input type="number" class="form-control font-mono" id="inputTimeAxisCustomWidthMm" value="${set.timeAxisCustomWidthMm || 560}" min="100" max="1800" step="5" />
                </div>
                <div class="form-col">
                  <label class="form-label">時刻軸の用紙高さ (mm):</label>
                  <input type="number" class="form-control font-mono" id="inputTimeAxisCustomHeightMm" value="${set.timeAxisCustomHeightMm || 220}" min="80" max="1200" step="5" />
                </div>
              </div>
            ` : ''}
          ` : ''}
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
          <div class="group-title">横軸モード・時間軸設定</div>
          <div class="form-row">
            <label class="form-label">横軸の表示モード:</label>
            <select class="form-select" id="selectXAxisMode">
              <option value="station" ${set.xAxisMode !== 'time' ? 'selected' : ''}>駅順（標準箱ダイヤ）</option>
              <option value="time" ${set.xAxisMode === 'time' ? 'selected' : ''}>時刻（運用線図／棒ダイヤ）</option>
            </select>
          </div>
          <div class="form-row-grid" style="margin-top: 10px;">
            <div class="form-col">
              <label class="form-label">日界（開始時刻）:</label>
              <select class="form-select" id="selectTimeAxisStartHour">
                ${[0, 1, 2, 3, 4, 5, 6].map(h => `
                  <option value="${h}" ${startHour === h ? 'selected' : ''}>${h}:00${h === 4 ? ' (標準)' : ''}</option>
                `).join("")}
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">時間範囲の決定方法:</label>
              <select class="form-select" id="selectTimeAxisRangeMode">
                <option value="auto" ${!isManualTimeRange ? 'selected' : ''}>自動（列車データから算出）</option>
                <option value="manual" ${isManualTimeRange ? 'selected' : ''}>手動（終端時刻を指定）</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">手動終端時刻:</label>
              <select class="form-select" id="selectTimeAxisEndHour" ${!isManualTimeRange ? 'disabled' : ''}>
                ${[22, 23, 24, 25, 26, 27, 28].map(h => {
                  const optLabel = h >= 24 ? `${h}:00 (翌${h - 24}時)` : `${h}:00`;
                  return `<option value="${h}" ${endHour === h ? 'selected' : ''}>${optLabel}</option>`;
                }).join("")}
              </select>
            </div>
          </div>
          <div class="form-row-grid" style="margin-top: 10px;">
            <div class="form-col">
              <label class="form-label">時刻罫線の間隔:</label>
              <select class="form-select" id="selectTimeAxisGridMinutes">
                <option value="30" ${set.timeAxisGridMinutes !== 60 ? 'selected' : ''}>30分補助線あり</option>
                <option value="60" ${set.timeAxisGridMinutes === 60 ? 'selected' : ''}>1時間ごとのみ</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">24時以降の目盛り表記:</label>
              <select class="form-select" id="selectTimeAxisLateNightFormat">
                <option value="24plus" ${(set.timeAxisLateNightFormat || '24plus') === '24plus' ? 'selected' : ''}>24, 25, 26 ...（標準）</option>
                <option value="zero" ${set.timeAxisLateNightFormat === 'zero' ? 'selected' : ''}>0, 1, 2 ...</option>
                <option value="yoku" ${set.timeAxisLateNightFormat === 'yoku' ? 'selected' : ''}>翌0, 翌1, 翌2 ...</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">時刻・駅略称ラベル:</label>
              <select class="form-select" id="selectTimeAxisLabelDensity">
                <option value="auto" ${set.timeAxisLabelDensity !== 'full' ? 'selected' : ''}>自動間引き（重なり回避）</option>
                <option value="full" ${set.timeAxisLabelDensity === 'full' ? 'selected' : ''}>全列車に極力表示</option>
              </select>
            </div>
          </div>
          <div class="form-row-grid" style="margin-top: 10px; align-items: end;">
            <div class="form-col">
              <label class="form-label">背景時刻縦線の濃さ:</label>
              <select class="form-select" id="selectTimeAxisGridStyle">
                <option value="default" ${(set.timeAxisGridStyle || 'default') === 'default' ? 'selected' : ''}>標準（見やすい罫線）</option>
                <option value="subtle" ${set.timeAxisGridStyle === 'subtle' ? 'selected' : ''}>淡め（控えめ）</option>
                <option value="none" ${set.timeAxisGridStyle === 'none' ? 'selected' : ''}>非表示</option>
              </select>
            </div>
            <div class="form-col">
              <label class="setting-toggle-card">
                <span class="setting-toggle-text">待機折り返しの点線接続を表示</span>
                <input type="checkbox" class="toggle-input toggle-sm" id="checkShowTimeAxisTurnaroundDash" ${showTurnDash ? 'checked' : ''} />
              </label>
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="group-title">スタイル・見た目カスタマイズ</div>
          <div class="form-row-grid">
            <div class="form-col">
              <label class="form-label">駅名ヘッダーの向き:</label>
              <select class="form-select" id="selectStationHeaderDirection">
                <option value="vertical" ${set.stationHeaderDirection !== 'horizontal' ? 'selected' : ''}>縦書き（2文字縦並び / 3文字以上均等配置）</option>
                <option value="horizontal" ${set.stationHeaderDirection === 'horizontal' ? 'selected' : ''}>横書き（ヘッダー中央1行配置）</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">駅軸の左右方向（上り・下り向き）:</label>
              <select class="form-select" id="selectStationAxisDirection">
                <option value="ltr" ${set.stationAxisDirection !== 'rtl' ? 'selected' : ''}>左→右（標準: 起点駅が左端）</option>
                <option value="rtl" ${set.stationAxisDirection === 'rtl' ? 'selected' : ''}>右→左（反転: 起点駅が右端）</option>
              </select>
            </div>
          </div>
          <div class="form-row-grid" style="margin-top: 8px;">
            <div class="form-col">
              <label class="form-label">発着時刻の表記形式:</label>
              <select class="form-select" id="selectTimeDisplayFormat">
                <option value="h:mm" ${(set.timeDisplayFormat || 'h:mm') === 'h:mm' ? 'selected' : ''}>6:08（標準・0詰めなし）</option>
                <option value="hh:mm" ${set.timeDisplayFormat === 'hh:mm' ? 'selected' : ''}>06:08（先頭0埋めあり）</option>
                <option value="hhmm" ${set.timeDisplayFormat === 'hhmm' ? 'selected' : ''}>0608（コロンなし4桁）</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">駅基準の縦ガイド線（駅軸）:</label>
              <select class="form-select" id="selectStationGridStyle">
                <option value="none" ${(set.stationGridStyle || 'none') === 'none' ? 'selected' : ''}>なし（標準・すっきり）</option>
                <option value="dashed" ${set.stationGridStyle === 'dashed' ? 'selected' : ''}>薄い破線</option>
                <option value="solid" ${set.stationGridStyle === 'solid' ? 'selected' : ''}>薄い実線</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">折り返し垂直線の色（駅軸）:</label>
              <select class="form-select" id="selectTurnaroundColorMode">
                <option value="next" ${(set.turnaroundColorMode || 'next') === 'next' ? 'selected' : ''}>後の列車色に合わせる（標準）</option>
                <option value="prev" ${set.turnaroundColorMode === 'prev' ? 'selected' : ''}>前の列車色に合わせる</option>
                <option value="black" ${set.turnaroundColorMode === 'black' ? 'selected' : ''}>常に黒にする</option>
              </select>
            </div>
          </div>
          <div class="form-row-grid" style="margin-top: 8px;">
            <div class="form-col">
              <label class="form-label">省略駅名行 (下 真 茂) の表示:</label>
              <select class="form-select" id="selectSubHeaderMode">
                <option value="omitFirst" ${set.subHeaderMode === 'omitFirst' ? 'selected' : ''}>先頭運用は省略 (標準)</option>
                <option value="all" ${set.subHeaderMode === 'all' ? 'selected' : ''}>全運用ブロックに表示</option>
                <option value="none" ${set.subHeaderMode === 'none' ? 'selected' : ''}>表示しない</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">自運用番号の強調スタイル:</label>
              <select class="form-select" id="selectSelfHighlightStyle">
                <option value="red" ${set.selfHighlightStyle === 'red' ? 'selected' : ''}>赤文字のみ (標準)</option>
                <option value="bold" ${set.selfHighlightStyle === 'bold' ? 'selected' : ''}>太字</option>
                <option value="underline" ${set.selfHighlightStyle === 'underline' ? 'selected' : ''}>下線</option>
                <option value="red-bold" ${set.selfHighlightStyle === 'red-bold' ? 'selected' : ''}>赤文字＋太字</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">途中駅 部分継走の標準段下げ:</label>
              <select class="form-select" id="selectPartialConnectStepRows">
                <option value="1" ${(typeof set.partialConnectStepRows !== 'number' || set.partialConnectStepRows >= 1) ? 'selected' : ''}>1行（標準の段差）</option>
                <option value="0" ${set.partialConnectStepRows === 0 ? 'selected' : ''}>0行（同じ横線上に詰める）</option>
              </select>
            </div>
          </div>
          <div class="form-row-grid" style="margin-top: 8px; align-items: end;">
            <div class="form-col">
              <label class="form-label">ダイヤ線の太さ倍率:</label>
              <select class="form-select" id="selectLineWidthScale">
                <option value="0.8" ${Math.abs(lineWidthScale - 0.8) < 0.05 ? 'selected' : ''}>0.8x（細め）</option>
                <option value="1" ${Math.abs(lineWidthScale - 1.0) < 0.05 ? 'selected' : ''}>1.0x（標準）</option>
                <option value="1.25" ${Math.abs(lineWidthScale - 1.25) < 0.05 ? 'selected' : ''}>1.25x（やや太め）</option>
                <option value="1.5" ${Math.abs(lineWidthScale - 1.5) < 0.05 ? 'selected' : ''}>1.5x（太め）</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">発着記号 (○▲) の大きさ:</label>
              <select class="form-select" id="selectSymbolScale">
                <option value="0.8" ${Math.abs(symbolScale - 0.8) < 0.05 ? 'selected' : ''}>0.8x（小さめ）</option>
                <option value="1" ${Math.abs(symbolScale - 1.0) < 0.05 ? 'selected' : ''}>1.0x（標準）</option>
                <option value="1.25" ${Math.abs(symbolScale - 1.25) < 0.05 ? 'selected' : ''}>1.25x（大きめ）</option>
                <option value="1.5" ${Math.abs(symbolScale - 1.5) < 0.05 ? 'selected' : ''}>1.5x（特大）</option>
              </select>
            </div>
            <div class="form-col">
              <label class="setting-toggle-card">
                <span class="setting-toggle-text">運用ごとに交互の薄い背景（ゼブラ）</span>
                <input type="checkbox" class="toggle-input toggle-sm" id="checkRosterZebraFill" ${set.rosterZebraFill ? 'checked' : ''} />
              </label>
            </div>
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

        <div class="settings-group">
          <div class="group-title">出区・入区欄および走行距離設定</div>
          <div class="setting-toggles-grid">
            <label class="setting-toggle-card">
              <span class="setting-toggle-text">出区場所欄を表示（運用番号の右）</span>
              <input type="checkbox" class="toggle-input toggle-sm" id="checkShowDepotOutCol" ${set.showDepotOutCol !== false ? 'checked' : ''} />
            </label>
            <label class="setting-toggle-card">
              <span class="setting-toggle-text">入区場所欄を表示（全体の右端）</span>
              <input type="checkbox" class="toggle-input toggle-sm" id="checkShowDepotInCol" ${set.showDepotInCol !== false ? 'checked' : ''} />
            </label>
            <label class="setting-toggle-card">
              <span class="setting-toggle-text">記号が無い運用は始発・終着駅で補完する</span>
              <input type="checkbox" class="toggle-input toggle-sm" id="checkDepotFallbackToEndpoints" ${set.depotFallbackToEndpoints !== false ? 'checked' : ''} />
            </label>
            <label class="setting-toggle-card">
              <span class="setting-toggle-text">走行距離から回送・試運転を除外する</span>
              <input type="checkbox" class="toggle-input toggle-sm" id="checkDistanceExcludeDeadhead" ${set.distanceExcludeDeadhead ? 'checked' : ''} />
            </label>
          </div>
          <div class="form-row-grid" style="margin-top: 8px;">
            <div class="form-col">
              <label class="form-label">複数発生時の表示方針（出区・入区）:</label>
              <select class="form-select" id="selectDepotDisplayScope">
                <option value="all" ${(set.depotDisplayScope || 'all') === 'all' ? 'selected' : ''}>すべて順に表示（複数回対応）</option>
                <option value="firstLast" ${set.depotDisplayScope === 'firstLast' ? 'selected' : ''}>最初と最後のみ表示（1行）</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">出区・入区欄の内容形式:</label>
              <select class="form-select" id="selectDepotTextFormat">
                <option value="station_time" ${(set.depotTextFormat || 'station_time') === 'station_time' ? 'selected' : ''}>駅名＋時刻（例: 楓ヶ丘 5:40）</option>
                <option value="abbr_time" ${set.depotTextFormat === 'abbr_time' ? 'selected' : ''}>駅略称＋時刻（例: 楓 5:40）</option>
                <option value="station_only" ${set.depotTextFormat === 'station_only' ? 'selected' : ''}>駅名のみ</option>
                <option value="abbr_only" ${set.depotTextFormat === 'abbr_only' ? 'selected' : ''}>駅略称のみ</option>
              </select>
            </div>
          </div>
          <div class="form-row" style="margin-top: 8px;">
            <label class="form-label">黒記号（●／▲）の扱い:</label>
            <select class="form-select" id="selectDepotFilledPolicy">
              <option value="ends_only" ${(set.depotFilledPolicy || 'ends_only') === 'ends_only' ? 'selected' : ''}>運用端のみ対象（標準・推奨）</option>
              <option value="exclude" ${set.depotFilledPolicy === 'exclude' ? 'selected' : ''}>○／△のみ（●／▲は除外）</option>
              <option value="all" ${set.depotFilledPolicy === 'all' ? 'selected' : ''}>○●／△▲すべて対象</option>
            </select>
          </div>
          <div class="form-row-grid" style="margin-top: 8px;">
            <div class="form-col">
              <label class="form-label">走行距離の表示位置（選択式）:</label>
              <select class="form-select" id="selectDistanceDisplayMode">
                <option value="none" ${(set.distanceDisplayMode || 'none') === 'none' ? 'selected' : ''}>非表示（集計のみ）</option>
                <option value="rightCol" ${set.distanceDisplayMode === 'rightCol' ? 'selected' : ''}>右端に専用列を追加表示</option>
                <option value="underInDepot" ${set.distanceDisplayMode === 'underInDepot' ? 'selected' : ''}>入区欄の下段に併記</option>
                <option value="underRoster" ${set.distanceDisplayMode === 'underRoster' ? 'selected' : ''}>運用番号欄の下段に併記</option>
              </select>
            </div>
            <div class="form-col">
              <label class="form-label">走行距離の小数桁:</label>
              <select class="form-select" id="selectDistanceDecimalPlaces" ${(set.distanceDisplayMode || 'none') === 'none' ? 'disabled' : ''}>
                <option value="1" ${set.distanceDecimalPlaces !== 0 ? 'selected' : ''}>小数第1位（例: 112.6km）</option>
                <option value="0" ${set.distanceDecimalPlaces === 0 ? 'selected' : ''}>整数丸め（例: 113km）</option>
              </select>
            </div>
          </div>
          <div class="form-row-grid" style="margin-top: 8px;">
            <div class="form-col">
              <label class="form-label">出区見出し文字:</label>
              <input type="text" class="form-control" id="inputDepotOutColHeaderText" value="${this.escapeXml(typeof set.depotOutColHeaderText === 'string' ? set.depotOutColHeaderText : '出区')}" placeholder="出区" maxlength="8" />
            </div>
            <div class="form-col">
              <label class="form-label">入区見出し文字:</label>
              <input type="text" class="form-control" id="inputDepotInColHeaderText" value="${this.escapeXml(typeof set.depotInColHeaderText === 'string' ? set.depotInColHeaderText : '入区')}" placeholder="入区" maxlength="8" />
            </div>
            <div class="form-col">
              <label class="form-label">走行距離見出し文字:</label>
              <input type="text" class="form-control" id="inputDistanceColHeaderText" value="${this.escapeXml(typeof set.distanceColHeaderText === 'string' ? set.distanceColHeaderText : '走行距離')}" placeholder="走行距離" maxlength="10" />
            </div>
          </div>
          <div class="text-muted" style="font-size: 11px; margin-top: 6px;">
            各運用の出区・入区手動上書きや手動走行距離は「運用一覧」タブの各行「詳細」から編集できます。駅ごとのキロ程(km)は「駅マスタ」タブで設定します。
          </div>
        </div>

        <div class="settings-group">
          <div class="group-title">運用表の縦横縮尺・列幅調整</div>
          <div class="scale-control-card">
            <div class="scale-control-header">
              <span class="form-label" style="margin:0;">縦縮尺（運用ブロックの行高さ・間隔）</span>
              <div style="display:flex; gap:4px; align-items:center;">
                <button type="button" class="btn btn-xs btn-secondary" id="btnAutoFitOnePageHeight" title="現在の定型用紙1ページに全運用が収まる縦縮尺を自動算出して適用">1ページに縦フィット</button>
                <button type="button" class="btn btn-xs btn-secondary" id="btnResetVScale">100%</button>
              </div>
            </div>
            <div class="scale-slider-row">
              <input type="range" id="rangeTableVerticalScale" min="50" max="180" step="5" value="${Math.round((typeof set.tableVerticalScale === 'number' ? set.tableVerticalScale : 1.0) * 100)}" />
              <span class="scale-pct-wrap">
                <input type="number" class="form-control font-mono scale-pct-input" id="inputTableVerticalScalePct" min="50" max="180" step="5" value="${Math.round((typeof set.tableVerticalScale === 'number' ? set.tableVerticalScale : 1.0) * 100)}" />
                <span class="text-muted" style="font-size:11px;">%</span>
              </span>
            </div>
          </div>
          <div class="scale-control-card">
            <div class="scale-control-header">
              <span class="form-label" style="margin:0;">横縮尺（定型紙: 外余白とプロット間隔 ／ 変形AUTO: 用紙幅ごと伸縮）</span>
              <button type="button" class="btn btn-xs btn-secondary" id="btnResetHScale">100%</button>
            </div>
            <div class="scale-slider-row">
              <input type="range" id="rangeTableHorizontalScale" min="60" max="180" step="5" value="${Math.round((typeof set.tableHorizontalScale === 'number' ? set.tableHorizontalScale : 1.0) * 100)}" />
              <span class="scale-pct-wrap">
                <input type="number" class="form-control font-mono scale-pct-input" id="inputTableHorizontalScalePct" min="60" max="180" step="5" value="${Math.round((typeof set.tableHorizontalScale === 'number' ? set.tableHorizontalScale : 1.0) * 100)}" />
                <span class="text-muted" style="font-size:11px;">%</span>
              </span>
            </div>
            <div class="scale-note-text">
              「変形（自動フィット）」選択時は横縮尺が用紙算出幅（mm）に直接連動します。個別運用の縦倍率は「運用一覧」タブの「詳細」から変更できます。
            </div>
          </div>
          <div class="form-row-grid" style="margin-top: 8px;">
            <div class="form-col">
              <label class="form-label">運用番号欄幅 (px):</label>
              <input type="number" class="form-control font-mono" id="inputRosterColWidth" value="${typeof set.rosterColWidth === 'number' ? set.rosterColWidth : 66.40}" min="42" max="140" step="2" />
            </div>
            <div class="form-col">
              <label class="form-label">出区欄幅 (px):</label>
              <input type="number" class="form-control font-mono" id="inputDepotOutColWidth" value="${typeof set.depotOutColWidth === 'number' ? set.depotOutColWidth : 68}" min="40" max="160" step="2" />
            </div>
            <div class="form-col">
              <label class="form-label">入区欄幅 (px):</label>
              <input type="number" class="form-control font-mono" id="inputDepotInColWidth" value="${typeof set.depotInColWidth === 'number' ? set.depotInColWidth : 68}" min="40" max="160" step="2" />
            </div>
            <div class="form-col">
              <label class="form-label">距離欄幅 (px):</label>
              <input type="number" class="form-control font-mono" id="inputDistanceColWidth" value="${typeof set.distanceColWidth === 'number' ? set.distanceColWidth : 56}" min="38" max="120" step="2" />
            </div>
          </div>
        </div>

        <div class="settings-group">
          <div class="group-title">フォント・文字スタイルの詳細設定（部位別）</div>
          <div class="font-theme-bar">
            <span class="font-theme-bar-label">一括プリセット:</span>
            <button type="button" class="btn btn-xs btn-secondary" data-font-theme="standard">標準（Ｐゴシック系）</button>
            <button type="button" class="btn btn-xs btn-secondary" data-font-theme="sharp_gothic">くっきりゴシック太字</button>
            <button type="button" class="btn btn-xs btn-secondary" data-font-theme="tabular_timetables">時刻等幅強調</button>
            <button type="button" class="btn btn-xs btn-secondary" data-font-theme="classic_mincho">明朝クラシック</button>
          </div>
          <div class="font-roles-stack">
            ${(() => {
              const fontStyles = BoxDiagramDataModel.normalizeFontStyles
                ? BoxDiagramDataModel.normalizeFontStyles(set.fontStyles)
                : {};
              return [
                this.renderFontRoleCard("header", "見出し・タイトル・頁番号", "桜川電鉄 平日ダイヤ 1/2", fonts.header, fontStyles.header, "F1"),
                this.renderFontRoleCard("station", "駅名・省略駅名・時刻目盛り", "桜川中央 / 茂木 / 12時", fonts.station, fontStyles.station, "F1"),
                this.renderFontRoleCard("roster", "運用番号（左列）", "A1 / A2 / 下り", fonts.roster, fontStyles.roster, "F1"),
                this.renderFontRoleCard("trainNo", "列車番号・併結表記", "3697M (A1+A2)", fonts.trainNo, fontStyles.trainNo, "F1"),
                this.renderFontRoleCard("time", "発着時刻", "5:24 / 14:08 / 23:55", fonts.time, fontStyles.time, "F2")
              ].join("");
            })()}
          </div>
          <div class="text-muted" style="font-size: 11px; margin-top: 6px;">
            太字（B）・斜体（I）・下線（U）・等幅数字（01）・サイズ倍率（％）・字間（px）・任意フォント名を部位ごとに細かく調整できます。注記テキストの太字／斜体は「注記」タブから個別に切替できます。
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
          <strong>上級者向け：JSON直接編集</strong><br>
          JSONを直接編集すると構造破綻のリスクがあります。通常の編集は「列車表」「運用一覧」などのGUIタブを使用してください。<br>
          編集する場合は下記のチェックボックスをONにして「適用する」ボタンを押してください。スキーマ検証が行われます。
        </div>

        <div class="json-actions-bar">
          <label class="toggle-switch">
            <input type="checkbox" class="toggle-input" id="checkEnableRawEdit" />
            <span class="font-bold">JSONの直接編集を有効化する</span>
          </label>
          <div>
            <button id="btnCopyJson" class="btn btn-sm btn-secondary">コピー</button>
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
        this.setActiveTab(btn.dataset.tab, true);
      });
    });

    this._bindClipboardBarEvents();

    // 列車表タブ
    if (this.activeTab === "tab-trains") {
      const rosterSelect = this.container.querySelector("#selectActiveRoster");
      if (rosterSelect) {
        rosterSelect.addEventListener("change", (e) => {
          this.setActiveRoster(e.target.value, true);
        });
      }

      const btnAddTrain = this.container.querySelector("#btnAddTrain");
      if (btnAddTrain) {
        btnAddTrain.addEventListener("click", () => {
          this._setCtx({ kind: "single" });
          this.model.addTrain(this.activeRosterId);
        });
      }

      const btnAddConn = this.container.querySelector("#btnAddConnectingTrain");
      if (btnAddConn) {
        btnAddConn.addEventListener("click", () => {
          this._setCtx({ kind: "connecting" });
          this.model.addConnectingTrain(this.activeRosterId);
        });
      }

      const btnPasteToolbar = this.container.querySelector("#btnPasteTrainsToolbar");
      if (btnPasteToolbar) {
        btnPasteToolbar.addEventListener("click", () => {
          this.pasteClipboardToTrains(this.activeRosterId, this._getDefaultTrainInsertAt());
        });
      }

      const btnPasteEmpty = this.container.querySelector("#btnPasteTrainsEmpty");
      if (btnPasteEmpty) {
        btnPasteEmpty.addEventListener("click", () => {
          this.pasteClipboardToTrains(this.activeRosterId, 0);
        });
      }

      const btnOpenPocketEmpty = this.container.querySelector("#btnOpenPocketEmpty");
      if (btnOpenPocketEmpty) {
        btnOpenPocketEmpty.addEventListener("click", () => {
          this.setPocketOpen(true);
        });
      }

      const selBar = this.container.querySelector("#trainsSelectionBar");
      if (selBar) {
        selBar.addEventListener("click", (e) => {
          const sendBtn = e.target.closest("#btnSendSelectedToRoster");
          if (sendBtn) {
            this.openSendToRosterPopover(sendBtn);
            return;
          }
          const btn = e.target.closest("[data-sel-act]");
          if (!btn) return;
          this._handleTrainsSelectionAction(btn.dataset.selAct);
        });
      }

      const checkShowTrainDist = this.container.querySelector("#checkShowTrainDistanceCol");
      if (checkShowTrainDist) {
        checkShowTrainDist.addEventListener("change", (e) => {
          this.showTrainDistanceCol = !!e.target.checked;
          this._track("show_train_distance_toggled", { enabled: this.showTrainDistanceCol });
          this.render();
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
          this._track("coupled_sync_batch", {
            updated_count: res.updatedCount || 0,
            created_count: res.createdCount || 0
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

      const btnFirstTrainInline = this.container.querySelector("#btnAddFirstTrainInline");
      if (btnFirstTrainInline) {
        btnFirstTrainInline.addEventListener("click", () => {
          this.model.addTrain(this.activeRosterId);
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
            } else if (field === "distanceKm") {
              return; // 確定値変更は change で反映し小数入力途中のジャンプを防ぐ
            }
            this._setCtx({ field });
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
            } else if (field === "distanceKm") {
              val = val === "" ? null : BoxDiagramDataModel.clampKm(val, null);
              e.target.value = typeof val === "number" ? val : "";
            }
            this._setCtx({ field });
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

        // 選択チェックボックス（Shift+クリック範囲選択対応）
        const selectAllTrains = this.container.querySelector("#selectAllTrainsCheck");
        if (selectAllTrains) {
          selectAllTrains.addEventListener("change", (e) => {
            const roster = this.model.getRoster(this.activeRosterId);
            const count = (roster && roster.trains) ? roster.trains.length : 0;
            this.selectedTrainIndices.clear();
            if (e.target.checked) {
              for (let i = 0; i < count; i++) this.selectedTrainIndices.add(i);
            }
            this.lastTrainSelectAnchor = null;
            this.render();
          });
        }

        trainTable.addEventListener("click", (e) => {
          const check = e.target.closest(".row-select-check[data-select-train]");
          if (check) {
            const idx = parseInt(check.dataset.selectTrain, 10);
            this._handleTrainCheckboxClick(idx, check.checked, e.shiftKey);
            return;
          }

          const btn = e.target.closest("button");
          if (!btn) return;
          const tr = btn.closest("tr");
          if (!tr) return;
          const idx = parseInt(tr.dataset.trainIdx, 10);
          const act = btn.dataset.action;

          if (act === "split-train") {
            this._track("coupled_split_opened", { source: "train_row" });
            this.openSplitPopover(btn, idx);
          } else if (act === "copy-train") {
            this.copyTrainsToClipboard(this.activeRosterId, [idx], "copy", "row_btn");
          } else if (act === "cut-train") {
            this.copyTrainsToClipboard(this.activeRosterId, [idx], "cut", "row_btn");
          } else if (act === "dup-train") {
            this.model.duplicateTrain(this.activeRosterId, idx);
          } else if (act === "del-train") {
            this.model.deleteTrain(this.activeRosterId, idx);
          } else if (act === "up-train") {
            this._setCtx({ via: "button" });
            this.model.moveTrain(this.activeRosterId, idx, idx - 1);
          } else if (act === "down-train") {
            this._setCtx({ via: "button" });
            this.model.moveTrain(this.activeRosterId, idx, idx + 1);
          } else if (act === "open-formation-popover") {
            this._track("coupled_formation_opened");
            this.openFormationPopover(btn, idx);
          } else if (act === "toggle-custom-coupled") {
            this._setCtx({ field: "customCoupled" });
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

        this._bindTableRowPointerDrag(trainTable, "train");
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

      const btnToggleAllRosterDetails = this.container.querySelector("#btnToggleAllRosterDetails");
      if (btnToggleAllRosterDetails) {
        btnToggleAllRosterDetails.addEventListener("click", () => {
          const rosters = this.model.getRosters();
          const opening = this.expandedRosterIds.size === 0;
          if (!opening) {
            this.expandedRosterIds.clear();
          } else {
            rosters.forEach(r => this.expandedRosterIds.add(r.id));
          }
          this._track("roster_detail_toggled", { scope: "all", open: opening });
          this.render();
        });
      }

      const btnPasteRosters = this.container.querySelector("#btnPasteRostersToolbar");
      if (btnPasteRosters) {
        btnPasteRosters.addEventListener("click", () => {
          this.pasteClipboardToRosters(null, null);
        });
      }

      const rosterSelBar = this.container.querySelector("#rostersSelectionBar");
      if (rosterSelBar) {
        rosterSelBar.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-roster-sel-act]");
          if (!btn) return;
          this._handleRostersSelectionAction(btn.dataset.rosterSelAct);
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
          const detailField = e.target.dataset.rosterDetailField;
          if (detailField) {
            const detailTr = e.target.closest("tr.roster-detail-row");
            const rId = detailTr ? detailTr.dataset.rosterDetailFor : null;
            if (!rId) return;
            if (detailField === "depotOutOverride" || detailField === "depotInOverride") {
              this._setCtx({ field: detailField, detailPanel: true });
              this.safeMutate(() => {
                this.model.updateRoster(rId, { [detailField]: e.target.value });
              });
            }
            return;
          }
          const tr = e.target.closest("tr");
          if (!tr) return;
          const id = tr.dataset.rosterId;
          const field = e.target.dataset.rosterField;
          if (field === "name") {
            let res;
            this._setCtx({ field: "name" });
            this.safeMutate(() => {
              res = this.model.updateRoster(id, { name: e.target.value });
            });
            if (res && res.ok && res.roster) {
              updateRosterBadgeDom(tr, res.roster);
            }
          }
        });

        rostersTable.addEventListener("change", (e) => {
          const detailField = e.target.dataset.rosterDetailField;
          if (detailField) {
            const detailTr = e.target.closest("tr.roster-detail-row");
            const rId = detailTr ? detailTr.dataset.rosterDetailFor : null;
            if (!rId) return;
            this._setCtx({ field: detailField, detailPanel: true });
            if (detailField === "depotOutOverride" || detailField === "depotInOverride") {
              this.safeMutate(() => {
                this.model.updateRoster(rId, { [detailField]: e.target.value });
              });
            } else if (detailField === "manualDistanceKm") {
              const nextKm = e.target.value === "" ? null : BoxDiagramDataModel.clampKm(e.target.value, null);
              e.target.value = typeof nextKm === "number" ? nextKm : "";
              this.safeMutate(() => {
                this.model.updateRoster(rId, { manualDistanceKm: nextKm });
              });
            } else if (detailField === "rowScale") {
              const pct = parseFloat(e.target.value);
              const clampedScale = BoxDiagramDataModel.clampScale(Number.isFinite(pct) ? pct / 100 : 1.0, 1.0, 0.5, 2.0);
              e.target.value = Math.round(clampedScale * 100);
              this.safeMutate(() => {
                this.model.updateRoster(rId, { rowScale: clampedScale });
              });
            }
            return;
          }
          const tr = e.target.closest("tr");
          if (!tr) return;
          const id = tr.dataset.rosterId;
          const field = e.target.dataset.rosterField;
          if (field) {
            const val = e.target.type === "checkbox" ? e.target.checked : e.target.value;
            let res;
            this._setCtx({ field });
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

        const selectAllRosters = this.container.querySelector("#selectAllRostersCheck");
        if (selectAllRosters) {
          selectAllRosters.addEventListener("change", (e) => {
            const rosters = this.model.getRosters();
            this.selectedRosterIds.clear();
            if (e.target.checked) {
              rosters.forEach(r => this.selectedRosterIds.add(r.id));
            }
            this.lastRosterSelectAnchor = null;
            this.render();
          });
        }

        rostersTable.addEventListener("click", (e) => {
          const check = e.target.closest(".row-select-check[data-select-roster]");
          if (check) {
            this._handleRosterCheckboxClick(check.dataset.selectRoster, check.checked, e.shiftKey);
            return;
          }

          const btn = e.target.closest("button");
          if (!btn) return;
          const detailTr = btn.closest("tr.roster-detail-row");
          if (detailTr && btn.dataset.action === "reset-roster-rowscale") {
            const detailId = detailTr.dataset.rosterDetailFor;
            if (detailId) {
              this.model.updateRoster(detailId, { rowScale: 1.0 });
            }
            return;
          }
          const tr = btn.closest("tr");
          if (!tr) return;
          const id = tr.dataset.rosterId;
          const act = btn.dataset.action;

          if (act === "edit-roster-trains") {
            this.setActiveRoster(id, true);
            this.setActiveTab("tab-trains", true);
          } else if (act === "toggle-roster-detail") {
            const opening = !this.expandedRosterIds.has(id);
            if (!opening) {
              this.expandedRosterIds.delete(id);
            } else {
              this.expandedRosterIds.add(id);
            }
            this._track("roster_detail_toggled", { scope: "single", open: opening });
            this.render();
          } else if (act === "copy-roster") {
            this.copyRostersToClipboard([id], "copy", "row_btn");
          } else if (act === "cut-roster") {
            this.copyRostersToClipboard([id], "cut", "row_btn");
          } else if (act === "paste-into-roster") {
            const rosters = this.model.getRosters();
            const curIdx = rosters.findIndex(r => r.id === id);
            if (this.clipboard && this.clipboard.kind === "rosters") {
              this.pasteClipboardToRosters(null, curIdx + 1);
            } else {
              this.pasteClipboardToRosters(id, null);
            }
          } else if (act === "reset-roster-name") {
            this._setCtx({ field: "resetName" });
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
            this._setCtx({ via: "button" });
            this.model.moveRoster(curIdx, targetIdx);
          }
        });

        this._bindTableRowPointerDrag(rostersTable, "roster");
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

          this._setCtx({ field });
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
          this._setCtx({ kind: "all10" });
          this.model.mutate("stations-reset", () => {
            this.model.data.stations = JSON.parse(JSON.stringify(FICTIONAL_ALL_STATIONS));
            this.model.recalculateStationX();
          });
        });
      }

      const btnMain3 = this.container.querySelector("#btnResetMain3Stations");
      if (btnMain3) {
        btnMain3.addEventListener("click", () => {
          this._setCtx({ kind: "major4" });
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
            this._setCtx({ field });
            this.safeMutate(() => {
              if (field === "visible") {
                this.model.setStationVisibility(id, e.target.checked);
              } else if (field === "x") {
                this.model.updateStation(id, { x: parseFloat(e.target.value) || 0 });
              } else if (field === "km") {
                const kmVal = e.target.value === "" ? null : BoxDiagramDataModel.clampKm(e.target.value, null);
                e.target.value = typeof kmVal === "number" ? kmVal : "";
                this.model.updateStation(id, { km: kmVal });
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
            this._setCtx({ via: "button" });
            this.model.moveStation(curIdx, targetIdx);
          }
        });

        this._bindTableRowPointerDrag(stTable, "station");
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
        const handleNoteUpdate = (e, allowModeRerender) => {
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
          } else if (field === "axisMode") {
            val = (val === "time") ? "time" : "station";
          } else if (field === "font") {
            val = BoxDiagramDataModel.normalizeFontId(val, "F1");
          }

          this._setCtx({ field });
          this.safeMutate(() => {
            this.model.updateNote(id, { [field]: val });
          });
          if (allowModeRerender && field === "axisMode") {
            this.render();
          }
        };

        notesTable.addEventListener("input", (e) => handleNoteUpdate(e, false));
        notesTable.addEventListener("change", (e) => handleNoteUpdate(e, true));

        notesTable.addEventListener("click", (e) => {
          const btn = e.target.closest("button");
          if (!btn) return;
          const tr = btn.closest("tr");
          if (!tr) return;
          const id = tr.dataset.noteId;
          const act = btn.dataset.action;

          if (act === "del-note") {
            this.model.deleteNote(id);
            return;
          }

          const styleKey = btn.dataset.noteStyle;
          if (styleKey === "bold" || styleKey === "italic") {
            const note = (this.model.data.notes || []).find(n => n.id === id);
            if (!note) return;
            const nextVal = !note[styleKey];
            this._setCtx({ field: styleKey });
            this.safeMutate(() => {
              this.model.updateNote(id, { [styleKey]: nextVal });
            });
            btn.classList.toggle("active", nextVal);
            btn.setAttribute("aria-pressed", String(nextVal));
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

      const bindSettingSelect = (selector, key, transform = (v) => v, rerenderAfter = false) => {
        const el = this.container.querySelector(selector);
        if (!el) return;
        el.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ [key]: transform(e.target.value) });
          });
          if (rerenderAfter) {
            this.render();
          }
        });
      };

      const bindSettingToggle = (selector, key, rerenderAfter = false) => {
        const el = this.container.querySelector(selector);
        if (!el) return;
        el.addEventListener("change", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ [key]: !!e.target.checked });
          });
          if (rerenderAfter) this.render();
        });
      };

      const rosterColInp = this.container.querySelector("#inputRosterColHeaderText");
      if (rosterColInp) {
        rosterColInp.addEventListener("input", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ rosterColHeaderText: e.target.value });
          });
        });
      }

      const btnAppendCredit = this.container.querySelector("#btnAppendCredit");
      if (btnAppendCredit && metaCopy) {
        btnAppendCredit.addEventListener("click", () => {
          const creditTag = "sekitan66325.github.io/box-diagram で作成";
          const cur = (metaCopy.value || "").trim();
          const next = cur.includes(creditTag)
            ? cur
            : (cur ? `${cur} / ${creditTag}` : creditTag);
          metaCopy.value = next;
          this.safeMutate(() => {
            this.model.updateMetadata({ copyright: next });
            this.model.updateSettings({ showHeaderCopyright: true });
          });
          const copyChk = this.container.querySelector("#checkShowHeaderCopyright");
          if (copyChk && !copyChk.checked) {
            copyChk.checked = true;
            metaCopy.disabled = false;
          }
          if (typeof window.showAppToast === "function") {
            window.showAppToast("著作権・作成者欄にクレジットを追記しました");
          }
          this._track("credit_appended");
        });
      }

      bindSettingToggle("#checkShowHeaderTitle", "showHeaderTitle", true);
      bindSettingToggle("#checkShowHeaderCopyright", "showHeaderCopyright", true);
      bindSettingToggle("#checkPageNumberEnabled", "pageNumberEnabled", true);
      bindSettingToggle("#checkPageNumberHideSingle", "pageNumberHideSingle");
      bindSettingToggle("#checkShowTimeAxisTurnaroundDash", "showTimeAxisTurnaroundDash");
      bindSettingToggle("#checkRosterZebraFill", "rosterZebraFill");

      bindSettingSelect("#selectPageNumberFormat", "pageNumberFormat");
      bindSettingSelect("#selectPageNumberPosition", "pageNumberPosition");
      bindSettingSelect("#selectTimeAxisGridStyle", "timeAxisGridStyle");
      bindSettingSelect("#selectTimeDisplayFormat", "timeDisplayFormat");
      bindSettingSelect("#selectStationGridStyle", "stationGridStyle");
      bindSettingSelect("#selectTurnaroundColorMode", "turnaroundColorMode");
      bindSettingSelect("#selectLineWidthScale", "lineWidthScale", v => parseFloat(v) || 1.0);
      bindSettingSelect("#selectSymbolScale", "symbolScale", v => parseFloat(v) || 1.0);

      bindSettingSelect("#selectPageSize", "pageSize", v => v, true);
      bindSettingSelect("#selectOrientation", "orientation");
      bindSettingSelect("#selectTimeAxisPageSize", "timeAxisPageSize", v => v, true);
      bindSettingSelect("#selectTimeAxisOrientation", "timeAxisOrientation");
      bindSettingSelect("#selectXAxisMode", "xAxisMode");

      const bindCustomMmInput = (selector, key, fallback, minMm, maxMm) => {
        const el = this.container.querySelector(selector);
        if (!el) return;
        el.addEventListener("change", (e) => {
          const clamped = BoxDiagramDataModel.clampCustomMm(e.target.value, fallback, minMm, maxMm);
          e.target.value = clamped;
          this.safeMutate(() => {
            this.model.updateSettings({ [key]: clamped });
          });
        });
      };
      bindCustomMmInput("#inputCustomPageWidthMm", "customPageWidthMm", 420, 100, 1800);
      bindCustomMmInput("#inputCustomPageHeightMm", "customPageHeightMm", 220, 80, 1200);
      bindCustomMmInput("#inputTimeAxisCustomWidthMm", "timeAxisCustomWidthMm", 560, 100, 1800);
      bindCustomMmInput("#inputTimeAxisCustomHeightMm", "timeAxisCustomHeightMm", 220, 80, 1200);
      bindSettingSelect("#selectTimeAxisStartHour", "timeAxisStartHour", (v) => {
        const n = parseInt(v, 10);
        return Number.isNaN(n) ? 4 : n;
      });
      bindSettingSelect("#selectTimeAxisRangeMode", "timeAxisRangeMode", (v) => v, true);
      bindSettingSelect("#selectTimeAxisEndHour", "timeAxisEndHour", (v) => parseInt(v, 10) || 25);
      bindSettingSelect("#selectTimeAxisGridMinutes", "timeAxisGridMinutes", (v) => parseInt(v, 10) === 60 ? 60 : 30);
      bindSettingSelect("#selectTimeAxisLateNightFormat", "timeAxisLateNightFormat");
      bindSettingSelect("#selectTimeAxisLabelDensity", "timeAxisLabelDensity");

      const checkSeparatePageByAxis = this.container.querySelector("#checkSeparatePageByAxis");
      if (checkSeparatePageByAxis) {
        checkSeparatePageByAxis.addEventListener("change", (e) => {
          const checked = !!e.target.checked;
          const cur = this.model.getSettings();
          const patch = { separatePageSettingsByAxisMode: checked };
          if (checked) {
            if (!cur.timeAxisPageSize) patch.timeAxisPageSize = "AUTO";
            if (!cur.timeAxisOrientation) patch.timeAxisOrientation = "landscape";
          }
          this.safeMutate(() => {
            this.model.updateSettings(patch);
          });
          this.render();
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

      bindSettingSelect("#selectStationAxisDirection", "stationAxisDirection", (v) => v === "rtl" ? "rtl" : "ltr");

      const syncRoleFontCardUi = (role) => {
        const curSet = this.model.getSettings();
        const curFonts = Object.assign({}, BoxDiagramDataModel.DEFAULT_ELEMENT_FONTS, curSet.fonts || {});
        const curStyles = BoxDiagramDataModel.normalizeFontStyles
          ? BoxDiagramDataModel.normalizeFontStyles(curSet.fontStyles)
          : {};
        const fontId = curFonts[role] || (role === "time" ? "F2" : "F1");
        const st = BoxDiagramDataModel.normalizeFontStyleItem(curStyles[role]);
        const card = this.container.querySelector(`[data-font-card="${role}"]`);
        if (!card) return;
        const customWrap = card.querySelector(`[data-font-custom-wrap="${role}"]`);
        if (customWrap) customWrap.hidden = fontId !== "CUSTOM";
        const sample = card.querySelector(`[data-font-sample="${role}"]`);
        if (sample) {
          sample.style.fontFamily = BoxDiagramDataModel.resolveFontCss(fontId, role === "time" ? "F2" : "F1", st.customFamily);
          sample.style.fontWeight = st.bold ? "700" : "400";
          sample.style.fontStyle = st.italic ? "italic" : "normal";
          sample.style.textDecoration = st.underline ? "underline" : "none";
          sample.style.letterSpacing = `${st.letterSpacing || 0}px`;
          sample.style.fontVariantNumeric = st.tabularNums ? "tabular-nums" : "";
        }
        ["bold", "italic", "underline", "tabularNums"].forEach(k => {
          const b = card.querySelector(`[data-font-style-toggle="${k}"]`);
          if (b) {
            b.classList.toggle("active", !!st[k]);
            b.setAttribute("aria-pressed", String(!!st[k]));
          }
        });
      };

      this.container.querySelectorAll("select[data-font-role]").forEach(sel => {
        sel.addEventListener("change", (e) => {
          const role = sel.dataset.fontRole;
          if (!role) return;
          const fontVal = BoxDiagramDataModel.normalizeFontId(e.target.value, role === "time" ? "F2" : "F1");
          this.safeMutate(() => {
            this.model.updateSettings({ fonts: { [role]: fontVal } });
          });
          syncRoleFontCardUi(role);
        });
      });

      this.container.querySelectorAll("[data-font-style-toggle]").forEach(btn => {
        btn.addEventListener("click", () => {
          const role = btn.dataset.fontTarget;
          const prop = btn.dataset.fontStyleToggle;
          if (!role || !prop) return;
          const curStyles = BoxDiagramDataModel.normalizeFontStyles(this.model.getSettings().fontStyles);
          const curVal = !!(curStyles[role] && curStyles[role][prop]);
          this.safeMutate(() => {
            this.model.updateSettings({ fontStyles: { [role]: { [prop]: !curVal } } });
          });
          syncRoleFontCardUi(role);
        });
      });

      this.container.querySelectorAll("[data-font-scale-role]").forEach(inp => {
        inp.addEventListener("change", (e) => {
          const role = inp.dataset.fontScaleRole;
          if (!role) return;
          const pct = parseFloat(e.target.value);
          const nextScale = Number.isFinite(pct) ? Math.max(0.65, Math.min(1.6, pct / 100)) : 1.0;
          inp.value = Math.round(nextScale * 100);
          this.safeMutate(() => {
            this.model.updateSettings({ fontStyles: { [role]: { sizeScale: nextScale } } });
          });
          syncRoleFontCardUi(role);
        });
      });

      this.container.querySelectorAll("[data-font-spacing-role]").forEach(inp => {
        inp.addEventListener("change", (e) => {
          const role = inp.dataset.fontSpacingRole;
          if (!role) return;
          const val = parseFloat(e.target.value);
          const nextLs = Number.isFinite(val) ? Math.round(Math.max(-1.0, Math.min(3.0, val)) * 100) / 100 : 0;
          inp.value = nextLs;
          this.safeMutate(() => {
            this.model.updateSettings({ fontStyles: { [role]: { letterSpacing: nextLs } } });
          });
          syncRoleFontCardUi(role);
        });
      });

      this.container.querySelectorAll("[data-font-custom-role]").forEach(inp => {
        inp.addEventListener("input", (e) => {
          const role = inp.dataset.fontCustomRole;
          if (!role) return;
          this.safeMutate(() => {
            this.model.updateSettings({ fontStyles: { [role]: { customFamily: e.target.value } } });
          });
          syncRoleFontCardUi(role);
        });
      });

      this.container.querySelectorAll("[data-font-theme]").forEach(btn => {
        btn.addEventListener("click", () => {
          const theme = btn.dataset.fontTheme;
          const defFonts = Object.assign({}, BoxDiagramDataModel.DEFAULT_ELEMENT_FONTS);
          const defStyles = BoxDiagramDataModel.getDefaultFontStyles();
          let patchFonts = defFonts;
          let patchStyles = defStyles;
          if (theme === "sharp_gothic") {
            patchFonts = { header: "BIZ_GOTHIC", station: "BIZ_GOTHIC", roster: "BIZ_GOTHIC", trainNo: "BIZ_GOTHIC", time: "CONSOLAS" };
            patchStyles = BoxDiagramDataModel.normalizeFontStyles({
              header: { bold: true },
              station: { bold: true },
              roster: { bold: true },
              trainNo: { bold: false, tabularNums: true },
              time: { tabularNums: true }
            });
          } else if (theme === "tabular_timetables") {
            patchFonts = { header: "YUGOTHIC", station: "YUGOTHIC", roster: "CONSOLAS", trainNo: "CONSOLAS", time: "CONSOLAS" };
            patchStyles = BoxDiagramDataModel.normalizeFontStyles({
              header: { bold: true },
              station: { bold: false },
              roster: { bold: true, tabularNums: true },
              trainNo: { tabularNums: true },
              time: { bold: true, tabularNums: true, sizeScale: 1.05 }
            });
          } else if (theme === "classic_mincho") {
            patchFonts = { header: "YUMINCHO", station: "YUMINCHO", roster: "F2", trainNo: "F2", time: "F2" };
            patchStyles = BoxDiagramDataModel.normalizeFontStyles({
              header: { bold: true, letterSpacing: 0.4 },
              station: { bold: false },
              roster: { bold: true },
              trainNo: { bold: false },
              time: { italic: false }
            });
          }
          this.model.updateSettings({ fonts: patchFonts, fontStyles: patchStyles });
          this._track("font_theme_applied", { theme });
          this.render();
          this._notifyToast("フォントプリセットを適用しました");
        });
      });

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

      bindSettingToggle("#checkShowDepotOutCol", "showDepotOutCol", true);
      bindSettingToggle("#checkShowDepotInCol", "showDepotInCol", true);
      bindSettingToggle("#checkDepotFallbackToEndpoints", "depotFallbackToEndpoints");
      bindSettingToggle("#checkDistanceExcludeDeadhead", "distanceExcludeDeadhead");

      bindSettingSelect("#selectDepotDisplayScope", "depotDisplayScope");
      bindSettingSelect("#selectDepotTextFormat", "depotTextFormat");
      bindSettingSelect("#selectDepotFilledPolicy", "depotFilledPolicy");
      const selectDistanceDisplayMode = this.container.querySelector("#selectDistanceDisplayMode");
      if (selectDistanceDisplayMode) {
        selectDistanceDisplayMode.addEventListener("change", (e) => {
          const val = e.target.value;
          this.safeMutate(() => {
            this.model.updateSettings({ distanceDisplayMode: val });
          });
          const decPlacesEl = this.container.querySelector("#selectDistanceDecimalPlaces");
          if (decPlacesEl) {
            decPlacesEl.disabled = (val === "none");
          }
        });
      }
      bindSettingSelect("#selectDistanceDecimalPlaces", "distanceDecimalPlaces", v => parseInt(v, 10) === 0 ? 0 : 1);

      const bindSettingTextInput = (selector, key) => {
        const el = this.container.querySelector(selector);
        if (!el) return;
        el.addEventListener("input", (e) => {
          this.safeMutate(() => {
            this.model.updateSettings({ [key]: e.target.value });
          });
        });
      };
      bindSettingTextInput("#inputDepotOutColHeaderText", "depotOutColHeaderText");
      bindSettingTextInput("#inputDepotInColHeaderText", "depotInColHeaderText");
      bindSettingTextInput("#inputDistanceColHeaderText", "distanceColHeaderText");

      const bindScalePair = (rangeSel, numSel, resetSel, settingKey, minPct, maxPct) => {
        const rangeEl = this.container.querySelector(rangeSel);
        const numEl = this.container.querySelector(numSel);
        const resetEl = this.container.querySelector(resetSel);
        const commitPct = (rawVal, clampUi = false) => {
          const parsed = parseFloat(rawVal);
          const scale = BoxDiagramDataModel.clampScale(
            Number.isFinite(parsed) ? parsed / 100 : 1.0,
            1.0,
            minPct / 100,
            maxPct / 100
          );
          const pct = Math.round(scale * 100);
          if (rangeEl) rangeEl.value = pct;
          if (numEl && (clampUi || document.activeElement !== numEl)) numEl.value = pct;
          this.safeMutate(() => {
            this.model.updateSettings({ [settingKey]: scale });
          });
        };
        if (rangeEl) {
          rangeEl.addEventListener("input", (e) => commitPct(e.target.value, true));
        }
        if (numEl) {
          numEl.addEventListener("change", (e) => commitPct(e.target.value, true));
        }
        if (resetEl) {
          resetEl.addEventListener("click", () => commitPct(100, true));
        }
      };
      bindScalePair("#rangeTableVerticalScale", "#inputTableVerticalScalePct", "#btnResetVScale", "tableVerticalScale", 50, 180);
      bindScalePair("#rangeTableHorizontalScale", "#inputTableHorizontalScalePct", "#btnResetHScale", "tableHorizontalScale", 60, 180);

      const btnAutoFitOnePage = this.container.querySelector("#btnAutoFitOnePageHeight");
      if (btnAutoFitOnePage) {
        btnAutoFitOnePage.addEventListener("click", () => {
          if (typeof BoxDiagramRenderer !== "function") return;
          const renderer = new BoxDiagramRenderer({ interactive: false });
          const curData = this.model.getData();
          const cfg = BoxDiagramDataModel.getEffectivePageConfig(curData ? curData.settings : {});
          if (cfg.isAutoPageSize) {
            this._notifyToast("「変形（自動フィット）」モードでは用紙高さが自動調整されます");
            return;
          }
          const res = renderer.suggestVerticalScaleForPages(curData, 1);
          this.model.updateSettings({ tableVerticalScale: res.scale });
          this._track("auto_fit_one_page", { scale: res.scale, fits: !!res.fits, already_fits: !!res.alreadyFits });
          this.render();
          const pct = Math.round(res.scale * 100);
          if (res.alreadyFits) {
            this._notifyToast(`既に1ページ内に収まっています（縦縮尺 ${pct}%）`);
          } else if (res.fits) {
            this._notifyToast(`1ページに収まる縦縮尺（${pct}%）へ自動調整しました`);
          } else {
            this._notifyToast(`最小倍率（${pct}%）まで詰めましたが、複数ページにまたがります`);
          }
        });
      }

      const bindWidthInput = (selector, key, fb, mn, mx) => {
        const el = this.container.querySelector(selector);
        if (!el) return;
        el.addEventListener("change", (e) => {
          const clamped = BoxDiagramDataModel.clampWidth(e.target.value, fb, mn, mx);
          e.target.value = clamped;
          this.safeMutate(() => {
            this.model.updateSettings({ [key]: clamped });
          });
        });
      };
      bindWidthInput("#inputRosterColWidth", "rosterColWidth", 66.40, 42, 140);
      bindWidthInput("#inputDepotOutColWidth", "depotOutColWidth", 68, 40, 160);
      bindWidthInput("#inputDepotInColWidth", "depotInColWidth", 68, 40, 160);
      bindWidthInput("#inputDistanceColWidth", "distanceColWidth", 56, 38, 120);

      const btnResetSettings = this.container.querySelector("#btnResetSettingsToDefaults");
      if (btnResetSettings) {
        btnResetSettings.addEventListener("click", () => {
          const defaults = BoxDiagramDataModel.getDefaultSettings
            ? BoxDiagramDataModel.getDefaultSettings()
            : {
                baseRowHeight: 12.96,
                rosterStepRows: 2,
                partialConnectStepRows: 1,
                blockPaddingRows: 2,
                stationHeaderDirection: "vertical",
                stationAxisDirection: "ltr",
                fonts: Object.assign({}, BoxDiagramDataModel.DEFAULT_ELEMENT_FONTS),
                subHeaderMode: "omitFirst",
                selfHighlightStyle: "red",
                autoSyncCoupled: true,
                timeAxisStartHour: 4,
                timeAxisRangeMode: "auto",
                timeAxisEndHour: 25,
                timeAxisGridMinutes: 30,
                timeAxisLateNightFormat: "24plus",
                timeAxisLabelDensity: "auto"
              };
          // 用紙サイズと軸モード自体以外の描画・スタイル・ページ番号・時間軸設定を初期化
          const cur = this.model.getSettings();
          this.model.updateSettings(Object.assign(defaults, {
            pageSize: cur.pageSize || defaults.pageSize,
            orientation: cur.orientation || defaults.orientation,
            xAxisMode: cur.xAxisMode || defaults.xAxisMode
          }));
          this._track("settings_reset", { axis_mode: cur.xAxisMode || "station" });
          this.render();
          if (typeof window.showAppToast === "function") {
            window.showAppToast("基本設定（用紙・軸モード除く）を初期値に戻しました");
          }
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
          this._track("raw_json_action", { action: e.target.checked ? "enable_edit" : "disable_edit" });
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
              this._track("raw_json_action", { action: "apply", success: false });
              return;
            }
            errorBox.style.display = "none";
            this.model.load(parsed);
            this._track("raw_json_action", { action: "apply", success: true });
            alert("生JSONデータを適用しました。");
          } catch (err) {
            errorBox.textContent = `JSON構文エラー: ${err.message}`;
            errorBox.style.display = "block";
            this._track("raw_json_action", { action: "apply", success: false });
          }
        });
      }

      if (btnCopy && textarea) {
        btnCopy.addEventListener("click", () => {
          navigator.clipboard.writeText(textarea.value).then(() => {
            this._track("raw_json_action", { action: "copy" });
            btnCopy.textContent = "コピー完了";
            setTimeout(() => { btnCopy.textContent = "コピー"; }, 1500);
          });
        });
      }
    }
  }

  // ==================== 選択・クリップボード・移動ポケット・D&D ====================
  _notifyToast(msg) {
    if (msg && typeof window.showAppToast === "function") {
      window.showAppToast(msg, 2400);
    }
  }

  _cloneData(val) {
    return JSON.parse(JSON.stringify(val));
  }

  _formatRosterLabel(rosterOrId) {
    if (!rosterOrId) return "";
    const r = typeof rosterOrId === "string" ? this.model.getRoster(rosterOrId) : rosterOrId;
    if (!r) return String(rosterOrId);
    if (r.name && r.name !== r.id) return `${r.name} (${r.id})`;
    return r.id;
  }

  _stationLabel(stationId) {
    const stations = this.model.getStations ? this.model.getStations() : [];
    const st = stations.find(s => s.id === stationId);
    return st ? (st.abbr || st.name || stationId) : (stationId || "?");
  }

  _typeLabel(typeId) {
    const types = this.model.getTrainTypes ? this.model.getTrainTypes() : [];
    const tp = types.find(t => t.id === typeId);
    return tp ? tp.name : (typeId || "");
  }

  _describeTrain(tr) {
    if (!tr) return "";
    const no = tr.trainNo ? `${tr.trainNo}` : "(無番)";
    const tp = this._typeLabel(tr.typeId);
    const fromSt = this._stationLabel(tr.fromStation);
    const toSt = this._stationLabel(tr.toStation);
    const dep = tr.depTime || "";
    const arr = tr.arrTime || "";
    return `${no} ${tp} ${fromSt}${dep ? " " + dep : ""}→${toSt}${arr ? " " + arr : ""}`.trim();
  }

  _summarizeTrains(trains) {
    if (!Array.isArray(trains) || trains.length === 0) return "";
    if (trains.length === 1) return this._describeTrain(trains[0]);
    const first = trains[0].trainNo || this._stationLabel(trains[0].fromStation);
    const last = trains[trains.length - 1].trainNo || this._stationLabel(trains[trains.length - 1].toStation);
    return `${trains.length}本の列車 (${first} 〜 ${last})`;
  }

  _sanitizeSelections(data) {
    const rosters = (data && data.rosters) || [];
    const validIds = new Set(rosters.map(r => r.id));
    [...this.selectedRosterIds].forEach(id => {
      if (!validIds.has(id)) this.selectedRosterIds.delete(id);
    });

    const activeRoster = rosters.find(r => r.id === this.activeRosterId);
    const trainCount = (activeRoster && activeRoster.trains) ? activeRoster.trains.length : 0;
    [...this.selectedTrainIndices].forEach(idx => {
      if (!Number.isInteger(idx) || idx < 0 || idx >= trainCount) {
        this.selectedTrainIndices.delete(idx);
      }
    });
  }

  _syncSelectAllStates() {
    const allTrainsChk = this.container.querySelector("#selectAllTrainsCheck");
    if (allTrainsChk) {
      const roster = this.model.getRoster(this.activeRosterId);
      const total = (roster && roster.trains) ? roster.trains.length : 0;
      const sel = this.selectedTrainIndices.size;
      allTrainsChk.disabled = total === 0;
      allTrainsChk.checked = total > 0 && sel === total;
      allTrainsChk.indeterminate = sel > 0 && sel < total;
    }

    const allRostersChk = this.container.querySelector("#selectAllRostersCheck");
    if (allRostersChk) {
      const total = this.model.getRosters().length;
      const sel = this.selectedRosterIds.size;
      allRostersChk.disabled = total === 0;
      allRostersChk.checked = total > 0 && sel === total;
      allRostersChk.indeterminate = sel > 0 && sel < total;
    }
  }

  _applyPendingFlash(scrollContainer) {
    const target = this._flashTarget;
    this._flashTarget = null;
    if (!target) return;

    let matchedRows = [];
    if (target.type === "trains" && target.rosterId === this.activeRosterId && this.activeTab === "tab-trains") {
      (target.indices || []).forEach(idx => {
        const tr = this.container.querySelector(`#trainsGridTable tbody tr[data-train-idx="${idx}"]`);
        if (tr) matchedRows.push(tr);
      });
    } else if (target.type === "rosters" && this.activeTab === "tab-rosters") {
      const idSet = new Set(target.ids || []);
      this.container.querySelectorAll("#rostersGridTable tbody tr[data-roster-id]").forEach(tr => {
        if (idSet.has(tr.dataset.rosterId)) matchedRows.push(tr);
      });
    } else if (target.type === "stations" && this.activeTab === "tab-stations") {
      const tr = this.container.querySelector(`#stationsGridTable tbody tr[data-station-idx="${target.index}"]`);
      if (tr) matchedRows.push(tr);
    }

    if (matchedRows.length === 0) return;
    matchedRows.forEach(tr => tr.classList.add("row-jump-flash"));
    if (target.scrollIntoView && scrollContainer) {
      matchedRows[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    setTimeout(() => {
      matchedRows.forEach(tr => tr.classList.remove("row-jump-flash"));
    }, 1150);
  }

  _bindGlobalShortcuts() {
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (document.querySelector(".modal-backdrop:not([hidden])")) return;

      const activeEl = document.activeElement;
      if (activeEl) {
        const tag = activeEl.tagName;
        const isRowCheckbox = tag === "INPUT" && activeEl.type === "checkbox" && activeEl.classList.contains("row-select-check");
        if (!isRowCheckbox && (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || activeEl.isContentEditable)) {
          return;
        }
      }

      const selText = window.getSelection ? window.getSelection().toString() : "";
      if (selText && selText.length > 0) return;

      const k = (e.key || "").toLowerCase();
      if (k === "c") {
        if (this.activeTab === "tab-trains" && this.selectedTrainIndices.size > 0) {
          e.preventDefault();
          this.copyTrainsToClipboard(this.activeRosterId, [...this.selectedTrainIndices], "copy");
        } else if (this.activeTab === "tab-rosters" && this.selectedRosterIds.size > 0) {
          e.preventDefault();
          this.copyRostersToClipboard([...this.selectedRosterIds], "copy");
        }
      } else if (k === "x") {
        if (this.activeTab === "tab-trains" && this.selectedTrainIndices.size > 0) {
          e.preventDefault();
          this.copyTrainsToClipboard(this.activeRosterId, [...this.selectedTrainIndices], "cut");
        } else if (this.activeTab === "tab-rosters" && this.selectedRosterIds.size > 0) {
          e.preventDefault();
          this.copyRostersToClipboard([...this.selectedRosterIds], "cut");
        }
      } else if (k === "v" && this.clipboard) {
        if (this.activeTab === "tab-trains") {
          e.preventDefault();
          this.pasteClipboardToTrains(this.activeRosterId, this._getDefaultTrainInsertAt());
        } else if (this.activeTab === "tab-rosters") {
          e.preventDefault();
          this.pasteClipboardToRosters(null, null);
        }
      }
    });
  }

  _handleTrainCheckboxClick(index, isChecked, shiftKey) {
    if (Number.isNaN(index)) return;
    if (shiftKey && this.lastTrainSelectAnchor !== null) {
      const start = Math.min(this.lastTrainSelectAnchor, index);
      const end = Math.max(this.lastTrainSelectAnchor, index);
      for (let i = start; i <= end; i++) {
        if (isChecked) this.selectedTrainIndices.add(i);
        else this.selectedTrainIndices.delete(i);
      }
    } else {
      if (isChecked) this.selectedTrainIndices.add(index);
      else this.selectedTrainIndices.delete(index);
    }
    this.lastTrainSelectAnchor = index;
    this._track("selection_changed", { kind: "train", count: this.selectedTrainIndices.size, shift: !!shiftKey });
    this.render();
  }

  _handleRosterCheckboxClick(rosterId, isChecked, shiftKey) {
    if (!rosterId) return;
    const rosters = this.model.getRosters();
    const curIdx = rosters.findIndex(r => r.id === rosterId);
    if (curIdx === -1) return;

    if (shiftKey && this.lastRosterSelectAnchor) {
      const anchorIdx = rosters.findIndex(r => r.id === this.lastRosterSelectAnchor);
      if (anchorIdx !== -1) {
        const start = Math.min(anchorIdx, curIdx);
        const end = Math.max(anchorIdx, curIdx);
        for (let i = start; i <= end; i++) {
          if (isChecked) this.selectedRosterIds.add(rosters[i].id);
          else this.selectedRosterIds.delete(rosters[i].id);
        }
        this.lastRosterSelectAnchor = rosterId;
        this._track("selection_changed", { kind: "roster", count: this.selectedRosterIds.size, shift: true });
        this.render();
        return;
      }
    }

    if (isChecked) this.selectedRosterIds.add(rosterId);
    else this.selectedRosterIds.delete(rosterId);
    this.lastRosterSelectAnchor = rosterId;
    this._track("selection_changed", { kind: "roster", count: this.selectedRosterIds.size, shift: !!shiftKey });
    this.render();
  }

  _getDefaultTrainInsertAt() {
    if (this.selectedTrainIndices.size === 0) return null;
    return Math.max(...this.selectedTrainIndices) + 1;
  }

  _handleTrainsSelectionAction(act) {
    const indices = [...this.selectedTrainIndices].sort((a, b) => a - b);
    if (act === "clear") {
      this.selectedTrainIndices.clear();
      this.lastTrainSelectAnchor = null;
      this.render();
      return;
    }
    if (indices.length === 0) return;

    if (act === "copy") {
      this.copyTrainsToClipboard(this.activeRosterId, indices, "copy");
    } else if (act === "cut") {
      this.copyTrainsToClipboard(this.activeRosterId, indices, "cut");
    } else if (act === "pocket-cut") {
      this.addTrainsToPocket(this.activeRosterId, indices, "cut");
      this.selectedTrainIndices.clear();
      this.render();
    } else if (act === "pocket-copy") {
      this.addTrainsToPocket(this.activeRosterId, indices, "copy");
    } else if (act === "delete") {
      if (confirm(`選択した ${indices.length} 本の列車を削除しますか？`)) {
        this.model.removeTrains(this.activeRosterId, indices);
        this.selectedTrainIndices.clear();
        this.lastTrainSelectAnchor = null;
        this._notifyToast(`${indices.length}本の列車を削除しました`);
      }
    }
  }

  _handleRostersSelectionAction(act) {
    const rosters = this.model.getRosters();
    const ids = rosters.filter(r => this.selectedRosterIds.has(r.id)).map(r => r.id);
    if (act === "clear") {
      this.selectedRosterIds.clear();
      this.lastRosterSelectAnchor = null;
      this.render();
      return;
    }
    if (ids.length === 0) return;

    if (act === "copy") {
      this.copyRostersToClipboard(ids, "copy");
    } else if (act === "cut") {
      this.copyRostersToClipboard(ids, "cut");
    } else if (act === "pocket-cut") {
      this.addRostersToPocket(ids, "cut");
      this.selectedRosterIds.clear();
      this.render();
    } else if (act === "pocket-copy") {
      this.addRostersToPocket(ids, "copy");
    } else if (act === "delete") {
      if (confirm(`選択した ${ids.length} 件の運用を削除しますか？`)) {
        this.model.removeRostersByIds(ids);
        this.selectedRosterIds.clear();
        this.lastRosterSelectAnchor = null;
        this._notifyToast(`${ids.length}件の運用を削除しました`);
      }
    }
  }

  openSendToRosterPopover(anchorEl) {
    this.closeFloatingPopover();
    const indices = [...this.selectedTrainIndices].sort((a, b) => a - b);
    if (indices.length === 0) return;

    const allRosters = this.model.getRosters();
    const defaultTarget = allRosters.find(r => r.id !== this.activeRosterId)?.id || "__new__";

    const pop = document.createElement("div");
    pop.id = "editorFloatingPopover";
    pop.className = "editor-floating-popover";
    this.floatingPopover = pop;

    pop.innerHTML = `
      <div class="editor-popover-header">
        <span>選択した ${indices.length}本を別運用へ送る</span>
        <button type="button" class="btn-icon-xs" data-send-act="close">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;padding:4px 0;">
        <label style="font-size:11px;font-weight:600;color:var(--text-main);">
          送り先の運用:
          <select id="sendTargetRosterSelect" class="form-select" style="width:100%;margin-top:4px;">
            ${allRosters.map(r => `
              <option value="${this.escapeXml(r.id)}" ${r.id === defaultTarget ? 'selected' : ''}>
                ${this.escapeXml(this._formatRosterLabel(r))} (${(r.trains || []).length}本)${r.id === this.activeRosterId ? ' [現在表示中]' : ''}
              </option>
            `).join("")}
            <option value="__new__" ${defaultTarget === "__new__" ? 'selected' : ''}>＋ 新規運用を作成して送る</option>
          </select>
        </label>
        <div class="editor-popover-footer" style="justify-content:flex-end;gap:6px;">
          <button type="button" class="btn btn-xs btn-secondary" data-send-act="copy">${this._uiIcon("copy")} コピーして送る</button>
          <button type="button" class="btn btn-xs btn-primary" data-send-act="move">${this._uiIcon("cut")} 移動(切取)して送る</button>
        </div>
      </div>
    `;

    pop.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.sendAct;
      if (act === "close") {
        this.closeFloatingPopover();
        return;
      }
      if (act === "copy" || act === "move") {
        const sel = pop.querySelector("#sendTargetRosterSelect");
        let targetId = sel ? sel.value : "";
        const sourceRoster = this.model.getRoster(this.activeRosterId);
        if (!sourceRoster) return;
        const trainsToSend = indices.map(i => sourceRoster.trains[i]).filter(Boolean);
        if (trainsToSend.length === 0) return;

        if (targetId === "__new__") {
          targetId = this.model.addRoster({ trains: [] });
        }

        const cutOpts = act === "move"
          ? { cutFrom: { rosterId: this.activeRosterId, refs: trainsToSend.slice() } }
          : {};

        this.closeFloatingPopover();
        const res = this.model.insertTrains(targetId, this._cloneData(trainsToSend), null, cutOpts);
        if (res.ok) {
          this.selectedTrainIndices.clear();
          this.lastTrainSelectAnchor = null;
          this._flashTarget = { type: "trains", rosterId: targetId, indices: res.insertedIndices, scrollIntoView: true };
          this._notifyToast(`${this._formatRosterLabel(targetId)} へ ${trainsToSend.length}本を${act === "move" ? "移動" : "コピー"}しました`);
          this._track("send_to_roster_completed", { mode: act, count: trainsToSend.length });
          this.render();
        }
      }
    });

    this.positionFloatingPopover(pop, anchorEl);
  }

  // -------------------- クリップボード管理 --------------------
  copyTrainsToClipboard(rosterId, indices, mode = "copy", via = "selection") {
    const roster = this.model.getRoster(rosterId);
    if (!roster || !Array.isArray(roster.trains)) return;

    const cleanIdx = [...new Set(indices)]
      .filter(i => Number.isInteger(i) && i >= 0 && i < roster.trains.length)
      .sort((a, b) => a - b);
    if (cleanIdx.length === 0) return;

    const refs = cleanIdx.map(i => roster.trains[i]);
    const items = this._cloneData(refs);
    const summaryText = this._summarizeTrains(items);
    const rosterLabel = this._formatRosterLabel(roster);

    this.clipboard = {
      kind: "trains",
      mode: mode === "cut" ? "cut" : "copy",
      items,
      sourcePanel: "列車表",
      sourceRosterId: roster.id,
      sourceRosterName: roster.name || roster.id,
      sourceRosterLabel: rosterLabel,
      sourceRefs: refs,
      summaryText
    };

    this._justArmedClip = true;
    this._track("clipboard_op", { op: this.clipboard.mode, kind: "trains", count: items.length, via });
    this._notifyToast(`${mode === "cut" ? "切り取り待機" : "コピー"}: ${rosterLabel} の ${summaryText}`);
    this.render();
  }

  copyRostersToClipboard(rosterIds, mode = "copy", via = "selection") {
    const rosters = this.model.getRosters();
    const idSet = new Set(rosterIds || []);
    const matched = rosters.filter(r => idSet.has(r.id));
    if (matched.length === 0) return;

    const items = this._cloneData(matched);
    const summaryText = matched.length === 1
      ? `運用 ${this._formatRosterLabel(matched[0])} (${(matched[0].trains || []).length}本)`
      : `${matched.length}件の運用 (${matched.map(r => r.id).slice(0, 3).join(", ")}${matched.length > 3 ? "…" : ""})`;

    this.clipboard = {
      kind: "rosters",
      mode: mode === "cut" ? "cut" : "copy",
      items,
      sourcePanel: "運用一覧",
      sourceRosterIds: matched.map(r => r.id),
      sourceRosterLabel: "運用一覧",
      summaryText
    };

    this._justArmedClip = true;
    this._track("clipboard_op", { op: this.clipboard.mode, kind: "rosters", count: items.length, via });
    this._notifyToast(`${mode === "cut" ? "切り取り待機" : "コピー"}: ${summaryText}`);
    this.render();
  }

  clearClipboard() {
    this.clipboard = null;
    this._track("clipboard_op", { op: "clear" });
    this.render();
  }

  pasteClipboardToTrains(targetRosterId, insertAt = null) {
    if (!this.clipboard || !targetRosterId) return;
    const clip = this.clipboard;

    if (clip.kind === "trains") {
      const cutOpts = clip.mode === "cut"
        ? { cutFrom: { rosterId: clip.sourceRosterId, refs: clip.sourceRefs || [] } }
        : {};
      this._setCtx({ kind: clip.mode === "cut" ? "paste_cut" : "paste_copy", via: "clipboard" });
      const res = this.model.insertTrains(targetRosterId, clip.items, insertAt, cutOpts);
      if (!res.ok) {
        this._notifyToast("切り取り元の列車が見つからないため貼り付けできませんでした");
        return;
      }
      if (clip.mode === "cut") {
        this.clipboard = null;
      }
      this.selectedTrainIndices.clear();
      this._flashTarget = {
        type: "trains",
        rosterId: targetRosterId,
        indices: res.insertedIndices,
        scrollIntoView: true
      };
      this._track("clipboard_op", { op: "paste", kind: "trains", mode: clip.mode, target: "trains", count: clip.items.length });
      this._notifyToast(`${this._formatRosterLabel(targetRosterId)} に ${clip.items.length}本を${clip.mode === "cut" ? "移動貼付" : "貼り付け"}しました`);
      this.render();
    } else if (clip.kind === "rosters") {
      const flatTrains = clip.items.flatMap(r => Array.isArray(r.trains) ? r.trains : []);
      if (flatTrains.length === 0) {
        this._notifyToast("コピー中の運用には列車が含まれていません");
        return;
      }
      this._setCtx({ kind: "paste_roster_trains", via: "clipboard" });
      const res = this.model.insertTrains(targetRosterId, flatTrains, insertAt);
      if (res.ok) {
        this._flashTarget = {
          type: "trains",
          rosterId: targetRosterId,
          indices: res.insertedIndices,
          scrollIntoView: true
        };
        this._track("clipboard_op", { op: "paste", kind: "rosters_to_trains", count: flatTrains.length });
        this._notifyToast(`運用内の列車 ${flatTrains.length}本を ${this._formatRosterLabel(targetRosterId)} へ展開貼付しました`);
        this.render();
      }
    }
  }

  pasteClipboardToRosters(targetRosterId = null, insertAt = null) {
    if (!this.clipboard) return;
    const clip = this.clipboard;

    if (clip.kind === "trains") {
      if (targetRosterId) {
        const cutOpts = clip.mode === "cut"
          ? { cutFrom: { rosterId: clip.sourceRosterId, refs: clip.sourceRefs || [] } }
          : {};
        this._setCtx({ kind: clip.mode === "cut" ? "paste_cut" : "paste_copy", via: "clipboard" });
        const res = this.model.insertTrains(targetRosterId, clip.items, null, cutOpts);
        if (!res.ok) {
          this._notifyToast("切り取り元の列車が見つかりませんでした");
          return;
        }
        if (clip.mode === "cut") this.clipboard = null;
        this._flashTarget = { type: "rosters", ids: [targetRosterId], scrollIntoView: true };
        this._track("clipboard_op", { op: "paste", kind: "trains", mode: clip.mode, target: "roster_existing", count: clip.items.length });
        this._notifyToast(`${this._formatRosterLabel(targetRosterId)} に ${clip.items.length}本を貼り付けました`);
        this.render();
      } else {
        const cutOpts = clip.mode === "cut"
          ? { cutFrom: { rosterId: clip.sourceRosterId, refs: clip.sourceRefs || [] } }
          : {};
        this._setCtx({ kind: "paste_to_new_roster", via: "clipboard" });
        const newId = this.model.addRoster({ trains: [] });
        this.model.insertTrains(newId, clip.items, 0, cutOpts);
        if (clip.mode === "cut") this.clipboard = null;
        this.activeRosterId = newId;
        this._flashTarget = { type: "rosters", ids: [newId], scrollIntoView: true };
        this._track("clipboard_op", { op: "paste", kind: "trains", mode: clip.mode, target: "roster_new", count: clip.items.length });
        this._notifyToast(`新規運用 ${newId} を作成して ${clip.items.length}本を貼り付けました`);
        this.render();
      }
      return;
    }

    if (clip.kind === "rosters") {
      const cutOpts = clip.mode === "cut"
        ? { cutSourceIds: clip.sourceRosterIds || [] }
        : {};
      this._setCtx({ kind: clip.mode === "cut" ? "paste_cut" : "paste_copy", via: "clipboard" });
      const createdIds = this.model.insertRosters(clip.items, insertAt, cutOpts);
      if (clip.mode === "cut") this.clipboard = null;
      if (createdIds.length > 0) {
        this._flashTarget = { type: "rosters", ids: createdIds, scrollIntoView: true };
        this._track("clipboard_op", { op: "paste", kind: "rosters", mode: clip.mode, target: "rosters", count: createdIds.length });
        this._notifyToast(`${createdIds.length}件の運用を${clip.mode === "cut" ? "移動貼付" : "貼り付け"}しました`);
      }
      this.render();
    }
  }

  sendClipboardToPocket() {
    if (!this.clipboard) return;
    const clip = this.clipboard;
    if (clip.kind === "trains") {
      if (clip.mode === "cut") {
        const sourceRoster = this.model.getRoster(clip.sourceRosterId);
        const firstIdx = sourceRoster && clip.sourceRefs && clip.sourceRefs[0]
          ? sourceRoster.trains.indexOf(clip.sourceRefs[0])
          : 0;
        const removed = this.model.removeTrains(clip.sourceRosterId, [], clip.sourceRefs || []);
        if (removed.length === 0) {
          this._notifyToast("切り取り元の列車が見つかりませんでした");
          return;
        }
        this._pushPocketItem({
          itemType: "train",
          mode: "cut",
          originLabel: `列車表 / ${clip.sourceRosterLabel}`,
          sourceRosterId: clip.sourceRosterId,
          sourceRosterName: clip.sourceRosterName,
          sourceIndex: Math.max(0, firstIdx),
          title: this._summarizeTrains(removed),
          items: removed
        });
        this.clipboard = null;
      } else {
        this._pushPocketItem({
          itemType: "train",
          mode: "copy",
          originLabel: `列車表 / ${clip.sourceRosterLabel}`,
          sourceRosterId: clip.sourceRosterId,
          sourceRosterName: clip.sourceRosterName,
          sourceIndex: 0,
          title: clip.summaryText,
          items: this._cloneData(clip.items)
        });
      }
    } else if (clip.kind === "rosters") {
      if (clip.mode === "cut") {
        const allRosters = this.model.getRosters();
        const firstIdx = allRosters.findIndex(r => (clip.sourceRosterIds || []).includes(r.id));
        const removed = this.model.removeRostersByIds(clip.sourceRosterIds || []);
        if (removed.length === 0) return;
        this._pushPocketItem({
          itemType: "roster",
          mode: "cut",
          originLabel: "運用一覧",
          sourceRosterId: null,
          sourceRosterName: null,
          sourceIndex: Math.max(0, firstIdx),
          title: clip.summaryText,
          items: removed
        });
        this.clipboard = null;
      } else {
        this._pushPocketItem({
          itemType: "roster",
          mode: "copy",
          originLabel: "運用一覧",
          sourceRosterId: null,
          sourceRosterName: null,
          sourceIndex: 0,
          title: clip.summaryText,
          items: this._cloneData(clip.items)
        });
      }
    }
    this.setPocketOpen(true);
    this.render();
  }

  // -------------------- 下部常設クリップボードバー --------------------
  renderClipboardBarHtml(data) {
    const clip = this.clipboard;
    const pocketCount = this.pocketItems.length;
    const activeRoster = (data.rosters || []).find(r => r.id === this.activeRosterId);
    const activeRosterText = activeRoster ? this._formatRosterLabel(activeRoster) : "";

    let barClass = "is-empty";
    let pillHtml = `<span class="clipboard-kind-pill is-empty">保持なし</span>`;
    let detailText = "コピー・切り取り、または左端ドットのドラッグで並替・ポケット整理ができます";
    let actionsHtml = "";

    if (clip) {
      const isCut = clip.mode === "cut";
      barClass = isCut ? "is-cut" : "is-copy";
      pillHtml = isCut
        ? `<span class="clipboard-kind-pill is-cut">${this._uiIcon("cut", 11)} 切取待機</span>`
        : `<span class="clipboard-kind-pill is-copy">${this._uiIcon("copy", 11)} コピー中</span>`;
      const originText = clip.kind === "trains"
        ? `元: ${clip.sourcePanel} / ${clip.sourceRosterLabel}`
        : `元: ${clip.sourcePanel}`;
      detailText = `${originText} ｜ ${clip.summaryText}`;

      let pasteBtnLabel = "貼付";
      if (this.activeTab === "tab-trains" && activeRosterText) {
        pasteBtnLabel = `${activeRosterText}へ貼付`;
      } else if (this.activeTab === "tab-rosters") {
        pasteBtnLabel = clip.kind === "rosters" ? "運用一覧へ貼付" : "新規運用に貼付";
      } else if (clip.kind === "trains" && activeRosterText) {
        pasteBtnLabel = `${activeRosterText}へ貼付`;
      }

      actionsHtml = `
        <button type="button" class="btn btn-xs btn-primary" id="btnClipBarPaste" title="現在の貼り付け先へ貼り付け">${this._uiIcon("paste", 11)} ${this.escapeXml(pasteBtnLabel)}</button>
        <button type="button" class="btn btn-xs btn-secondary" id="btnClipBarToPocket" title="この内容を移動ポケットへ入れる">${this._uiIcon("pocket", 11)} ポケットへ</button>
        <button type="button" class="btn btn-xs btn-secondary" id="btnClipBarClear" title="クリップボード保持を解除">解除</button>
      `;
    }

    const armClass = this._justArmedClip ? "anim-clip-arm" : "";

    return `
      <div class="editor-clipboard-bar ${barClass} ${armClass}" id="editorClipboardBar">
        <div class="clipboard-bar-status">
          ${pillHtml}
          <span class="clipboard-detail-text" title="${this.escapeXml(detailText)}">${this.escapeXml(detailText)}</span>
        </div>
        <div class="clipboard-bar-actions">
          ${actionsHtml}
          <button type="button" class="btn btn-xs btn-secondary btn-pocket-toggle ${pocketCount > 0 ? 'has-items' : ''}" id="btnClipBarTogglePocket" title="移動ポケットを開く・閉じる（背後画面もそのまま操作できます）">
            ${this._uiIcon("pocket", 11)} ポケット${pocketCount > 0 ? `<span class="pocket-count-badge">${pocketCount}</span>` : ''}
          </button>
        </div>
      </div>
    `;
  }

  _bindClipboardBarEvents() {
    const bar = this.container.querySelector("#editorClipboardBar");
    if (!bar) return;

    const btnPaste = bar.querySelector("#btnClipBarPaste");
    if (btnPaste) {
      btnPaste.addEventListener("click", () => {
        if (!this.clipboard) return;
        if (this.activeTab === "tab-rosters") {
          this.pasteClipboardToRosters(null, null);
        } else {
          this.pasteClipboardToTrains(this.activeRosterId, this._getDefaultTrainInsertAt());
        }
      });
    }

    const btnToPocket = bar.querySelector("#btnClipBarToPocket");
    if (btnToPocket) {
      btnToPocket.addEventListener("click", () => {
        this.sendClipboardToPocket();
      });
    }

    const btnClear = bar.querySelector("#btnClipBarClear");
    if (btnClear) {
      btnClear.addEventListener("click", () => {
        this.clearClipboard();
      });
    }

    const btnPocket = bar.querySelector("#btnClipBarTogglePocket");
    if (btnPocket) {
      btnPocket.addEventListener("click", () => {
        this.setPocketOpen(!this.pocketOpen);
      });
    }
  }

  // -------------------- 自由移動式「移動ポケット」 --------------------
  setPocketOpen(open) {
    const nextOpen = !!open;
    if (nextOpen && !this._wasPocketOpen) {
      this._animateNextPocketOpen = true;
    }
    if (this.pocketOpen !== nextOpen) {
      this._track("pocket_op", { op: nextOpen ? "open" : "close", items_count: this.pocketItems.length });
    }
    this.pocketOpen = nextOpen;
    this._wasPocketOpen = nextOpen;
    if (this.pocketOpen) {
      this.pocketMinimized = false;
    }
    this.renderFloatingPocket();
  }

  _pushPocketItem(entry) {
    const uid = `pk_${this._uidSeq++}`;
    this._newPocketUids.add(uid);
    this.pocketItems.push(Object.assign({ uid }, entry));
  }

  movePocketItem(uid, delta) {
    const idx = this.pocketItems.findIndex(p => p.uid === uid);
    if (idx === -1) return;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= this.pocketItems.length) return;
    const [moved] = this.pocketItems.splice(idx, 1);
    this.pocketItems.splice(nextIdx, 0, moved);
    this.renderFloatingPocket();
  }

  addTrainsToPocket(rosterId, indices, mode = "cut") {
    const roster = this.model.getRoster(rosterId);
    if (!roster || !Array.isArray(roster.trains)) return;
    const cleanIdx = [...new Set(indices)]
      .filter(i => Number.isInteger(i) && i >= 0 && i < roster.trains.length)
      .sort((a, b) => a - b);
    if (cleanIdx.length === 0) return;

    const rosterLabel = this._formatRosterLabel(roster);
    let items;
    if (mode === "cut") {
      items = this.model.removeTrains(rosterId, cleanIdx);
      if (items.length === 0) return;
    } else {
      items = this._cloneData(cleanIdx.map(i => roster.trains[i]));
    }

    this._pushPocketItem({
      itemType: "train",
      mode: mode === "cut" ? "cut" : "copy",
      originLabel: `列車表 / ${rosterLabel}`,
      sourceRosterId: roster.id,
      sourceRosterName: roster.name || roster.id,
      sourceIndex: cleanIdx[0],
      title: this._summarizeTrains(items),
      items
    });

    this.setPocketOpen(true);
    this._notifyToast(`移動ポケットへ${mode === "cut" ? "移動" : "追加"}: ${this._summarizeTrains(items)}`);
    if (mode !== "cut") this.renderFloatingPocket();
  }

  addRostersToPocket(rosterIds, mode = "cut") {
    const rosters = this.model.getRosters();
    const idSet = new Set(rosterIds || []);
    const matched = rosters.filter(r => idSet.has(r.id));
    if (matched.length === 0) return;
    const firstIdx = rosters.findIndex(r => r.id === matched[0].id);

    const summary = matched.length === 1
      ? `運用 ${this._formatRosterLabel(matched[0])} (${(matched[0].trains || []).length}本)`
      : `${matched.length}件の運用`;

    let items;
    if (mode === "cut") {
      items = this.model.removeRostersByIds(matched.map(r => r.id));
      if (items.length === 0) return;
    } else {
      items = this._cloneData(matched);
    }

    this._pushPocketItem({
      itemType: "roster",
      mode: mode === "cut" ? "cut" : "copy",
      originLabel: "運用一覧",
      sourceRosterId: null,
      sourceRosterName: null,
      sourceIndex: Math.max(0, firstIdx),
      title: summary,
      items
    });

    this.setPocketOpen(true);
    this._notifyToast(`移動ポケットへ${mode === "cut" ? "移動" : "追加"}: ${summary}`);
    if (mode !== "cut") this.renderFloatingPocket();
  }

  pastePocketItem(uid, targetRosterId = this.activeRosterId, insertAt = null) {
    const itemIdx = this.pocketItems.findIndex(p => p.uid === uid);
    if (itemIdx === -1) return;
    const item = this.pocketItems[itemIdx];

    if (item.itemType === "train") {
      if (!targetRosterId) {
        targetRosterId = this.model.addRoster({ trains: [] });
        this.activeRosterId = targetRosterId;
      }
      const res = this.model.insertTrains(targetRosterId, item.items, insertAt);
      if (!res.ok) return;
      if (item.mode === "cut") {
        this.pocketItems.splice(itemIdx, 1);
      }
      this._flashTarget = { type: "trains", rosterId: targetRosterId, indices: res.insertedIndices, scrollIntoView: true };
      this._notifyToast(`${this._formatRosterLabel(targetRosterId)} に貼付しました`);
      this.render();
    } else if (item.itemType === "roster") {
      if (this.activeTab === "tab-trains" && targetRosterId && insertAt !== null) {
        const flatTrains = item.items.flatMap(r => Array.isArray(r.trains) ? r.trains : []);
        const res = this.model.insertTrains(targetRosterId, flatTrains, insertAt);
        if (res.ok) {
          if (item.mode === "cut") this.pocketItems.splice(itemIdx, 1);
          this._flashTarget = { type: "trains", rosterId: targetRosterId, indices: res.insertedIndices, scrollIntoView: true };
          this._notifyToast(`${flatTrains.length}本を展開貼付しました`);
          this.render();
        }
      } else {
        const createdIds = this.model.insertRosters(item.items, insertAt);
        if (item.mode === "cut") this.pocketItems.splice(itemIdx, 1);
        if (createdIds.length > 0) {
          this._flashTarget = { type: "rosters", ids: createdIds, scrollIntoView: true };
          this._notifyToast(`運用 ${createdIds.join(", ")} を貼付しました`);
        }
        this.render();
      }
    }
  }

  pasteAllPocketItems(targetRosterId = this.activeRosterId) {
    if (this.pocketItems.length === 0) return;
    const trainItems = this.pocketItems.filter(p => p.itemType === "train");
    const rosterItems = this.pocketItems.filter(p => p.itemType === "roster");
    let pastedCount = 0;

    if (trainItems.length > 0) {
      let tid = targetRosterId;
      if (!tid || !this.model.getRoster(tid)) {
        tid = this.model.addRoster({ trains: [] });
        this.activeRosterId = tid;
      }
      const combined = trainItems.flatMap(p => p.items);
      const res = this.model.insertTrains(tid, combined, null);
      if (res.ok) {
        pastedCount += combined.length;
        this._flashTarget = { type: "trains", rosterId: tid, indices: res.insertedIndices, scrollIntoView: true };
      }
    }

    if (rosterItems.length > 0) {
      const combinedRosters = rosterItems.flatMap(p => p.items);
      const createdIds = this.model.insertRosters(combinedRosters, null);
      pastedCount += createdIds.length;
    }

    this.pocketItems = this.pocketItems.filter(p => p.mode !== "cut");
    this._notifyToast(`ポケットから一括貼付しました (${pastedCount}件)`);
    this.render();
  }

  restoreCutPocketItem(uid) {
    const idx = this.pocketItems.findIndex(p => p.uid === uid);
    if (idx === -1) return;
    const item = this.pocketItems[idx];
    if (item.mode !== "cut") return;

    if (item.itemType === "train") {
      const existing = this.model.getRoster(item.sourceRosterId);
      if (existing) {
        const at = Math.min(item.sourceIndex || 0, existing.trains.length);
        const res = this.model.insertTrains(existing.id, item.items, at);
        if (res.ok) {
          this.pocketItems.splice(idx, 1);
          this._flashTarget = { type: "trains", rosterId: existing.id, indices: res.insertedIndices, scrollIntoView: true };
          this._notifyToast(`元運用 ${this._formatRosterLabel(existing)} へ戻しました`);
          this.render();
        }
      } else {
        const created = this.model.insertRosters([{
          id: item.sourceRosterId,
          name: item.sourceRosterName || item.sourceRosterId,
          trains: item.items
        }], null);
        this.pocketItems.splice(idx, 1);
        this._notifyToast(`削除されていた元運用 ${created[0]} を復元して戻しました`);
        this.render();
      }
    } else if (item.itemType === "roster") {
      const created = this.model.insertRosters(item.items, item.sourceIndex);
      this.pocketItems.splice(idx, 1);
      this._flashTarget = { type: "rosters", ids: created, scrollIntoView: true };
      this._notifyToast(`元の位置へ運用 ${created.join(", ")} を戻しました`);
      this.render();
    }
  }

  restoreAllCutPocketItems() {
    const cutUids = this.pocketItems.filter(p => p.mode === "cut").map(p => p.uid);
    for (let i = cutUids.length - 1; i >= 0; i--) {
      this.restoreCutPocketItem(cutUids[i]);
    }
  }

  removePocketItem(uid) {
    const idx = this.pocketItems.findIndex(p => p.uid === uid);
    if (idx === -1) return;
    this.pocketItems.splice(idx, 1);
    this.render();
  }

  clearPocket() {
    const cutCount = this.pocketItems.filter(p => p.mode === "cut").length;
    if (cutCount > 0) {
      if (!confirm(`切り取り移動中の項目が ${cutCount}件 含まれています。\n元運用へ戻さずにポケットを空にしますか？（「切取を全戻し」で元に戻せます）`)) {
        return;
      }
    }
    this.pocketItems = [];
    this.render();
  }

  _clampPocketPosition(el) {
    if (window.innerWidth <= 900) {
      el.style.left = "";
      el.style.top = "";
      return;
    }
    const rect = el.getBoundingClientRect();
    const width = rect.width || (this.pocketMinimized ? 204 : 348);
    const height = rect.height || 44;
    if (!this.pocketPos) {
      const defLeft = Math.max(12, window.innerWidth - 368);
      const defTop = 108;
      this.pocketPos = { left: defLeft, top: defTop };
    }
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - Math.min(height, 120) - 8);
    this.pocketPos.left = Math.min(Math.max(8, this.pocketPos.left), maxLeft);
    this.pocketPos.top = Math.min(Math.max(8, this.pocketPos.top), maxTop);
    el.style.left = `${Math.round(this.pocketPos.left)}px`;
    el.style.top = `${Math.round(this.pocketPos.top)}px`;
  }

  ensureFloatingPocket() {
    if (this.floatingPocketEl && document.body.contains(this.floatingPocketEl)) {
      return this.floatingPocketEl;
    }

    const el = document.createElement("aside");
    el.id = "floatingPocket";
    el.className = "floating-pocket";
    el.hidden = true;
    el.setAttribute("aria-label", "移動ポケット");
    document.body.appendChild(el);
    this.floatingPocketEl = el;

    el.addEventListener("click", (e) => {
      const hdrBtn = e.target.closest("[data-pocket-hdr-act]");
      if (hdrBtn) {
        const act = hdrBtn.dataset.pocketHdrAct;
        if (act === "minimize") {
          this.pocketMinimized = !this.pocketMinimized;
          this._track("pocket_op", { op: this.pocketMinimized ? "minimize" : "restore_window" });
          this.renderFloatingPocket();
        } else if (act === "close") {
          this.setPocketOpen(false);
        }
        return;
      }

      const modeBtn = e.target.closest("[data-pocket-mode]");
      if (modeBtn) {
        this.pocketDragMode = modeBtn.dataset.pocketMode === "copy" ? "copy" : "cut";
        this._track("pocket_op", { op: "drag_mode", mode: this.pocketDragMode });
        this.renderFloatingPocket();
        return;
      }

      const cardActBtn = e.target.closest("[data-pocket-act]");
      if (cardActBtn) {
        const card = cardActBtn.closest(".pocket-item-card");
        const uid = card ? card.dataset.pocketUid : null;
        const act = cardActBtn.dataset.pocketAct;
        if (!uid) return;
        this._track("pocket_op", { op: act });
        if (act === "paste") {
          this.pastePocketItem(uid, this.activeRosterId, null);
        } else if (act === "restore") {
          this.restoreCutPocketItem(uid);
        } else if (act === "remove") {
          this.removePocketItem(uid);
        } else if (act === "move-up") {
          this.movePocketItem(uid, -1);
        } else if (act === "move-down") {
          this.movePocketItem(uid, 1);
        }
        return;
      }

      const footBtn = e.target.closest("[data-pocket-foot-act]");
      if (footBtn) {
        const act = footBtn.dataset.pocketFootAct;
        this._track("pocket_op", { op: act, items_count: this.pocketItems.length });
        if (act === "paste-all") {
          this.pasteAllPocketItems(this.activeRosterId);
        } else if (act === "restore-all") {
          this.restoreAllCutPocketItems();
        } else if (act === "clear") {
          this.clearPocket();
        } else if (act === "new-roster") {
          const newId = this.model.addRoster({});
          this.setActiveRoster(newId, true);
        }
      }
    });

    el.addEventListener("change", (e) => {
      if (e.target && e.target.id === "pocketTargetRosterSelect") {
        this._track("pocket_op", { op: "select_target_roster" });
        this.setActiveRoster(e.target.value, true);
      }
    });

    el.addEventListener("pointerdown", (e) => {
      const hdr = e.target.closest(".pocket-header");
      if (hdr && !e.target.closest("button")) {
        if (window.innerWidth <= 900) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const origPos = this.pocketPos
          ? { left: this.pocketPos.left, top: this.pocketPos.top }
          : { left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top };

        const onMove = (mv) => {
          this.pocketPos = {
            left: origPos.left + (mv.clientX - startX),
            top: origPos.top + (mv.clientY - startY)
          };
          this._clampPocketPosition(el);
        };
        const onUp = () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return;
      }

      const cardGrip = e.target.closest(".pocket-card-drag");
      if (cardGrip) {
        const card = cardGrip.closest(".pocket-item-card");
        const uid = card ? card.dataset.pocketUid : null;
        if (uid) {
          this._startPocketItemDrag(e, uid);
        }
      }
    });

    return el;
  }

  renderFloatingPocket() {
    document.body.classList.toggle("has-mobile-pocket-open", this.pocketOpen && !this.pocketMinimized);
    if (!this.pocketOpen) {
      this._wasPocketOpen = false;
      this._animateNextPocketOpen = false;
      if (this.floatingPocketEl) {
        this.floatingPocketEl.classList.remove("anim-open");
        this.floatingPocketEl.hidden = true;
      }
      return;
    }

    const el = this.ensureFloatingPocket();
    el.hidden = false;
    el.classList.toggle("is-minimized", this.pocketMinimized);
    const shouldAnimateOpen = this._animateNextPocketOpen;
    this._animateNextPocketOpen = false;
    el.classList.toggle("anim-open", shouldAnimateOpen);

    const items = this.pocketItems;
    const cutCount = items.filter(p => p.mode === "cut").length;
    const rosters = this.model.getRosters();

    if (this.pocketMinimized) {
      el.innerHTML = `
        <div class="pocket-header" title="展開して移動ポケットを表示">
          <div class="pocket-title-group">
            ${this._uiIcon("pocket", 13)}
            <span>移動ポケット</span>
            <span class="pocket-hdr-count">${items.length}</span>
          </div>
          <div class="pocket-header-btns">
            <button type="button" class="pocket-hdr-btn" data-pocket-hdr-act="minimize" title="展開する" aria-label="展開する">${this._uiIcon("expand", 11)}</button>
            <button type="button" class="pocket-hdr-btn" data-pocket-hdr-act="close" title="閉じる" aria-label="閉じる">${this._uiIcon("close", 11)}</button>
          </div>
        </div>
      `;
      this._clampPocketPosition(el);
      return;
    }

    const cardsHtml = items.map((item, itemIdx) => {
      const isCut = item.mode === "cut";
      const isNewCard = this._newPocketUids.has(item.uid);
      const badgeHtml = isCut
        ? `${this._uiIcon("cut", 10)} 切取`
        : `${this._uiIcon("copy", 10)} コピー`;
      const subSummary = item.itemType === "train" && item.items.length > 1
        ? `<div class="pocket-card-sub">${this.escapeXml(item.items.slice(0, 3).map(t => this._describeTrain(t)).join(" / "))}${item.items.length > 3 ? ` 他${item.items.length - 3}本` : ""}</div>`
        : "";
      const disableUp = itemIdx === 0 ? "disabled" : "";
      const disableDown = itemIdx === items.length - 1 ? "disabled" : "";
      return `
        <div class="pocket-item-card ${isCut ? 'is-cut' : 'is-copy'} ${isNewCard ? 'anim-card-in' : ''}" data-pocket-uid="${this.escapeXml(item.uid)}">
          <div class="pocket-card-top">
            <span class="pocket-card-drag" title="ドラッグして表の好きな行位置・運用へ直接ドロップ">${this._uiIcon("grip", 10)}</span>
            <span class="pocket-badge ${isCut ? 'is-cut' : 'is-copy'}">${badgeHtml}</span>
            <span class="pocket-card-origin" title="${this.escapeXml(item.originLabel)}">元: ${this.escapeXml(item.originLabel)}</span>
          </div>
          <div class="pocket-card-main">
            <div>${this.escapeXml(item.title)}</div>
            ${subSummary}
          </div>
          <div class="pocket-card-actions">
            <div class="pocket-card-move-group">
              <button type="button" class="btn btn-xs btn-secondary btn-pocket-move" data-pocket-act="move-up" title="ポケット内で上へ" aria-label="上へ移動" ${disableUp}>↑</button>
              <button type="button" class="btn btn-xs btn-secondary btn-pocket-move" data-pocket-act="move-down" title="ポケット内で下へ" aria-label="下へ移動" ${disableDown}>↓</button>
            </div>
            <button type="button" class="btn btn-xs btn-primary" data-pocket-act="paste" title="選択中の貼り付け先運用へ貼り付け">${this._uiIcon("paste", 11)} 貼付</button>
            ${isCut ? `<button type="button" class="btn btn-xs btn-secondary" data-pocket-act="restore" title="切り取り元の場所へ戻す">${this._uiIcon("restore", 11)} 戻す</button>` : ''}
            <button type="button" class="btn btn-xs btn-secondary text-danger" data-pocket-act="remove" title="ポケットから外す" aria-label="ポケットから外す">✕</button>
          </div>
        </div>
      `;
    }).join("");

    this._newPocketUids.clear();

    el.innerHTML = `
      <div class="pocket-header" title="ヘッダーを掴んで移動できます（背後の画面もそのまま操作可能）">
        <div class="pocket-title-group">
          ${this._uiIcon("pocket", 13)}
          <span>移動ポケット</span>
          <span class="pocket-hdr-count">${items.length}</span>
        </div>
        <div class="pocket-header-btns">
          <button type="button" class="pocket-hdr-btn" data-pocket-hdr-act="minimize" title="最小化" aria-label="最小化">${this._uiIcon("min", 11)}</button>
          <button type="button" class="pocket-hdr-btn" data-pocket-hdr-act="close" title="閉じる（内容は保持されます）" aria-label="閉じる">${this._uiIcon("close", 11)}</button>
        </div>
      </div>

      <div class="pocket-mode-bar">
        <span>ドラッグ搬入時</span>
        <div class="pocket-mode-pills">
          <button type="button" class="pocket-mode-btn is-cut ${this.pocketDragMode === 'cut' ? 'active' : ''}" data-pocket-mode="cut">${this._uiIcon("cut", 10)} 切取で移動</button>
          <button type="button" class="pocket-mode-btn is-copy ${this.pocketDragMode === 'copy' ? 'active' : ''}" data-pocket-mode="copy">${this._uiIcon("copy", 10)} コピー</button>
        </div>
      </div>

      <div class="pocket-body" id="pocketBody">
        ${items.length === 0 ? `
          <div class="pocket-empty-state">
            表の左端ドットをここへドラッグするか、<br>
            チェック選択バーの「ポケットへ移動」で一時退避できます。<br>
            <span style="font-size:10px;opacity:0.85;">ポケットを開いたまま背後の運用切替・編集が可能です</span>
          </div>
        ` : cardsHtml}
      </div>

      <div class="pocket-footer">
        <div class="pocket-footer-left" style="flex:1;min-width:0;">
          <span style="font-size:10.5px;color:var(--text-muted);white-space:nowrap;">貼付先:</span>
          <select id="pocketTargetRosterSelect" class="cell-select" style="flex:1;min-width:70px;border:1px solid var(--border-color);background:#fff;height:22px;">
            ${rosters.map(r => `
              <option value="${this.escapeXml(r.id)}" ${r.id === this.activeRosterId ? 'selected' : ''}>
                ${this.escapeXml(this._formatRosterLabel(r))} (${(r.trains || []).length}本)
              </option>
            `).join("")}
          </select>
          <button type="button" class="btn btn-xs btn-secondary" data-pocket-foot-act="new-roster" title="新しい運用を追加して貼り付け先に選ぶ">＋新規</button>
        </div>
        ${items.length > 0 ? `
          <div class="pocket-footer-right" style="width:100%;justify-content:flex-end;">
            <button type="button" class="btn btn-xs btn-primary" data-pocket-foot-act="paste-all">すべて貼付</button>
            ${cutCount > 0 ? `<button type="button" class="btn btn-xs btn-secondary" data-pocket-foot-act="restore-all">切取を全戻し</button>` : ''}
            <button type="button" class="btn btn-xs btn-secondary text-danger" data-pocket-foot-act="clear">クリア</button>
          </div>
        ` : ''}
      </div>
    `;

    this._clampPocketPosition(el);
  }

  // -------------------- ポインター方式ドラッグ＆ドロップ --------------------
  _bindTableRowPointerDrag(tableEl, kind) {
    tableEl.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(`.row-drag-handle[data-drag-kind="${kind}"]`);
      if (!handle) return;
      const tr = handle.closest("tr");
      if (!tr) return;

      if (kind === "train") {
        const idx = parseInt(tr.dataset.trainIdx, 10);
        if (Number.isNaN(idx)) return;
        const roster = this.model.getRoster(this.activeRosterId);
        if (!roster) return;
        const indices = this.selectedTrainIndices.has(idx)
          ? [...this.selectedTrainIndices].sort((a, b) => a - b)
          : [idx];
        const trains = indices.map(i => roster.trains[i]).filter(Boolean);
        const label = indices.length === 1
          ? this._describeTrain(trains[0])
          : `選択 ${indices.length}本の列車`;

        this._beginPointerDrag({
          startEvent: e,
          label,
          kind: "train",
          sourceRowEls: indices.map(i => tableEl.querySelector(`tbody tr[data-train-idx="${i}"]`)).filter(Boolean),
          onDrop: (dropInfo) => {
            if (dropInfo.overPocket) {
              this._track("pocket_op", { op: "drag_into", kind: "train", mode: this.pocketDragMode, count: indices.length });
              this.addTrainsToPocket(this.activeRosterId, indices, this.pocketDragMode);
              this.selectedTrainIndices.clear();
              this.render();
            } else if (dropInfo.trainInsertIndex !== null) {
              this._setCtx({ via: "drag" });
              const moved = this.model.moveTrainsBlock(this.activeRosterId, indices, dropInfo.trainInsertIndex);
              if (moved.length > 0) {
                this._track("drag_reorder", { kind: "train", count: moved.length });
                this.selectedTrainIndices = new Set(moved);
                this._flashTarget = { type: "trains", rosterId: this.activeRosterId, indices: moved };
                this.render();
              }
            }
          }
        });
      } else if (kind === "roster") {
        const rosterId = tr.dataset.rosterId;
        if (!rosterId) return;
        const rosters = this.model.getRosters();
        const ids = this.selectedRosterIds.has(rosterId)
          ? rosters.filter(r => this.selectedRosterIds.has(r.id)).map(r => r.id)
          : [rosterId];
        const label = ids.length === 1
          ? `運用 ${this._formatRosterLabel(rosterId)}`
          : `選択 ${ids.length}件の運用`;

        this._beginPointerDrag({
          startEvent: e,
          label,
          kind: "roster",
          sourceRowEls: ids.map(id => [...tableEl.querySelectorAll("tbody tr")].find(r => r.dataset.rosterId === id)).filter(Boolean),
          onDrop: (dropInfo) => {
            if (dropInfo.overPocket) {
              this._track("pocket_op", { op: "drag_into", kind: "roster", mode: this.pocketDragMode, count: ids.length });
              this.addRostersToPocket(ids, this.pocketDragMode);
              this.selectedRosterIds.clear();
              this.render();
            } else if (dropInfo.rosterInsertIndex !== null) {
              this._setCtx({ via: "drag" });
              this.model.moveRostersBlock(ids, dropInfo.rosterInsertIndex);
              this._track("drag_reorder", { kind: "roster", count: ids.length });
              this._flashTarget = { type: "rosters", ids };
              this.render();
            }
          }
        });
      } else if (kind === "station") {
        const curIdx = parseInt(tr.dataset.stationIdx, 10);
        if (Number.isNaN(curIdx)) return;
        const st = this.model.getStations()[curIdx];
        const label = `駅: ${st ? st.name : ""}`;

        this._beginPointerDrag({
          startEvent: e,
          label,
          kind: "station",
          sourceRowEls: [tr],
          onDrop: (dropInfo) => {
            if (dropInfo.stationInsertIndex !== null) {
              const raw = dropInfo.stationInsertIndex;
              const targetIdx = raw > curIdx ? raw - 1 : raw;
              if (targetIdx !== curIdx) {
                this._setCtx({ via: "drag" });
                this._flashTarget = { type: "stations", index: targetIdx };
                this.model.moveStation(curIdx, targetIdx);
                this._track("drag_reorder", { kind: "station", count: 1 });
              }
            }
          }
        });
      }
    });
  }

  _startPocketItemDrag(startEvent, uid) {
    const idx = this.pocketItems.findIndex(p => p.uid === uid);
    if (idx === -1) return;
    const item = this.pocketItems[idx];
    const cardEl = this.floatingPocketEl ? this.floatingPocketEl.querySelector(`.pocket-item-card[data-pocket-uid="${uid}"]`) : null;
    const modePrefix = item.mode === "cut" ? "[切取] " : "[コピー] ";

    this._beginPointerDrag({
      startEvent,
      label: `${modePrefix}${item.title}`,
      kind: "pocket",
      ghostIcon: item.mode === "cut" ? "cut" : "copy",
      pocketItemType: item.itemType,
      sourceRowEls: cardEl ? [cardEl] : [],
      onDrop: (dropInfo) => {
        if (dropInfo.pocketReorderIndex !== null) {
          const fromIdx = this.pocketItems.findIndex(p => p.uid === uid);
          if (fromIdx === -1) return;
          let toIdx = dropInfo.pocketReorderIndex;
          if (toIdx > fromIdx) toIdx -= 1;
          if (toIdx !== fromIdx && toIdx >= 0 && toIdx < this.pocketItems.length) {
            const [moved] = this.pocketItems.splice(fromIdx, 1);
            this.pocketItems.splice(toIdx, 0, moved);
            this.renderFloatingPocket();
          }
        } else if (dropInfo.trainInsertIndex !== null) {
          this.pastePocketItem(uid, this.activeRosterId, dropInfo.trainInsertIndex);
        } else if (dropInfo.targetRosterIdForTrain) {
          this.pastePocketItem(uid, dropInfo.targetRosterIdForTrain, null);
        } else if (dropInfo.rosterInsertIndex !== null) {
          this.pastePocketItem(uid, null, dropInfo.rosterInsertIndex);
        }
      }
    });
  }

  _beginPointerDrag({ startEvent, label, kind, ghostIcon = "grip", pocketItemType = null, sourceRowEls = [], onDrop }) {
    if (startEvent.button !== undefined && startEvent.button !== 0 && startEvent.pointerType === "mouse") {
      return;
    }
    startEvent.preventDefault();

    const startX = startEvent.clientX;
    const startY = startEvent.clientY;
    let started = false;
    let ghostEl = null;
    let rafScrollId = 0;
    let lastClientX = startX;
    let lastClientY = startY;
    let highlightedEls = [];
    let currentDrop = {
      overPocket: false,
      trainInsertIndex: null,
      rosterInsertIndex: null,
      stationInsertIndex: null,
      targetRosterIdForTrain: null,
      pocketReorderIndex: null
    };

    const clearHighlights = () => {
      highlightedEls.forEach(el => {
        el.classList.remove("drag-insert-before", "drag-insert-after", "drag-roster-target", "is-drop-active");
      });
      highlightedEls = [];
    };

    const hitTestAndHighlight = (clientX, clientY) => {
      clearHighlights();
      currentDrop = {
        overPocket: false,
        trainInsertIndex: null,
        rosterInsertIndex: null,
        stationInsertIndex: null,
        targetRosterIdForTrain: null,
        pocketReorderIndex: null
      };

      const pocketEl = this.floatingPocketEl;
      if (pocketEl && !pocketEl.hidden) {
        const pr = pocketEl.getBoundingClientRect();
        if (clientX >= pr.left && clientX <= pr.right && clientY >= pr.top && clientY <= pr.bottom) {
          if (kind === "train" || kind === "roster") {
            pocketEl.classList.add("is-drop-active");
            highlightedEls.push(pocketEl);
            currentDrop.overPocket = true;
            return;
          }
          if (kind === "pocket") {
            const card = document.elementFromPoint(clientX, clientY)?.closest(".pocket-item-card");
            if (card) {
              const r = card.getBoundingClientRect();
              const isBefore = clientY < r.top + r.height / 2;
              card.classList.add(isBefore ? "drag-insert-before" : "drag-insert-after");
              highlightedEls.push(card);
              const allCards = [...pocketEl.querySelectorAll(".pocket-item-card")];
              const idx = allCards.indexOf(card);
              if (idx !== -1) currentDrop.pocketReorderIndex = isBefore ? idx : idx + 1;
            }
            return;
          }
        }
      }

      const hit = document.elementFromPoint(clientX, clientY);
      if (!hit) return;

      if (kind === "train" || (kind === "pocket")) {
        const trainsTable = this.container.querySelector("#trainsGridTable");
        const emptyGuide = this.container.querySelector(".empty-trains-guide");
        const tr = hit.closest("#trainsGridTable tbody tr");
        if (tr) {
          const r = tr.getBoundingClientRect();
          const isBefore = clientY < r.top + r.height / 2;
          tr.classList.add(isBefore ? "drag-insert-before" : "drag-insert-after");
          highlightedEls.push(tr);
          const idx = parseInt(tr.dataset.trainIdx, 10);
          if (!Number.isNaN(idx)) currentDrop.trainInsertIndex = isBefore ? idx : idx + 1;
          return;
        }
        if (kind === "pocket" && trainsTable && hit.closest(".table-scroll-container")) {
          const tbody = trainsTable.querySelector("tbody");
          const rows = tbody ? [...tbody.querySelectorAll("tr")] : [];
          if (rows.length === 0 || (emptyGuide && emptyGuide.contains(hit))) {
            currentDrop.trainInsertIndex = 0;
          } else {
            const last = rows[rows.length - 1];
            last.classList.add("drag-insert-after");
            highlightedEls.push(last);
            currentDrop.trainInsertIndex = rows.length;
          }
          return;
        }
      }

      if (kind === "roster" || kind === "pocket") {
        let tr = hit.closest("#rostersGridTable tbody tr[data-roster-id]");
        if (!tr) {
          const detailTr = hit.closest("#rostersGridTable tbody tr.roster-detail-row");
          if (detailTr && detailTr.dataset.rosterDetailFor) {
            tr = [...this.container.querySelectorAll("#rostersGridTable tbody tr[data-roster-id]")]
              .find(r => r.dataset.rosterId === detailTr.dataset.rosterDetailFor) || null;
          }
        }
        if (tr) {
          if (kind === "pocket" && pocketItemType === "train") {
            tr.classList.add("drag-roster-target");
            highlightedEls.push(tr);
            currentDrop.targetRosterIdForTrain = tr.dataset.rosterId || null;
          } else {
            const r = tr.getBoundingClientRect();
            const isBefore = clientY < r.top + r.height / 2;
            tr.classList.add(isBefore ? "drag-insert-before" : "drag-insert-after");
            highlightedEls.push(tr);
            const rows = [...this.container.querySelectorAll("#rostersGridTable tbody tr[data-roster-id]")];
            const idx = rows.indexOf(tr);
            if (idx !== -1) currentDrop.rosterInsertIndex = isBefore ? idx : idx + 1;
          }
          return;
        }
      }

      if (kind === "station") {
        const tr = hit.closest("#stationsGridTable tbody tr");
        if (tr) {
          const r = tr.getBoundingClientRect();
          const isBefore = clientY < r.top + r.height / 2;
          tr.classList.add(isBefore ? "drag-insert-before" : "drag-insert-after");
          highlightedEls.push(tr);
          const idx = parseInt(tr.dataset.stationIdx, 10);
          if (!Number.isNaN(idx)) currentDrop.stationInsertIndex = isBefore ? idx : idx + 1;
        }
      }
    };

    const runAutoScroll = () => {
      rafScrollId = 0;
      if (!started) return;
      const sc = this.container.querySelector(".table-scroll-container");
      if (sc) {
        const r = sc.getBoundingClientRect();
        if (lastClientX >= r.left && lastClientX <= r.right) {
          if (lastClientY < r.top + 38 && sc.scrollTop > 0) {
            sc.scrollTop -= 12;
            hitTestAndHighlight(lastClientX, lastClientY);
            rafScrollId = requestAnimationFrame(runAutoScroll);
            return;
          }
          if (lastClientY > r.bottom - 38 && sc.scrollTop + sc.clientHeight < sc.scrollHeight) {
            sc.scrollTop += 12;
            hitTestAndHighlight(lastClientX, lastClientY);
            rafScrollId = requestAnimationFrame(runAutoScroll);
          }
        }
      }
    };

    const cleanup = () => {
      if (rafScrollId) cancelAnimationFrame(rafScrollId);
      clearHighlights();
      sourceRowEls.forEach(el => el.classList.remove("is-dragging-source"));
      if (ghostEl && ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };

    const onMove = (mv) => {
      lastClientX = mv.clientX;
      lastClientY = mv.clientY;
      if (!started) {
        if (Math.hypot(mv.clientX - startX, mv.clientY - startY) < 5) return;
        started = true;
        sourceRowEls.forEach(el => el.classList.add("is-dragging-source"));
        ghostEl = document.createElement("div");
        ghostEl.className = "drag-ghost-pill";
        ghostEl.innerHTML = `${this._uiIcon(ghostIcon, 11)}<span>${this.escapeXml(label)}</span>`;
        document.body.appendChild(ghostEl);
      }
      ghostEl.style.left = `${Math.round(mv.clientX + 14)}px`;
      ghostEl.style.top = `${Math.round(mv.clientY + 10)}px`;
      hitTestAndHighlight(mv.clientX, mv.clientY);
      if (!rafScrollId) {
        rafScrollId = requestAnimationFrame(runAutoScroll);
      }
    };

    const onUp = (upEv) => {
      if (started) {
        hitTestAndHighlight(upEv.clientX, upEv.clientY);
      }
      const dropSnapshot = Object.assign({}, currentDrop);
      const didStart = started;
      cleanup();
      if (didStart && typeof onDrop === "function") {
        onDrop(dropSnapshot);
      }
    };

    const onCancel = () => cleanup();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
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
    this._track("type_palette_applied", { preset: presetName });
    this.render();
  }

  _uiIcon(name, size = 12) {
    const s = Number(size) || 12;
    if (name === "grip") {
      const gw = Math.max(9, Math.round(s * 0.85));
      const gh = Math.round(s * 1.25);
      return `<svg class="ui-ico" width="${gw}" height="${gh}" viewBox="0 0 10 14" aria-hidden="true" fill="currentColor"><circle cx="3" cy="3" r="1.05"/><circle cx="7" cy="3" r="1.05"/><circle cx="3" cy="7" r="1.05"/><circle cx="7" cy="7" r="1.05"/><circle cx="3" cy="11" r="1.05"/><circle cx="7" cy="11" r="1.05"/></svg>`;
    }
    const base = `class="ui-ico" width="${s}" height="${s}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`;
    switch (name) {
      case "copy":
        return `<svg ${base} viewBox="0 0 16 16"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/></svg>`;
      case "cut":
        return `<svg ${base} viewBox="0 0 16 16"><circle cx="4.5" cy="12" r="2"/><circle cx="11.5" cy="12" r="2"/><path d="M5.7 10.3L12.5 2.5"/><path d="M10.3 10.3L3.5 2.5"/></svg>`;
      case "paste":
        return `<svg ${base} viewBox="0 0 16 16"><rect x="3" y="3.5" width="10" height="11" rx="1.5"/><path d="M6 3.5V2.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/></svg>`;
      case "pocket":
        return `<svg ${base} viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10.5" rx="1.8"/><path d="M2 7.5h3.5l1.2 1.8h2.6l1.2-1.8H14"/></svg>`;
      case "restore":
        return `<svg ${base} viewBox="0 0 16 16"><path d="M3.5 6.5H10a3.5 3.5 0 1 1 0 7H7"/><path d="M6 4L3.2 6.5 6 9"/></svg>`;
      case "min":
        return `<svg ${base} viewBox="0 0 16 16"><path d="M3.5 8.5h9"/></svg>`;
      case "expand":
        return `<svg ${base} viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>`;
      case "close":
        return `<svg ${base} viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;
      default:
        return "";
    }
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
