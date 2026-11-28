(function () {
  'use strict';
  const C = window.Core, K = window.Comparar, KEY = 'conferencia-estoque-v1';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const aviso = t => { $('aviso').textContent = t; $('aviso').style.display = t ? 'block' : 'none'; };

  let estado, bloqueado = false, esperaLista = 0, agendarLista = () => {};
  try {
    const bruto = localStorage.getItem(KEY);
    estado = bruto ? C.lerBackup(bruto) : C.estadoInicial();
  } catch (e) {
    /* Não sobrescreve dados que não conseguimos ler. */
    bloqueado = true; estado = C.estadoInicial();
    aviso('Não consegui ler os dados salvos. Nada será gravado. Restaure um backup no Menu.');
  }
  function salvar() {
    if (bloqueado) return;
    try { localStorage.setItem(KEY, JSON.stringify(estado)); }
    catch (e) { aviso('ATENÇÃO: o tablet não conseguiu salvar. Baixe um backup agora (Menu).'); }
    agendarLista();
  }
  function converter() {
    const antes = JSON.stringify(estado);
    const familias = C.reorganizarPorFamilia(estado), empresas = C.separarEmpresas(estado);
    if (!familias && !empresas) return;
    /* Guarda uma cópia da organização anterior antes de gravar a nova. */
    try { localStorage.setItem(KEY + '-antes-familias', antes); } catch (e) { /* sem espaço: segue */ }
  }
  if (!bloqueado) converter();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  const emp = () => estado.empresas.find(e => e.id === estado.sel.emp) || estado.empresas[0];
  const setor = () => emp().setores.find(s => s.id === estado.sel.set) || emp().setores[0];
  const hoje = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  /* A categoria guarda "Hotel - Almoxarifado"; na tela, o filtro mostra só o local. */
  const COM_EMPRESA = /^(Hotel|A&B) - /;
  const localDe = c => (c || '').replace(COM_EMPRESA, '');
  function opcoes(sel, lista, valor) {
    sel.replaceChildren(...lista.map(([v, t]) => { const o = el('option', '', t); o.value = v; return o; }));
    sel.value = valor;
  }
  function tudo() {
    const e = emp(), s = setor();
    estado.sel = { emp: e.id, set: s.id };
    s.data = hoje();
    opcoes($('emp'), estado.empresas.map(x => [x.id, x.nome]), e.id);
    opcoes($('set'), e.setores.map(x => [x.id, x.nome]), s.id);
    const cats = [...new Set(s.itens.map(i => localDe(i.cat)).filter(Boolean))].sort();
    opcoes($('cat'), [['', 'Local de estoque'], ...cats.map(c => [c, c])], cats.includes($('cat').value) ? $('cat').value : '');
    $('cego').checked = s.cego;
    cabecalho();
    if (s.cego && $('filtro').value === 'div') $('filtro').value = '';
    $('filtro').querySelector('[value=div]').disabled = s.cego;
    lista();
  }

  function status() {
    const r = C.resumo(setor());
    $('stat').textContent = r.contados + ' de ' + r.total + ' contados' + (setor().cego ? '' : ' · faltas: ' + r.falta + ' · sobras: ' + r.sobra);
  }
  const visiveis = () => [...document.querySelectorAll('.it .valor')];

  function linha(it) {
    const s = setor();
    const d = el('div'), nm = el('div', 'nm'), titulo = el('div', 'titulo');
    if (it.cod) titulo.append(el('span', 'cod', it.cod));
    titulo.append(el('span', 'desc', it.nome));
    if (it.un) titulo.append(el('span', 'un', it.un));
    nm.append(titulo);
    const del = el('button', 'x del', 'Excluir item');
    del.onclick = () => {
      if (!confirm('Excluir “' + it.nome + '” deste setor, com contagem, saldo e observação?')) return;
      s.itens = s.itens.filter(i => i.id !== it.id); C.apagarDados(s, it.id); salvar(); tudo();
    };
    nm.append(del);
    const cont = el('div', 'cont'), ent = el('div', 'ent'), inp = el('input', 'valor'), add = el('button', 'p', '+'), chips = el('div', 'chips');
    inp.inputMode = 'decimal'; inp.placeholder = 'quantidade'; inp.autocomplete = 'off'; inp.enterKeyHint = 'next';
    add.title = 'Somar'; ent.append(inp, add); cont.append(ent, chips);
    const fis = el('div', 'num fisico'), sal = el('div', 'num saldo'), dif = el('div', 'num dif');
    const obs = el('input', 'obs'); obs.placeholder = 'Observação'; obs.value = s.obs[it.id] || '';
    obs.addEventListener('input', () => { if (obs.value) s.obs[it.id] = obs.value; else delete s.obs[it.id]; salvar(); });
    d.append(nm, cont, fis, sal, dif, obs);

    function num(box, rotulo, v) { box.replaceChildren(el('small', '', rotulo), document.createTextNode(v)); }
    function pintar() {
      const x = C.situacao(s, it);
      d.className = 'it' + (s.cego ? ' cego' : ' ' + x.tipo);
      num(fis, 'Físico', x.fisico === null ? '–' : C.fmt(x.fisico));
      num(sal, 'Sistema', x.saldo === null || s.cego ? '–' : C.fmt(x.saldo));
      num(dif, x.dif === null || s.cego ? 'Diferença' : C.ROTULO[x.tipo], x.dif === null || s.cego ? '–' : C.sinal(x.dif));
      chips.replaceChildren(...(s.cont[it.id] || []).map((v, k) => {
        const b = el('button', '', C.fmt(v) + ' ✕');
        b.onclick = () => { s.cont[it.id].splice(k, 1); if (!s.cont[it.id].length) delete s.cont[it.id]; salvar(); pintar(); status(); };
        return b;
      }));
    }
    function somar() {
      if (!inp.value.trim()) return true;
      const v = C.numsContagem(inp.value);
      if (!v) { inp.setCustomValidity('Use só números'); inp.reportValidity(); inp.select(); return false; }
      s.cont[it.id] = (s.cont[it.id] || []).concat(v); inp.value = '';
      const nomes = s.resp ? s.resp.split(', ') : [];
      if (estado.usuario && !nomes.includes(estado.usuario)) s.resp = nomes.concat(estado.usuario).join(', '); salvar(); pintar(); status(); return true;
    }
    inp.addEventListener('input', () => inp.setCustomValidity(''));
    inp.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (!somar()) return;
      const todos = visiveis(), prox = todos[todos.indexOf(inp) + 1];
      if (prox) { prox.focus(); prox.scrollIntoView({ block: 'center' }); }
    });
    /* Valor digitado e não confirmado também conta ao sair do campo. */
    inp.addEventListener('change', somar);
    add.onclick = () => { somar(); inp.focus(); };
    pintar();
    return d;
  }

  function lista() {
    const s = setor(), q = C.norm($('q').value), cat = $('cat').value, f = $('filtro').value;
    const itens = s.itens.filter(it => {
      if (q && !C.norm(it.nome + ' ' + it.cod).includes(q)) return false;
      if (cat && localDe(it.cat) !== cat) return false;
      const t = C.situacao(s, it).tipo;
      if (f === 'recont') return pedidas().includes(K.chave(it));
      return !f || (f === 'div' ? t === 'falta' || t === 'sobra' : t === f);
    });
    const grupos = new Map();
    itens.forEach(it => { const g = localDe(it.cat) || 'Sem categoria'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(it); });
    const nos = [];
    grupos.forEach((g, nome) => { nos.push(el('h2', '', nome)); g.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')).forEach(it => nos.push(linha(it))); });
    if (!nos.length) nos.push(el('div', 'vazio', s.itens.length ? 'Nenhum item com esses filtros.' : 'Este setor ainda não tem itens. Toque em Menu → Cadastrar itens e cole a sua lista.'));
    $('lista').replaceChildren(...nos);
    status();
    avisos();
    marcarFiltros();
  }

  /* Data da lista recebida e recontagem pedida pelo administrador. */
  const KLISTA = KEY + '-lista';
  const infoLista = () => { try { return JSON.parse(localStorage.getItem(KLISTA)) || {}; } catch (e) { return {}; } };
  const pedido = () => (infoLista().recontagens || {})[C.nomeArq(emp().nome)];
  const pedidas = () => (pedido() || { itens: [] }).itens;
  function avisos() {
    const info = infoLista(), n = pedidas().length;
    const quando = info.quando ? new Date(info.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    $('listaInfo').textContent = quando ? (info.origem ? 'Lista enviada em ' : 'Lista atualizada em ') + quando : '';
    $('filtro').querySelector('[value=recont]').hidden = !n;
    if (!n && $('filtro').value === 'recont') { $('filtro').value = ''; lista(); }
    $('bRecont').hidden = !n || !!info.origem;
    const aqui = setor().itens.filter(i => pedidas().includes(K.chave(i))).length;
    $('bRecont').textContent = '🔁 Recontagem pedida: ' + n + (n === 1 ? ' item' : ' itens') + ' (' + aqui + ' nesta família)';
  }
  $('bRecont').onclick = () => { $('filtro').value = 'recont'; $('q').value = ''; $('cat').value = ''; lista(); };

  document.querySelectorAll('[data-fechar]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $('emp').onchange = () => { estado.sel = { emp: $('emp').value, set: '' }; salvar(); tudo(); salvar(); };
  $('set').onchange = () => { estado.sel.set = $('set').value; tudo(); salvar(); };

  /* Identificação de quem conta (sem senha) e data automática. */
  const SESSAO = KEY + '-sessao';
  const identificado = () => { try { return sessionStorage.getItem(SESSAO) === hoje() && !!estado.usuario; } catch (e) { return false; } };
  function cabecalho() {
    setor().data = hoje();
    /* Atalho do dia a dia: só no aparelho do administrador conectado. */
    $('bImpConf').hidden = !souAdmin() || !servidor();
    $('data').textContent = hoje().split('-').reverse().join('/');
    $('resp').textContent = estado.usuario || '—';
  }
  /* PIN: evita contar no nome de outra pessoa por engano. Não é segurança forte. */
  const cadastrado = nome => (estado.usuarios || []).find(n => C.norm(n) === C.norm(nome));
  const temPin = nome => !!(nome && estado.pins && estado.pins[nome]);
  async function resumoPin(nome, pin) {
    /* "sais" preserva o PIN de quem teve o nome corrigido. */
    return resumoSal((estado.sais && estado.sais[nome]) || C.norm(nome), pin);
  }
  async function resumoSal(sal, pin) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sal + ':' + pin));
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  /* Tela de entrada: '' = pergunta, 'ja' = já tenho usuário, 'novo' = cadastro novo. */
  let modoEntrada = '';
  const semUsuarios = () => !(estado.usuarios || []).length;
  /* Servidor (script no Google). Endereço e chave ficam só neste aparelho, fora dos backups. */
  const KSERV = KEY + '-servidor';
  const servidor = () => { try { return JSON.parse(localStorage.getItem(KSERV)); } catch (e) { return null; } };
  async function chamar(acao, dados, cfg) {
    const c = cfg || servidor();
    const corta = new AbortController(), t = setTimeout(() => corta.abort(), 30000);
    let r;
    try {
      const res = await fetch(c.url, { method: 'POST', body: JSON.stringify(Object.assign({ acao, chave: c.chave }, dados)), signal: corta.signal });
      r = await res.json();
    } catch (e) {
      throw Object.assign(new Error('Sem conexão com o Google.'), { semRede: true });
    } finally { clearTimeout(t); }
    if (!r || !r.ok) throw new Error((r && r.erro) || 'O Google não respondeu como esperado.');
    return r;
  }
  let recPendente = '';
  /* A lista do servidor vale para todos os aparelhos. */
  function aplicarUsuarios(r) {
    if (!r.usuarios || !r.usuarios.length) return;
    for (const k of ['usuarios', 'pins', 'sais', 'admin', 'recuperacao']) estado[k] = r[k];
    if (estado.usuario && !estado.usuarios.includes(estado.usuario)) {
      estado.usuario = '';
      try { sessionStorage.removeItem(SESSAO); } catch (e) { /* sem sessão */ }
    }
    salvar(); cabecalho();
  }
  async function sincronizar() {
    if (!servidor() || recPendente) return;
    try { aplicarUsuarios(await chamar('usuarios')); } catch (e) { return; }
    if ($('dUser').open) { montarNomes(); $('uCancelar').hidden = !identificado(); } else if (!identificado()) pedirUsuario();
  }

  function ajustarPin() {
    const n = cadastrado($('uNome').value), criar = modoEntrada === 'novo' || (!!n && !temPin(n));
    $('uPin').placeholder = criar ? 'Crie um PIN de 4 números' : 'Digite o seu PIN';
    $('uPin2').hidden = !criar;
    /* O administrador também pode digitar o código de recuperação, de 8 números. */
    $('uPin').maxLength = modoEntrada === 'ja' && n && n === estado.admin ? 8 : 4;
    $('uErro').textContent = '';
  }
  function mostrar(m) {
    modoEntrada = m;
    const vazio = m === 'ja' && semUsuarios();
    $('uNome').value = $('uPin').value = $('uPin2').value = '';
    $('uEscolha').hidden = !!m;
    $('uServ').hidden = !!servidor() || !semUsuarios();
    $('uCampos').hidden = !m || vazio;
    $('uEntrar').hidden = !m || vazio;
    $('uVoltar').hidden = !m;
    $('uTrazer').hidden = !vazio;
    $('uLista').hidden = m !== 'ja';
    $('uTexto').textContent = m !== 'novo' ? 'Toque no seu nome e digite o PIN.'
      : 'Digite o seu nome e crie um PIN.' + (servidor() ? '' : ' Este aparelho ainda não está conectado ao Google: peça o link de conexão ao administrador.');
    /* Quem usou o aparelho por último já vem preenchido. */
    if (m === 'ja' && ultimo()) $('uNome').value = ultimo();
    ajustarPin();
    if (vazio) $('uErro').textContent = 'Este aparelho ainda não tem usuários. Traga o arquivo de usuários salvo no outro aparelho, ou toque em Voltar e faça um Cadastro novo.';
  }
  function montarNomes() {
    $('uLista').replaceChildren(...(estado.usuarios || []).map(n => {
      const b = el('button', '', n); b.type = 'button';
      b.onclick = () => { $('uNome').value = n; $('uPin').value = $('uPin2').value = ''; ajustarPin(); $('uPin').focus(); };
      return b;
    }));
  }
  const KULTIMO = KEY + '-ultimo';
  const ultimo = () => cadastrado(localStorage.getItem(KULTIMO) || '') || '';
  function pedirUsuario() {
    if ($('dUser').open) return;
    $('uCancelar').hidden = !identificado();
    recPendente = '';
    montarNomes();
    mostrar(ultimo() ? 'ja' : '');
    $('dUser').showModal();
    if (ultimo()) $('uPin').focus();
  }
  $('uJa').onclick = () => { mostrar('ja'); sincronizar(); };
  $('uNovo').onclick = () => { mostrar('novo'); $('uNome').focus(); };
  $('uVoltar').onclick = () => mostrar('');
  $('uTrazer').onclick = () => $('uArq').click();
  $('uArq').onchange = async () => {
    const arq = $('uArq').files[0]; $('uArq').value = '';
    if (!arq || !semUsuarios()) return;
    try {
      Object.assign(estado, C.lerUsuarios(await arq.text()));
      salvar(); $('dUser').close();
      if (!$('dUser').open) pedirUsuario();
      mostrar('ja');
    } catch (e) { $('uErro').textContent = 'Esse não é um arquivo de usuários válido.'; }
  };
  async function entrar() {
    const digitado = $('uNome').value.replace(/\s+/g, ' ').trim(), pin = $('uPin').value;
    const erro = t => { $('uErro').textContent = t; };
    if (!modoEntrada) return;
    if (!digitado) return erro('Digite ou toque no seu nome.');
    if (modoEntrada === 'novo' && cadastrado(digitado)) return erro('Esse usuário já existe. Toque em Voltar e escolha Já tenho usuário.');
    if (modoEntrada === 'novo' && digitado.includes(',')) return erro('Digite o nome, sem vírgulas.');
    /* Usuário criado ou renomeado em outro aparelho: busca a lista antes de recusar. */
    if (modoEntrada === 'ja' && !cadastrado(digitado) && servidor()) await sincronizar();
    if (modoEntrada === 'ja' && !cadastrado(digitado)) return erro('Usuário não encontrado neste aparelho. Toque em Voltar e escolha Cadastro novo.');
    const nome = cadastrado(digitado) || digitado;
    if (nome === estado.admin && /^\d{8}$/.test(pin)) {
      const rec = await resumoPin(nome, pin);
      if (rec !== estado.recuperacao) return erro('Código de recuperação incorreto.');
      if (servidor()) recPendente = rec;
      delete estado.pins[nome]; salvar();
      $('uPin').value = $('uPin2').value = ''; ajustarPin();
      return erro('Código aceito. Crie o novo PIN.');
    }
    if (!/^\d{4}$/.test(pin)) return erro('O PIN precisa ter 4 números.');
    let hash = await resumoPin(nome, pin);
    if (temPin(nome)) {
      /* PIN pode ter sido trocado em outro aparelho: confere a lista nova antes de recusar. */
      if (estado.pins[nome] !== hash && servidor()) { await sincronizar(); hash = await resumoPin(nome, pin); }
      if (estado.pins[nome] !== hash) { $('uPin').value = ''; return erro('PIN incorreto. Peça ao administrador para trocar.'); }
    } else {
      if ($('uPin2').value !== pin) return erro('Os dois PINs precisam ser iguais.');
      if (servidor()) {
        try {
          const r = recPendente ? await chamar('recuperar', { recuperacao: recPendente, hash })
            : await chamar('cadastrar', { nome, hash: await resumoPin(nome, pin) });
          recPendente = ''; aplicarUsuarios(r);
        } catch (e) { return erro(e.semRede ? 'Para cadastrar ou trocar o PIN é preciso internet.' : e.message); }
      }
      estado.pins = estado.pins || {}; estado.pins[nome] = hash;
    }
    estado.usuarios = estado.usuarios || [];
    if (!estado.usuarios.includes(nome)) estado.usuarios.push(nome);
    estado.usuario = nome;
    try { localStorage.setItem(KULTIMO, nome); } catch (e) { /* só deixa de lembrar */ }
    try { sessionStorage.setItem(SESSAO, hoje()); } catch (e) { /* pergunta de novo depois */ }
    salvar(); cabecalho(); $('dUser').close();
  }
  $('uNome').oninput = ajustarPin;
  $('uForm').onsubmit = e => { e.preventDefault(); entrar().catch(() => { $('uErro').textContent = 'Não foi possível conferir o PIN neste navegador.'; }); };

  /* Cadastro de usuários: só o administrador. */
  const souAdmin = () => identificado() && !!estado.admin && estado.usuario === estado.admin;
  function ajustarMenu() {
    $('mSouAdm').hidden = !!estado.admin || !identificado();
    $('mServ').hidden = !!estado.admin && !souAdmin();
    $('mServ').querySelector('b').textContent = servidor() ? '✔ Conectado ao Google' : 'Conectar ao Google';
    $('mLink').hidden = !souAdmin();
    $('mLista').hidden = !souAdmin() || !servidor();
    $('mComp').hidden = !souAdmin() || !servidor();
    $('mUsuarios').hidden = !souAdmin();
    $('mAdmTxt').textContent = estado.admin ? 'Administrador: ' + estado.admin : 'Este aparelho ainda não tem administrador.';
    /* Quem só conta vê apenas relatório e backup. */
    const restrito = !!estado.admin && !souAdmin();
    for (const id of ['gItens', 'gCad', 'gInv', 'gAp']) $(id).hidden = restrito;
  }
  async function novoCodigo() {
    const codigo = String(10000000 + crypto.getRandomValues(new Uint32Array(1))[0] % 90000000);
    const rec = await resumoPin(estado.admin, codigo);
    if (servidor()) {
      try { await chamar('codigo', { auth: estado.pins[estado.admin], recuperacao: rec }); }
      catch (e) { return alert('O código não foi trocado. ' + e.message); }
    }
    estado.recuperacao = rec; salvar();
    alert('ANOTE E GUARDE o código de recuperação do administrador:\n\n' + codigo + '\n\nSe esquecer o PIN, digite esse código no lugar dele. Ele não será mostrado novamente.');
  }
  $('mSouAdm').onclick = async () => {
    if (estado.admin || !confirm('Definir “' + estado.usuario + '” como administrador deste aparelho?')) return;
    estado.admin = estado.usuario; salvar(); await novoCodigo(); ajustarMenu();
  };
  let editando = '';
  function editar(nome) {
    editando = nome;
    $('aTitulo').textContent = nome ? 'Alterando: ' + nome + ' (deixe o PIN vazio para manter o atual)' : 'Novo usuário';
    $('aNome').value = nome; $('aPin').value = ''; $('aMsg').textContent = '';
  }
  const abrirForm = nome => { editar(nome); $('aForm').hidden = false; $('aForm').scrollIntoView({ block: 'nearest' }); (nome ? $('aPin') : $('aNome')).focus(); };
  const fecharForm = () => { editar(''); $('aForm').hidden = true; };
  function listaUsuarios() {
    const ordem = (estado.usuarios || []).slice().sort((x, y) => (y === estado.admin) - (x === estado.admin) || x.localeCompare(y, 'pt-BR'));
    $('aLista').replaceChildren(...ordem.map(n => {
      const adm = n === estado.admin, d = el('div', adm ? 'usu adm' : 'usu'), ed = el('button', '', 'Alterar nome / PIN');
      ed.type = 'button'; ed.onclick = () => abrirForm(n);
      const quem = el('span', '', n);
      quem.append(el('small', '', (adm ? 'Administrador · acessa tudo' : 'Usuário · só faz contagem') + (temPin(n) ? '' : ' · ainda sem PIN')));
      d.append(quem, ed);
      if (n !== estado.admin) {
        const x = el('button', 'x', 'Excluir'); x.type = 'button';
        x.onclick = async () => {
          if (!confirm('Excluir o usuário “' + n + '”? As contagens já feitas continuam com o nome dele.')) return;
          if (servidor()) {
            try { await chamar('excluir', { auth: estado.pins[estado.admin], nome: n }); }
            catch (e) { $('aMsg').textContent = e.message; return; }
          }
          estado.usuarios = estado.usuarios.filter(u => u !== n);
          delete (estado.pins || {})[n]; delete (estado.sais || {})[n];
          salvar(); listaUsuarios(); fecharForm();
        };
        d.append(x);
      }
      return d;
    }));
  }
  async function salvarUsuario() {
    if (!souAdmin()) return;
    const novo = $('aNome').value.replace(/\s+/g, ' ').trim(), pin = $('aPin').value, antigo = editando;
    const erro = t => { $('aMsg').textContent = t; };
    if (!novo || novo.includes(',')) return erro('Digite o nome, sem vírgulas.');
    const outro = cadastrado(novo);
    if (outro && outro !== antigo) return erro('Já existe um usuário com esse nome.');
    if (pin && !/^\d{4}$/.test(pin)) return erro('O PIN precisa ter 4 números.');
    if (!antigo && !pin) return erro('Informe o PIN do novo usuário.');
    estado.usuarios = estado.usuarios || []; estado.pins = estado.pins || {}; estado.sais = estado.sais || {};
    if (servidor()) {
      /* O PIN é embaralhado com o mesmo "sal" que o usuário já tinha. */
      const sal = antigo ? (estado.sais[antigo] || C.norm(antigo)) : C.norm(novo);
      const hash = pin ? await resumoSal(sal, pin) : '';
      try { await chamar('salvar', { auth: estado.pins[estado.admin], antigo, nome: novo, hash }); }
      catch (e) { return erro(e.message); }
      if (!antigo) estado.sais[novo] = sal;
    }
    if (!antigo) estado.usuarios.push(novo);
    else if (antigo !== novo) {
      estado.sais[novo] = estado.sais[antigo] || C.norm(antigo); delete estado.sais[antigo];
      if (estado.pins[antigo]) estado.pins[novo] = estado.pins[antigo];
      delete estado.pins[antigo];
      estado.usuarios[estado.usuarios.indexOf(antigo)] = novo;
      if (estado.usuario === antigo) estado.usuario = novo;
      if (estado.admin === antigo) estado.admin = novo;
      for (const e of estado.empresas) for (const s of e.setores) if (s.resp) s.resp = s.resp.split(', ').map(n => n === antigo ? novo : n).join(', ');
    }
    if (pin) estado.pins[novo] = await resumoPin(novo, pin);
    salvar(); cabecalho(); listaUsuarios(); fecharForm();
    erro(antigo ? 'Salvo.' : 'Salvo. “' + novo + '” entra como usuário normal, em “Já tenho usuário”.');
  }
  /* Abre mostrando o que já tem e busca no Google quem se cadastrou em outro aparelho. */
  async function atualizarUsuarios() {
    const diz = t => { $('aEstado').textContent = t; };
    if (!servidor()) return diz('Lista só deste aparelho. Conecte ao Google para ver os cadastros dos outros.');
    diz('Buscando a lista no Google…');
    try { aplicarUsuarios(await chamar('usuarios')); } catch (e) { return diz('Sem conexão: esta é a última lista salva neste aparelho.'); }
    listaUsuarios();
    diz('Lista do Google, a mesma para todos os aparelhos conectados.');
  }
  $('mUsuarios').onclick = () => { if (!souAdmin()) return; $('dMenu').close(); listaUsuarios(); fecharForm(); $('dAdm').showModal(); atualizarUsuarios(); };
  $('aForm').onsubmit = e => { e.preventDefault(); salvarUsuario(); };
  $('aExportar').onclick = () => {
    if (!souAdmin()) return;
    baixar('usuarios_conferencia_' + hoje() + '.json', C.arquivoUsuarios(estado), 'application/json');
    $('aMsg').textContent = 'Arquivo salvo em Downloads.';
  };
  $('aNovo').onclick = () => abrirForm('');
  $('aCancelar').onclick = fecharForm;
  $('aCodigo').onclick = () => { if (souAdmin() && confirm('Gerar um novo código? O anterior deixa de valer.')) novoCodigo(); };
  $('uCancelar').onclick = () => $('dUser').close();
  $('dUser').addEventListener('cancel', e => { if (!identificado()) e.preventDefault(); });
  $('dUser').addEventListener('close', () => { if (!identificado()) setTimeout(pedirUsuario); });
  $('bTrocar').onclick = pedirUsuario;
  /* App deixado aberto de um dia para o outro: atualiza a data e pede o nome. */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { cabecalho(); if (!identificado()) pedirUsuario(); } });

  /* O relatório leva quem contou o setor; se ninguém contou ainda, quem está usando. */
  const paraRelatorio = () => { const s = setor(); s.data = hoje(); return Object.assign({}, s, { resp: s.resp || estado.usuario || '' }); };
  $('cego').onchange = () => { setor().cego = $('cego').checked; salvar(); tudo(); };
  $('q').oninput = $('cat').onchange = $('filtro').onchange = lista;
  $('bFiltros').onclick = () => { $('painelF').hidden = !$('painelF').hidden; $('bFiltros').setAttribute('aria-expanded', !$('painelF').hidden); };
  /* Botão destacado quando algum filtro está escondendo itens. */
  function marcarFiltros() {
    const n = [$('cat').value, $('filtro').value, setor().cego].filter(Boolean).length;
    $('bFiltros').textContent = n ? 'Filtros (' + n + ')' : 'Filtros';
    $('bFiltros').classList.toggle('ativo', !!n);
  }

  /* Importação */
  let modo = '';
  function abrirImp(m) {
    modo = m;
    $('impT').textContent = (m === 'itens' ? 'Cadastrar itens — ' : 'Saldo do sistema — ') + emp().nome + ' / ' + setor().nome;
    $('impA').textContent = m === 'itens'
      ? 'Copie da planilha e cole, nesta ordem: Código, Item, Unidade, Categoria. Uma coluna só é lida como nome do item.'
      : 'Cole duas colunas: Código (ou nome do item) e Quantidade. Havendo mais colunas, vale a primeira e a última. Substitui o saldo anterior.';
    $('impRl').style.display = m === 'itens' ? '' : 'none';
    $('impX').value = ''; $('impF').value = ''; $('impR').checked = false; $('dres').textContent = '';
    $('dImp').showModal();
  }
  $('bItens').onclick = () => { $('dMenu').close(); abrirImp('itens'); };
  $('bSaldo').onclick = () => { $('dMenu').close(); abrirImp('saldo'); };
  $('impF').onchange = async () => {
    const f = $('impF').files[0];
    if (!f) return;
    const buf = await f.arrayBuffer();
    let t;
    try { t = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { t = new TextDecoder('windows-1252').decode(buf); }
    $('impX').value = t;
  };
  const bloco = (titulo, l) => l.length ? '\n\n' + titulo + ' (' + l.length + '):\n' + l.slice(0, 30).join('\n') + (l.length > 30 ? '\n…' : '') : '';
  $('impOk').onclick = () => {
    const s = setor(), t = $('impX').value;
    if (!t.trim()) { $('dres').textContent = 'Cole a lista ou escolha um arquivo.'; return; }
    if (modo === 'itens') {
      if ($('impR').checked && !confirm('Itens fora da lista serão removidos, junto com suas contagens. Continuar?')) return;
      const r = C.importarCadastro(s, t, { removerAusentes: $('impR').checked });
      $('dres').textContent = r.novos + ' novos, ' + r.atualizados + ' atualizados, ' + r.removidos + ' removidos.' + bloco('Linhas ignoradas', r.ignorados);
    } else {
      const r = C.importarSaldo(s, t);
      $('dres').textContent = (r.casados ? 'Saldo carregado para ' + r.casados + ' itens. Itens do setor sem saldo: ' + r.semSaldo + '.' : 'Nenhuma linha casou com os itens. O saldo anterior foi mantido.') +
        bloco('NÃO encontrados no cadastro', r.naoEncontrados) + bloco('Sem quantidade válida', r.invalidos) + bloco('Repetidos e somados', r.somados);
    }
    salvar(); tudo();
  };

  /* Excel "Posição de Estoque" */
  let conferirDepois = false;
  const escolherExcel = conferir => { conferirDepois = conferir; $('xFile').value = ''; $('xFile').click(); };
  $('bExcel').onclick = () => { $('dMenu').close(); escolherExcel(false); };
  $('bImpConf').onclick = () => escolherExcel(true);
  $('xFile').onchange = async () => {
    const f = $('xFile').files[0];
    if (!f) return;
    try {
      const plan = await window.lerXlsx(await f.arrayBuffer());
      /* Trabalha numa cópia: se algo falhar ou for cancelado, nada muda. */
      const copia = JSON.parse(JSON.stringify(estado));
      const r = C.importarExcel(copia, emp().id, plan);
      /* No atalho só pergunta se algum item ficaria de fora. */
      if ((!conferirDepois || r.naoIdentificados.length) && !confirm('Importar para “' + r.destino + '”?\n\n' + r.total + ' itens na planilha\n' + r.atualizados + ' já cadastrados (contagens mantidas)\n' + r.novos + ' novos\n' + r.fora + ' do app que não estão na planilha (mantidos)'
        + (r.naoIdentificados.length ? '\n\nNÃO importados, empresa não identificada (' + r.naoIdentificados.length + '):\n' + r.naoIdentificados.slice(0, 10).join('\n') : ''))) return;
      estado = copia;
      $('q').value = ''; $('filtro').value = '';
      salvar(); tudo(); salvar();
      const resumo = 'Saldo atualizado: ' + r.total + (r.total === 1 ? ' item' : ' itens') + (r.novos ? ' (' + r.novos + (r.novos === 1 ? ' novo)' : ' novos)') : '') + '.';
      if (!conferirDepois) return alert('Pronto. ' + resumo);
      /* Arquivo do Portal importado com outra empresa aberta: mostra o Portal. */
      const portal = estado.empresas.filter(e => e.nome === 'Portal Beach' || e.nome === 'Portal A&B');
      if (r.destino === 'Portal Beach e Portal A&B' && !portal.includes(emp())) { estado.sel = { emp: (portal.find(e => e.nome === 'Portal Beach') || portal[0]).id, set: '' }; salvar(); tudo(); salvar(); }
      window.Conferir.abrirEBuscar(resumo);
    } catch (e) { alert('Não foi possível importar. ' + e.message); }
  };

  /* Relatório */
  const textoRel = () => { $('relX').value = C.relatorio(emp().nome, paraRelatorio(), $('relD').checked); };
  $('bRel').onclick = () => { $('dMenu').close(); textoRel(); $('dRel').showModal(); };
  $('relD').onchange = textoRel;
  $('relC').onclick = async () => {
    try { await navigator.clipboard.writeText($('relX').value); }
    catch (e) { $('relX').select(); document.execCommand('copy'); }
    $('relC').textContent = 'Copiado!'; setTimeout(() => $('relC').textContent = 'Copiar', 1500);
  };
  if (!navigator.share) $('relS').hidden = true;
  $('relS').onclick = () => navigator.share({ text: $('relX').value }).catch(() => {});
  function baixar(nome, conteudo, tipo) {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo })); a.download = nome;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const arquivo = t => C.norm(t).replace(/[^a-z0-9]+/g, '-');
  $('relV').onclick = () => baixar('conferencia_' + arquivo(emp().nome) + '_' + arquivo(setor().nome) + '_' + setor().data + '.csv', '﻿' + C.csv(emp().nome, paraRelatorio()), 'text/csv');

  /* Finalizar contagem: grava no Drive; sem internet, fica na fila. */
  const KFILA = KEY + '-fila';
  const lerFila = () => { try { return JSON.parse(localStorage.getItem(KFILA)) || []; } catch (e) { return []; } };
  function mostrarPendentes() {
    const n = lerFila().length;
    $('bPend').hidden = !n;
    $('bPend').textContent = '⏳ Enviar pendentes (' + n + ')';
  }
  let enviando = null;
  function enviarFila() {
    if (!enviando) enviando = (async () => {
      let erro = null;
      while (servidor()) {
        const item = lerFila()[0];
        if (!item) break;
        try { await chamar('arquivo', item); } catch (e) { erro = e; break; }
        localStorage.setItem(KFILA, JSON.stringify(lerFila().filter(x => x.id !== item.id)));
        mostrarPendentes();
      }
      return erro;
    })().finally(() => { enviando = null; mostrarPendentes(); });
    return enviando;
  }
  const agora = () => new Date().toTimeString().slice(0, 8).replace(':', 'h').replace(':', '-');
  const localAtual = () => $('cat').value;
  function montar() {
    const data = hoje(), hora = agora(), grupo = $('fGrupo').value;
    const f = C.finalizacao(estado, emp().id, grupo, localAtual(), estado.usuario, data, hora);
    const meta = { usuario: estado.usuario, aparelho: idAparelho(), data, hora };
    if (pedido()) meta.recontagem = pedido().id;
    f.pacote.arquivos.push({ nome: f.pacote.id + '_contagem.json', conteudo: JSON.stringify(K.contagemDe(estado, emp().id, grupo, localAtual(), meta)) });
    return f;
  }
  function resumoFim() {
    $('fMsg').textContent = '';
    const r = montar().total;
    const cego = emp().setores.some(s => s.cego && C.grupoDe(s.nome) === $('fGrupo').value);
    $('fResumo').textContent = r.total + ' itens · ' + r.contados + ' contados · ' + r.nao_contado + ' não contados'
      + (cego ? '' : ' · faltas: ' + r.falta + ' · sobras: ' + r.sobra);
    $('fOk').disabled = !r.contados;
    if (!r.contados) $('fMsg').textContent = r.total ? 'Nenhum item contado neste grupo.' : 'Este grupo não tem itens no local escolhido.';
  }
  $('bFim').onclick = () => {
    if (!identificado()) return pedirUsuario();
    const grupos = C.gruposDe(emp());
    if (!grupos.length) return alert('Esta empresa ainda não tem itens.');
    if (!servidor()) { alert('Primeiro conecte este aparelho ao Google.'); return abrirServidor(); }
    const atual = C.grupoDe(setor().nome);
    opcoes($('fGrupo'), grupos.map(g => [g, g.replace(/_/g, ' ')]), grupos.includes(atual) ? atual : grupos[0]);
    $('fOnde').textContent = emp().nome + ' · ' + (localAtual() || 'todos os locais') + ' · ' + estado.usuario;
    resumoFim();
    $('dFim').showModal();
  };
  $('fGrupo').onchange = resumoFim;
  $('fOk').onclick = async () => {
    const f = montar();
    try { localStorage.setItem(KFILA, JSON.stringify(lerFila().concat(f.pacote))); }
    catch (e) { $('fMsg').textContent = 'Sem espaço no aparelho. Envie os pendentes antes.'; return; }
    mostrarPendentes();
    $('fOk').disabled = true; $('fMsg').textContent = 'Enviando…';
    let erro = await enviarFila();
    if (!erro && lerFila().some(x => x.id === f.pacote.id)) erro = await enviarFila();
    $('fMsg').textContent = !erro ? '✔ Salvo no Drive. A contagem continua no aparelho.'
      : erro.semRede ? 'Sem internet: ficou PENDENTE e será enviado quando a conexão voltar, com o app aberto.'
      : 'Ficou PENDENTE. O Google recusou: ' + erro.message;
  };
  $('bPend').onclick = async () => {
    const erro = await enviarFila();
    alert(erro ? 'Ainda pendente. ' + erro.message : 'Pendentes enviados.');
  };

  /* Lista de itens: o aparelho que a enviou pelo botão é a origem; os outros recebem. */
  function gravarInfo(mais) {
    try { localStorage.setItem(KLISTA, JSON.stringify(Object.assign(infoLista(), mais))); } catch (e) { /* baixa de novo depois */ }
  }
  function idAparelho() {
    let id = infoLista().aparelho;
    if (!id) { id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); gravarInfo({ aparelho: id }); }
    return id;
  }
  const podeEnviar = () => !!servidor() && !bloqueado && !!estado.admin && estado.usuario === estado.admin && identificado();
  async function enviarLista(auto) {
    const lista = C.listaItens(estado), texto = JSON.stringify(lista);
    const r = await chamar('salvarLista', { auth: estado.pins[estado.admin], aparelho: idAparelho(), auto, lista });
    gravarInfo(r.assumida ? { origem: true, versao: r.versao, enviado: texto, quando: new Date().toISOString() } : { origem: false });
    avisos();
    return r;
  }
  /* Digitação ainda não somada: não mexe na tela agora. */
  const digitando = () => [...document.querySelectorAll('.it .valor')].some(i => i.value.trim());
  let sincLista = null;
  function sincronizarLista() {
    if (!sincLista) sincLista = (async () => {
      const cfg = servidor();
      if (!cfg || bloqueado) return;
      const info = infoLista(), mesmo = info.url === cfg.url;
      const r = await chamar('lista', { versao: mesmo ? info.versao : '' });
      gravarInfo({ url: cfg.url });
      if (!r.versao) return;
      gravarInfo({ quando: r.quando || '' });
      if (r.origem === idAparelho()) {
        gravarInfo({ origem: true, recontagens: r.recontagens || {} });
        avisos();
        if (podeEnviar() && infoLista().enviado !== JSON.stringify(C.listaItens(estado))) await enviarLista(true);
        return;
      }
      gravarInfo({ origem: false });
      if (digitando()) return;
      let mudou = false;
      if (r.lista) { estado = C.aplicarLista(estado, r.lista); gravarInfo({ versao: r.versao }); mudou = true; }
      /* Recontagem nova: apaga a contagem anterior dos itens pedidos, uma vez só. */
      const antes = infoLista().recontagens || {}, agoraPedidos = r.recontagens || {};
      for (const nome in agoraPedidos) {
        if (antes[nome] && antes[nome].id === agoraPedidos[nome].id) continue;
        if (K.limparParaRecontar(estado, nome, agoraPedidos[nome].itens)) mudou = true;
      }
      gravarInfo({ recontagens: agoraPedidos });
      if (mudou) { salvar(); tudo(); salvar(); } else avisos();
    })().catch(() => { /* sem internet ou script antigo: tenta de novo depois */ }).finally(() => { sincLista = null; });
    return sincLista;
  }
  agendarLista = () => {
    clearTimeout(esperaLista);
    esperaLista = setTimeout(() => {
      const info = infoLista();
      if (info.origem && podeEnviar() && info.enviado !== JSON.stringify(C.listaItens(estado))) enviarLista(true).catch(() => {});
    }, 3000);
  };
  $('mLista').onclick = async () => {
    if (!souAdmin() || !servidor()) return;
    $('dMenu').close();
    const n = C.contarItens(C.listaItens(estado));
    if (!n) return alert('Este aparelho não tem itens para enviar.');
    if (!confirm('Enviar a lista deste aparelho (' + n + ' itens, sem saldo)? Ela passa a valer para todos os aparelhos.')) return;
    try {
      await enviarLista(false);
      alert('Lista enviada. Os outros aparelhos recebem ao abrir o app com internet. As próximas mudanças feitas aqui vão sozinhas.');
    } catch (e) { alert('Não foi possível enviar a lista. ' + e.message); }
  };

  /* Conexão com o Google */
  function abrirServidor() {
    const c = servidor();
    $('sUrl').value = c ? c.url : ''; $('sChave').value = c ? c.chave : '';
    $('sEstado').textContent = c ? 'Este aparelho está conectado.' : 'Informe o endereço do script e a chave de acesso.';
    $('sSair').hidden = !c; $('sMsg').textContent = '';
    $('dServ').showModal();
  }
  /* Devolve false se a pessoa desistir; lança erro se não der para conectar. */
  async function conectar(cfg) {
    let r = await chamar('usuarios', {}, cfg);
    if (!r.usuarios.length) {
      if (!estado.admin) throw new Error('O servidor ainda está vazio. Conecte primeiro o aparelho do administrador (Menu → Definir-me como administrador).');
      if (!confirm('Enviar os usuários deste aparelho para o Google? “' + estado.admin + '” será o administrador de todos.')) return false;
      r = await chamar('iniciar', { usuarios: estado.usuarios, pins: estado.pins, sais: estado.sais, admin: estado.admin, recuperacao: estado.recuperacao }, cfg);
    } else if (!semUsuarios()) {
      /* Quem se cadastrou aqui antes de o aparelho ter Google não pode perder o acesso. */
      const soAqui = servidor() ? [] : estado.usuarios.filter(n => temPin(n) && !r.usuarios.some(u => C.norm(u) === C.norm(n)) &&
        (!estado.sais || !estado.sais[n] || estado.sais[n] === C.norm(n)));
      if (!confirm(soAqui.length ? 'Cadastrados só neste aparelho: ' + soAqui.join(', ') + '. Serão enviados ao Google como usuários normais, e a lista do Google passa a valer. Continuar?'
        : 'Os usuários deste aparelho serão substituídos pelos do Google. Continuar?')) return false;
      for (const n of soAqui) r = await chamar('cadastrar', { nome: n, hash: estado.pins[n] }, cfg);
    }
    localStorage.setItem(KSERV, JSON.stringify(cfg));
    aplicarUsuarios(r);
    $('dServ').close();
    if ($('dUser').open) { montarNomes(); mostrar('ja'); } else if (!identificado()) pedirUsuario();
    await sincronizarLista();
    alert(souAdmin() ? 'Aparelho conectado. Para ligar os outros: Menu → Enviar link de conexão.' : 'Aparelho conectado.');
    enviarFila();
    return true;
  }
  $('sForm').onsubmit = async e => {
    e.preventDefault();
    const cfg = { url: $('sUrl').value.trim(), chave: $('sChave').value.trim() };
    const erro = t => { $('sMsg').textContent = t; };
    if (!C.enderecoValido(cfg.url)) return erro('O endereço deve começar com https://script.google.com/ e terminar com /exec.');
    if (!cfg.chave) return erro('Informe a chave de acesso.');
    erro('Conectando…');
    try { if (!await conectar(cfg)) erro(''); } catch (ex) { erro(ex.message); }
  };
  /* Link de conexão: o endereço e a chave vão depois do "#", que não é enviado ao GitHub. */
  $('mLink').onclick = async () => {
    const c = servidor();
    $('dMenu').close();
    if (!c) { abrirServidor(); $('sMsg').textContent = 'Para enviar o link, primeiro conecte este aparelho: informe o endereço e a chave.'; return; }
    const url = C.linkConexao(location.origin + location.pathname, c);
    if (navigator.share) {
      try { await navigator.share({ title: 'Conectar a Conferência de Estoque', url }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); alert('Link copiado. Cole e mande só para quem vai usar.'); }
    catch (e) { prompt('Copie o link e mande só para quem vai usar:', url); }
  };
  async function abrirLink() {
    if (!location.hash.startsWith('#conectar=')) return;
    const cfg = C.lerLink(location.hash);
    history.replaceState(null, '', location.pathname + location.search); // tira a chave da barra de endereço
    if (!cfg) return alert('Link de conexão inválido. Peça outro ao administrador.');
    const atual = servidor();
    if (atual && atual.url === cfg.url && atual.chave === cfg.chave) return alert('Este aparelho já está conectado.');
    if (atual && lerFila().length) return alert('Há contagens pendentes. Envie-as antes de abrir o link de novo.');
    if (!confirm(atual ? 'ATENÇÃO: este aparelho já está conectado, com outro endereço ou chave. Trocar? Só aceite se o link veio do seu administrador.'
      : 'Conectar este aparelho ao Google? Só aceite se o link veio do seu administrador.')) return;
    try { await conectar(cfg); }
    catch (e) { alert('Não foi possível conectar. ' + (e.semRede ? 'Verifique a internet e abra o link de novo.' : e.message)); }
  }
  window.addEventListener('hashchange', abrirLink);
  $('sSair').onclick = () => {
    if (lerFila().length) return alert('Há contagens pendentes. Envie-as antes de desconectar.');
    if (!confirm('Desconectar este aparelho do Google?')) return;
    localStorage.removeItem(KSERV); $('dServ').close(); cabecalho();
  };
  $('uServ').onclick = abrirServidor;
  $('mServ').onclick = () => { $('dMenu').close(); abrirServidor(); };
  window.addEventListener('online', () => { enviarFila(); sincronizar().then(sincronizarLista); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { enviarFila(); sincronizar().then(sincronizarLista); } });
  setInterval(() => { if (lerFila().length && navigator.onLine) enviarFila(); }, 60000);

  /* O que a tela de conferência das contagens usa. */
  window.App = { emp, empresas: () => estado.empresas, chamar, souAdmin, hoje, agora, baixar, avisos, auth: () => estado.pins[estado.admin], infoLista, gravarInfo };

  /* Menu */
  const fechar = () => $('dMenu').close();
  const pedir = (msg, atual) => (prompt(msg, atual || '') || '').trim();
  const gravar = () => { salvar(); tudo(); salvar(); };
  const mudou = () => { gravar(); fechar(); };
  $('bMenu').onclick = () => { ajustarMenu(); $('dMenu').showModal(); };

  /* Listas: a pessoa escolhe em qual setor ou empresa mexer, sem precisar abri-lo antes. */
  const zerarSetor = s => { s.cont = {}; s.sys = {}; s.obs = {}; s.resp = ''; s.data = hoje(); };
  const itensDe = n => n + (n === 1 ? ' item' : ' itens');
  const renomear = (alvo, msg) => { const n = pedir(msg, alvo.nome); if (n) alvo.nome = n; return !!n; };
  const TELAS = {
    setores: {
      titulo: () => 'Setores — ' + emp().nome, novo: '+ Novo setor',
      criar: () => { const n = pedir('Nome do novo setor'); if (!n) return false; const s = C.novoSetor(n); emp().setores.push(s); estado.sel.set = s.id; return true; },
      linhas: () => emp().setores.map(s => [s.nome + ' · ' + itensDe(s.itens.length), [
        ['Renomear', () => renomear(s, 'Novo nome do setor')],
        ['Excluir itens', () => { if (!confirm('Excluir TODOS os ' + s.itens.length + ' itens de “' + emp().nome + ' / ' + s.nome + '”, com contagens e saldos?')) return false; s.itens = []; zerarSetor(s); return true; }, 'x'],
        ['Excluir setor', () => {
          if (emp().setores.length < 2) { alert('A empresa precisa de pelo menos um setor.'); return false; }
          if (!confirm('Excluir o setor “' + s.nome + '” com itens e contagens?')) return false;
          emp().setores = emp().setores.filter(x => x !== s); return true; }, 'x']]])
    },
    empresas: {
      titulo: () => 'Empresas', novo: '+ Nova empresa',
      criar: () => { const n = pedir('Nome da nova empresa'); if (!n) return false; const e = C.novaEmpresa(n, ['Geral']); estado.empresas.push(e); estado.sel = { emp: e.id, set: e.setores[0].id }; return true; },
      linhas: () => estado.empresas.map(e => [e.nome, [
        ['Renomear', () => renomear(e, 'Novo nome da empresa')],
        ['Excluir', () => {
          if (estado.empresas.length < 2) { alert('É preciso manter pelo menos uma empresa.'); return false; }
          if (!confirm('Excluir a empresa “' + e.nome + '” com todos os setores?')) return false;
          estado.empresas = estado.empresas.filter(x => x !== e); return true; }, 'x']]])
    },
    nova: {
      titulo: () => 'Nova conferência — ' + emp().nome, txt: 'Escolha o setor. Zera contagens, saldo e observações; os itens ficam.',
      linhas: () => emp().setores.map(s => [s.nome, [['Zerar', () => { if (!confirm('Zerar contagens, saldo e observações de “' + s.nome + '”?')) return false; zerarSetor(s); return true; }, 'x']]])
    },
    zerar: {
      titulo: () => 'Zerar saldos', txt: 'Escolha a empresa. Zera saldos, contagens e observações de todas as famílias dela. Um backup é baixado antes.',
      linhas: () => estado.empresas.map(e => [e.nome, [['Zerar saldos', () => {
        if (!confirm('Zerar saldos, contagens e observações de TODAS as famílias de “' + e.nome + '”?')) return false;
        baixar('backup_antes_de_zerar_' + hoje() + '.json', C.backup(estado), 'application/json');
        e.setores.forEach(zerarSetor); $('filtro').value = ''; return true; }, 'x']]])
    }
  };
  let tela = '';
  function mostrarLista() {
    const t = TELAS[tela];
    $('lTitulo').textContent = t.titulo();
    $('lTxt').textContent = t.txt || '';
    $('lNovo').hidden = !t.novo; $('lNovo').textContent = t.novo || '';
    $('lItens').replaceChildren(...t.linhas().map(([nome, acoes]) => {
      const lin = el('div', 'lin');
      lin.append(el('span', '', nome));
      for (const [rotulo, fazer, cls] of acoes) {
        const bt = el('button', cls || '', rotulo);
        bt.type = 'button';
        bt.onclick = () => { if (fazer()) { gravar(); mostrarLista(); } };
        lin.append(bt);
      }
      return lin;
    }));
  }
  const abrirTela = nome => { fechar(); tela = nome; mostrarLista(); $('dLista').showModal(); };
  $('mSetores').onclick = () => abrirTela('setores');
  $('mEmpresas').onclick = () => abrirTela('empresas');
  $('mNova').onclick = () => abrirTela('nova');
  $('mZerar').onclick = () => abrirTela('zerar');
  $('lNovo').onclick = () => { if (TELAS[tela].criar()) { gravar(); mostrarLista(); } };
  $('lVoltar').onclick = () => { $('dLista').close(); $('bMenu').onclick(); };
  $('mBk').onclick = () => baixar('backup_conferencia_' + hoje() + '.json', C.backup(estado), 'application/json');
  $('mRs').onclick = () => { $('mFile').value = ''; $('mFile').click(); };
  $('mFile').onchange = async () => {
    const f = $('mFile').files[0];
    if (!f) return;
    let novo;
    try { novo = C.lerBackup(await f.text()); } catch (e) { return alert('Arquivo de backup inválido.'); }
    if (!confirm('Substituir TODOS os dados deste tablet pelo backup?')) return;
    if (estado.admin || !novo.usuarios) for (const k of ['usuarios', 'pins', 'sais', 'admin', 'recuperacao', 'usuario']) novo[k] = estado[k];
    estado = novo; bloqueado = false; aviso(''); converter(); mudou();
  };

  tudo(); salvar();
  if (!identificado()) pedirUsuario();
  mostrarPendentes(); enviarFila(); sincronizar().then(sincronizarLista); abrirLink();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => aviso('O modo sem internet não foi ativado. Abra de novo com internet.'));
  }
})();
