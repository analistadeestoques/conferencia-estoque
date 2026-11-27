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
      const iguais = setor.itens.filter(x => x.cod && chaveCod(x.cod) === chaveCod(l[0]));
      if (iguais.length > 1) { naoEncontrados.push(l.join(' | ') + ' (código repetido no setor: use Importar Excel do sistema)'); continue; }
      const it = achar(setor, l[0]) || setor.itens.find(x => norm(x.nome) === norm(l[0]));
      if (!it) { naoEncontrados.push(l.join(' | ')); continue; }
      if (it.id in sys) { somados.push(it.nome); sys[it.id] = arred(sys[it.id] + q); }
      else sys[it.id] = q;
    }
    const casados = Object.keys(sys).length;
    if (casados) setor.sys = sys;
    return { casados, semSaldo: setor.itens.filter(i => !(i.id in setor.sys)).length, naoEncontrados, invalidos, somados };
  }

  /* Exportação "Posição de Estoque": setor = família; categoria = empresa e local.
     Mantém contagens e observações dos itens já existentes. */
  const FAMILIAS = { 'BEBIDAS ALCOOLICAS': 'Bebidas alcoólicas', 'BEBIDAS NAO ALCOOLICAS': 'Bebidas não alcoólicas', 'CEREAIS E DIVERSOS': 'Cereais diversos',
    'ESCRITORIO E ASSEMELHADOS': 'Escritório e assemelhados', 'FRIOS E EMBUTIDOS': 'Frios e embutidos', 'MATERIAL DE LIMPEZA': 'Material de limpeza',
    'PORCOES': 'Porções', 'PROTEINAS': 'Proteínas', 'VINHO E ESPUMANTES': 'Vinhos e espumantes' };
  const EMPRESAS = { 'PORTAL BEACH HOTEL': 'Hotel', 'PORTAL A & B SERVICOS E EVENTOS': 'A&B' };
  const inicial = t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

  function lerPosicao(linhasPlan) {
    const h = linhasPlan.findIndex(l => l.some(c => norm(c) === 'codigo do produto'));
    if (h < 0) throw new Error('Não achei a coluna “Código do Produto”.');
    const cab = linhasPlan[h].map(norm);
    const col = nome => { const i = cab.findIndex(c => c.startsWith(nome)); if (i < 0) throw new Error('Falta a coluna “' + nome + '” na exportação.'); return i; };
    const c = { cod: col('codigo do produto'), nome: col('descricao do produto'), un: col('unidade'), qtd: col('quantidade'), fam: col('familia'), emp: col('minha empresa'), local: col('local de estoque') };
    const mapa = new Map();
    for (const l of linhasPlan.slice(h + 1)) {
      const t = i => String(l[i] === undefined ? '' : l[i]).trim();
      const q = typeof l[c.qtd] === 'number' ? l[c.qtd] : numSistema(t(c.qtd));
      if (!t(c.cod) || !t(c.nome) || q === null) continue;
      const empresa = t(c.emp).toUpperCase(), familia = t(c.fam).toUpperCase();
      const r = { cod: t(c.cod), nome: t(c.nome), un: t(c.un), q: arred(q), setor: FAMILIAS[familia] || inicial(familia || 'Sem família'),
        cat: (EMPRESAS[empresa] || t(c.emp)) + ' - ' + inicial(t(c.local)) };
      const k = r.cat + '|' + chaveCod(r.cod);
      if (mapa.has(k)) mapa.get(k).q = arred(mapa.get(k).q + r.q); else mapa.set(k, r);
    }
    if (!mapa.size) throw new Error('Nenhum item encontrado na planilha.');
    return [...mapa.values()];
  }

  function importarPosicao(empresa, linhasPlan) {
    const regs = lerPosicao(linhasPlan);
    const rotulos = new Set(regs.map(r => r.cat));
    /* Itens atuais, em qualquer organização anterior (local como categoria ou como setor). */
    const atuais = [];
    for (const s of empresa.setores) for (const it of s.itens) {
      const local = rotulos.has(it.cat) ? it.cat : rotulos.has(s.nome) ? s.nome : null;
      atuais.push({ s, it, local, usado: false });
    }
    const porCod = new Map(), porNome = new Map();
    const guardar = (m, k, a) => { if (!m.has(k)) m.set(k, []); m.get(k).push(a); };
    for (const a of atuais) if (a.local) { guardar(porCod, a.local + '|' + chaveCod(a.it.cod), a); guardar(porNome, a.local + '|' + norm(a.it.nome), a); }
    const pares = regs.map(r => ({ r, a: null }));
    for (const p of pares) {
      const a = (porCod.get(p.r.cat + '|' + chaveCod(p.r.cod)) || []).find(x => !x.usado && norm(x.it.nome) === norm(p.r.nome));
      if (a) { a.usado = true; p.a = a; }
    }
    /* Código ou descrição mudou no sistema: aceita se sobrar um único candidato. */
    for (const p of pares) if (!p.a) {
      for (const lista of [porNome.get(p.r.cat + '|' + norm(p.r.nome)), porCod.get(p.r.cat + '|' + chaveCod(p.r.cod))]) {
        const livres = (lista || []).filter(x => !x.usado);
        if (livres.length === 1) { livres[0].usado = true; p.a = livres[0]; break; }
      }
    }
    const setores = new Map();
    const pegar = nome => {
      if (!setores.has(nome)) {
        const velho = empresa.setores.find(s => s.nome === nome), s = novoSetor(nome);
        if (velho) Object.assign(s, { id: velho.id, resp: velho.resp, data: velho.data, cego: velho.cego });
        setores.set(nome, s);
      }
      return setores.get(nome);
    };
    const mover = (a, s) => { for (const k of ['cont', 'obs']) if (a.s[k][a.it.id] !== undefined) s[k][a.it.id] = a.s[k][a.it.id]; };
    let novos = 0, atualizados = 0;
    for (const { r, a } of pares) {
      const s = pegar(r.setor), id = a ? a.it.id : novoId();
      if (a) { mover(a, s); atualizados++; } else novos++;
      s.itens.push({ id, cod: r.cod, nome: r.nome, un: r.un, cat: r.cat });
      s.sys[id] = r.q;
    }
    /* O que não veio na exportação permanece, com o saldo que tinha. */
    let fora = 0;
    for (const a of atuais) if (!a.usado) {
      const s = pegar(a.s.nome);
      s.itens.push(a.it); mover(a, s); fora++;
      if (a.s.sys[a.it.id] !== undefined) s.sys[a.it.id] = a.s.sys[a.it.id];
    }
    for (const s of setores.values()) s.itens.sort((x, y) => (x.cat + '|' + x.nome).localeCompare(y.cat + '|' + y.nome, 'pt-BR'));
    empresa.setores = [...setores.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
    return { total: regs.length, novos, atualizados, fora, setores: empresa.setores.length };
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

  const api = { novoSetor, novaEmpresa, estadoInicial, numSistema, numsContagem, importarCadastro, importarSaldo, importarPosicao, situacao, resumo, relatorio, csv, backup, lerBackup, apagarDados, fmt, norm, sinal, ROTULO };
  if (typeof module !== 'undefined') module.exports = api; else root.Core = api;
})(this);
