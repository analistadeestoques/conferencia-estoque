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
      const lin = [], formulas = [];
      tags(row, 'c').forEach((c, i) => {
        const ref = c.getAttribute('r'), tipo = c.getAttribute('t'), v = tags(c, 'v')[0];
        let val = '';
        if (tipo === 'inlineStr') val = texto(c);
        else if (v) val = tipo === 's' ? textos[+v.textContent] : tipo === 'str' ? v.textContent : Number(v.textContent);
        lin[ref ? coluna(ref) : i] = val;
        const f = tags(c, 'f')[0];
        if (f) formulas[ref ? coluna(ref) : i] = f.textContent;
      });
      return Object.assign(Array.from(lin, x => x === undefined ? '' : x), { f: formulas });
    });
  }
  root.lerXlsx = lerXlsx;
})(this);

/* Gravador mínimo de .xlsx: zip sem compressão, textos dentro das próprias células. */
(function (root) {
  'use strict';
  const TAB = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = TAB[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const esc = t => String(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const letra = i => (i >= 26 ? letra(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + i % 26);
  function zip(arquivos) {
    const enc = new TextEncoder(), partes = [], central = [];
    let pos = 0, tamCentral = 0;
    const bloco = (n, escrever) => { const b = new Uint8Array(n); escrever(new DataView(b.buffer)); return b; };
    for (const [nome, texto] of arquivos) {
      const n = enc.encode(nome), d = enc.encode(texto), c = crc(d);
      const comum = (v, p) => { v.setUint16(p, 20, true); v.setUint16(p + 2, 0x800, true); v.setUint32(p + 10, c, true); v.setUint32(p + 14, d.length, true); v.setUint32(p + 18, d.length, true); v.setUint16(p + 22, n.length, true); v.setUint16(p + 8, 0x21, true); };
      const local = bloco(30, v => { v.setUint32(0, 0x04034b50, true); comum(v, 4); });
      const cen = bloco(46, v => { v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); comum(v, 6); v.setUint32(42, pos, true); });
      partes.push(local, n, d); central.push(cen, n);
      pos += 30 + n.length + d.length; tamCentral += 46 + n.length;
    }
    const fim = bloco(22, v => { v.setUint32(0, 0x06054b50, true); v.setUint16(8, arquivos.length, true); v.setUint16(10, arquivos.length, true); v.setUint32(12, tamCentral, true); v.setUint32(16, pos, true); });
    const tudo = [...partes, ...central, fim], saida = new Uint8Array(tudo.reduce((a, b) => a + b.length, 0));
    let p = 0;
    for (const b of tudo) { saida.set(b, p); p += b.length; }
    return saida;
  }
  /* abas: [{ nome, linhas: [[valor]], larguras: [n], titulos: [índices em negrito] }] */
  function gerarXlsx(abas) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships', TIPO = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
    const folha = a => X + '<worksheet xmlns="' + NS + '">' +
      (a.larguras ? '<cols>' + a.larguras.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>' : '') +
      '<sheetData>' + a.linhas.map((l, i) => '<row r="' + (i + 1) + '">' + l.map((v, j) => {
        const r = ' r="' + letra(j) + (i + 1) + '"' + ((a.titulos || []).includes(i) ? ' s="1"' : '');
        if (typeof v === 'number' && Number.isFinite(v)) return '<c' + r + '><v>' + v + '</v></c>';
        return v === '' || v === null || v === undefined ? '' : '<c' + r + ' t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>';
      }).join('') + '</row>').join('') + '</sheetData></worksheet>';
    return zip([
      ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="' + TIPO + 'sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="' + TIPO + 'styles+xml"/>' + abas.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="' + TIPO + 'worksheet+xml"/>').join('') + '</Types>'],
      ['_rels/.rels', X + '<Relationships xmlns="' + PKG + '"><Relationship Id="rId1" Type="' + REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', X + '<workbook xmlns="' + NS + '" xmlns:r="' + REL + '"><sheets>' + abas.map((a, i) => '<sheet name="' + esc(a.nome.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="' + PKG + '">' + abas.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (abas.length + 1) + '" Type="' + REL + '/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', X + '<styleSheet xmlns="' + NS + '"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ...abas.map((a, i) => ['xl/worksheets/sheet' + (i + 1) + '.xml', folha(a)])
    ]);
  }
  root.gerarXlsx = gerarXlsx;
})(this);
