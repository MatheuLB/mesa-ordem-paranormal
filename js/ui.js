// Substitui prompt()/alert()/confirm() nativos por overlays no mesmo visual do site.

function ensureModalRoot() {
  let root = document.getElementById('uiModalRoot');
  if (!root) {
    root = document.createElement('div');
    root.id = 'uiModalRoot';
    document.body.appendChild(root);
  }
  return root;
}

function closeModal() {
  const root = document.getElementById('uiModalRoot');
  if (root) root.innerHTML = '';
  document.body.style.overflow = '';
}

function openModal(innerHtml) {
  const root = ensureModalRoot();
  root.innerHTML = `
    <div class="ui-modal-backdrop">
      <div class="ornate-frame ui-modal-box">
        <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
        ${innerHtml}
      </div>
    </div>
  `;
  document.body.style.overflow = 'hidden';
  return root;
}

function uiPrompt(title, { placeholder = '', defaultValue = '' } = {}) {
  return new Promise(resolve => {
    const root = openModal(`
      <h3 style="margin-bottom:14px;font-size:18px">${title}</h3>
      <input type="text" id="uiPromptInput" placeholder="${placeholder}" value="${defaultValue}" style="width:100%;margin-bottom:16px">
      <div class="row" style="justify-content:flex-end">
        <button class="btn small" id="uiPromptCancel">Cancelar</button>
        <button class="btn primary small" id="uiPromptOk">Confirmar</button>
      </div>
    `);
    const input = root.querySelector('#uiPromptInput');
    input.focus();
    const finish = val => { closeModal(); resolve(val); };
    root.querySelector('#uiPromptOk').addEventListener('click', () => finish(input.value.trim() || null));
    root.querySelector('#uiPromptCancel').addEventListener('click', () => finish(null));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value.trim() || null); });
  });
}

function uiChoice(title, options) {
  return new Promise(resolve => {
    const root = openModal(`
      <h3 style="margin-bottom:14px;font-size:18px">${title}</h3>
      <div class="stack" id="uiChoiceOpts">
        ${options.map(o => `<button class="btn" data-val="${o.value}" style="width:100%;text-align:left">${o.label}</button>`).join('')}
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:14px">
        <button class="btn small" id="uiChoiceCancel">Cancelar</button>
      </div>
    `);
    const finish = val => { closeModal(); resolve(val); };
    root.querySelectorAll('#uiChoiceOpts button').forEach(b => b.addEventListener('click', () => finish(b.dataset.val)));
    root.querySelector('#uiChoiceCancel').addEventListener('click', () => finish(null));
  });
}

function uiConfirm(title, text = '') {
  return new Promise(resolve => {
    const root = openModal(`
      <h3 style="margin-bottom:10px;font-size:18px">${title}</h3>
      ${text ? `<p style="color:var(--text-dim);font-size:13px;margin-bottom:16px">${text}</p>` : ''}
      <div class="row" style="justify-content:flex-end">
        <button class="btn small" id="uiConfirmNo">Cancelar</button>
        <button class="btn danger small" id="uiConfirmYes">Confirmar</button>
      </div>
    `);
    const finish = val => { closeModal(); resolve(val); };
    root.querySelector('#uiConfirmYes').addEventListener('click', () => finish(true));
    root.querySelector('#uiConfirmNo').addEventListener('click', () => finish(false));
  });
}

function uiToast(text, type = 'info') {
  let wrap = document.getElementById('uiToastWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'uiToastWrap';
    document.body.appendChild(wrap);
  }
  const toast = document.createElement('div');
  toast.className = 'ui-toast ' + type;
  toast.textContent = text;
  wrap.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 4200);
}
