'use strict';
// Vade Mecum AJ-AJ TRT4 — leitor offline (abre direto do disco, sem servidor).
// Dados: dados/indice.js (catálogo), dados/textos/<id>.js (textos), edital.js (conteúdo programático).
// Marcações de estudo ficam no localStorage deste navegador; "Meu estudo" exporta/importa um backup .json.

const I = window.VM_INDICE, E = window.VM_EDITAL;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $('#main'), col = $('#col');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// minúsculas sem acento, com o mesmo comprimento do original (as posições batem com o texto exibido)
const fold = s => s.replace(/[^\x00-\x7f]/g, c => c.normalize('NFD')[0]).toLowerCase();
const plano = h => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
const dataBR = s => s ? s.slice(0, 10).split('-').reverse().join('/') : '—';
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const barra = p => `<i class="barra" aria-hidden="true"><i style="width:${p}%"></i></i>`;
const debounce = (f, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => f(...a), ms); }; };

if (!I || !E) {
  col.innerHTML = '<h1>Arquivos de dados não encontrados</h1><p>Mantenha <code>index.html</code>, <code>edital.js</code>, <code>assets/</code> e <code>dados/</code> na mesma pasta. Para reconstruir os textos: <code>python gerar.py</code>.</p>';
  throw new Error('dados ausentes');
}

// ---------- preferências e marcações (localStorage) ----------
function lido(k, padrao) {
  try { const v = JSON.parse(localStorage.getItem('vm.' + k) || 'null'); return v && typeof v === 'object' ? Object.assign(padrao, v) : padrao; } catch (e) { return padrao; }
}
let avisouFalha = false;
function guardar(k, v) {
  try { localStorage.setItem('vm.' + k, JSON.stringify(v)); }
  catch (e) { if (!avisouFalha) toast('O navegador não deixou salvar. Exporte seu estudo em "Meu estudo" para não perder as marcações.'); avisouFalha = true; }
}
const EST = lido('estudo', { fav: {}, ok: {}, notas: {}, grifos: {}, edital: {} });
const PREF = lido('pref', { tema: 'auto', fs: 1.06, rev: false, notasLeg: true, sans: false, lado: true, fechadas: [] });
const POS = lido('pos', {});
const salvarEst = () => guardar('estudo', EST);
const salvarPref = () => guardar('pref', PREF);
const salvarPos = debounce(() => guardar('pos', POS), 800);

function aplicarPref() {
  const r = document.documentElement;
  if (PREF.tema === 'auto') delete r.dataset.tema; else r.dataset.tema = PREF.tema;
  r.style.setProperty('--fs', PREF.fs + 'rem');
  document.body.classList.toggle('sem-lado', !PREF.lado);
  document.body.classList.toggle('mostra-rev', PREF.rev);
  document.body.classList.toggle('sem-notas-leg', !PREF.notasLeg);
  document.body.classList.toggle('sans', PREF.sans);
  estado.tops = null;
}

let tToast;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('vis');
  clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove('vis'), 2800);
}
async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); }
  catch (e) {
    const ta = Object.assign(document.createElement('textarea'), { value: txt });
    ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Copiado');
}

// ---------- catálogo e textos ----------
const porId = Object.fromEntries(I.normas.map(n => [n.id, n]));
const comTexto = I.normas.filter(n => n.tipo !== 'link');
const NUM_LEI = {};  // "8112" -> "lei-8112", para ligar remissões a outras leis do catálogo
for (const n of I.normas) {
  const m = n.sigla.match(/\b(?:Lei|LC|DL|Dec\.|MP)\s*([\d.]+)\/\d{4}/);
  if (m) NUM_LEI[m[1].replace(/\./g, '')] = n.id;
}
const cache = {}, espera = {};
window.VM_RECEBE = (id, d) => {
  d.idx = new Map(); d.b.forEach((b, i) => b[0] && d.idx.set(b[0], i));
  cache[id] = d; (espera[id] || []).forEach(f => f[0](d)); delete espera[id];
};
function carregar(id) {
  if (cache[id]) return Promise.resolve(cache[id]);
  return new Promise((ok, falha) => {
    if (espera[id]) return espera[id].push([ok, falha]);
    espera[id] = [[ok, falha]];
    const s = document.createElement('script');
    s.src = `dados/textos/${id}.js`;
    s.onerror = () => { (espera[id] || []).forEach(f => f[1](new Error('texto ausente'))); delete espera[id]; };
    document.head.append(s);
  });
}
function rotulo(chave, nid) {  // "a1072" -> "Art. 1.072"; "a10_2" na CF -> "ADCT, art. 10"
  const m = /^a(\d+)(-[A-Z]+)?(?:_(\d+))?$/.exec(chave || '');
  if (!m) return '';
  const n = +m[1], num = n.toLocaleString('pt-BR') + (n < 10 ? 'º' : '') + (m[2] || '');
  if (m[3] && nid === 'cf88') return 'ADCT, art. ' + num;
  return 'Art. ' + num + (m[3] ? ` (${m[3]}ª ocorrência)` : '');
}
function contar(tipo, id) { let c = 0; const p = id + '/'; for (const k in EST[tipo]) if (k.startsWith(p)) c++; return c; }

// ---------- edital ----------
const hashTxt = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const TOPICOS = [];
E.disciplinas.forEach((d, k) => d.topicos.forEach(t => {
  const [txt, ...links] = Array.isArray(t) ? t : [t];
  TOPICOS.push({ d: k, txt, links, h: hashTxt(d.nome + '|' + txt) });
}));
const progDisc = k => { const ts = TOPICOS.filter(t => t.d === k); return [ts.filter(t => EST.edital[t.h]).length, ts.length]; };
function chip(l) {
  const [alvo, rot] = l.split('|'), [nid, art] = alvo.split('/'), n = porId[nid];
  if (!n) return '';
  return `<a class="chip${n.tipo === 'link' ? ' ext' : ''}" href="#${esc(alvo)}">${esc(rot || n.sigla + (art ? ', ' + rotulo(art, nid).toLowerCase() : ''))}</a>`;
}

