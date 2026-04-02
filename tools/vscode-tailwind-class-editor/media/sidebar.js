(function () {
  const vscode = acquireVsCodeApi();

  const meta = document.getElementById('meta');
  const chips = document.getElementById('chips');
  const chipsSection = chips ? chips.closest('.section') : null;
  const preview = document.getElementById('preview');
  const previewUrlInput = document.getElementById('previewUrl');
  const savePreviewUrlButton = document.getElementById('savePreviewUrl');
  const controlsUrlInput = document.getElementById('controlsUrl');
  const saveControlsUrlButton = document.getElementById('saveControlsUrl');
  const cssControls = document.getElementById('cssControls');
  const classControls = document.getElementById('classControls');
  const selectorLabel = document.getElementById('selectorLabel');
  const controlsFrame = document.getElementById('controlsFrame');

  const displayInput = document.getElementById('display');
  const fontSizeInput = document.getElementById('fontSize');
  const paddingInput = document.getElementById('padding');
  const marginInput = document.getElementById('margin');
  const radiusInput = document.getElementById('radius');
  const textColorInput = document.getElementById('textColor');
  const bgColorInput = document.getElementById('bgColor');

  let currentState = {
    mode: 'none',
    hasTarget: false,
    filePath: null,
    message: '',
    previewUrl: 'http://localhost:3000',
    controlsUrl: 'http://localhost:3002',
    attribute: null,
    tokens: [],
    cssSelector: null,
    cssDeclarations: {},
  };

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'state') {
      currentState = message.payload;
      renderState();
      return;
    }

    if (message && message.source === 'ycode-css-controls' && message.type === 'design-change') {
      if (!currentState.hasTarget || currentState.mode !== 'css') {
        return;
      }
      const declarations = message.declarations || {};
      vscode.postMessage({
        type: 'applyCssDeclarations',
        declarations,
      });
    }
  });

  function post(type, payload) {
    vscode.postMessage({ type, ...payload });
  }

  function renderState() {
    previewUrlInput.value = currentState.previewUrl || '';
    controlsUrlInput.value = currentState.controlsUrl || '';
    updatePreview(currentState.previewUrl);
    updateControlsFrame(currentState.controlsUrl);

    if (currentState.mode === 'css') {
      cssControls.classList.remove('hidden');
      classControls.classList.add('hidden');
      if (chipsSection) {
        chipsSection.classList.add('hidden');
      }
      renderCssState();
      return;
    }

    cssControls.classList.add('hidden');
    classControls.classList.remove('hidden');
    if (chipsSection) {
      chipsSection.classList.remove('hidden');
    }

    if (!currentState.hasTarget) {
      meta.textContent = currentState.message || 'Kein class/className am Cursor gefunden.';
      chips.innerHTML = '';
      return;
    }

    const fileName = (currentState.filePath || '').split('/').pop();
    meta.textContent = `${fileName} • ${currentState.attribute}`;
    renderChips(currentState.tokens);
    fillQuickControls(currentState.tokens);
  }

  function renderCssState() {
    const fileName = (currentState.filePath || '').split('/').pop();
    meta.textContent = currentState.hasTarget
      ? `${fileName} • CSS Mode`
      : currentState.message || 'Kein CSS-Block am Cursor gefunden.';
    selectorLabel.textContent = currentState.cssSelector || '(kein Selektor)';
  }

  function renderChips(tokens) {
    chips.innerHTML = '';
    if (!tokens.length) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = 'Keine Klassen gesetzt';
      chips.appendChild(empty);
      return;
    }

    tokens.forEach((token) => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.type = 'button';
      chip.title = 'Klasse entfernen';
      chip.textContent = token;
      chip.addEventListener('click', () => {
        post('removeClass', { value: token });
      });
      chips.appendChild(chip);
    });
  }

  function fillQuickControls(tokens) {
    displayInput.value = firstMatch(tokens, /^(block|inline-block|inline|flex|inline-flex|grid|hidden)$/) || '';
    fontSizeInput.value = firstMatch(tokens, /^text-(xs|sm|base|lg|xl|[2-9]xl|\[.+\])$/) || '';
    paddingInput.value = firstMatch(tokens, /^p[trblxy]?-.+/) || '';
    marginInput.value = firstMatch(tokens, /^m[trblxy]?-.+/) || '';
    radiusInput.value = firstMatch(tokens, /^rounded(?:-[trbl]{1,2})?(?:-.+)?$/) || '';

    const textColor = firstMatch(tokens, /^text-(?!left$|right$|center$|justify$|start$|end$|xs$|sm$|base$|lg$|xl$|[2-9]xl$).+/);
    textColorInput.value = textColor || '';

    const bgColor = firstMatch(tokens, /^bg-(?!auto$|cover$|contain$|center$|top$|bottom$|left$|right$|repeat$|repeat-x$|repeat-y$|no-repeat$).+/);
    bgColorInput.value = bgColor || '';
  }

  function firstMatch(tokens, regex) {
    return tokens.find((token) => regex.test(token)) || null;
  }

  function updatePreview(url) {
    if (!url) {
      preview.srcdoc = '<div style="padding:12px;color:#888;">Keine Preview URL gesetzt.</div>';
      return;
    }
    preview.src = url;
  }

  function updateControlsFrame(url) {
    if (!controlsFrame) {
      return;
    }
    if (!url) {
      controlsFrame.srcdoc = '<div style="padding:12px;color:#888;">Keine URL gesetzt.</div>';
      return;
    }
    try {
      const parsed = new URL(url);
      controlsFrame.src = `${parsed.origin}/dev/css-controls?embed=1`;
    } catch {
      controlsFrame.src = `${url.replace(/\/$/, '')}/dev/css-controls?embed=1`;
    }
  }

  displayInput.addEventListener('change', (event) => {
    post('setGroupedClass', {
      group: 'display',
      value: event.target.value,
    });
  });

  fontSizeInput.addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      post('setGroupedClass', { group: 'fontSize', value: '' });
      return;
    }
    if (value.startsWith('text-')) {
      post('setGroupedClass', { group: 'fontSize', value });
      return;
    }
    post('setMeasurement', { group: 'fontSize', prefix: 'text', value });
  });

  paddingInput.addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      post('setGroupedClass', { group: 'padding', value: '' });
      return;
    }
    if (/^p[trblxy]?-.+/.test(value)) {
      post('setGroupedClass', { group: 'padding', value });
      return;
    }
    post('setMeasurement', { group: 'padding', prefix: 'p', value });
  });

  marginInput.addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      post('setGroupedClass', { group: 'margin', value: '' });
      return;
    }
    if (/^m[trblxy]?-.+/.test(value)) {
      post('setGroupedClass', { group: 'margin', value });
      return;
    }
    post('setMeasurement', { group: 'margin', prefix: 'm', value });
  });

  radiusInput.addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      post('setGroupedClass', { group: 'rounded', value: '' });
      return;
    }
    if (value.startsWith('rounded')) {
      post('setGroupedClass', { group: 'rounded', value });
      return;
    }
    post('setMeasurement', { group: 'rounded', prefix: 'rounded', value });
  });

  textColorInput.addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      post('setGroupedClass', { group: 'textColor', value: '' });
      return;
    }
    if (value.startsWith('text-')) {
      post('setGroupedClass', { group: 'textColor', value });
      return;
    }
    post('setColor', { group: 'textColor', prefix: 'text', value });
  });

  bgColorInput.addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) {
      post('setGroupedClass', { group: 'backgroundColor', value: '' });
      return;
    }
    if (value.startsWith('bg-')) {
      post('setGroupedClass', { group: 'backgroundColor', value });
      return;
    }
    post('setColor', { group: 'backgroundColor', prefix: 'bg', value });
  });

  savePreviewUrlButton.addEventListener('click', () => {
    const value = previewUrlInput.value.trim();
    if (!value) {
      return;
    }
    post('setPreviewUrl', { value });
  });

  saveControlsUrlButton.addEventListener('click', () => {
    const value = controlsUrlInput.value.trim();
    if (!value) {
      return;
    }
    post('setControlsUrl', { value });
  });

  post('ready', {});
})();
