/* Telas da conferência por apartamento. */
(function () {
  'use strict';
  const A = window.App, C = window.Core, M = window.Motel;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const botao = (txt, cls, fazer) => { const b = el('button', cls, txt); b.type = 'button'; b.onclick = fazer; return b; };
  const dois = n => String(n).padStart(2, '0');
  const motel = () => (A.estado().motel || {})[M.chave(A.emp())];
  const dia = d => d.split('-').reverse().join('/');
  let aberto = null, rascunho = {}; /* aberto: número do apartamento, 'coz' ou null */

  /* ---------- importar a planilha ---------- */
  $('mMotel').onclick = () => { $('dMenu').close(); $('oFile').value = ''; $('oFile').click(); };
  $('oFile').onchange = async () => {
    const f = $('oFile').files[0];
    if (!f) return;
    try {
      const p = M.lerPlanilha(await window.lerXlsx(await f.arrayBuffer()));
      const alvo = A.estado().empresas.find(e => C.norm(e.nome) === C.norm(p.titulo)) || A.emp();
      if (!confirm('Importar para “' + alvo.nome + '”?\n\n' + p.aptos + ' apartamentos\n' + p.itens.length + ' produtos, ' + p.itens.filter(i => i.kit).length + ' no kit do apartamento')) return;
      const r = M.aplicarPlanilha(A.estado(), alvo.id, p);
      A.abrirEmpresa(alvo.id);
      alert('Pronto. “' + r.empresa + '” tem agora o botão “Conferir apartamentos”.');
    } catch (e) { alert('Não foi possível importar. ' + e.message); }
  };

  /* ---------- conferência ---------- */
  const conf = () => motel().conf;
  function comecar() { const m = motel(); m.conf = M.novaConf(''); aberto = null; A.salvar(); }
  function marcar(n, dif) {
    const c = conf();
    if (!c.data) c.data = A.hoje();
    M.marcar(motel(), c, n, dif, A.usuario(), A.hoje() + ' ' + A.agora());
    delete c.enviada;
    A.salvar();
  }
  /* Próximo apartamento ainda não marcado, dando a volta. */
  function proximo(n) {
    const t = motel().aptos;
    for (let i = 1; i <= t; i++) { const k = (n - 1 + i) % t + 1; if (!conf().apt[k]) return k; }
    return null;
  }
  function abrirApto(n) {
    aberto = n;
    const a = typeof n === 'number' && conf().apt[n];
    rascunho = a ? Object.assign({}, a.dif) : {};
    desenhar(a && Object.keys(a.dif).length > 0);
    $('dMotel').scrollTop = 0;
  }
  function desenhar(mostrarItens) {
    const m = motel(), c = conf(), feitos = M.marcados(m, c);
    $('oTitulo').textContent = 'Apartamentos — ' + A.emp().nome;
    $('oStat').textContent = feitos + ' de ' + m.aptos + ' conferidos' + (c.data ? ' · iniciada em ' + dia(c.data) : '') + (c.enviada ? ' · enviada' : '');
    $('oAptos').replaceChildren(...Array.from({ length: m.aptos }, (_, i) => {
      const n = i + 1, a = c.apt[n], inc = a && Object.keys(a.dif).length;
      const b = botao(dois(n) + (a ? (inc ? ' !' : ' ✔') : ''), (a ? (inc ? 'inc' : 'ok') : '') + (aberto === n ? ' sel' : ''), () => abrirApto(n));
      b.setAttribute('aria-label', 'Apartamento ' + n + (a ? (inc ? ', incompleto' : ', completo') : ', não conferido'));
      return b;
    }), botao('Cozinha', 'coz' + (Object.keys(c.coz).length ? ' ok' : '') + (aberto === 'coz' ? ' sel' : ''), () => abrirApto('coz')));
    $('oFim').disabled = feitos < m.aptos;
    $('oRes').hidden = !A.podeVerResultado();
    painel(mostrarItens);
  }
  function painel(mostrarItens) {
    const p = $('oPainel'), m = motel();
    if (aberto === null) return p.replaceChildren(el('p', '', 'Toque no número do apartamento.'));
    if (aberto === 'coz') return p.replaceChildren(el('h4', '', 'Cozinha — quantidade guardada'), cartao(m.itens.map(it => {
      const lin = el('div', 'lin'), campo = el('input');
      campo.inputMode = 'numeric'; campo.value = conf().coz[it.cod] === undefined ? '' : C.fmt(conf().coz[it.cod]);
      campo.setAttribute('aria-label', 'Cozinha: ' + it.nome);
      campo.onchange = () => {
        const q = campo.value.trim() === '' ? undefined : C.numSistema(campo.value.trim());
        if (q === null || q < 0) { campo.value = ''; return; }
        if (q === undefined) delete conf().coz[it.cod]; else conf().coz[it.cod] = q;
        if (!conf().data) conf().data = A.hoje();
        conf().cozQuando = A.hoje() + ' ' + A.agora(); delete conf().enviada;
        A.salvar();
      };
      lin.append(el('span', '', it.nome), campo);
      return lin;
    })));
    const n = aberto;
    const seguir = () => { const k = proximo(n); if (k) abrirApto(k); else { aberto = null; desenhar(); $('oMsg').textContent = 'Todos conferidos. Confira a cozinha e finalize.'; } };
    const completo = botao('✔ Completo', 'grande bom', () => { marcar(n, {}); seguir(); });
    const incompleto = botao('✖ Incompleto', 'grande ruim', () => painel(true));
    const duas = el('div', 'duas'); duas.append(completo, incompleto);
    const partes = [el('h4', '', 'Apartamento ' + dois(n)), duas];
    if (mostrarItens) {
      incompleto.classList.add('sel');
      partes.push(el('p', '', 'O que está diferente? Use − para o que falta e + para o que sobra.'));
      partes.push(cartao(m.itens.filter(i => i.kit).map(it => {
        const lin = el('div', 'lin'), v = el('b', 'dif');
        const pintar = () => { const d = rascunho[it.cod] || 0; v.textContent = d > 0 ? '+' + d : String(d); lin.classList.toggle('mudou', d !== 0); };
        const mais = s => { rascunho[it.cod] = Math.max(-it.kit, (rascunho[it.cod] || 0) + s); pintar(); };
        const nome = el('span', '', it.nome); nome.append(el('small', '', 'padrão ' + it.kit));
        const menos = botao('−', 'passo', () => mais(-1)), soma = botao('+', 'passo', () => mais(1));
        menos.setAttribute('aria-label', 'Falta ' + it.nome); soma.setAttribute('aria-label', 'Sobra ' + it.nome);
        lin.append(nome, menos, v, soma); pintar();
        return lin;
      })));
      partes.push(botao('Salvar e ir para o próximo', 'p grande', () => { marcar(n, rascunho); seguir(); }));
    }
    p.replaceChildren(...partes);
  }
  function cartao(linhas) { const d = el('div', 'cartao'); d.append(...linhas); return d; }

  $('bApto').onclick = () => {
    if (!A.identificado()) return A.pedirUsuario();
    /* Conferência de outro dia já enviada: começa uma nova. */
    if (conf().enviada && conf().data !== A.hoje()) comecar();
    aberto = null; $('oMsg').textContent = '';
    abrirApto(proximo(0) || null);
    $('dMotel').showModal();
  };
  $('oNova').onclick = () => {
    if (!confirm('Começar uma nova conferência? As marcações atuais saem deste aparelho.' + (conf().enviada ? '' : ' Elas AINDA NÃO foram enviadas.'))) return;
    comecar(); $('oMsg').textContent = ''; abrirApto(1);
  };
  $('oFim').onclick = async () => {
    const m = motel(), c = conf();
    if (M.marcados(m, c) < m.aptos) return;
    if (!A.servidor()) { alert('Primeiro conecte este aparelho ao Google.'); return; }
    if (!Object.keys(c.coz).length && !confirm('A cozinha está sem quantidades. Finalizar mesmo assim?')) return;
    const pacote = M.pacote(A.emp(), m, c, { data: c.data, hora: A.agora(), usuario: A.usuario(), aparelho: A.idAparelho() });
    $('oMsg').textContent = 'Enviando…'; $('oFim').disabled = true;
    let texto;
    try {
      const erro = await A.enviarPacote(pacote);
      texto = !erro ? '✔ Salvo no Drive.' : erro.semRede ? 'Sem internet: ficou PENDENTE e será enviada quando a conexão voltar, com o app aberto.' : 'Ficou PENDENTE. O Google recusou: ' + erro.message;
      c.enviada = A.agora(); A.salvar();
    } catch (e) { texto = 'Sem espaço no aparelho. Envie os pendentes antes.'; }
    desenhar(); $('oMsg').textContent = texto;
  };

  /* ---------- resultado (administrador) ---------- */
  let resultado = null, juntada = null, vez = 0;
  const reais = n => n === null ? '' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  function tabela(cab, linhas) {
    const t = el('table'), h = el('tr');
    cab.forEach(c => h.append(el('th', '', c)));
    t.append(h);
    for (const l of linhas) {
      const tr = el('tr', l.classe || '');
      l.c.forEach((v, i) => tr.append(el('td', i && typeof v === 'number' ? 'n' : '', v === null ? '' : typeof v === 'number' ? C.fmt(v) : v)));
      t.append(tr);
    }
    const d = el('div', 'tab'); d.append(t); return d;
  }
  function mostrarResultado() {
    const m = motel(), r = resultado = M.totais(m, juntada, m.sismotel);
    $('rResumo').textContent = r.marcados + ' de ' + m.aptos + ' apartamentos · ' + r.incompletos + (r.incompletos === 1 ? ' incompleto' : ' incompletos') + ' · faltas nos apartamentos ' + reais(r.faltaAptos)
      + (Object.keys(m.sismotel).length ? ' · contra o Sismotel: faltas ' + reais(r.faltas) + ', sobras ' + reais(r.sobras) : ' · cole o Sismotel para comparar');
    $('rTabelas').replaceChildren(
      el('h4', '', 'Por apartamento'),
      r.porApto.length ? tabela(['Apto', 'Produto', 'Diferença', 'Valor', 'Conferido por'], r.porApto.map(p => ({ classe: p.dif < 0 ? 'falta' : 'sobra', c: [dois(p.apto), p.nome, p.dif, reais(p.valor), p.quem] })))
        : el('p', '', 'Nenhum apartamento com diferença.'),
      el('h4', '', 'Por produto'),
      tabela(['Produto', 'Apartamentos', 'Cozinha', 'PDV', 'Sismotel', 'Diferença', 'Valor'], r.linhas.map(l => ({ classe: l.dif < 0 ? 'falta' : l.dif > 0 ? 'sobra' : '',
        c: [l.nome, l.aptos, l.coz, l.pdv, l.sismotel, l.dif, reais(l.valor)] }))));
  }
  async function buscar() {
    const data = $('rData').value, m = motel(), agoraVez = ++vez, envios = [];
    if (!data) return;
    $('rMsg').textContent = A.servidor() ? 'Buscando…' : '';
    if (A.servidor()) {
      try {
        const r = await A.chamar('contagens', { auth: A.auth(), empresa: M.chave(A.emp()), data });
        for (const t of r.arquivos) { try { envios.push(JSON.parse(t)); } catch (e) { /* arquivo ilegível */ } }
        $('rMsg').textContent = '';
      } catch (e) { $('rMsg').textContent = 'Sem acesso ao Drive: mostrando só o que está neste aparelho. ' + e.message; }
    }
    if (agoraVez !== vez) return;
    if (m.conf.data === data) envios.push(Object.assign({ tipo: 'motel' }, m.conf));
    juntada = M.juntar(envios, data);
    if (!Object.keys(juntada.apt).length) { resultado = null; $('rTabelas').replaceChildren(); $('rResumo').textContent = 'Nenhuma conferência de apartamentos nesta data.'; return; }
    mostrarResultado();
  }
  $('oRes').onclick = () => {
    const m = motel();
    $('rTitulo').textContent = 'Resultado — ' + A.emp().nome;
    $('rData').value = m.conf.data || A.hoje();
    $('rSis').value = Object.entries(m.sismotel).map(([k, v]) => k + '\t' + C.fmt(v)).join('\n');
    $('rMsg').textContent = ''; resultado = null; $('rTabelas').replaceChildren(); $('rResumo').textContent = '';
    $('dMRes').showModal();
    buscar();
  };
  $('rData').onchange = buscar;
  $('rAplicar').onclick = () => {
    const l = M.lerSismotel($('rSis').value);
    motel().sismotel = l.saldos; A.salvar();
    if (resultado) mostrarResultado();
    const cods = new Set(motel().itens.map(i => i.cod)), fora = Object.keys(l.saldos).filter(k => !cods.has(k));
    $('rMsg').textContent = Object.keys(l.saldos).length - fora.length + ' produtos com saldo.' + (fora.length ? ' Códigos que não são deste motel: ' + fora.join(', ') + '.' : '') + (l.ruins.length ? ' Linhas não lidas: ' + l.ruins.length + '.' : '');
  };
  $('rExcel').onclick = () => resultado && A.baixar('apartamentos_' + M.chave(A.emp()) + '_' + juntada.data + '.xlsx',
    window.gerarXlsx(M.planilha(A.emp().nome, motel(), resultado, juntada.data)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
})();
