/* Junta as contagens dos aparelhos e compara com o saldo do sistema (sem tela). */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.Core;

  const chave = it => [C.norm(it.cat), C.chaveCod(it.cod), C.norm(it.nome)].join('|');
  const soma = q => C.arred(q.reduce((a, b) => a + b, 0));
  const dinheiro = n => Math.round(n * 100) / 100;
  const momento = c => c.data + ' ' + c.hora;

  /* O que um aparelho contou em um grupo: sem saldo e sem custo. */
  function contagemDe(estado, empresaId, grupo, local, meta) {
    const empresa = estado.empresas.find(e => e.id === empresaId);
    const itens = [];
    for (const s of empresa.setores) {
      if (C.grupoDe(s.nome) !== grupo) continue;
      for (const it of s.itens) {
        const q = s.cont[it.id];
        if ((local && C.localItem(it) !== local) || !q || !q.length) continue;
        itens.push({ familia: s.nome, cod: it.cod || '', nome: it.nome, un: it.un || '', cat: it.cat || '', q, obs: s.obs[it.id] || '' });
      }
    }
    return Object.assign({ empresa: C.nomeArq(empresa.nome), grupo, local: local || '', itens }, meta);
  }

  const valida = c => c && typeof c.data === 'string' && typeof c.hora === 'string' && Array.isArray(c.itens) &&
    c.itens.every(i => typeof i.nome === 'string' && Array.isArray(i.q) && i.q.every(Number.isFinite));

  /* opc: { data, pedido }. Vale a última contagem de cada aparelho; a recontagem substitui o que veio antes. */
  function comparar(empresa, contagens, opc) {
    const pedido = opc.pedido && opc.pedido.data === opc.data ? opc.pedido : null;
    const usadas = contagens.filter(c => valida(c) && (c.data === opc.data || (pedido && c.recontagem === pedido.id)))
      .sort((a, b) => momento(a).localeCompare(momento(b)));
    const todos = empresa.setores.flatMap(s => s.itens.map(it => ({ s, it })));
    const porChave = new Map(todos.map(x => [chave(x.it), x]));
    const achar = i => porChave.get(chave(i)) ||
      todos.find(x => i.cod && C.chaveCod(x.it.cod) === C.chaveCod(i.cod) && C.norm(x.it.cat) === C.norm(i.cat));
    const lidas = new Map(), fora = new Map();
    for (const c of usadas) for (const i of c.itens) {
      const x = achar(i);
      if (!x) { fora.set(chave(i), { cod: i.cod, nome: i.nome, local: C.localItem(i), quantidade: soma(i.q), quem: c.usuario }); continue; }
      if (!lidas.has(x.it.id)) lidas.set(x.it.id, []);
      const l = lidas.get(x.it.id).filter(o => o.aparelho !== c.aparelho);
      l.push({ aparelho: c.aparelho, usuario: c.usuario, quando: momento(c), total: soma(i.q), obs: i.obs || '' });
      lidas.set(x.it.id, l);
    }
    /* "Não contado" só vale dentro dos grupos e locais que alguém enviou. */
    const noEscopo = (s, it) => usadas.some(c => c.grupo === C.grupoDe(s.nome) && (!c.local || c.local === C.localItem(it)));
    const resumo = { total: 0, ok: 0, falta: 0, sobra: 0, conflito: 0, nao_contado: 0, sem_saldo: 0, valorFalta: 0, valorSobra: 0 };
    const linhas = [];
    for (const { s, it } of todos) {
      let l = lidas.get(it.id) || [];
      if (!l.length && !noEscopo(s, it)) continue;
      if (pedido && pedido.itens.includes(chave(it))) {
        const depois = l.filter(o => o.quando > pedido.quando);
        if (depois.length) l = depois;
      }
      const saldo = s.sys[it.id] === undefined ? null : s.sys[it.id];
      const r = { chave: chave(it), familia: s.nome, cod: it.cod || '', nome: it.nome, un: it.un || '', local: C.localItem(it),
        custo: it.custo || null, saldo, fisico: null, dif: null, valor: null, tipo: 'nao_contado',
        quem: l.map(o => o.usuario + ': ' + C.fmt(o.total)).join(' | '), obs: [...new Set(l.map(o => o.obs).filter(Boolean))].join(' | ') };
      if (l.length && new Set(l.map(o => o.total)).size > 1) r.tipo = 'conflito';
      else if (l.length) {
        r.fisico = l[0].total;
        if (saldo === null) r.tipo = 'sem_saldo';
        else {
          r.dif = C.arred(r.fisico - saldo);
          r.tipo = r.dif === 0 ? 'ok' : r.dif > 0 ? 'sobra' : 'falta';
          if (r.custo) r.valor = dinheiro(r.dif * r.custo);
        }
      }
      resumo.total++; resumo[r.tipo]++;
      if (r.valor < 0) resumo.valorFalta = dinheiro(resumo.valorFalta + r.valor);
      if (r.valor > 0) resumo.valorSobra = dinheiro(resumo.valorSobra + r.valor);
      linhas.push(r);
    }
    linhas.sort((a, b) => (a.familia + '|' + a.local + '|' + a.nome).localeCompare(b.familia + '|' + b.local + '|' + b.nome, 'pt-BR'));
    return { data: opc.data, linhas, resumo, fora: [...fora.values()], enviadas: usadas.length,
      responsaveis: [...new Set(usadas.map(c => c.usuario))] };
  }

  const paraRecontar = r => r.linhas.filter(l => ['falta', 'sobra', 'conflito'].includes(l.tipo)).map(l => l.chave);

  /* No aparelho que vai recontar: apaga só a contagem anterior dos itens pedidos. */
  function limparParaRecontar(estado, nomeEmpresa, chaves) {
    const pedidas = new Set(chaves);
    let n = 0;
    for (const e of estado.empresas) {
      if (C.nomeArq(e.nome) !== C.nomeArq(nomeEmpresa)) continue;
      for (const s of e.setores) for (const it of s.itens) if (pedidas.has(chave(it)) && s.cont[it.id]) { delete s.cont[it.id]; delete s.obs[it.id]; n++; }
    }
    return n;
  }

  /* O que vai para o histórico: só faltas e sobras. */
  const historico = r => ({ data: r.data, itens: r.linhas.filter(l => l.tipo === 'falta' || l.tipo === 'sobra')
    .map(l => ({ cod: l.cod, nome: l.nome, local: l.local, familia: l.familia, dif: l.dif, valor: l.valor })) });

  /* Faltas do mês ('AAAA-MM'), das que mais se repetem para as que menos. */
  function ranking(resultados, mes) {
    const mapa = new Map();
    for (const r of resultados) {
      if (!String(r.data).startsWith(mes)) continue;
      for (const i of r.itens) {
        if (!(i.dif < 0)) continue;
        const k = [i.local, i.cod, C.norm(i.nome)].join('|');
        const x = mapa.get(k) || { cod: i.cod, nome: i.nome, local: i.local, familia: i.familia, vezes: 0, quantidade: 0, valor: 0 };
        x.vezes++; x.quantidade = C.arred(x.quantidade + i.dif); x.valor = dinheiro(x.valor + (i.valor || 0));
        mapa.set(k, x);
      }
    }
    return [...mapa.values()].sort((a, b) => b.vezes - a.vezes || a.valor - b.valor);
  }

  const ROTULO = { ok: 'OK', falta: 'Falta', sobra: 'Sobra', conflito: 'Conflito', nao_contado: 'Não contado', sem_saldo: 'Sem saldo' };

  /* Abas do Excel para a Controladoria. */
  function planilha(nomeEmpresa, r) {
    const dataBR = r.data.split('-').reverse().join('/');
    const v = x => x === null ? '' : x;
    const cab = ['Família', 'Local', 'Código', 'Item', 'Unidade', 'Sistema', 'Físico', 'Diferença', 'Custo médio', 'Valor da diferença', 'Situação', 'Contado por', 'Observação'];
    const lin = l => [l.familia, l.local, l.cod, l.nome, l.un, v(l.saldo), v(l.fisico), v(l.dif), v(l.custo), v(l.valor), ROTULO[l.tipo], l.quem, l.obs];
    const familias = [...new Set(r.linhas.map(l => l.familia))].map(f => {
      const ls = r.linhas.filter(l => l.familia === f), n = t => ls.filter(l => l.tipo === t).length;
      const total = sinal => dinheiro(ls.reduce((a, l) => a + (l.valor * sinal > 0 ? l.valor : 0), 0));
      return [f, ls.length, n('ok'), n('falta'), n('sobra'), n('conflito'), n('nao_contado'), total(-1), total(1)];
    });
    const s = r.resumo;
    const resumo = [['Conferência de estoque'], ['Empresa', nomeEmpresa], ['Data', dataBR], ['Responsáveis', r.responsaveis.join(', ')], [],
      ['Família', 'Itens', 'OK', 'Faltas', 'Sobras', 'Conflitos', 'Não contados', 'Valor das faltas', 'Valor das sobras'], ...familias,
      ['TOTAL', s.total, s.ok, s.falta, s.sobra, s.conflito, s.nao_contado, s.valorFalta, s.valorSobra], [],
      ['Diferença = físico − sistema. Valor pelo custo médio (CMC) da última importação.']];
    const abas = [
      { nome: 'Resumo', linhas: resumo, titulos: [0, 5], larguras: [28, 22, 8, 8, 8, 10, 13, 16, 16] },
      { nome: 'Divergências', linhas: [cab, ...r.linhas.filter(l => ['falta', 'sobra', 'conflito'].includes(l.tipo)).map(lin)], titulos: [0] },
      { nome: 'Todos os itens', linhas: [cab, ...r.linhas.map(lin)], titulos: [0] }
    ];
    abas[1].larguras = abas[2].larguras = [20, 18, 10, 36, 8, 10, 10, 11, 12, 16, 12, 28, 28];
    if (r.fora.length) abas.push({ nome: 'Fora do cadastro', titulos: [0], larguras: [10, 36, 18, 12, 20],
      linhas: [['Código', 'Item', 'Local', 'Quantidade', 'Contado por'], ...r.fora.map(f => [f.cod, f.nome, f.local, f.quantidade, f.quem])] });
    return abas;
  }

  const api = { chave, contagemDe, comparar, paraRecontar, limparParaRecontar, historico, ranking, planilha, ROTULO };
  if (typeof module !== 'undefined') module.exports = api; else root.Comparar = api;
})(this);
