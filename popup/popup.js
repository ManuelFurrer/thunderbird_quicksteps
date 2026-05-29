import { localizeDocument, getTranslation } from "../utils/i18n.mjs";

const ACTION_LABELS = {
  move: (a) => getTranslation("actionMoveLabel", a.folder?.name || "?"),
  copy: (a) => getTranslation("actionCopyLabel", a.folder?.name || "?"),
  delete: () => getTranslation("actionDeleteTrash"),
  delete_permanent: () => getTranslation("actionDeletePermanent"),
  archive: () => getTranslation("actionArchive"),
  mark_read: () => getTranslation("actionMarkRead"),
  mark_unread: () => getTranslation("actionMarkUnread"),
  flag: () => getTranslation("actionFlag"),
  unflag: () => getTranslation("actionUnflag"),
};

function getActionLabel(action) {
  const fn = ACTION_LABELS[action.type];
  return fn ? fn(action) : action.type;
}

async function getCurrentMailTabId() {
  try {
    const mailTabs = await messenger.mailTabs.query({
      active: true,
      currentWindow: true,
    });
    if (mailTabs.length > 0) return mailTabs[0].tabId;
  } catch {}

  return null;
}

function showStatus(message, type = "info") {
  const bar = document.getElementById("status-bar");
  bar.textContent = message;
  bar.className = `status-${type}`;
  bar.classList.remove("hidden");
  clearTimeout(bar._timeout);
  bar._timeout = setTimeout(() => bar.classList.add("hidden"), 8000);
}

function openOptions() {
  messenger.runtime.openOptionsPage();
  window.close();
}

async function loadAndRender() {
  const loading = document.getElementById("loading");
  const container = document.getElementById("steps-container");
  const emptyState = document.getElementById("empty-state");

  loading.classList.remove("hidden");
  container.classList.add("hidden");
  emptyState.classList.add("hidden");

  let steps;
  try {
    steps = await messenger.runtime.sendMessage({ type: "GET_QUICK_STEPS" });
  } catch (e) {
    loading.classList.add("hidden");
    showStatus(getTranslation("statusLoadError", [e.message]), "error");
    return;
  }

  loading.classList.add("hidden");

  if (!steps || steps.length === 0) {
    emptyState.classList.remove("hidden");
    return;
  }

  container.innerHTML = "";

  for (const step of steps) {
    const btn = document.createElement("button");
    btn.className = "step-btn";
    btn.style.setProperty("--step-color", step.color || "#0078D4");

    const info = document.createElement("div");
    info.className = "step-info";

    const name = document.createElement("span");
    name.className = "step-name";
    name.textContent = step.name;

    const desc = document.createElement("span");
    desc.className = "step-desc";
    desc.textContent = step.actions.map(getActionLabel).join(" → ");

    info.append(name, desc);
    btn.append(info);

    btn.title = `${step.name}\n${step.actions.map(getActionLabel).join(" → ")}`;

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.classList.add("executing");

      try {
        const tabId = await getCurrentMailTabId();
        if (tabId === null) {
          showStatus(getTranslation("statusNoMailTab"), "error");
          return;
        }

        const result = await messenger.runtime.sendMessage({
          type: "EXECUTE_QUICK_STEP",
          quickStepId: step.id,
          tabId,
        });

        if (result.success) {
          const count = result.messageCount;
          const key =
            count === 1 ? "statusAppliedSingle" : "statusAppliedMultiple";
          showStatus(
            getTranslation(key, [step.name, count.toString()]),
            "success",
          );
        } else if (result.anySucceeded) {
          const count = result.messageCount;
          const errorDetail = result.errors?.length
            ? `: ${result.errors[0]}`
            : ".";

          showStatus(
            getTranslation("statusAppliedWithErrors", [
              step.name,
              count.toString(),
              errorDetail,
            ]),
            "warning",
          );
        } else if (result.errors?.length) {
          showStatus(
            getTranslation("statusError", [result.errors[0]]),
            "error",
          );
        } else {
          showStatus(getTranslation("statusActionFailed"), "error");
        }
      } catch (e) {
        showStatus(getTranslation("statusError", [e.message]), "error");
      } finally {
        btn.disabled = false;
        btn.classList.remove("executing");
      }
    });

    container.appendChild(btn);
  }

  container.classList.remove("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("btn-settings")
    .addEventListener("click", openOptions);
  document
    .getElementById("createFirstBtn")
    .addEventListener("click", openOptions);

  loadAndRender();
  localizeDocument();
});