// ---------- flutuantes (menus, prévias, barra de grifo) ----------
function fecharFlutuantes(exceto) {
  $$('.flutuante').forEach(f => f !== exceto && f.remove());
  $$('[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function flutuante(nome, ancora, cls = '') {
  fecharFlutuantes();
  const el = document.createElement('div');
  el.className = 'flutuante ' + cls; el.dataset.nome = nome;
  document.body.append(el);
  el.posicionar = () => {  // abaixo da âncora; acima se lá couber mais; nunca a cobre
    el.style.maxHeight = '';
    const r = ancora.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
    const abaixo = innerHeight - r.bottom - 14, acima = r.top - 14, emCima = h > abaixo && acima > abaixo;
    const alt = Math.min(h, emCima ? acima : abaixo);
    el.style.maxHeight = alt + 'px';
    el.style.top = (emCima ? r.top - alt - 6 : r.bottom + 6) + 'px';
    el.style.left = Math.min(Math.max(8, r.left), innerWidth - w - 8) + 'px';
  };
  ancora.setAttribute?.('aria-expanded', 'true');
  return el;
}
document.addEventListener('mousedown', e => {
  if (!e.target.closest('.flutuante, #bleitura, .rot, #bsum')) fecharFlutuantes();
});

function abrirLeitura() {
  const b = $('#bleitura');
  if ($('.flutuante[data-nome="leitura"]')) return fecharFlutuantes();
  const pop = flutuante('leitura', b, 'leitura');
  const desenhar = () => {
    pop.innerHTML = `
      <div class="op"><span>Tema</span><div class="seg">${[['auto', 'Auto'], ['claro', 'Claro'], ['sepia', 'Sépia'], ['escuro', 'Escuro']]
        .map(([v, t]) => `<button data-tema="${v}" aria-pressed="${PREF.tema === v}">${t}</button>`).join('')}</div></div>
      <div class="op"><span>Letra</span><div class="seg"><button data-sans="0" aria-pressed="${!PREF.sans}">Serifada</button><button data-sans="1" aria-pressed="${PREF.sans}">Sem serifa</button></div></div>
      <div class="op"><span>Tamanho</span><div class="seg"><button data-fs="-1" aria-label="Diminuir letra">A−</button><output>${Math.round(PREF.fs / 1.06 * 100)}%</output><button data-fs="1" aria-label="Aumentar letra">A+</button></div></div>
      <div class="op"><span>Índice de normas</span><div class="seg"><button data-lado="1" aria-pressed="${PREF.lado}">Mostrar</button><button data-lado="0" aria-pressed="${!PREF.lado}">Ocultar</button></div></div>
      <label class="op chk"><input type="checkbox" data-pref="rev" ${PREF.rev ? 'checked' : ''}> Mostrar texto revogado (tachado)</label>
      <label class="op chk"><input type="checkbox" data-pref="notasLeg" ${PREF.notasLeg ? 'checked' : ''}> Mostrar notas de alteração <small>“(Redação dada pela…)”</small></label>`;
    pop.posicionar();
  };
  desenhar();
  pop.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tema) PREF.tema = t.dataset.tema;
    if (t.dataset.sans) PREF.sans = t.dataset.sans === '1';
    if (t.dataset.lado) PREF.lado = t.dataset.lado === '1';
    if (t.dataset.fs) PREF.fs = Math.min(1.7, Math.max(.85, +(PREF.fs + .08 * t.dataset.fs).toFixed(2)));
    salvarPref(); aplicarPref(); desenhar();
  });
  pop.addEventListener('change', e => {
    const k = e.target.dataset.pref; if (!k) return;
    PREF[k] = e.target.checked; salvarPref(); aplicarPref();
    if (estado.d) pintar();
  });
}
$('#bleitura').addEventListener('click', abrirLeitura);
$('#menu').addEventListener('click', () => {
  if (matchMedia('(max-width: 860px)').matches) document.body.classList.toggle('menu-aberto');
  else { PREF.lado = !PREF.lado; salvarPref(); aplicarPref(); }
});

// ---------- índice lateral ----------
function desenharLista() {
  const q = fold($('#filtro').value.trim()), atual = decodeURIComponent(location.hash.slice(1)).split('/')[0];
  $('#lista').innerHTML = I.disciplinas.map(d => {
    const ns = I.normas.filter(n => n.disc.includes(d) && (!q || fold(n.sigla + ' ' + n.titulo).includes(q)));
    if (!ns.length) return '';
    return `<details class="grupo-disc" data-d="${esc(d)}" ${q || !PREF.fechadas.includes(d) ? 'open' : ''}><summary>${esc(d)}</summary>${ns.map(n => {
      const ok = n.arts ? contar('ok', n.id) : 0;
      return `<a class="norma${n.id === atual ? ' ativa' : ''}" href="#${n.id}"><b>${esc(n.sigla)}</b>${n.tipo === 'link' ? '<span class="selo">↗ site</span>' : ''}<small>${esc(n.titulo)}</small>${ok ? barra(pct(ok, n.arts)) : ''}</a>`;
    }).join('')}</details>`;
  }).join('') || '<p class="vazio">Nenhuma norma encontrada.</p>';
}
$('#filtro').addEventListener('input', desenharLista);
$('#lista').addEventListener('toggle', e => {
  const d = e.target.dataset?.d; if (!d || $('#filtro').value) return;
  PREF.fechadas = PREF.fechadas.filter(x => x !== d).concat(e.target.open ? [] : [d]); salvarPref();
}, true);
$('#lista').addEventListener('click', e => { if (e.target.closest('a')) document.body.classList.remove('menu-aberto'); });

// ---------- tela inicial ----------
function telaInicio() {
  const ult = porId[POS._ultimo] && POS[POS._ultimo] ? POS._ultimo : null;
  const feitos = TOPICOS.filter(t => EST.edital[t.h]).length;
  const nOk = Object.keys(EST.ok).length, nFav = Object.keys(EST.fav).length, nNotas = Object.keys(EST.notas).length;
  const nGrifos = Object.values(EST.grifos).reduce((s, l) => s + new Set(l.map(g => g.g)).size, 0);
  col.innerHTML = `
    <p class="sobre">Analista Judiciário — Área Judiciária · TRT 4ª Região · FCC</p>
    <h1>Vade Mecum do edital</h1>
    <p class="meta">${comTexto.length} normas com texto integral, conforme a legislação vigente na data do edital (${dataBR(I.edital)}), obtidas das fontes oficiais. As alterações posteriores aparecem marcadas.</p>
    <form id="fbusca2" class="busca-grande" role="search" style="margin-top:16px"><input id="qglobal2" type="search" placeholder="Buscar em todas as normas — ex.: aviso prévio, desconsideração" aria-label="Buscar em todas as normas" autocomplete="off"></form>
    ${ult ? `<a class="cartao continuar" href="#${ult}/p${POS[ult].i}"><span>Continuar lendo</span><b>${esc(porId[ult].sigla)}</b><small>${esc(POS[ult].rot || '')}</small></a>` : ''}
    <div class="cartoes">
      <a class="cartao" href="#edital"><b>${pct(feitos, TOPICOS.length)}%</b><span>do edital estudado · ${feitos} de ${TOPICOS.length} tópicos</span>${barra(pct(feitos, TOPICOS.length))}</a>
      <a class="cartao" href="#estudo"><b>${nOk}</b><span>artigos estudados</span></a>
      <a class="cartao" href="#estudo"><b>${nFav}</b><span>artigos favoritos</span></a>
      <a class="cartao" href="#estudo"><b>${nNotas + nGrifos}</b><span>anotações e grifos</span></a>
    </div>
    <h2>Progresso por disciplina do edital</h2>
    <div class="disc-prog">${E.disciplinas.map((d, k) => { const [a, b] = progDisc(k); return `<a href="#edital/d${k}"><span>${esc(d.nome)}</span>${barra(pct(a, b))}<em>${a}/${b}</em></a>`; }).join('')}</div>
    <h2>Como usar</h2>
    <ul class="dicas">
      <li><b>Edital</b> (aba acima): marque os tópicos estudados. Os atalhos abrem a norma no artigo certo.</li>
      <li>Clique no número do artigo (<b style="color:var(--acc)">Art. 5º</b>) para marcar como estudado, favoritar, anotar ou copiar com a citação.</li>
      <li>Selecione um trecho do texto para <mark class="g g1">grifar</mark> em quatro cores. Clique no grifo para trocar a cor ou remover.</li>
      <li>Remissões como <u style="text-decoration-style:dotted">art. 482</u> levam ao artigo. No computador, pare o mouse sobre elas para ler sem sair do lugar.</li>
      <li>Atalhos: <kbd>/</kbd> buscar · <kbd>g</kbd> ir para artigo · <kbd>Esc</kbd> fechar menus. Em <b>Aa</b>: tema, letra, revogados.</li>
      <li>Suas marcações ficam neste navegador. Faça backup em <a href="#estudo">Meu estudo</a>.</li>
    </ul>`;
  $('#fbusca2').addEventListener('submit', e => { e.preventDefault(); location.hash = 'busca:' + encodeURIComponent($('#qglobal2').value.trim()); });
}

