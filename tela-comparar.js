/* Tela do administrador: junta as contagens, compara, pede recontagem, gera Excel e histórico. */
(function () {
  'use strict';
  const A = window.App, K = window.Comparar, C = window.Core;
  const $ = id => document.getElementById(id);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; };
  const reais = n => n === null ? '' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num = n => n === null ? '' : C.fmt(n);
  let atual = null, empresaNome = '';
  const msg = t => { $('cMsg').textContent = t; };
  const pasta = () => C.nomeArq(empresaNome);
  const pedir = (acao, dados) => A.chamar(acao, Object.assign({ auth: A.auth(), empresa: pasta() }, dados));
  const falhou = e => msg(e.semRede ? 'Sem internet. Tente de novo com conexão.' : e.message);

  function tabela(cabecalho, linhas) {
    const t = el('table'), h = el('tr');
    cabecalho.forEach(c => h.append(el('th', '', c)));
    t.append(h);
    for (const l of linhas) {
      const tr = el('tr', l.classe || '');
      l.celulas.forEach(c => tr.append(el('td', typeof c === 'object' ? 'n' : '', typeof c === 'object' ? c.n : c)));
      t.append(tr);
    }
    $('cTabela').replaceChildren(t);
  }
  const n = x => ({ n: x });

  function mostrar() {
    if (!atual) return;
    const ls = atual.linhas.filter(l => $('cTodos').checked || ['falta', 'sobra', 'conflito'].includes(l.tipo));
    if (!ls.length) return $('cTabela').replaceChildren(el('p', '', 'Nenhuma divergência nos itens contados.'));
    tabela(['Item', 'Família / local', 'Sistema', 'Físico', 'Diferença', 'Valor', 'Situação', 'Contado por'], ls.map(l => ({ classe: l.tipo,
      celulas: [l.nome + (l.obs ? ' — ' + l.obs : ''), l.familia + ' / ' + l.local, n(num(l.saldo)), n(num(l.fisico)), n(l.dif === null ? '' : C.sinal(l.dif)), n(reais(l.valor)), K.ROTULO[l.tipo], l.quem] })));
  }

  async function buscar() {
    const data = $('cData').value;
    if (!data) return msg('Escolha a data.');
    msg('Buscando…'); atual = null; $('cAcoes').hidden = true; $('cResumo').textContent = ''; $('cTabela').replaceChildren();
    try {
      const resposta = await pedir('contagens', { data });
      const contagens = resposta.arquivos.map(t => { try { return JSON.parse(t); } catch (e) { return null; } }).filter(Boolean);
      const lista = await A.chamar('lista', { versao: A.infoLista().versao || '' });
      const r = K.comparar(A.emp(), contagens, { data, pedido: (lista.recontagens || {})[pasta()] });
      if (!r.enviadas) return msg('Nenhuma contagem enviada nesta data para ' + empresaNome + '. Confira se o aparelho usou “Finalizar contagem” e não ficou pendente.');
      atual = r; msg('');
      const s = r.resumo;
      $('cResumo').textContent = 'Contado por ' + r.responsaveis.join(', ') + ' · ' + s.total + ' itens · OK ' + s.ok + ' · faltas ' + s.falta + ' (' + reais(s.valorFalta) + ') · sobras ' + s.sobra + ' (' + reais(s.valorSobra) + ')'
        + ' · conflitos ' + s.conflito + ' · não contados ' + s.nao_contado + (s.sem_saldo ? ' · sem saldo ' + s.sem_saldo : '') + (r.fora.length ? ' · fora do cadastro ' + r.fora.length : '');
      $('cAcoes').hidden = false;
      mostrar();
    } catch (e) { falhou(e); }
  }

  $('mComp').onclick = () => {
    if (!A.souAdmin()) return;
    $('dMenu').close();
    empresaNome = A.emp().nome; atual = null;
    $('cTitulo').textContent = 'Conferir contagens — ' + empresaNome;
    $('cData').value = A.hoje(); $('cMes').value = A.hoje().slice(0, 7);
    msg(''); $('cResumo').textContent = ''; $('cAcoes').hidden = true; $('cTabela').replaceChildren();
    $('dComp').showModal();
  };
  $('cBuscar').onclick = buscar;
  $('cData').onchange = () => { atual = null; $('cAcoes').hidden = true; $('cResumo').textContent = ''; $('cTabela').replaceChildren(); msg(''); };
  $('cTodos').onchange = mostrar;

  $('cExcel').onclick = () => atual && A.baixar('conferencia_' + pasta() + '_' + atual.data + '.xlsx', window.gerarXlsx(K.planilha(empresaNome, atual)),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  async function recontagem(itens) {
    try {
      const r = await pedir('recontagem', { data: atual.data, quando: A.hoje() + ' ' + A.agora(), itens });
      const todas = Object.assign({}, A.infoLista().recontagens);
      if (r.pedido) todas[pasta()] = r.pedido; else delete todas[pasta()];
      A.gravarInfo({ recontagens: todas }); A.avisos();
      return true;
    } catch (e) { falhou(e); return false; }
  }
  $('cRecontar').onclick = async () => {
    const itens = atual ? K.paraRecontar(atual) : [];
    if (!itens.length) return msg('Não há divergências para recontar.');
    if (!A.infoLista().origem) return msg('Antes, envie a lista de itens deste computador (Opções → Enviar lista de itens).');
    if (!confirm('Pedir recontagem de ' + itens.length + ' itens? Nos outros aparelhos, a contagem anterior desses itens é apagada.')) return;
    if (await recontagem(itens)) msg('Recontagem pedida. Os aparelhos recebem ao abrir o app com internet. Depois, busque as contagens de novo.');
  };
  $('cEncerrar').onclick = async () => { if (atual && await recontagem([])) msg('Recontagem encerrada.'); };

  $('cGuardar').onclick = async () => {
    if (!atual) return;
    if (atual.data !== A.hoje() && !confirm('A comparação usa o saldo que está no computador agora. Ele é o saldo de ' + atual.data.split('-').reverse().join('/') + '?')) return;
    try { await pedir('salvarComparacao', { resultado: K.historico(atual) }); msg('Guardado no histórico. Guardar de novo a mesma data substitui.'); }
    catch (e) { falhou(e); }
  };

  $('cRanking').onclick = async () => {
    const mes = $('cMes').value;
    if (!mes) return msg('Escolha o mês.');
    msg('Buscando…');
    try {
      const r = await pedir('comparacoes', { ano: mes.slice(0, 4) });
      const itens = K.ranking(r.resultados, mes);
      atual = null; $('cAcoes').hidden = true;
      const total = itens.reduce((a, i) => a + i.valor, 0);
      $('cResumo').textContent = 'Faltas guardadas em ' + mes.split('-').reverse().join('/') + ' · ' + itens.length + ' itens · ' + reais(total);
      msg('');
      if (!itens.length) return $('cTabela').replaceChildren(el('p', '', 'Nada guardado neste mês. Use “Guardar no histórico” depois de conferir.'));
      tabela(['Item', 'Família / local', 'Vezes que faltou', 'Quantidade', 'Valor'], itens.map(i => ({ celulas: [i.nome, i.familia + ' / ' + i.local, n(String(i.vezes)), n(C.fmt(i.quantidade)), n(reais(i.valor))] })));
    } catch (e) { falhou(e); }
  };
})();
