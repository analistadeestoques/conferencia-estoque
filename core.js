/* Regras da Conferência de Estoque (sem tela). */
(function (root) {
  'use strict';
  let seq = 0;
  const novoId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
  const arred = n => Math.round(n * 1000) / 1000;
  const fmt = n => String(arred(n)).replace('.', ',');
  const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const chaveCod = c => String(c || '').trim().toLowerCase().replace(/^0+(?=.)/, '');

  const novoSetor = nome => ({ id: novoId(), nome, itens: [], cont: {}, sys: {}, obs: {}, resp: '', data: '', cego: false });
  const novaEmpresa = (nome, setores) => ({ id: novoId(), nome, setores: setores.map(novoSetor) });
  function estadoInicial() {
    const cozinha = ['Cereais diversos', 'Frios e embutidos', 'Proteínas', 'Uso e consumo', 'Limpeza'];
    const empresas = [novaEmpresa('Portal Beach', cozinha), novaEmpresa('Shangrila', cozinha), novaEmpresa('Motéis', ['Almoxarifado', 'PDV'])];
    return { app: 'conferencia-estoque', v: 1, empresas, sel: { emp: empresas[0].id, set: empresas[0].setores[0].id } };
  }

  /* Saldo vindo do sistema/planilha: "1.500" é mil e quinhentos. */
  function numSistema(s) {
    s = String(s == null ? '' : s).replace(/\s/g, '');
    if (!s) return null;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    return /^-?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
  }
  /* Digitação no tablet: ponto ou vírgula são decimais; vários valores separados por espaço, + ou ; */
  function numsContagem(s) {
    const p = String(s).trim().split(/[\s+;]+/).filter(Boolean).map(x => x.replace(',', '.'));
    if (!p.length || !p.every(x => /^(\d+(\.\d*)?|\.\d+)$/.test(x))) return null;
    return p.map(Number);
  }

  /* Colagem do Excel (tab) ou CSV com ponto e vírgula, com aspas. */
  function linhas(texto) {
    texto = String(texto || '').replace(/^\ufeff/, '');
    const sep = texto.includes('\t') ? '\t' : ';';
    const out = [];
    let lin = [], cel = '', aspas = false;
    for (let i = 0; i < texto.length; i++) {
      const c = texto[i];
      if (aspas) {
        if (c === '"' && texto[i + 1] === '"') { cel += '"'; i++; }
        else if (c === '"') aspas = false;
        else cel += c;
      } else if (c === '"' && cel === '') aspas = true;
      else if (c === sep) { lin.push(cel.trim()); cel = ''; }
      else if (c === '\n') { lin.push(cel.trim()); out.push(lin); lin = []; cel = ''; }
      else if (c !== '\r') cel += c;
    }
    lin.push(cel.trim()); out.push(lin);
    return out.filter(l => l.some(x => x !== ''));
  }
  const TITULO = /^(cod(igo)?\.?( interno| produto| do produto)?|item|produto|descricao|nome|saldo( sistema| atual)?|quantidade|qtde?\.?|unidade|un\.?|und\.?|categoria|grupo)$/;
  const ehCabecalho = l => l.filter(c => TITULO.test(norm(c))).length >= Math.min(2, l.length) && !l.some(c => numSistema(c) !== null);

  function achar(setor, cod, nome) {
    if (cod) { const k = chaveCod(cod); const i = setor.itens.find(x => x.cod && chaveCod(x.cod) === k); if (i) return i; }
    if (nome) { const n = norm(nome); return setor.itens.find(x => norm(x.nome) === n && (!cod || !x.cod)); }
  }
  const apagarDados = (setor, id) => { delete setor.cont[id]; delete setor.sys[id]; delete setor.obs[id]; };

  /* Colunas: Código | Item | Unidade | Categoria. Uma coluna só = nome do item. */
  function importarCadastro(setor, texto, opc = {}) {
    let ls = linhas(texto);
    if (ls.length && ehCabecalho(ls[0])) ls = ls.slice(1);
    const vistos = new Set();
    let novos = 0, atualizados = 0;
    const ignorados = [];
    for (const l of ls) {
      const [cod, nome, un, cat] = l.length === 1 ? ['', l[0]] : l;
      if (!nome) { ignorados.push(l.join(' | ')); continue; }
      let it = achar(setor, cod, nome);
      if (it && vistos.has(it.id)) { ignorados.push(l.join(' | ') + ' (repetido)'); continue; }
      if (it) atualizados++;
      else { it = { id: novoId(), cod: '', nome: '', un: '', cat: '' }; setor.itens.push(it); novos++; }
      it.nome = nome; if (cod) it.cod = cod; if (un) it.un = un; if (cat) it.cat = cat;
      vistos.add(it.id);
    }
    let removidos = 0;
    if (opc.removerAusentes && vistos.size) {
      setor.itens = setor.itens.filter(i => { if (vistos.has(i.id)) return true; apagarDados(setor, i.id); removidos++; return false; });
    }
    return { novos, atualizados, removidos, ignorados };
  }

  /* Primeira coluna = código (ou nome); última coluna = saldo. Substitui o saldo anterior. */
  function importarSaldo(setor, texto) {
    let ls = linhas(texto);
    if (ls.length && ehCabecalho(ls[0])) ls = ls.slice(1);
    const sys = {}, naoEncontrados = [], invalidos = [], somados = [];
    for (const l of ls) {
      const q = l.length > 1 ? numSistema(l[l.length - 1]) : null;
      if (q === null) { invalidos.push(l.join(' | ')); continue; }
      const it = achar(setor, l[0]) || setor.itens.find(x => norm(x.nome) === norm(l[0]));
      if (!it) { naoEncontrados.push(l.join(' | ')); continue; }
      if (it.id in sys) { somados.push(it.nome); sys[it.id] = arred(sys[it.id] + q); }
      else sys[it.id] = q;
    }
    const casados = Object.keys(sys).length;
    if (casados) setor.sys = sys;
    return { casados, semSaldo: setor.itens.filter(i => !(i.id in setor.sys)).length, naoEncontrados, invalidos, somados };
  }

  function situacao(setor, it) {
    const v = setor.cont[it.id], s = setor.sys[it.id];
    const fisico = v && v.length ? arred(v.reduce((a, b) => a + b, 0)) : null;
    const saldo = s === undefined ? null : s;
    if (fisico === null) return { tipo: 'nao_contado', fisico, saldo, dif: null };
    if (saldo === null) return { tipo: 'sem_saldo', fisico, saldo, dif: null };
    const dif = arred(fisico - saldo);
    return { tipo: dif === 0 ? 'ok' : dif > 0 ? 'sobra' : 'falta', fisico, saldo, dif };
  }
  const ROTULO = { nao_contado: 'Não contado', sem_saldo: 'Sem saldo', ok: 'OK', sobra: 'Sobra', falta: 'Falta' };
  function resumo(setor) {
    const r = { total: setor.itens.length, contados: 0, nao_contado: 0, sem_saldo: 0, ok: 0, sobra: 0, falta: 0 };
    for (const it of setor.itens) { const t = situacao(setor, it).tipo; r[t]++; if (t !== 'nao_contado') r.contados++; }
    return r;
  }
  const dataBR = d => d ? d.split('-').reverse().join('/') : '';
  const sinal = n => (n > 0 ? '+' : '') + fmt(n);

  function relatorio(empresa, setor, soDivergencias) {
    const r = resumo(setor), out = [];
    out.push('RELATÓRIO DE CONFERÊNCIA', 'Empresa: ' + empresa, 'Setor: ' + setor.nome, 'Data: ' + dataBR(setor.data), 'Responsável: ' + setor.resp, '',
      'Itens: ' + r.total + ' | Contados: ' + r.contados + ' | OK: ' + r.ok,
      'Faltas: ' + r.falta + ' | Sobras: ' + r.sobra + ' | Sem saldo: ' + r.sem_saldo, 'Não contados: ' + r.nao_contado, '');
    let n = 0;
    for (const it of setor.itens) {
      const s = situacao(setor, it);
      const diverge = s.tipo === 'falta' || s.tipo === 'sobra';
      if (soDivergencias && !diverge) continue;
      const un = it.un ? ' ' + it.un : '';
      const corpo = diverge ? sinal(s.dif) + un + ' (' + ROTULO[s.tipo].toLowerCase() + ') — físico ' + fmt(s.fisico) + ', sistema ' + fmt(s.saldo)
        : s.tipo === 'sem_saldo' ? 'físico ' + fmt(s.fisico) + un + ' (sem saldo)' : ROTULO[s.tipo];
      const obs = setor.obs[it.id] ? ' | Obs: ' + setor.obs[it.id] : '';
      out.push(it.nome + ': ' + corpo + obs); n++;
    }
    if (!n) out.push(soDivergencias ? 'Sem divergências nos itens contados com saldo.' : 'Sem itens.');
    out.push('', 'Diferença = físico − sistema (+ sobra / − falta)');
    return out.join('\n');
  }

  function celula(v) {
    if (v === null || v === undefined) v = '';
    if (typeof v === 'number') return fmt(v);
    v = String(v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function csv(empresa, setor) {
    const cab = ['Empresa', 'Setor', 'Data', 'Responsável', 'Código', 'Item', 'Unidade', 'Categoria', 'Contagens', 'Contagem Física', 'Saldo Sistema', 'Diferença', 'Situação', 'Observação'];
    const ls = setor.itens.map(it => {
      const s = situacao(setor, it);
      return [empresa, setor.nome, dataBR(setor.data), setor.resp, it.cod, it.nome, it.un, it.cat, (setor.cont[it.id] || []).map(fmt).join(' + '),
        s.fisico, s.saldo, s.dif, ROTULO[s.tipo], setor.obs[it.id] || ''].map(celula).join(';');
    });
    return [cab.join(';'), ...ls].join('\r\n');
  }

  const backup = estado => JSON.stringify(estado);
  function lerBackup(texto) {
    const o = JSON.parse(texto);
    const obj = x => x && typeof x === 'object' && !Array.isArray(x);
    const ok = o && o.app === 'conferencia-estoque' && obj(o.sel) && Array.isArray(o.empresas) && o.empresas.length &&
      o.empresas.every(e => e.id && typeof e.nome === 'string' && Array.isArray(e.setores) && e.setores.length &&
        e.setores.every(s => s.id && Array.isArray(s.itens) && obj(s.cont) && obj(s.sys) && obj(s.obs) &&
          Object.values(s.cont).every(v => Array.isArray(v) && v.every(Number.isFinite)) && Object.values(s.sys).every(Number.isFinite)));
    if (!ok) throw new Error('Arquivo de backup inválido');
    return o;
  }

  const api = { novoSetor, novaEmpresa, estadoInicial, numSistema, numsContagem, importarCadastro, importarSaldo, situacao, resumo, relatorio, csv, backup, lerBackup, apagarDados, fmt, norm, sinal, ROTULO };
  if (typeof module !== 'undefined') module.exports = api; else root.Core = api;
})(this);