// ---------- edital verticalizado ----------
function telaEdital(foco) {
  const feitos = TOPICOS.filter(t => EST.edital[t.h]).length;
  col.innerHTML = `
    <p class="sobre">Edital nº 1/2026 · publicado em ${dataBR(E.data)}</p>
    <h1>Edital verticalizado</h1>
    <p class="meta">Marque cada tópico quando terminar de estudá-lo. Os atalhos abrem a legislação no ponto indicado.</p>
    <div class="progresso">${barra(pct(feitos, TOPICOS.length))}<span id="prog-edital">${feitos} de ${TOPICOS.length} tópicos (${pct(feitos, TOPICOS.length)}%)</span></div>
    <label class="chk" style="margin-top:12px"><input type="checkbox" id="ocultar-feitos" ${PREF.ocultarFeitos ? 'checked' : ''}> Ocultar tópicos já estudados</label>
    <nav class="indice-edital">${E.disciplinas.map((d, k) => `<a class="chip" href="#edital/d${k}">${esc(d.nome)}</a>`).join('')}</nav>
    <div id="disciplinas" class="${PREF.ocultarFeitos ? 'ocultar-feitos' : ''}">${E.disciplinas.map((d, k) => {
      const [a, b] = progDisc(k);
      return `<section class="disc" id="d${k}"><header><h2>${esc(d.nome)}</h2>${barra(pct(a, b))}<em>${a}/${b}</em></header><ul class="topicos">${TOPICOS.filter(t => t.d === k).map(t => `
        <li class="${EST.edital[t.h] ? 'feito' : ''}"><label><input type="checkbox" data-h="${t.h}" ${EST.edital[t.h] ? 'checked' : ''}><span>${esc(t.txt)}</span></label>${t.links.length ? `<div class="chips">${t.links.map(chip).join('')}</div>` : ''}</li>`).join('')}</ul></section>`;
    }).join('')}</div>`;
  $('#disciplinas').addEventListener('change', e => {
    const h = e.target.dataset.h; if (!h) return;
    if (e.target.checked) EST.edital[h] = Date.now(); else delete EST.edital[h];
    salvarEst();
    e.target.closest('li').classList.toggle('feito', e.target.checked);
    const sec = e.target.closest('.disc'), k = +sec.id.slice(1), [a, b] = progDisc(k);
    sec.querySelector('header').innerHTML = `<h2>${esc(E.disciplinas[k].nome)}</h2>${barra(pct(a, b))}<em>${a}/${b}</em>`;
    const f = TOPICOS.filter(t => EST.edital[t.h]).length;
    $('.progresso .barra > i').style.width = pct(f, TOPICOS.length) + '%';
    $('#prog-edital').textContent = `${f} de ${TOPICOS.length} tópicos (${pct(f, TOPICOS.length)}%)`;
  });
  $('#ocultar-feitos').addEventListener('change', e => { PREF.ocultarFeitos = e.target.checked; salvarPref(); $('#disciplinas').classList.toggle('ocultar-feitos', e.target.checked); });
  if (foco) document.getElementById(foco)?.scrollIntoView({ block: 'start' });
}

// ---------- uma norma ----------
let estado = {}, buscaPendente = '';
function sair() { estado.ro?.disconnect(); estado = {}; }

const ART = String.raw`(?:Art\.?|Artigo|ARTIGO|ART\.)\s*\.?\s*[\dIVXLC.]+(?:\s*[º°]|o(?![\wÀ-ú]))?(?:\s?-[A-Z]{1,2}\b)?`;
const RE_ROT = new RegExp(String.raw`^((?:<[^>]+>)*)(${ART}\.?)`);
const RE_PAR = new RegExp(String.raw`^((?:<[^>]+>)*)(§\s*\d+(?:[º°]|o(?![\wÀ-ú]))?(?:\s?-\s?[A-Z]\b)?\.?|Parágrafo único\.?)`);
const RE_REM = /\b(arts?\.|artigos?)\s*(\d{1,4}(?:\.\d{3})?)(?:\s*[º°]|o(?![\wÀ-ú]))?(-[A-Z]{1,2}\b)?/g;
const OUTRA = /^(?:(?!\barts?\.)[^;:])*?\b(?:d[ao]s?|n[ao]s?)\s+(presente\s+|referid[ao]\s+)?(Lei Complementar|Lei|Decreto-Lei|Decreto|Medida Provisória|Constituição|Consolidação|CLT|Código de Processo Civil|Código Civil|CPC|Código|Resolução|Emenda|Estatuto|Regimento|Portaria|Instrução|Convenção|Pacto|Protocolo|Carta|Declaração|Ato das Disposições|ADCT|Regulamento)\b(.{0,40})/;

function alvoRemissao(depois, nid) {
  const m = depois.slice(0, 90).match(OUTRA);
  if (!m) return nid;
  if (m[1]) return nid;  // "do presente Pacto", "da referida Lei"
  const tipo = m[2], resto = m[3];
  if (tipo === 'Constituição') {
    if (/Disposições|ADCT|^\s*(de 19[0-8]\d|dos Estados Unidos)/.test(resto)) return null;
    // leis anteriores a 1988 citam constituições antigas; nelas, só "Constituição Federal/da República" é a de 1988
    const ano = +(porId[nid].sigla.match(/\/(\d{4})/) || [])[1];
    return ano && ano < 1988 && !/^\s*(Federal|da República)/.test(resto) ? null : 'cf88';
  }
  if (tipo === 'Consolidação' || tipo === 'CLT') return 'clt';
  if (tipo === 'Código de Processo Civil' || tipo === 'CPC') return 'cpc';
  if (tipo === 'Código Civil') return 'cc';
  if (/^(Lei|Decreto|Medida)/.test(tipo)) { const n = resto.match(/n[º°o.]*\s*([\d.]+)/); return n ? NUM_LEI[n[1].replace(/\./g, '')] || null : null; }
  return null;
}
function remissoes(h, nid) {  // "art. 482" vira link (para a própria norma ou para outra do catálogo)
  let dentro = 0;
  return h.split(/(<[^>]+>)/).map((p, k) => {
    if (k % 2) { if (/^<a\b/i.test(p)) dentro++; else if (/^<\/a>/i.test(p)) dentro--; return p; }
    if (dentro || !/art/.test(p)) return p;
    return p.replace(RE_REM, (m, _t, num, suf, off, str) => {
      const alvo = alvoRemissao(str.slice(off + m.length), nid);
      if (!alvo || !porId[alvo] || porId[alvo].tipo === 'link') return m;
      const dest = `${alvo}/a${num.replace(/\./g, '')}${suf || ''}`;
      return `<a class="rem" href="#${dest}" data-alvo="${dest}">${m}</a>`;
    });
  }).join('');
}
function blocoHTML([id, cls, h, nota], i, nid, niveis) {
  let c = cls;
  if (cls.includes('h')) c += ' n' + (niveis[id] ?? 5);
  else {
    const t = plano(h).trimStart();
    if (/^(§|Parágrafo único)/i.test(t)) c += ' par';
    else if (/^[IVXLC]+\s*[-–—]/.test(t)) c += ' inc';
    else if (/^[a-z]\)/.test(t)) c += ' ali';
    h = remissoes(h, nid);
    h = id && id[0] === 'a'
      ? h.replace(RE_ROT, '$1<button type="button" class="rot" aria-haspopup="menu" title="Estudado, favorito, anotação, copiar">$2</button>')
      : h.replace(RE_PAR, '$1<strong>$2</strong>');
  }
  return (nota ? `<div class="aviso-pos" role="note">⚠ ${esc(nota)}</div>` : '') +
    `<p data-i="${i}"${id ? ` id="${id}"` : ''}${c.trim() ? ` class="${c.trim()}"` : ''}>${h}</p>`;
}

