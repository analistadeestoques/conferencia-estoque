/* Conferência por apartamento dos motéis: regras, sem tela. */
(function (root) {
  'use strict';
  const C = typeof module !== 'undefined' ? require('./core.js') : root.Core;
  const dinheiro = n => Math.round(n * 100) / 100;
  const chave = empresa => C.nomeArq(empresa.nome);
  const num = v => typeof v === 'number' ? v : C.numSistema(String(v === undefined ? '' : v).replace(/R\$/, '').trim());

  /* Planilha de faltas do motel. A fórmula do PDV, "(22*4)+Cozinha", dá os apartamentos e o kit. */
  function lerPlanilha(linhas) {
    const h = linhas.findIndex(l => l.some(c => C.norm(c) === 'cod') && l.some(c => C.norm(c) === 'descricao'));
    if (h < 0) throw new Error('Não achei as colunas “Cod” e “Descrição”.');
    const cab = linhas[h].map(C.norm), col = nome => cab.findIndex(c => c.startsWith(nome));
    const c = { cod: col('cod'), nome: col('descricao'), grupo: col('grupo'), valor: col('vlr unit'), coz: col('cozinha'), pdv: col('pdv') };
    if (c.pdv < 0) throw new Error('Falta a coluna “PDV”.');
    const regra = l => /\(\s*(\d+)\s*\*\s*(\d+)\s*\)/.exec((l.f && l.f[c.pdv]) || '');
    const corpo = linhas.slice(h + 1).filter(l => String(l[c.cod] === undefined ? '' : l[c.cod]).trim() && String(l[c.nome] || '').trim());
    const primeira = corpo.map(regra).find(Boolean);
    if (!primeira) throw new Error('Não achei a fórmula do kit na coluna PDV, como (22*4).');
    const aptos = +primeira[1];
    const itens = corpo.map(l => {
      const m = regra(l);
      let kit = m ? +m[2] : 0;
      /* Fórmula repetida sem texto: o kit sai do próprio valor. */
      if (!m && l.f && l.f[c.pdv] !== undefined) {
        const k = ((num(l[c.pdv]) || 0) - (num(l[c.coz]) || 0)) / aptos;
        if (Number.isInteger(k) && k > 0) kit = k;
      }
      return { cod: String(l[c.cod]).trim(), nome: String(l[c.nome]).trim(), grupo: String(l[c.grupo] || '').trim(), valor: num(l[c.valor]) || 0, kit };
    });
    return { titulo: String((linhas[0] || [])[0] || '').trim(), aptos, itens };
  }

  const novaConf = data => ({ data, apt: {}, coz: {}, cozQuando: '' });

  /* Grava o cadastro do motel na empresa e põe os produtos que faltam no Almoxarifado. */
  function aplicarPlanilha(estado, empresaId, p) {
    const empresa = estado.empresas.find(e => e.id === empresaId);
    estado.motel = estado.motel || {};
    const velho = estado.motel[chave(empresa)] || {};
    estado.motel[chave(empresa)] = { aptos: p.aptos, itens: p.itens, conf: velho.conf || novaConf(''), sismotel: velho.sismotel || {} };
    let s = empresa.setores.find(x => C.norm(x.nome) === 'almoxarifado');
    if (!s) { s = C.novoSetor('Almoxarifado'); empresa.setores.push(s); }
    const tem = new Set(s.itens.map(i => C.chaveCod(i.cod)));
    const novos = p.itens.filter(i => !tem.has(C.chaveCod(i.cod)));
    C.importarCadastro(s, novos.map(i => i.cod + '\t' + i.nome + '\tun').join('\n'), false);
    return { empresa: empresa.nome, aptos: p.aptos, produtos: p.itens.length, noKit: p.itens.filter(i => i.kit).length, novos: novos.length };
  }

  /* dif: { código: quantidade a mais (+) ou a menos (-) }. Vazio = completo. */
  function marcar(motel, conf, apto, dif, quem, quando) {
    const limpo = {};
    for (const it of motel.itens) {
      const d = Math.max(-it.kit, Math.round(dif[it.cod] || 0));
      if (it.kit && d) limpo[it.cod] = d;
    }
    conf.apt[apto] = { dif: limpo, quem, quando };
  }
  const marcados = (motel, conf) => Object.keys(conf.apt).filter(n => +n >= 1 && +n <= motel.aptos).length;

  function totais(motel, conf, sismotel) {
    const aptos = Object.keys(conf.apt).map(Number).filter(n => n >= 1 && n <= motel.aptos).sort((a, b) => a - b);
    const porApto = [];
    for (const n of aptos) for (const it of motel.itens) {
      const d = conf.apt[n].dif[it.cod];
      if (d) porApto.push({ apto: n, cod: it.cod, nome: it.nome, dif: d, valor: dinheiro(d * (it.valor || 0)), quem: conf.apt[n].quem });
    }
    const linhas = motel.itens.map(it => {
      const nos = aptos.reduce((a, n) => a + (it.kit ? it.kit + (conf.apt[n].dif[it.cod] || 0) : 0), 0);
      const coz = conf.coz[it.cod] === undefined ? 0 : conf.coz[it.cod];
      const pdv = C.arred(nos + coz);
      const sis = sismotel && sismotel[it.cod] !== undefined ? sismotel[it.cod] : null;
      const dif = sis === null ? null : C.arred(pdv - sis);
      return { cod: it.cod, nome: it.nome, grupo: it.grupo, aptos: nos, coz, pdv, sismotel: sis, dif, valor: dif === null ? null : dinheiro(dif * (it.valor || 0)) };
    });
    const soma = (l, sinal) => dinheiro(l.reduce((a, x) => a + (x.valor * sinal > 0 ? x.valor : 0), 0));
    return { marcados: aptos.length, pendentes: motel.aptos - aptos.length, incompletos: aptos.filter(n => Object.keys(conf.apt[n].dif).length).length,
      linhas, porApto, faltaAptos: soma(porApto, -1), faltas: soma(linhas, -1), sobras: soma(linhas, 1) };
  }

  /* Envios de um ou mais aparelhos na mesma data: vale o mais recente de cada apartamento. */
  function juntar(envios, data) {
    const r = novaConf(data);
    for (const e of envios) {
      if (!e || e.tipo !== 'motel' || e.data !== data || !e.apt) continue;
      for (const n in e.apt) if (!r.apt[n] || String(e.apt[n].quando) >= String(r.apt[n].quando)) r.apt[n] = e.apt[n];
      if (e.cozQuando && e.cozQuando >= r.cozQuando) { r.coz = e.coz || {}; r.cozQuando = e.cozQuando; }
    }
    return r;
  }

  function lerSismotel(texto) {
    const r = {}, ruins = [];
    for (const linha of String(texto).split(/\r?\n/)) {
      if (!linha.trim()) continue;
      const m = /^\s*(\S+?)[\t; ]+(-?[\d.,]+)\s*$/.exec(linha), q = m && C.numSistema(m[2]);
      if (!m || q === null) ruins.push(linha.trim()); else r[m[1]] = q;
    }
    return { saldos: r, ruins };
  }

  function planilha(empresaNome, motel, r, data) {
    const dia = data.split('-').reverse().join('/');
    return [
      { nome: 'Resumo', larguras: [10, 28, 16, 13, 10, 10, 10, 10, 12], titulos: [0, 2], linhas: [
        [empresaNome + ' · ' + dia + ' · ' + r.marcados + ' de ' + motel.aptos + ' apartamentos'], [],
        ['Cod', 'Descrição', 'Grupo', 'Apartamentos', 'Cozinha', 'PDV', 'Sismotel', 'Diferença', 'Valor'],
        ...r.linhas.map(l => [l.cod, l.nome, l.grupo, l.aptos, l.coz, l.pdv, l.sismotel === null ? '' : l.sismotel, l.dif === null ? '' : l.dif, l.valor === null ? '' : l.valor])] },
      { nome: 'Por apartamento', larguras: [14, 10, 28, 12, 12, 20], titulos: [0], linhas: [
        ['Apartamento', 'Cod', 'Descrição', 'Diferença', 'Valor', 'Conferido por'],
        ...r.porApto.map(p => [p.apto, p.cod, p.nome, p.dif, p.valor, p.quem])] }
    ];
  }

  /* O que vai para o Drive: sem valores nem Sismotel. */
  function pacote(empresa, motel, conf, meta) {
    const emp = chave(empresa);
    const nome = [meta.data, meta.hora, 'APARTAMENTOS', emp, C.nomeArq(meta.usuario)].join('_');
    const linhas = [['apartamento', 'situacao', 'codigo', 'produto', 'diferenca', 'conferido por']];
    for (let n = 1; n <= motel.aptos; n++) {
      const a = conf.apt[n];
      if (!a) continue;
      const cods = Object.keys(a.dif);
      if (!cods.length) linhas.push([n, 'Completo', '', '', '', a.quem]);
      for (const c of cods) linhas.push([n, 'Incompleto', c, (motel.itens.find(i => i.cod === c) || {}).nome || '', a.dif[c], a.quem]);
    }
    for (const it of motel.itens) if (conf.coz[it.cod]) linhas.push(['Cozinha', '', it.cod, it.nome, conf.coz[it.cod], meta.usuario]);
    const celula = v => '"' + String(v).replace(/^([=+\-@])(?=\D)/, "'$1").replace(/"/g, '""') + '"';
    return { id: nome, empresa: emp, grupo: 'APARTAMENTOS', ano: meta.data.slice(0, 4), arquivos: [
      { nome: nome + '.csv', conteudo: '﻿' + linhas.map(l => l.map(celula).join(';')).join('\r\n') },
      { nome: nome + '_contagem.json', conteudo: JSON.stringify(Object.assign({ tipo: 'motel', empresa: emp, apt: conf.apt, coz: conf.coz, cozQuando: conf.cozQuando }, meta)) }
    ] };
  }

  const api = { chave, lerPlanilha, aplicarPlanilha, novaConf, marcar, marcados, totais, juntar, lerSismotel, planilha, pacote };
  if (typeof module !== 'undefined') module.exports = api; else root.Motel = api;
})(this);
