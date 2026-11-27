(function () {
  'use strict';
  const C = window.Core, KEY = 'conferencia-estoque-v1';
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const aviso = t => { $('aviso').textContent = t; $('aviso').style.display = t ? 'block' : 'none'; };

  let estado, bloqueado = false;
  try {
    const bruto = localStorage.getItem(KEY);
    estado = bruto ? C.lerBackup(bruto) : C.estadoInicial();
  } catch (e) {
    /* Não sobrescreve dados que não conseguimos ler. */
    bloqueado = true; estado = C.estadoInicial();
    aviso('Não consegui ler os dados salvos. Nada será gravado. Restaure um backup em Opções.');
  }
  function salvar() {
    if (bloqueado) return;
    try { localStorage.setItem(KEY, JSON.stringify(estado)); }
    catch (e) { aviso('ATENÇÃO: o tablet não conseguiu salvar. Baixe um backup agora (Opções).'); }
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

  const emp = () => estado.empresas.find(e => e.id === estado.sel.emp) || estado.empresas[0];
  const setor = () => emp().setores.find(s => s.id === estado.sel.set) || emp().setores[0];
  const hoje = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  function opcoes(sel, lista, valor) {
    sel.replaceChildren(...lista.map(([v, t]) => { const o = el('option', '', t); o.value = v; return o; }));
    sel.value = valor;
  }
  function tudo() {
    const e = emp(), s = setor();
    estado.sel = { emp: e.id, set: s.id };
    if (!s.data) s.data = hoje();
    opcoes($('emp'), estado.empresas.map(x => [x.id, x.nome]), e.id);
    opcoes($('set'), e.setores.map(x => [x.id, x.nome]), s.id);
    const cats = [...new Set(s.itens.map(i => i.cat).filter(Boolean))].sort();
    opcoes($('cat'), [['', 'Todas as categorias'], ...cats.map(c => [c, c])], cats.includes($('cat').value) ? $('cat').value : '');
    $('data').value = s.data; $('resp').value = s.resp; $('cego').checked = s.cego;
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
      s.cont[it.id] = (s.cont[it.id] || []).concat(v); inp.value = ''; salvar(); pintar(); status(); return true;
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
      if (cat && it.cat !== cat) return false;
      const t = C.situacao(s, it).tipo;
      return !f || (f === 'div' ? t === 'falta' || t === 'sobra' : t === f);
    });
    const grupos = new Map();
    itens.forEach(it => { const g = it.cat || 'Sem categoria'; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(it); });
    const nos = [];
    grupos.forEach((g, nome) => { nos.push(el('h2', '', nome)); g.forEach(it => nos.push(linha(it))); });
    if (!nos.length) nos.push(el('div', 'vazio', s.itens.length ? 'Nenhum item com esses filtros.' : 'Este setor ainda não tem itens. Toque em “Cadastrar itens” e cole a sua lista.'));
    $('lista').replaceChildren(...nos);
    status();
  }

  document.querySelectorAll('[data-fechar]').forEach(b => b.onclick = () => b.closest('dialog').close());
  $('emp').onchange = () => { estado.sel = { emp: $('emp').value, set: '' }; salvar(); tudo(); salvar(); };
  $('set').onchange = () => { estado.sel.set = $('set').value; tudo(); salvar(); };
  $('data').onchange = () => { setor().data = $('data').value; salvar(); };
  $('resp').oninput = () => { setor().resp = $('resp').value; salvar(); };
  $('cego').onchange = () => { setor().cego = $('cego').checked; salvar(); tudo(); };
  $('q').oninput = $('cat').onchange = $('filtro').onchange = lista;

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
  $('bItens').onclick = () => abrirImp('itens');
  $('bSaldo').onclick = () => abrirImp('saldo');
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

  /* Relatório */
  const textoRel = () => { $('relX').value = C.relatorio(emp().nome, setor(), $('relD').checked); };
  $('bRel').onclick = () => { textoRel(); $('dRel').showModal(); };
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
  $('relV').onclick = () => baixar('conferencia_' + arquivo(emp().nome) + '_' + arquivo(setor().nome) + '_' + setor().data + '.csv', '﻿' + C.csv(emp().nome, setor()), 'text/csv');

  /* Opções */
  const fechar = () => $('dMenu').close();
  const pedir = (msg, atual) => (prompt(msg, atual || '') || '').trim();
  const mudou = () => { salvar(); tudo(); salvar(); fechar(); };
  $('bMenu').onclick = () => $('dMenu').showModal();
  $('mNovoSetor').onclick = () => { const n = pedir('Nome do novo setor'); if (!n) return; const s = C.novoSetor(n); emp().setores.push(s); estado.sel.set = s.id; mudou(); };
  $('mRenSetor').onclick = () => { const n = pedir('Novo nome do setor', setor().nome); if (n) { setor().nome = n; mudou(); } };
  $('mDelSetor').onclick = () => {
    if (emp().setores.length < 2) return alert('A empresa precisa de pelo menos um setor.');
    if (confirm('Excluir o setor “' + setor().nome + '” com itens e contagens?')) { const id = setor().id; emp().setores = emp().setores.filter(s => s.id !== id); mudou(); }
  };
  $('mNovaEmp').onclick = () => { const n = pedir('Nome da nova empresa'); if (!n) return; const e = C.novaEmpresa(n, ['Geral']); estado.empresas.push(e); estado.sel = { emp: e.id, set: e.setores[0].id }; mudou(); };
  $('mRenEmp').onclick = () => { const n = pedir('Novo nome da empresa', emp().nome); if (n) { emp().nome = n; mudou(); } };
  $('mDelEmp').onclick = () => {
    if (estado.empresas.length < 2) return alert('É preciso manter pelo menos uma empresa.');
    if (confirm('Excluir a empresa “' + emp().nome + '” com todos os setores?')) { const id = emp().id; estado.empresas = estado.empresas.filter(e => e.id !== id); mudou(); }
  };
  $('mNova').onclick = () => {
    if (!confirm('Zerar contagens, saldo e observações de “' + setor().nome + '”?')) return;
    const s = setor(); s.cont = {}; s.sys = {}; s.obs = {}; s.data = hoje(); mudou();
  };
  $('mLimpar').onclick = () => {
    const s = setor();
    if (!confirm('Excluir TODOS os ' + s.itens.length + ' itens de “' + emp().nome + ' / ' + s.nome + '”, com contagens e saldos?')) return;
    s.itens = []; s.cont = {}; s.sys = {}; s.obs = {}; mudou();
  };
  $('mBk').onclick = () => baixar('backup_conferencia_' + hoje() + '.json', C.backup(estado), 'application/json');
  $('mRs').onclick = () => { $('mFile').value = ''; $('mFile').click(); };
  $('mFile').onchange = async () => {
    const f = $('mFile').files[0];
    if (!f) return;
    let novo;
    try { novo = C.lerBackup(await f.text()); } catch (e) { return alert('Arquivo de backup inválido.'); }
    if (!confirm('Substituir TODOS os dados deste tablet pelo backup?')) return;
    estado = novo; bloqueado = false; aviso(''); mudou();
  };

  tudo(); salvar();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => aviso('O modo sem internet não foi ativado. Abra de novo com internet.'));
  }
})();