function cabecalhoNorma(n) {
  const oficial = n.oficial || n.pagina || n.url;
  return `<header class="cab">
    <p class="sobre">${n.disc.map(esc).join(' · ')}</p>
    <h1>${esc(n.sigla)}</h1>
    <p class="subtitulo">${esc(n.titulo)}</p>
    <p class="meta"><a href="${esc(oficial)}" target="_blank" rel="noopener">Fonte oficial ↗</a>${n.obtido ? ` · texto obtido em ${dataBR(n.obtido)} e conferido com o edital de ${dataBR(I.edital)}` : ''}${n.tipo === 'pdf' ? ' · extraído do PDF oficial (a diagramação pode diferir)' : ''}</p>
    ${n.arts ? `<div class="progresso" id="prog-norma"></div>` : ''}
    ${n.nota ? `<p class="aviso">${esc(n.nota)}</p>` : ''}
    ${n.erro ? `<p class="aviso">A última geração deste texto falhou (${esc(n.erro)}).</p>` : ''}
  </header>`;
}
function atualizarProgressoNorma() {
  const el = $('#prog-norma'), n = porId[estado.id]; if (!el || !n?.arts) return;
  const ok = contar('ok', n.id);
  el.innerHTML = `${barra(pct(ok, n.arts))}<span>${ok} de ${n.arts} artigos marcados como estudados</span>`;
}

async function telaNorma(id, alvo) {
  const n = porId[id];
  if (estado.id !== id) {
    sair();
    estado = { id };
    POS._ultimo = id; salvarPos();
    main.scrollTop = 0;
    if (n.tipo === 'link') {
      col.innerHTML = cabecalhoNorma(n) + `<p style="margin-top:22px">Este conteúdo é consultado no site oficial (pesquisa dinâmica, sem texto consolidado para baixar).</p><p><a class="btn prim" href="${esc(n.url)}" target="_blank" rel="noopener">Abrir no site oficial ↗</a></p>`;
      return;
    }
    col.innerHTML = cabecalhoNorma(n) + '<p class="meta" id="carregando" style="margin-top:20px">Carregando…</p>';
    atualizarProgressoNorma();
    let d;
    try { d = await carregar(id); } catch (e) {
      $('#carregando').outerHTML = `<p class="aviso">Texto não encontrado em <code>dados/textos/${esc(id)}.js</code>. Rode <code>python gerar.py ${esc(id)}</code>.</p>`;
      return;
    }
    if (estado.id !== id) return;  // já navegou para outra
    estado.d = d;
    estado.niveis = Object.fromEntries(d.s.map(s => [s[0], s[2]]));
    estado.titulos = Object.fromEntries(d.s.map(s => [s[0], s[1]]));
    estado.html = d.b.map((b, i) => blocoHTML(b, i, id, estado.niveis)).join('');
    $('#carregando').outerHTML = `
      <div class="ferr" id="ferr">
        <div class="linha">
          <form class="grupo" id="fart"><input id="art" placeholder="Art. nº" aria-label="Ir para o artigo (atalho g)" autocomplete="off" enterkeyhint="go"><button class="btn">Ir</button></form>
          <div class="grupo busca-local"><input id="qlocal" type="search" placeholder="Buscar nesta norma" aria-label="Buscar nesta norma (atalho /)" autocomplete="off"><button class="btn" id="ant" aria-label="Ocorrência anterior">‹</button><button class="btn" id="prox" aria-label="Próxima ocorrência">›</button><span class="cont" id="cont" aria-live="polite"></span></div>
          ${d.s.length ? '<button class="btn" id="bsum" aria-haspopup="true" aria-expanded="false">Sumário ▾</button>' : ''}
        </div>
        <nav class="trilha" id="trilha" aria-label="Posição no texto"></nav>
      </div>
      <article class="txt" id="txt" lang="pt-BR"></article>`;
    ligarFerramentas();
    const medir = () => document.documentElement.style.setProperty('--ferr-h', ($('#ferr')?.offsetHeight || 96) + 'px');
    medir();  // antes de rolar até o alvo, para a barra fixa não cobrir o artigo
    pintar();
    estado.ro = new ResizeObserver(() => { estado.tops = null; medir(); });
    estado.ro.observe($('#txt')); estado.ro.observe($('#ferr'));
    if (!alvo && POS[id]?.i > 0) irPara('p' + POS[id].i, false);
  }
  if (buscaPendente && $('#qlocal')) { $('#qlocal').value = buscaPendente; buscaPendente = ''; pintar(); }
  if (alvo && !irPara(alvo, true)) toast('Dispositivo não encontrado neste texto');
}

function pintar() {
  const txt = $('#txt'); if (!txt) return;
  txt.innerHTML = estado.html;
  const pre = estado.id + '/';
  for (const tipo of ['ok', 'fav']) for (const k in EST[tipo]) if (k.startsWith(pre)) document.getElementById(k.slice(pre.length))?.classList.add(tipo);
  for (const k in EST.notas) if (k.startsWith(pre)) { const p = document.getElementById(k.slice(pre.length)); if (p) caixaNota(p, false); }
  aplicarGrifos();
  aplicarBusca();
  estado.marcos = $$('p[id]', txt).map(el => el.id[0] === 'a'
    ? { el, niv: 9, rot: rotulo(el.id, estado.id) }
    : { el, niv: estado.niveis[el.id] ?? 5, rot: (estado.titulos[el.id] || el.textContent).slice(0, 90) });
  estado.tops = null; estado.trilhaHTML = null;
  atualizarTrilha();
}

function irPara(alvo, destacar) {
  const txt = $('#txt'); if (!txt) return false;
  const el = alvo[0] === 'p' ? $(`p[data-i="${parseInt(alvo.slice(1), 10)}"]`, txt) : document.getElementById(alvo);
  if (!el || !txt.contains(el)) return false;
  if (el.offsetParent === null) { PREF.rev = true; aplicarPref(); }  // destino é texto revogado oculto
  el.scrollIntoView({ block: 'start' });
  estado.tops = null; atualizarTrilha();
  if (destacar) {
    const m = $('mark.busca', el);
    if (m) { estado.atual = estado.marcas.indexOf(m) - 1; passo(1, false); }
    el.classList.add('alvo'); setTimeout(() => el.classList.remove('alvo'), 1800);
  }
  return true;
}

function ligarFerramentas() {
  $('#fart').addEventListener('submit', e => {
    e.preventDefault();
    const m = $('#art').value.match(/(\d[\d.]*)\s*[º°o]?\s*(?:-?\s*([a-z]{1,2})\b)?/i);
    if (!m) return;
    const chave = 'a' + m[1].replace(/\./g, '') + (m[2] ? '-' + m[2].toUpperCase() : '');
    // repetir a busca vai para a próxima ocorrência (ADCT na CF, artigos do tratado anexo ao decreto)
    estado.artN = estado.artUlt === chave ? estado.artN + 1 : 1;
    estado.artUlt = chave;
    const id = k => k === 1 ? chave : `${chave}_${k}`;
    if (!document.getElementById(id(estado.artN))) estado.artN = 1;
    if (!irPara(id(estado.artN), true)) toast(`${rotulo(chave)} não encontrado neste texto`);
  });
  const buscar = debounce(() => { pintar(); passo(1); }, 250);
  $('#qlocal').addEventListener('input', buscar);
  $('#qlocal').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); passo(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.target.value = ''; pintar(); }
  });
  $('#prox').addEventListener('click', () => passo(1));
  $('#ant').addEventListener('click', () => passo(-1));
  $('#bsum')?.addEventListener('click', abrirSumario);
}

