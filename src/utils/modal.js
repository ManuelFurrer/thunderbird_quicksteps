export function showModal({ overlay, messageEl, message, choices }) {
  return new Promise((resolve) => {
    messageEl.textContent = message;
    overlay.classList.remove('hidden');

    const controller = new AbortController();

    const done = (result) => {
      overlay.classList.add('hidden');
      controller.abort();
      resolve(result);
    };

    for (const [button, result] of choices) {
      button.addEventListener('click', () => done(result), { signal: controller.signal });
    }
  });
}
