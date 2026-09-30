const DEFAULT_SETTINGS = Object.freeze({
  autoClosePopup: false,
  showSearchBar: true,
  searchBarMinSteps: 5
});

const MAX_SEARCH_BAR_MIN_STEPS = 999;

function normalizeSearchBarMinSteps(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SETTINGS.searchBarMinSteps;
  return Math.min(n, MAX_SEARCH_BAR_MIN_STEPS);
}

export { DEFAULT_SETTINGS, MAX_SEARCH_BAR_MIN_STEPS, normalizeSearchBarMinSteps };