function abrirSumario() {
  const b = $('#bsum');
  if ($('.flutuante[data-nome="sumario"]')) return fecharFlutuantes();
  const pop = flutuante('sumario', b, 'sumario');
  const itens = estado.d.s.map(([sid, rot, niv]) => `<a href="#${estado.id}/${sid}" style="padding-left:${10 + Math.min(niv, 4) * 14}px">${esc(rot)}</a>`);
  pop.innerHTML = `<input class="campo" placeholder="Filtrar sumário…" aria-label="Filtrar sumário"><nav>${itens.join('')}</nav>`;
  pop.posicionar();
  const inp = pop.querySelector('input'); inp.focus();
  inp.addEventListener('input', () => { const q = fold(inp.value); $$('a', pop).forEach(a => { a.hidden = q && !fold(a.textContent).includes(q); }); });
  pop.addEventListener('click', e => { if (e.target.closest('a')) fecharFlutuantes(); });
}

// busca dentro da norma: trecho exato, sem acento/maiúsculas
function aplicarBusca() {
  const txt = $('#txt'), fq = fold(($('#qlocal')?.value || '').trim());
  estado.marcas = []; estado.atual = -1;
  if (fq.length >= 2) {
    const w = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('.nota') ? 2 : 1 });
    const nos = []; while (w.nextNode()) nos.push(w.currentNode);
    for (const no of nos) {
      if (!PREF.rev && no.parentElement.closest('.rev, s')) continue;
      if (!PREF.notasLeg && no.parentElement.closest('a:not(.rem)')) continue;
      const f = fold(no.data), pos = [];
      for (let i = f.indexOf(fq); i >= 0; i = f.indexOf(fq, i + fq.length)) pos.push(i);
      for (let k = pos.length - 1; k >= 0; k--) {
        const r = no.splitText(pos[k]); r.splitText(fq.length);
        const m = document.createElement('mark'); m.className = 'busca'; r.replaceWith(m); m.append(r);
      }
    }
    estado.marcas = $$('mark.busca', txt);
  }
  $('#cont').textContent = fq.length < 2 ? '' : estado.marcas.length ? `–/${estado.marcas.length}` : '0';
}
function passo(dir, rolar = true) {
  const ms = estado.marcas || [];
  if (!ms.length) return;
  ms[estado.atual]?.classList.remove('atual');
  estado.atual = (estado.atual + dir + ms.length) % ms.length;
  ms[estado.atual].classList.add('atual');
  if (rolar) ms[estado.atual].scrollIntoView({ block: 'center' });
  $('#cont').textContent = `${estado.atual + 1}/${ms.length}`;
}

// trilha "Título › Capítulo › Art." e posição de leitura
function atualizarTrilha() {
  const tr = $('#trilha'); if (!tr || !estado.marcos?.length) return;
  if (!estado.tops) {
    const base = main.getBoundingClientRect().top - main.scrollTop;
    estado.tops = estado.marcos.map(m => m.el.getBoundingClientRect().top - base);
  }
  const y = main.scrollTop + ($('#ferr')?.offsetHeight || 0) + 30;
  let lo = 0, hi = estado.tops.length - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (estado.tops[mid] <= y) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  const partes = []; let min = 99, art = null;
  for (let j = k; j >= 0 && min > 0; j--) {
    const m = estado.marcos[j];
    if (m.niv === 9) { if (!art && min === 99) art = m; continue; }
    if (m.niv < min) { partes.unshift(m); min = m.niv; }
  }
  if (art) partes.push(art);
  // ancestrais em forma curta ("CAPÍTULO II"); o título mais próximo por extenso
  const titulo = (m, i) => i < partes.length - (art ? 2 : 1) ? m.rot.split(' — ')[0] : m.rot;
  const html = partes.map((m, i) => i === partes.length - 1 ? `<b>${esc(titulo(m, i))}</b>` : `<a href="#${estado.id}/${m.el.id}">${esc(titulo(m, i))}</a>`).join('<span aria-hidden="true">›</span>');
  if (html !== estado.trilhaHTML) { tr.innerHTML = html || 'Início do texto'; estado.trilhaHTML = html; }
  if (k >= 0) {
    const ref = estado.marcos[k], i = +ref.el.dataset.i;
    if (POS[estado.id]?.i !== i) { POS[estado.id] = { i, rot: art ? art.rot : ref.rot }; salvarPos(); }
  }
}
let tTrilha = 0;
main.addEventListener('scroll', () => {
  if (!tTrilha) tTrilha = setTimeout(() => { tTrilha = 0; atualizarTrilha(); }, 80);
  $$('.flutuante').forEach(f => !['leitura', 'grifo'].includes(f.dataset.nome) && f.remove());
}, { passive: true });
addEventListener('resize', () => { estado.tops = null; });

// ---------- ações por artigo ----------
function textoArtigo(p) {
  const linhas = [];
  for (let el = p; el; el = el.nextElementSibling) {
    if (el !== p && el.tagName === 'P' && (el.id.startsWith('a') || el.classList.contains('h'))) break;
    if (el.tagName !== 'P' || (!PREF.rev && el.classList.contains('rev'))) continue;
    const c = el.cloneNode(true);
    c.querySelectorAll('a:not(.rem)' + (PREF.rev ? '' : ', s')).forEach(x => x.remove());
    const t = c.textContent.replace(/\s+/g, ' ').trim();
    if (t) linhas.push(t);
  }
  return linhas.join('\n');
}
function menuArtigo(p, btn) {
  if ($('.flutuante[data-nome="art"]') && btn.getAttribute('aria-expanded') === 'true') return fecharFlutuantes();
  const k = estado.id + '/' + p.id, rot = rotulo(p.id, estado.id), sigla = porId[estado.id].sigla;
  const pop = flutuante('art', btn, 'menu');
  pop.setAttribute('role', 'menu');
  pop.innerHTML = `<div class="titulo-menu">${esc(sigla)} — ${esc(rot)}</div>
    <button role="menuitemcheckbox" aria-checked="${!!EST.ok[k]}" data-a="ok"><span class="i ok">✓</span>${EST.ok[k] ? 'Estudado (desmarcar)' : 'Marcar como estudado'}</button>
    <button role="menuitemcheckbox" aria-checked="${!!EST.fav[k]}" data-a="fav"><span class="i fav">★</span>${EST.fav[k] ? 'Favorito (remover)' : 'Favoritar'}</button>
    <button role="menuitem" data-a="nota"><span class="i">✎</span>${EST.notas[k] ? 'Editar anotação' : 'Anotar'}</button>
    <button role="menuitem" data-a="copiar"><span class="i">⧉</span>Copiar texto com a citação</button>
    <button role="menuitem" data-a="link"><span class="i">⛓</span>Copiar link do artigo</button>`;
  pop.posicionar();
  pop.querySelector('button').focus();
  pop.addEventListener('keydown', e => {
    const bs = $$('button', pop), i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); }
  });
  pop.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a; if (!a) return;
    fecharFlutuantes();
    if (a === 'ok' || a === 'fav') {
      if (EST[a][k]) delete EST[a][k]; else EST[a][k] = Date.now();
      p.classList.toggle(a, !!EST[a][k]); salvarEst();
      if (a === 'ok') { atualizarProgressoNorma(); desenharLista(); }
      toast(a === 'ok' ? (EST.ok[k] ? `${rot} marcado como estudado` : 'Marcação removida') : (EST.fav[k] ? `${rot} nos favoritos` : 'Removido dos favoritos'));
    }
    if (a === 'copiar') copiar(`${textoArtigo(p)}\n(${sigla}, ${rot.replace(/^Art\./, 'art.')})`);
    if (a === 'link') copiar(location.href.split('#')[0] + '#' + estado.id + '/' + p.id);
    if (a === 'nota') caixaNota(p, true); else btn.focus();
  });
}
function caixaNota(p, foco) {
  const k = estado.id + '/' + p.id;
  let box = p.nextElementSibling?.classList.contains('nota') ? p.nextElementSibling : null;
  if (!box) {
    box = document.createElement('div'); box.className = 'nota';
    box.innerHTML = `<span class="nota-rot">✎ Nota</span><textarea rows="1" aria-label="Anotação sobre ${esc(rotulo(p.id, estado.id))}" placeholder="Escreva sua anotação (salva automaticamente)…"></textarea><button type="button" class="nota-x" aria-label="Excluir anotação" title="Excluir anotação">×</button>`;
    p.after(box);
    const ta = box.querySelector('textarea');
    ta.value = EST.notas[k]?.t || '';
    const ajustar = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    const gravar = () => { if (ta.value.trim()) EST.notas[k] = { t: ta.value, ts: Date.now() }; else delete EST.notas[k]; salvarEst(); };
    const gravarDepois = debounce(gravar, 400);
    ta.addEventListener('input', () => { ajustar(); gravarDepois(); });
    ta.addEventListener('blur', () => { gravar(); if (!ta.value.trim()) box.remove(); });
    box.querySelector('.nota-x').addEventListener('click', () => {
      if (ta.value.trim() && !confirm('Excluir esta anotação?')) return;
      ta.value = ''; delete EST.notas[k]; salvarEst(); box.remove();
    });
    setTimeout(ajustar);
  }
  if (foco) box.querySelector('textarea').focus();
}

