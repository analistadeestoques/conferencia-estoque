/* Leitor mínimo de .xlsx (primeira aba), sem bibliotecas e sem internet. */
(function (root) {
  'use strict';
  async function entradas(buf) {
    const v = new DataView(buf), u8 = new Uint8Array(buf), txt = new TextDecoder();
    let fim = buf.byteLength - 22;
    while (fim >= 0 && v.getUint32(fim, true) !== 0x06054b50) fim--;
    if (fim < 0) throw new Error('O arquivo não é um Excel .xlsx');
    const mapa = new Map();
    let p = v.getUint32(fim + 16, true);
    for (let i = v.getUint16(fim + 10, true); i > 0; i--) {
      const metodo = v.getUint16(p + 10, true), tam = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), local = v.getUint32(p + 42, true);
      const nome = txt.decode(u8.subarray(p + 46, p + 46 + nl));
      const ini = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      mapa.set(nome, { metodo, dados: u8.subarray(ini, ini + tam) });
      p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    return mapa;
  }
  async function xml(mapa, nome) {
    const e = mapa.get(nome);
    if (!e) return null;
    const fluxo = new Blob([e.dados]).stream();
    const t = await new Response(e.metodo === 8 ? fluxo.pipeThrough(new DecompressionStream('deflate-raw')) : fluxo).text();
    return new DOMParser().parseFromString(t, 'application/xml');
  }
  const tags = (n, t) => [...n.getElementsByTagNameNS('*', t)];
  const texto = n => tags(n, 't').map(t => t.textContent).join('');
  const coluna = ref => [...ref.replace(/\d+/g, '')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;

  /* Devolve um vetor de linhas; números continuam números. */
  async function lerXlsx(buf) {
    const mapa = await entradas(buf);
    const compart = await xml(mapa, 'xl/sharedStrings.xml');
    const textos = compart ? tags(compart, 'si').map(texto) : [];
    const aba = [...mapa.keys()].filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
    if (!aba) throw new Error('Planilha sem abas');
    return tags(await xml(mapa, aba), 'row').map(row => {
      const lin = [];
      tags(row, 'c').forEach((c, i) => {
        const ref = c.getAttribute('r'), tipo = c.getAttribute('t'), v = tags(c, 'v')[0];
        let val = '';
        if (tipo === 'inlineStr') val = texto(c);
        else if (v) val = tipo === 's' ? textos[+v.textContent] : tipo === 'str' ? v.textContent : Number(v.textContent);
        lin[ref ? coluna(ref) : i] = val;
      });
      return Array.from(lin, x => x === undefined ? '' : x);
    });
  }
  root.lerXlsx = lerXlsx;
})(this);
