import { localizeDocument, getTranslation } from "../utils/i18n.mjs";

const DEFAULT_COLOR = "#0078D4";

const ACTION_TYPES = [
  {
    value: "mark_read",
    i18nKey: "optionsActionTypeMarkReadLabel",
    needsFolder: false,
  },
  {
    value: "mark_unread",
    i18nKey: "optionsActionTypeMarkUnreadLabel",
    needsFolder: false,
  },
  {
    value: "flag",
    i18nKey: "optionsActionTypeFlagLabel",
    needsFolder: false,
  },
  {
    value: "unflag",
    i18nKey: "optionsActionTypeUnflagLabel",
    needsFolder: false,
  },
  {
    value: "archive",
    i18nKey: "optionsActionTypeArchiveLabel",
    needsFolder: false,
  },
  {
    value: "delete",
    i18nKey: "optionsActionTypeDeleteLabel",
    needsFolder: false,
  },
  {
    value: "delete_permanent",
    i18nKey: "optionsActionTypeDeletePermanentLabel",
    needsFolder: false,
  },
  {
    value: "move",
    i18nKey: "optionsActionTypeMoveLabel",
    needsFolder: true,
  },
  {
    value: "copy",
    i18nKey: "optionsActionTypeCopyLabel",
    needsFolder: true,
  },
];

const ACTION_LABELS = {
  mark_read: () => getTranslation("actionMarkRead"),
  mark_unread: () => getTranslation("actionMarkUnread"),
  flag: () => getTranslation("actionFlag"),
  unflag: () => getTranslation("actionUnflag"),
  archive: () => getTranslation("actionArchive"),
  delete: () => getTranslation("actionDeleteTrash"),
  delete_permanent: () => getTranslation("actionDeletePermanent"),
  move: (a) => getTranslation("actionMoveLabel", a.folder?.name || "?"),
  copy: (a) => getTranslation("actionCopyLabel", a.folder?.name || "?"),
};

function getActionLabel(action) {
  const fn = ACTION_LABELS[action.type];
  return fn ? fn(action) : action.type;
}

function generateId() {
  return "qs_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
}

function isStepBlank(step) {
  return (
    !step.name.trim() &&
    step.actions.length === 1 &&
    step.actions[0].type === "mark_read"
  );
}

let state = {
  steps: [],
  folders: [],
  foldersLoaded: false,
  editing: null,
  editingId: null,
  isNew: false,
};

const els = {
  stepsList: () => document.getElementById("steps-list"),
  sidebarEmpty: () => document.getElementById("sidebar-empty"),
  placeholder: () => document.getElementById("editor-placeholder"),
  editor: () => document.getElementById("editor"),
  stepName: () => document.getElementById("step-name"),
  previewActions: () => document.getElementById("editor-preview-actions"),
  actionsList: () => document.getElementById("actions-list"),
  addActionBtn: () => document.getElementById("btn-add-action"),
  saveBtn: () => document.getElementById("btn-save"),
  deleteStepBtn: () => document.getElementById("btn-delete-step"),
  newStepBtn: () => document.getElementById("btn-new-step"),
  confirmOverlay: () => document.getElementById("confirm-overlay"),
  confirmMessage: () => document.getElementById("confirm-message"),
  confirmOk: () => document.getElementById("confirm-ok"),
  confirmCancel: () => document.getElementById("confirm-cancel"),
  toast: () => document.getElementById("toast"),
  colorSwatch: () => document.getElementById("color-swatch"),
};

