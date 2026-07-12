const _elmCache = {};

function getCachedElementById(id) {
  if (!_elmCache[id]) {
    _elmCache[id] = document.getElementById(id);
  }

  return _elmCache[id];
}

export { getCachedElementById };
