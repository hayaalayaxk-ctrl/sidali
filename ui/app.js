/* SidAli playground UI. Engine is provided by the inlined `SidAli` global. */
(function () {
  'use strict';
  const E = window.SidAli;
  const $ = (id) => document.getElementById(id);

  const editor = $('editor');
  const gutter = $('gutter');
  const output = $('output');
  const verify = $('verify');
  const status = $('status');
  const timing = $('timing');
  const cursor = $('cursor');
  const exampleSel = $('example');
  const substrateSel = $('substrate');
  const examples = window.SIDALI_EXAMPLES || [];

  // ---------- substrates ----------
  // The same SAIR runs on every medium; only the energy model changes.
  const SUBSTRATES = E.SUBSTRATE_ENERGY ? Object.keys(E.SUBSTRATE_ENERGY) : ['electron'];
  SUBSTRATES.forEach((s) => {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s;
    substrateSel.appendChild(o);
  });
  const currentSubstrate = () => (E.makeSubstrate ? E.makeSubstrate(substrateSel.value) : null);

  // ---------- examples ----------
  examples.forEach((ex, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = ex.name.replace(/^\d+-/, '').replace('.sidali', '');
    exampleSel.appendChild(o);
  });
  exampleSel.addEventListener('change', () => {
    const ex = examples[Number(exampleSel.value)];
    if (ex) { editor.value = ex.source; refreshGutter(); }
  });
  if (examples.length) { editor.value = examples[0].source; }

  // ---------- editor helpers ----------
  function refreshGutter() {
    const lines = editor.value.split('\n').length;
    let g = '';
    for (let i = 1; i <= lines; i++) g += i + '\n';
    gutter.textContent = g;
  }
  function updateCursor() {
    const upTo = editor.value.slice(0, editor.selectionStart);
    const line = upTo.split('\n').length;
    const col = upTo.length - upTo.lastIndexOf('\n');
    cursor.textContent = `Ln ${line}, Col ${col}`;
  }
  editor.addEventListener('input', () => { refreshGutter(); updateCursor(); });
  editor.addEventListener('keyup', updateCursor);
  editor.addEventListener('click', updateCursor);
  editor.addEventListener('scroll', () => { gutter.scrollTop = editor.scrollTop; });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = editor.selectionStart, en = editor.selectionEnd;
      editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(en);
      editor.selectionStart = editor.selectionEnd = s + 2;
      refreshGutter();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  });

  // ---------- run ----------
  function chip(k, v, cls) {
    const d = document.createElement('div');
    d.className = 'chip' + (cls ? ' ' + cls : '');
    d.innerHTML = `<span class="k">${k}</span><span class="v">${escapeHtml(String(v))}</span>`;
    return d;
  }
  function hashline(label, hash) {
    const d = document.createElement('div');
    d.className = 'hashline';
    d.innerHTML = `<b>${escapeHtml(label)}</b> ${escapeHtml(hash)}`;
    return d;
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function run() {
    const src = editor.value;
    output.textContent = '';
    verify.textContent = '';
    status.textContent = 'compiling…';
    let result;
    try {
      result = E.runSource(src);
    } catch (err) {
      status.textContent = 'compile error';
      const line = document.createElement('div');
      line.className = 'err';
      line.textContent = '✖ ' + (err && err.message ? err.message : String(err));
      output.appendChild(line);
      timing.textContent = '—';
      return;
    }

    // stdout
    for (const ln of result.output) {
      const d = document.createElement('div');
      d.className = 'ok';
      d.textContent = ln;
      output.appendChild(d);
    }
    if (result.error) {
      const d = document.createElement('div');
      d.className = 'err';
      d.textContent = '✖ ' + result.error;
      output.appendChild(d);
    }
    if (!result.output.length && !result.error) {
      const d = document.createElement('div');
      d.className = 'dim';
      d.textContent = '(no output)';
      output.appendChild(d);
    }

    // verification layer
    const s = result.stats;
    verify.appendChild(chip('instructions', s.instructions));
    verify.appendChild(chip('time', s.timeMs + ' ms'));
    verify.appendChild(chip('RAM lattice', s.ramUsed + ' B'));
    verify.appendChild(chip('ledger height', s.ledgerHeight));
    verify.appendChild(chip('ace used', result.ace.used + ' / ' + result.ace.limit));
    verify.appendChild(chip('ace safety', result.ace.safety, result.ace.safety === 'VIOLATED' ? 'bad' : ''));
    verify.appendChild(chip('tier', result.ace.tier));
    verify.appendChild(chip('witnesses', s.witnesses));

    // BLAKE3 witnesses + proof anchor
    const witnessHash = E.blake3(src);
    verify.appendChild(hashline('source BLAKE3', witnessHash));
    if (result.witnesses.length) {
      result.witnesses.slice(0, 6).forEach((w, i) => verify.appendChild(hashline('build witness ' + i, w)));
    }
    const anchor = E.proofAnchor([witnessHash, String(s.instructions), result.ace.safety]);
    verify.appendChild(hashline('proof anchor', anchor));

    // Dilithium demo signature over the program (real lattice arithmetic)
    try {
      const kp = E.dilithiumKeygen(witnessHash);
      const sig = E.dilithiumSign(src, kp);
      const ok = E.dilithiumVerify(src, sig, kp);
      verify.appendChild(chip('dilithium', ok ? 'valid' : 'invalid', ok ? '' : 'bad'));
      verify.appendChild(hashline('dilithium sig', sig.hash.slice(0, 64)));
    } catch (e) { /* signature is best-effort telemetry */ }

    // sigma kernel stability of the execution
    const lEff = Math.min(0.999, s.instructions / 1000000);
    const sig2 = E.sigmaKernel(lEff, 0);
    verify.appendChild(chip('L_eff', sig2.lEff.toFixed(6), sig2.lEffOk ? '' : 'bad'));
    verify.appendChild(chip('stable', String(sig2.stable), sig2.stable ? '' : 'bad'));

    // DNA
    const dnaLine = document.createElement('div');
    dnaLine.className = 'hashline';
    dnaLine.innerHTML = `<b>DNA</b> ${escapeHtml(result.dna.slice(0, 80))}…`;
    verify.appendChild(dnaLine);

    // SAIR: the physics-free IR and its energy on the selected substrate
    if (E.lowerBytecode && E.compile && E.parse && E.evaluate) {
      try {
        const ir = E.lowerBytecode(E.compile(E.parse(src)), src);
        verify.appendChild(chip('SAIR states', ir.meta.states));
        verify.appendChild(chip('SAIR transitions', ir.meta.transitions));
        const sub = currentSubstrate();
        if (sub) {
          const ev = E.evaluate(ir, sub);
          verify.appendChild(chip('substrate', sub.name));
          verify.appendChild(chip('energy', ev.energy));
        }
      } catch (e) { /* SAIR is diagnostic telemetry; never block a run */ }
    }

    timing.textContent = s.timeMs + ' ms';
    status.textContent = result.error ? 'runtime error' : 'ok';
  }
  $('run').addEventListener('click', run);

  // ---------- LLVM IR (native backend) ----------
  $('ir').addEventListener('click', () => {
    output.textContent = '';
    verify.textContent = '';
    let ir;
    try {
      ir = E.emitLlvm(E.parse(editor.value), { target: 'x86_64-linux', optLevel: 2, entry: 'main' }).ir;
    } catch (err) {
      status.textContent = 'llvm error';
      const d = document.createElement('div');
      d.className = 'err';
      d.textContent = '✖ ' + (err && err.message ? err.message : String(err));
      output.appendChild(d);
      return;
    }
    const head = document.createElement('div');
    head.className = 'dim';
    head.textContent = '// LLVM IR — feed to clang to produce native machine code (' + ir.split('\n').length + ' lines)';
    output.appendChild(head);
    const pre = document.createElement('div');
    pre.className = 'ok';
    pre.style.whiteSpace = 'pre';
    pre.textContent = ir;
    output.appendChild(pre);
    verify.appendChild(chip('backend', 'llvm'));
    verify.appendChild(chip('target', 'x86_64-linux'));
    verify.appendChild(hashline('IR BLAKE3', E.blake3(ir)));
    status.textContent = 'llvm ir emitted';
  });

  // ---------- English -> SidAli ----------
  $('translate').addEventListener('click', () => {
    const english = prompt('Describe what you want in English (or use the microphone):', 'build a social platform');
    if (english === null) return;
    applyEnglish(english);
  });

  function applyEnglish(text) {
    const dec = new E.GraphemeDecomposer().decompose(text);
    editor.value = dec.code;
    refreshGutter();
    const policy = E.alpPolicy(3, 0);
    status.textContent = `intent: ${dec.intent} · confidence ${dec.confidence.toFixed(2)} · RTA ${dec.rta.toFixed(2)} · ${policy.policy}`;
    run();
  }

  // ---------- voice ----------
  const mic = $('mic');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (SR) {
    rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (ev) => {
      const text = ev.results[0][0].transcript;
      mic.classList.remove('rec');
      mic.textContent = '🎤';
      applyEnglish(text);
    };
    rec.onerror = () => { mic.classList.remove('rec'); mic.textContent = '🎤'; status.textContent = 'speech error'; };
    rec.onend = () => { mic.classList.remove('rec'); mic.textContent = '🎤'; };
    mic.addEventListener('click', () => {
      try {
        mic.classList.add('rec');
        mic.textContent = '■';
        status.textContent = 'listening…';
        rec.start();
      } catch (e) {
        mic.classList.remove('rec'); mic.textContent = '🎤';
        status.textContent = 'mic unavailable';
      }
    });
  } else {
    mic.addEventListener('click', () => {
      status.textContent = 'SpeechRecognition not supported — use English → SidAli';
    });
  }

  refreshGutter();
  updateCursor();
  // Run the first example on load so the VM demonstrates real execution immediately.
  if (editor.value) run();
})();