// ---------- grifos ----------
// guardados por bloco: {g: id do grifo, i: bloco, s/e: posições no texto do bloco, c: cor, t: trecho}
const CORES = [['1', 'Amarelo'], ['2', 'Verde'], ['3', 'Azul'], ['4', 'Rosa']];
function blocoDe(no) { return (no.nodeType === 1 ? no : no.parentElement)?.closest('#txt p[data-i]'); }
function posicaoEm(p, no, off) { const r = document.createRange(); r.selectNodeContents(p); r.setEnd(no, off); return r.toString().length; }
function envolver(p, s, e, preparar) {
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT), nos = [];
  while (w.nextNode()) nos.push(w.currentNode);
  let pos = 0;
  for (const no of nos) {
    const ini = pos, fim = pos + no.length; pos = fim;
    const a = Math.max(s, ini), b = Math.min(e, fim);
    if (a >= b) continue;
    let alvo = no;
    if (a > ini) alvo = alvo.splitText(a - ini);
    if (b < fim) alvo.splitText(b - a);
    const m = document.createElement('mark'); preparar(m); alvo.replaceWith(m); m.append(alvo);
  }
}
function localizarGrifo(gr) {
  const i = +gr.i; if (!Number.isFinite(i)) return null;
  const p = $(`#txt p[data-i="${i}"]`);
  if (p && p.textContent.slice(gr.s, gr.e) === gr.t) return [p, gr.s, gr.e];
  for (let d = 0; d <= 6; d++) for (const j of [i + d, i - d]) {  // texto mudou de posição: procura por perto
    const q = $(`#txt p[data-i="${j}"]`), k = q && gr.t ? q.textContent.indexOf(gr.t) : -1;
    if (k >= 0) return [q, k, k + gr.t.length];
  }
  return null;
}
function aplicarGrifos() {
  for (const gr of EST.grifos[estado.id] || []) {
    const r = localizarGrifo(gr); if (!r) continue;
    envolver(r[0], r[1], r[2], m => { m.className = 'g g' + (+gr.c || 1); m.dataset.g = gr.g; m.title = 'Grifo — clique para trocar a cor ou remover'; });
  }
}
function criarGrifo(cor) {
  const r = estado.faixa; if (!r) return;
  let pIni = blocoDe(r.startContainer), pFim = blocoDe(r.endContainer);
  const todos = $$('#txt p[data-i]').filter(p => r.intersectsNode(p));
  pIni ||= todos[0]; pFim ||= todos[todos.length - 1];
  if (!pIni || !pFim) return;
  const g = Date.now().toString(36), lista = EST.grifos[estado.id] ||= [];
  for (let i = +pIni.dataset.i; i <= +pFim.dataset.i; i++) {
    const p = $(`#txt p[data-i="${i}"]`); if (!p || p.offsetParent === null) continue;
    const s = p.contains(r.startContainer) ? posicaoEm(p, r.startContainer, r.startOffset) : 0;
    const e = p.contains(r.endContainer) ? posicaoEm(p, r.endContainer, r.endOffset) : p.textContent.length;
    const t = p.textContent.slice(s, e);
    if (t.trim()) lista.push({ g, i, s, e, c: cor, t });
  }
  salvarEst(); getSelection().removeAllRanges(); pintar();
}
function editarGrifo(g, cor) {
  const lista = EST.grifos[estado.id] || [];
  if (cor) lista.forEach(x => { if (x.g === g) x.c = cor; });
  else EST.grifos[estado.id] = lista.filter(x => x.g !== g);
  if (!EST.grifos[estado.id].length) delete EST.grifos[estado.id];
  salvarEst(); pintar();
}
function barraGrifo(g) {
  let bar = $('.flutuante[data-nome="grifo"]');
  if (!bar) { bar = document.createElement('div'); bar.className = 'flutuante barra-grifo'; bar.dataset.nome = 'grifo'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Grifo'); document.body.append(bar); }
  bar.dataset.g = g || '';
  bar.innerHTML = `<span class="rot-barra">${g ? 'Grifo' : 'Grifar'}</span>${CORES.map(([c, n]) => `<button class="cor g${c}" data-cor="${c}" aria-label="${n}" title="${n}"></button>`).join('')}
    ${g ? '<button class="btn-txt" data-acao="remover">Remover</button>' : '<button class="btn-txt" data-acao="copiar">Copiar</button>'}<button class="btn-txt" data-acao="fechar" aria-label="Fechar">✕</button>`;
  bar.onmousedown = e => e.preventDefault();  // não desfaz a seleção ao clicar
  bar.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cor) g ? editarGrifo(g, b.dataset.cor) : criarGrifo(b.dataset.cor);
    else if (b.dataset.acao === 'remover') editarGrifo(g);
    else if (b.dataset.acao === 'copiar' && estado.faixa) copiar(`${estado.faixa.toString().trim()}\n(${porId[estado.id].sigla})`);
    bar.remove(); estado.faixa = null;
  };
}
document.addEventListener('selectionchange', debounce(() => {
  const bar = $('.flutuante[data-nome="grifo"]'), sel = getSelection(), txt = $('#txt');
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  const valida = txt && r && !sel.isCollapsed && txt.contains(r.commonAncestorContainer) && r.toString().trim()
    && !(r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement).closest('.nota, .flutuante');
  if (valida) { estado.faixa = r.cloneRange(); barraGrifo(null); }
  else if (bar && !bar.dataset.g && sel.isCollapsed && !matchMedia('(hover: none)').matches) bar.remove();  // no toque, a seleção some ao tocar na barra
}, 300));