let toastTimer = null;
function showToast(msg, type = "info") {
  const toast = els.toast();
  toast.textContent = msg;
  toast.className = `toast-${type}`;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function showConfirm(message) {
  return new Promise((resolve) => {
    els.confirmMessage().textContent = message;
    els.confirmOverlay().classList.remove("hidden");

    function done(result) {
      els.confirmOverlay().classList.add("hidden");
      els.confirmOk().removeEventListener("click", onOk);
      els.confirmCancel().removeEventListener("click", onCancel);
      resolve(result);
    }
    const onOk = () => done(true);
    const onCancel = () => done(false);

    els.confirmOk().addEventListener("click", onOk);
    els.confirmCancel().addEventListener("click", onCancel);
  });
}

async function ensureFoldersLoaded() {
  if (state.foldersLoaded) return;
  try {
    state.folders = await messenger.runtime.sendMessage({
      type: "GET_ALL_FOLDERS",
    });
  } catch (e) {
    console.error("[QuickSteps] Could not load folders:", e);
    state.folders = [];
  }
  state.foldersLoaded = true;
}

function buildFolderSelect(action) {
  const select = document.createElement("select");
  select.className = "action-folder-select";

  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = getTranslation("optionsSelectFolderPlaceholder");
  select.appendChild(blank);

  const byAccount = {};
  for (const folder of state.folders) {
    if (!byAccount[folder.accountName]) {
      byAccount[folder.accountName] = [];
    }
    byAccount[folder.accountName].push(folder);
  }

  for (const [accountName, folders] of Object.entries(byAccount)) {
    const group = document.createElement("optgroup");
    group.label = accountName;
    for (const folder of folders) {
      const opt = document.createElement("option");
      opt.value = JSON.stringify({
        accountId: folder.accountId,
        accountName: folder.accountName,
        path: folder.path,
        name: folder.name,
        id: folder.id,
      });
      const depth = (folder.path.match(/\//g) || []).length;
      opt.textContent =
        "\u00a0".repeat(Math.max(0, depth - 1) * 2) + folder.name;
      if (
        action.folder &&
        action.folder.accountId === folder.accountId &&
        action.folder.path === folder.path
      ) {
        opt.selected = true;
      }
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  return select;
}

async function persistSteps() {
  await messenger.runtime.sendMessage({
    type: "SAVE_QUICK_STEPS",
    steps: state.steps,
  });
}

async function autoSave() {
  if (!state.editing) return;

  if (state.isNew && isStepBlank(state.editing)) {
    state.steps = state.steps.filter((x) => x.id !== state.editing.id);
    return;
  }

  if (!state.editing.name.trim()) state.editing.name = "Untitled";

  const idx = state.steps.findIndex((x) => x.id === state.editing.id);
  const clone = JSON.parse(JSON.stringify(state.editing));
  if (idx >= 0) state.steps[idx] = clone;
  else state.steps.push(clone);

  try {
    await persistSteps();
  } catch (e) {
    console.error("[QuickSteps] Auto-save failed:", e);
  }
}

function createDragAndDropListeners(item, stepId) {
  item.draggable = true;

  item.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", stepId);
    item.classList.add("dragging");
  });

  item.addEventListener("dragover", (e) => {
    e.preventDefault();
    const bounding = item.getBoundingClientRect();
    const offset = e.clientY - bounding.top;
    if (offset > bounding.height / 2) {
      item.classList.add("drag-over-bottom");
      item.classList.remove("drag-over-top");
    } else {
      item.classList.add("drag-over-top");
      item.classList.remove("drag-over-bottom");
    }
  });

  item.addEventListener("dragleave", () => {
    item.classList.remove("drag-over-top", "drag-over-bottom");
  });

  item.addEventListener("drop", async (e) => {
    e.preventDefault();
    item.classList.remove("drag-over-top", "drag-over-bottom");

    const draggedStepId = e.dataTransfer.getData("text/plain");
    if (!draggedStepId) return;

    const sourceIndex = state.steps.findIndex((s) => s.id === draggedStepId);
    const targetIndex = state.steps.findIndex((s) => s.id === stepId);
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex)
      return;

    const bounding = item.getBoundingClientRect();
    const offset = e.clientY - bounding.top;

    const movingStep = state.steps[sourceIndex];
    state.steps.splice(sourceIndex, 1);

    let insertIndex = targetIndex;
    if (offset > bounding.height / 2) {
      insertIndex = sourceIndex < targetIndex ? targetIndex : targetIndex + 1;
    } else {
      insertIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
    }

    state.steps.splice(insertIndex, 0, movingStep);

    renderSidebar();
    await persistSteps();
  });

  item.addEventListener("dragend", () => {
    item.classList.remove("dragging");
    document.querySelectorAll(".step-item").forEach((el) => {
      el.classList.remove("drag-over-top", "drag-over-bottom");
    });
  });
}

function renderSidebar() {
  const list = els.stepsList();
  list.innerHTML = "";

  if (!state.steps.length) {
    els.sidebarEmpty().classList.remove("hidden");
    return;
  }
  els.sidebarEmpty().classList.add("hidden");

  for (const step of state.steps) {
    const item = document.createElement("div");
    item.className =
      "step-item" + (state.editingId === step.id ? " active" : "");
    item.dataset.id = step.id;

    const info = document.createElement("div");
    info.className = "step-item-info";

    const name = document.createElement("div");
    name.className = "step-item-name";
    name.style.color = step.color || DEFAULT_COLOR;
    name.textContent = step.name || getTranslation("optionsPlaceholderTitle");

    const meta = document.createElement("div");
    meta.className = "step-item-meta";
    meta.textContent = step.actions.length
      ? step.actions.map(getActionLabel).join(" → ")
      : getTranslation("optionsNoActionsAssigned");

    info.append(name, meta);
    item.append(info);
    item.addEventListener("click", () => navigateTo(step.id));

    createDragAndDropListeners(item, step.id);

    list.appendChild(item);
  }
}

function renderEditor() {
  if (!state.editing) {
    els.editor().classList.add("hidden");
    els.placeholder().classList.remove("hidden");

    els.saveBtn().disabled = true;
    els.deleteStepBtn().disabled = true;

    return;
  }

  els.saveBtn().disabled = false;
  els.deleteStepBtn().disabled = false;

  els.placeholder().classList.add("hidden");
  els.editor().classList.remove("hidden");

  els.stepName().value = state.editing.name || "";
  updatePreviewActions();
  renderActionsList();

  els.colorSwatch().style.backgroundColor =
    state.editing.color || DEFAULT_COLOR;
}

function updatePreviewActions() {
  if (!state.editing) return;
  els.previewActions().textContent = state.editing.actions.length
    ? state.editing.actions.map(getActionLabel).join(" → ")
    : getTranslation("optionsNoActionsYet");
}

async function renderActionsList() {
  const list = els.actionsList();
  list.innerHTML = "";

  const needsFolders = state.editing.actions.some(
    (a) => a.type === "move" || a.type === "copy",
  );
  if (needsFolders && !state.foldersLoaded) await ensureFoldersLoaded();

  state.editing.actions.forEach((action, i) => {
    list.appendChild(buildActionRow(i, action));
  });
}

function buildActionRow(index, action) {
  const row = document.createElement("div");
  row.className = "action-row";

  const num = document.createElement("span");
  num.className = "action-num";
  num.textContent = index + 1;

  const typeSelect = document.createElement("select");
  typeSelect.className = "action-type-select";
  for (const at of ACTION_TYPES) {
    const opt = document.createElement("option");
    opt.value = at.value;
    opt.textContent = getTranslation(at.i18nKey);
    if (at.value === action.type) opt.selected = true;
    typeSelect.appendChild(opt);
  }

  const folderContainer = document.createElement("div");
  folderContainer.style.flex = "1";
  folderContainer.style.minWidth = "0";

  function refreshFolderPicker(currentAction) {
    folderContainer.innerHTML = "";
    const needsFolder = ACTION_TYPES.find(
      (at) => at.value === currentAction.type,
    )?.needsFolder;
    if (!needsFolder) return;

    if (!state.foldersLoaded) {
      const loading = document.createElement("span");
      loading.className = "action-folder-loading";
      loading.textContent = getTranslation("optionsFoldersLoading");
      folderContainer.appendChild(loading);
      ensureFoldersLoaded().then(() => {
        folderContainer.innerHTML = "";
        const select = buildFolderSelect(currentAction);
        attachFolderListener(select, index);
        folderContainer.appendChild(select);
      });
    } else {
      const select = buildFolderSelect(currentAction);
      attachFolderListener(select, index);
      folderContainer.appendChild(select);
    }
  }

  function attachFolderListener(select, idx) {
    select.addEventListener("change", () => {
      if (select.value) {
        try {
          state.editing.actions[idx].folder = JSON.parse(select.value);
        } catch (_) {}
      } else {
        delete state.editing.actions[idx].folder;
      }
      updatePreviewActions();
    });
  }

  typeSelect.addEventListener("change", () => {
    state.editing.actions[index].type = typeSelect.value;
    if (
      !ACTION_TYPES.find((at) => at.value === typeSelect.value)?.needsFolder
    ) {
      delete state.editing.actions[index].folder;
    }
    refreshFolderPicker(state.editing.actions[index]);
    updatePreviewActions();
  });

  refreshFolderPicker(action);

  const btns = document.createElement("div");
  btns.className = "action-btns";

  const upBtn = document.createElement("button");
  upBtn.className = "action-btn";
  upBtn.title = getTranslation("optionsMoveUpTitle");
  upBtn.textContent = "↑";
  upBtn.disabled = index === 0;
  upBtn.addEventListener("click", () => moveAction(index, -1));

  const downBtn = document.createElement("button");
  downBtn.className = "action-btn";
  downBtn.title = getTranslation("optionsMoveDownTitle");
  downBtn.textContent = "↓";
  downBtn.disabled = index === state.editing.actions.length - 1;
  downBtn.addEventListener("click", () => moveAction(index, 1));

  const removeBtn = document.createElement("button");
  removeBtn.className = "action-btn remove";
  removeBtn.title = getTranslation("optionsRemoveTitle");
  removeBtn.textContent = "X";
  removeBtn.addEventListener("click", () => removeAction(index));

  btns.append(upBtn, downBtn, removeBtn);
  row.append(num, typeSelect, folderContainer, btns);
  return row;
}

function addAction() {
  state.editing.actions.push({ type: "mark_read" });
  renderActionsList();
  updatePreviewActions();
  els
    .actionsList()
    .lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function removeAction(index) {
  state.editing.actions.splice(index, 1);
  renderActionsList();
  updatePreviewActions();
}

function moveAction(index, direction) {
  const actions = state.editing.actions;
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= actions.length) return;
  [actions[index], actions[newIndex]] = [actions[newIndex], actions[index]];
  renderActionsList();
  updatePreviewActions();
}

function syncSidebarItem() {
  if (!state.editing) return;
  const item = document.querySelector(
    `.step-item[data-id="${state.editing.id}"]`,
  );
  if (!item) return;
  const nameEl = item.querySelector(".step-item-name");
  const metaEl = item.querySelector(".step-item-meta");
  if (nameEl) {
    nameEl.textContent =
      state.editing.name || getTranslation("optionsPlaceholderTitle");
    nameEl.style.color = state.editing.color || DEFAULT_COLOR;
  }
  if (metaEl)
    metaEl.textContent =
      state.editing.actions.map(getActionLabel).join(" → ") ||
      getTranslation("optionsNoActionsAssigned");
}

async function navigateTo(stepId) {
  if (state.editingId === stepId) return;
  await autoSave();
  loadStep(stepId);
  renderSidebar();
}

function loadStep(stepId) {
  const step = state.steps.find((s) => s.id === stepId);
  if (!step) return;
  state.editingId = stepId;
  state.editing = JSON.parse(JSON.stringify(step));
  state.isNew = false;
  renderEditor();
}

function startNewStep() {
  autoSave().then(() => {
    const newStep = {
      id: generateId(),
      name: "",
      color: DEFAULT_COLOR,
      actions: [{ type: "mark_read" }],
    };
    state.steps.push(newStep);
    state.editingId = newStep.id;
    state.editing = JSON.parse(JSON.stringify(newStep));
    state.isNew = true;
    renderSidebar();
    renderEditor();
    setTimeout(() => els.stepName().focus(), 50);
  });
}

async function saveCurrentStep() {
  if (!state.editing) return;

  if (!state.editing.name.trim()) {
    els.stepName().focus();
    els.stepName().style.borderBottomColor = "#d32f2f";
    setTimeout(() => (els.stepName().style.borderBottomColor = ""), 2000);
    showToast(getTranslation("optionsToastNameRequired"), "error");
    return;
  }

  for (const action of state.editing.actions) {
    if ((action.type === "move" || action.type === "copy") && !action.folder) {
      showToast(getTranslation("optionsToastFolderRequired"), "error");
      return;
    }
  }

  const idx = state.steps.findIndex((x) => x.id === state.editing.id);
  const clone = JSON.parse(JSON.stringify(state.editing));
  if (idx >= 0) state.steps[idx] = clone;
  else state.steps.push(clone);

  state.isNew = false;

  try {
    await persistSteps();
    renderSidebar();
    showToast(getTranslation("optionsToastSaved"), "success");
  } catch (e) {
    showToast(getTranslation("optionsToastSaveError", [e.message]), "error");
  }
}

async function deleteCurrentStep() {
  const name = state.editing?.name || "Quick Step";
  const confirmed = await showConfirm(
    getTranslation("optionsConfirmDeleteMessage", [name]),
  );
  if (!confirmed) return;

  state.steps = state.steps.filter((s) => s.id !== state.editingId);
  state.editing = null;
  state.editingId = null;
  state.isNew = false;

  try {
    await persistSteps();
    renderSidebar();
    renderEditor();
    showToast(getTranslation("optionsToastDeleted"), "info");
  } catch (e) {
    showToast(getTranslation("optionsToastDeleteError", [e.message]), "error");
  }
}

async function init() {
  try {
    state.steps = await messenger.runtime.sendMessage({
      type: "GET_QUICK_STEPS",
    });
  } catch (e) {
    showToast(getTranslation("optionsToastLoadError", [e.message]), "error");
    state.steps = [];
  }

  ensureFoldersLoaded();

  renderSidebar();
  renderEditor();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      autoSave();
    }
  });

  els.newStepBtn().addEventListener("click", startNewStep);
  els.saveBtn().addEventListener("click", saveCurrentStep);
  els.deleteStepBtn().addEventListener("click", deleteCurrentStep);
  els.addActionBtn().addEventListener("click", addAction);

  els.stepName().addEventListener("input", (e) => {
    if (!state.editing) return;
    state.editing.name = e.target.value;
    updatePreviewActions();
    syncSidebarItem();
  });

  const colorInput = document.getElementById("step-color");
  const colorSwatch = els.colorSwatch();

  colorSwatch.style.backgroundColor = DEFAULT_COLOR;

  colorInput.addEventListener("input", (event) => {
    const selectedColor = event.target.value;
    colorSwatch.style.backgroundColor = selectedColor;

    state.editing.color = selectedColor;
    syncSidebarItem();
  });

  localizeDocument();
}

document.addEventListener("DOMContentLoaded", init);
