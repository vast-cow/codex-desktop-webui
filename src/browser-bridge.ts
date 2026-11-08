// Feasibility entry only: native operations fail explicitly until host services exist.
(() => {
  function showFailure(message: string) {
    const render = () => {
      let panel = document.getElementById('webui-compatibility-error');
      if (!panel) {
        panel = document.createElement('pre');
        panel.id = 'webui-compatibility-error';
        panel.style.cssText = 'position:fixed;inset:16px;z-index:2147483647;overflow:auto;padding:24px;background:Canvas;color:CanvasText;white-space:pre-wrap;font:14px system-ui';
        document.body.append(panel);
      }
      panel.textContent = `Codex WebUI feasibility gate is not passed.\n\n${message}\n\nRenderer host services and shared-manager workflows are not implemented yet.`;
    };
    if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once: true });
  }
  Object.defineProperty(window, 'electronBridge', { value: Object.freeze({
    async sendMessageFromView(message: { type?: string }) {
      const error = `Unsupported native message: ${message?.type ?? 'unknown'}`;
      showFailure(error);
      throw new Error(error);
    }
  }) });
  window.addEventListener('error', event => showFailure(event.message));
  window.addEventListener('unhandledrejection', event => showFailure(String(event.reason)));
  showFailure('The browser compatibility bridge currently provides diagnostics only.');
})();