// ---------- prévia das remissões ----------
let tPrevia, tFecha;
function trechoArtigo(d, i) {
  const out = [];
  for (let j = i; j < d.b.length && out.length < 14; j++) {
    const [id, cls, h] = d.b[j];
    if (j > i && (id[0] === 'a' || cls.includes('h'))) break;
    if (cls.includes('rev') && !PREF.rev) continue;
    out.push(`<p class="${esc(cls)}">${h}</p>`);
  }
  return out.join('');
}
async function previa(a) {
  const [nid, chave] = a.dataset.alvo.split('/');
  const pop = flutuante('previa', a, 'previa');
  pop.addEventListener('mouseenter', () => clearTimeout(tFecha));
  pop.addEventListener('mouseleave', () => { tFecha = setTimeout(() => pop.remove(), 200); });
  pop.innerHTML = '<p class="meta" style="padding:10px 14px">Carregando…</p>'; pop.posicionar();
  const d = await carregar(nid).catch(() => null);
  if (!pop.isConnected) return;
  const i = d?.idx.get(chave);
  pop.innerHTML = `<div class="previa-cab"><b>${esc(porId[nid].sigla)} — ${esc(rotulo(chave, nid))}</b><a href="#${nid}/${chave}">Abrir ›</a></div>`
    + (i == null ? '<p class="meta" style="padding:8px 14px">Dispositivo não encontrado neste texto.</p>' : `<div class="previa-txt">${trechoArtigo(d, i)}</div>`);
  pop.posicionar();
}
col.addEventListener('mouseover', e => {
  const a = e.target.closest('a.rem'); if (!a || !matchMedia('(hover: hover)').matches) return;
  clearTimeout(tFecha); clearTimeout(tPrevia); tPrevia = setTimeout(() => previa(a), 350);
});
col.addEventListener('mouseout', e => {
  if (!e.target.closest('a.rem')) return;
  clearTimeout(tPrevia); tFecha = setTimeout(() => $('.flutuante[data-nome="previa"]')?.remove(), 250);
});

// cliques dentro do texto: menu do artigo, grifo existente, remissão
col.addEventListener('click', e => {
  const rot = e.target.closest('.txt .rot');
  if (rot) return menuArtigo(rot.closest('p'), rot);
  const g = e.target.closest('mark.g');
  if (g && getSelection().isCollapsed) { estado.faixa = null; return barraGrifo(g.dataset.g); }
  const a = e.target.closest('a.rem, .trilha a, .previa a');
  if (a && estado.id && POS[estado.id]) history.replaceState(null, '', `#${estado.id}/p${POS[estado.id].i}`);  // "voltar" retorna a este ponto
});

