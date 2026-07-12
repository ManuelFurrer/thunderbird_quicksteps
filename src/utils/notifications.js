function notify({ elm, message, type = "info", duration = 6000 }) {
  elm.textContent = message;
  elm.className = `notify-${type}`;
  elm.classList.remove("hidden");
  clearTimeout(elm._timeout);
  elm._timeout = setTimeout(() => elm.classList.add("hidden"), duration);
}

export { notify };