// ---------- busca em todas as normas ----------
let buscaSeq = 0;
function marcarPalavras(t, palavras) {
  const f = fold(t), faixas = [];
  for (const w of palavras) for (let i = f.indexOf(w); i >= 0; i = f.indexOf(w, i + w.length)) faixas.push([i, i + w.length]);
  faixas.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [a, b] of faixas) { if (a < pos) continue; out += esc(t.slice(pos, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>'; pos = b; }
  return out + esc(t.slice(pos));
}
async function telaBusca(q) {
  const seq = ++buscaSeq;
  $('#qglobal').value = q;
  const frase = q.trim().replace(/^["“]|["”]$/g, ''), ff = fold(frase);
  const palavras = [...new Set(ff.split(/\s+/).filter(w => w.length > 1))];
  col.innerHTML = `<p class="sobre">Busca em todas as normas</p>
    <form id="fbusca3" class="busca-grande" role="search"><input id="qglobal3" type="search" value="${esc(q)}" placeholder="Palavras ou trecho — ex.: justa causa" aria-label="Buscar em todas as normas" autocomplete="off"></form>
    <p class="meta" id="prog">${palavras.length ? 'Carregando textos…' : 'Digite palavras (todas precisam aparecer no mesmo dispositivo). Entre aspas, busca o trecho exato.'}</p>
    <div class="filtros" id="filtros"></div><div id="res"></div>`;
  $('#fbusca3').addEventListener('submit', e => { e.preventDefault(); location.hash = 'busca:' + encodeURIComponent($('#qglobal3').value.trim()); });
  if (!palavras.length) return $('#qglobal3').focus();
  let feitos = 0;
  await Promise.all(comTexto.map(n => carregar(n.id).catch(() => null).then(() => {
    if (seq === buscaSeq && $('#prog')) $('#prog').textContent = `Carregando textos… ${++feitos}/${comTexto.length}`;
  })));
  if (seq !== buscaSeq) return;
  const exata = /^["“].*["”]$/.test(q.trim());
  const grupos = [];
  let total = 0;
  for (const n of comTexto) {
    const d = cache[n.id]; if (!d) continue;
    d.p ||= d.b.map(b => plano(b[2]));
    d.f ||= d.p.map(fold);
    let rot = '';
    const itens = [];
    d.b.forEach((b, i) => {
      if (b[0][0] === 'a') rot = rotulo(b[0], n.id);
      if (!PREF.rev && b[1].includes('rev')) return;
      const f = d.f[i];
      const temFrase = f.includes(ff);
      if (exata ? !temFrase : !palavras.every(w => f.includes(w))) return;
      itens.push({ i, rot, temFrase });
    });
    if (!itens.length) continue;
    itens.sort((a, b) => b.temFrase - a.temFrase);
    total += itens.length;
    grupos.push({ n, itens, d });
  }
  const disc = I.disciplinas.filter(x => grupos.some(g => g.n.disc.includes(x)));
  $('#prog').textContent = total ? `${total} dispositivo${total > 1 ? 's' : ''} em ${grupos.length} norma${grupos.length > 1 ? 's' : ''}${PREF.rev ? '' : ' (sem textos revogados)'}.` : 'Nada encontrado. Tente menos palavras ou sem aspas.';
  $('#filtros').innerHTML = disc.length > 1 ? `<button class="chip ativo" data-f="">Todas</button>${disc.map(x => `<button class="chip" data-f="${esc(x)}">${esc(x)}</button>`).join('')}` : '';
  const item = (g, it) => {
    const t = g.d.p[it.i], f = g.d.f[it.i];
    let k = it.temFrase ? f.indexOf(ff) : Math.min(...palavras.map(w => f.indexOf(w)));
    const ini = Math.max(0, k - 90);
    const trecho = (ini ? '…' : '') + marcarPalavras(t.slice(ini, k + 220), it.temFrase ? [ff] : palavras) + (k + 220 < t.length ? '…' : '');
    return `<a class="res" href="#${g.n.id}/p${it.i}" data-q="${esc(it.temFrase ? frase : palavras.reduce((a, b) => b.length > a.length ? b : a))}"><em>${esc(it.rot || 'Preâmbulo')}</em>${trecho}</a>`;
  };
  $('#res').innerHTML = grupos.map(g => `<section class="grupo-res" data-disc="${esc(g.n.disc.join('|'))}">
    <h2><span>${esc(g.n.sigla)} <span class="meta">· ${g.itens.length}</span></span><a href="#${g.n.id}" data-q="${esc(frase)}">abrir a norma ›</a></h2>
    ${g.itens.slice(0, 12).map(it => item(g, it)).join('')}
    ${g.itens.length > 12 ? `<details class="mais"><summary>mais ${g.itens.length - 12}</summary>${g.itens.slice(12, 200).map(it => item(g, it)).join('')}</details>` : ''}
  </section>`).join('');
  $('#res').addEventListener('click', e => { const a = e.target.closest('a[data-q]'); if (a) buscaPendente = a.dataset.q; });
  $('#filtros').addEventListener('click', e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    $$('#filtros .chip').forEach(c => c.classList.toggle('ativo', c === b));
    $$('.grupo-res').forEach(s => { s.hidden = b.dataset.f && !s.dataset.disc.split('|').includes(b.dataset.f); });
  });
}
$('#fbusca').addEventListener('submit', e => { e.preventDefault(); location.hash = 'busca:' + encodeURIComponent($('#qglobal').value.trim()); });

// ---------- meu estudo ----------
async function telaEstudo() {
  const ids = new Set([...Object.keys(EST.fav), ...Object.keys(EST.notas)].map(k => k.split('/')[0]).concat(Object.keys(EST.grifos)));
  col.innerHTML = `<p class="sobre">Meu estudo</p><h1>Favoritos, anotações e grifos</h1>
    <p class="meta">Tudo fica guardado neste navegador. Exporte de vez em quando para não perder (limpeza do navegador apaga) e para levar a outro computador.</p>
    <div class="acoes"><button class="btn prim" id="exportar">Exportar backup (.json)</button><label class="btn" for="importar">Importar backup</label><input type="file" id="importar" accept=".json,application/json" hidden><button class="btn" id="apagar">Apagar tudo</button></div>
    <div id="conteudo-estudo"><p class="meta">Carregando…</p></div>`;
  $('#exportar').addEventListener('click', exportar);
  $('#importar').addEventListener('change', e => e.target.files[0] && importar(e.target.files[0]));
  $('#apagar').addEventListener('click', () => {
    if (!confirm('Apagar todas as marcações deste navegador (estudados, favoritos, anotações, grifos e edital)? Não dá para desfazer — exporte antes se quiser guardar.')) return;
    for (const k of ['fav', 'ok', 'notas', 'grifos', 'edital']) EST[k] = {};
    salvarEst(); toast('Marcações apagadas'); telaEstudo();
  });
  await Promise.all([...ids].filter(id => porId[id]).map(id => carregar(id).catch(() => null)));
  if (!$('#conteudo-estudo')) return;
  const textoDe = k => {
    const [id, chave] = k.split('/'), d = cache[id], i = d?.idx.get(chave);
    return i == null ? '' : plano(d.b[i][2]);
  };
  const porNorma = obj => {
    const g = {};
    for (const k of Object.keys(obj)) { const id = k.split('/')[0]; if (porId[id]) (g[id] ||= []).push(k); }
    return Object.entries(g).sort((a, b) => I.normas.indexOf(porId[a[0]]) - I.normas.indexOf(porId[b[0]]));
  };
  const ordemArt = (a, b) => (cache[a.split('/')[0]]?.idx.get(a.split('/')[1]) ?? 0) - (cache[b.split('/')[0]]?.idx.get(b.split('/')[1]) ?? 0);
  const favs = porNorma(EST.fav), notas = porNorma(EST.notas);
  const grifos = Object.entries(EST.grifos).filter(([id]) => porId[id]);
  const estudados = I.normas.filter(n => n.arts && contar('ok', n.id));
  $('#conteudo-estudo').innerHTML = `
    <h2>★ Favoritos (${Object.keys(EST.fav).length})</h2>
    ${favs.length ? favs.map(([id, ks]) => ks.sort(ordemArt).map(k => `<a class="item-estudo" href="#${esc(k)}"><em>${esc(porId[id].sigla)} — ${esc(rotulo(k.split('/')[1], id))}</em><div class="t">${esc(textoDe(k).slice(0, 260))}</div></a>`).join('')).join('') : '<p class="vazio">Nenhum. Clique no número de um artigo e escolha “Favoritar”.</p>'}
    <h2>✎ Anotações (${Object.keys(EST.notas).length})</h2>
    ${notas.length ? notas.map(([id, ks]) => ks.sort(ordemArt).map(k => `<a class="item-estudo" href="#${esc(k)}"><em>${esc(porId[id].sigla)} — ${esc(rotulo(k.split('/')[1], id))}</em><div class="t">${esc(EST.notas[k].t)}</div></a>`).join('')).join('') : '<p class="vazio">Nenhuma.</p>'}
    <h2>Grifos (${grifos.reduce((s, [, l]) => s + new Set(l.map(g => g.g)).size, 0)})</h2>
    ${grifos.length ? grifos.map(([id, l]) => {
      const vistos = new Map();
      for (const g of [...l].sort((a, b) => a.i - b.i || a.s - b.s)) { const v = vistos.get(g.g); if (v) v.t += ' ' + g.t; else vistos.set(g.g, { ...g }); }
      return [...vistos.values()].map(g => `<a class="item-estudo" href="#${esc(id)}/p${+g.i}"><em>${esc(porId[id].sigla)}</em><div class="t"><mark class="g g${+g.c || 1}">${esc(g.t)}</mark></div></a>`).join('');
    }).join('') : '<p class="vazio">Nenhum. Selecione um trecho de qualquer norma para grifar.</p>'}
    <h2>✓ Artigos estudados por norma</h2>
    ${estudados.length ? `<div class="lista-progresso">${estudados.map(n => { const ok = contar('ok', n.id); return `<a href="#${n.id}"><span>${esc(n.sigla)}</span>${barra(pct(ok, n.arts))}<em>${ok}/${n.arts}</em></a>`; }).join('')}</div>` : '<p class="vazio">Nenhum ainda.</p>'}`;
}
function exportar() {
  const dados = { app: 'vade-mecum-trt4', versao: 1, exportado: new Date().toISOString(), estudo: EST, posicoes: POS };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 1)], { type: 'application/json' }));
  a.download = `vade-mecum-estudo-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importar(arq) {
  arq.text().then(t => {
    const j = JSON.parse(t), e = j && j.estudo;
    const objeto = v => v && typeof v === 'object' && !Array.isArray(v);
    if (j.app !== 'vade-mecum-trt4' || !objeto(e) || !['fav', 'ok', 'notas', 'grifos', 'edital'].every(k => objeto(e[k]))) throw new Error('não é um backup deste vade mecum');
    if (!confirm('Substituir as marcações deste navegador pelas do arquivo?')) return;
    for (const k of ['fav', 'ok', 'notas', 'grifos', 'edital']) EST[k] = e[k];
    for (const id in EST.grifos) if (!Array.isArray(EST.grifos[id])) delete EST.grifos[id];
    if (objeto(j.posicoes)) Object.assign(POS, j.posicoes);
    salvarEst(); guardar('pos', POS); toast('Backup importado'); telaEstudo();
  }).catch(err => toast('Não foi possível importar: ' + (err instanceof SyntaxError ? 'o arquivo não é um backup válido' : err.message)));
}

// ---------- rotas: #  #edital[/dN]  #estudo  #busca:termo  #norma[/a59|/p123|/t12] ----------
function rota() {
  const h = decodeURIComponent(location.hash.slice(1));
  fecharFlutuantes();
  document.body.classList.remove('menu-aberto');
  const aba = !h ? 'inicio' : h.startsWith('edital') ? 'edital' : h === 'estudo' ? 'estudo' : '';
  $$('.abas a').forEach(a => a.classList.toggle('ativa', a.dataset.aba === aba));
  desenharLista();
  const [id, alvo] = h.startsWith('busca:') ? [] : h.split('/');
  if (porId[id]) return telaNorma(id, alvo);
  sair(); buscaSeq++; main.scrollTop = 0;
  if (h.startsWith('busca:')) return telaBusca(h.slice(6));
  if (id === 'edital') return telaEdital(alvo);
  if (id === 'estudo') return telaEstudo();
  telaInicio();
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { fecharFlutuantes(); document.body.classList.remove('menu-aberto'); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select')) return;
  if (e.key === '/') { e.preventDefault(); const c = $('#qlocal') || $('#qglobal3') || $('#qglobal2') || $('#qglobal'); c.focus(); c.select?.(); }
  else if (e.key === 'g' && $('#art')) { e.preventDefault(); $('#art').focus(); }
});
addEventListener('hashchange', rota);
history.scrollRestoration = 'manual';  // a posição de leitura é restaurada pelo próprio app (POS)
aplicarPref();
rota();
