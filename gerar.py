"""Gera a pasta dados/ (textos usados pelo index.html) a partir das fontes oficiais listadas em normas.json.

Os textos de dados/ já foram gerados e conferidos com a data do edital (EDITAL abaixo). Só rode de novo
para reconstruir: as fontes trazem a versão vigente no dia, e o script lista as alterações de
EDITAL[:4] em diante para você conferir se são anteriores ao edital.

Uso:  python gerar.py            (todas)
      python gerar.py cf88 clt   (só as indicadas)
"""
import concurrent.futures as cf
import datetime as dt
import html
import io
import json
import re
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

import requests

BASE = Path(__file__).resolve().parent
TEXTOS = BASE / 'dados' / 'textos'
INDICE = BASE / 'dados' / 'indice.js'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VadeMecumTRT4/1.0'}
HOJE = dt.date.today().isoformat()
EDITAL = '2026-10-22'  # Edital nº 1/2026 (FCC), publicado no DOU
# anotações de alteração ("Redação dada pela Lei nº X, de 2026") a conferir contra a data do edital
ALTERACAO = re.compile(r'\([^()]*(?:Redação dada|redação dada|Incluíd|incluíd|Acrescid|acrescid|Revogad|revogad|'
                       r'Renumerad|alterad)[^()]*\b(20\d\d)\b[^()]*\)')

# ---------- download ----------

def baixar(url):
    r = requests.get(url, headers=UA, timeout=180)
    r.raise_for_status()
    return r


def decodificar(conteudo):
    m = re.search(rb'charset\s*=\s*["\']?([\w-]+)', conteudo[:4000], re.I)
    for enc in ([m.group(1).decode('ascii', 'ignore')] if m else []) + ['utf-8', 'cp1252']:
        if enc.lower() in ('iso-8859-1', 'latin1', 'latin-1'):
            enc = 'cp1252'  # Planalto declara latin-1 mas usa aspas/travessões do cp1252
        try:
            return conteudo.decode(enc)
        except (LookupError, UnicodeDecodeError):
            pass
    return conteudo.decode('cp1252', errors='replace')

# ---------- HTML -> blocos ----------
# Bloco = lista de trechos (texto, formatos); formatos = frozenset com 's','b','i','sup','sub' e ('a', href)

QUEBRA = {'p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'li', 'table', 'center',
          'blockquote', 'dd', 'dt', 'ul', 'ol', 'body', 'hr'}
IGNORAR = {'script', 'style', 'head', 'title', 'noscript', 'button', 'select', 'form', 'nav', 'iframe', 'svg'}
INLINE = {'strike': 's', 's': 's', 'del': 's', 'b': 'b', 'strong': 'b', 'i': 'i', 'em': 'i', 'sup': 'sup', 'sub': 'sub', 'a': 'a'}


class Limpador(HTMLParser):
    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base, self.blocos, self.trechos, self.pilha, self.ignorando = base, [], [], [], 0

    def fecha(self):
        if any(t.strip() for t, _ in self.trechos):
            self.blocos.append(self.trechos)
        self.trechos = []

    def formatos(self):
        f = set()
        for _, fmt, href in self.pilha:
            if fmt == 'a':
                if href and re.match(r'(https?:|\.|/|[\w-]+\.htm)', href, re.I):
                    f.add(('a', urljoin(self.base, href)))
            elif fmt:
                f.add(fmt)
        return frozenset(f)

    def handle_starttag(self, tag, attrs):
        if tag in IGNORAR:
            self.ignorando += 1
        elif tag in QUEBRA:
            self.fecha()
        elif tag in ('td', 'th') and self.trechos:
            self.trechos.append(('  │  ', frozenset()))
        a = dict(attrs)
        if tag in INLINE or tag in ('span', 'font'):
            # Planalto também marca texto revogado com style="text-decoration:line-through"
            fmt = 's' if 'line-through' in (a.get('style') or '') else INLINE.get(tag)
            self.pilha.append((tag, fmt, a.get('href')))

    def handle_endtag(self, tag):
        if tag in IGNORAR:
            self.ignorando = max(0, self.ignorando - 1)
        elif tag in QUEBRA:
            self.fecha()
        if tag in INLINE or tag in ('span', 'font'):
            for i in range(len(self.pilha) - 1, -1, -1):
                if self.pilha[i][0] == tag:
                    del self.pilha[i]
                    break

    def handle_data(self, d):
        if not self.ignorando:
            self.trechos.append((d, self.formatos()))


CABECALHO = re.compile(r'^(Presidência da República|Casa Civil|Subchefia para Assuntos Jurídicos|'
                       r'Secretaria(-Geral| Especial)?( para| de)? Assuntos Jurídicos|Secretaria-Geral)$')


def html_blocos(texto, base, corte):
    if corte:
        ini, fim = corte
        if ini and ini in texto:
            i = texto.find(ini)
            texto = texto[max(0, texto.rfind('<', 0, i)):]
        if fim and fim in texto:
            texto = texto[:texto.find(fim)]
    p = Limpador(base)
    p.feed(texto)
    p.close()
    p.fecha()
    return [b for b in p.blocos if not CABECALHO.match(''.join(t for t, _ in b).strip())]

# ---------- PDF -> blocos ----------

MARCA = re.compile(r'^(Art(igo)?\.?\s*\d|ARTIGO\s+\d|§|Par[áa]grafo [úu]nico|[IVXLC]+\s*[-–—]\s|[a-z]\)\s|'
                   r'(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O|ANEXO|PRE[ÂA]MBULO)\b)')
ABREV = re.compile(r'\b(art|arts|n|nº|n\.º|inc|al|p|fl|fls|Res|Lei|Dec)\.$', re.I)


def linhas_pdf(pg):
    t = pg.extract_text() or ''
    ls = [l for l in t.splitlines() if l.strip()]
    # PDFs do Google Docs saem com uma palavra por linha no modo padrão; o modo layout os remonta
    # (o modo layout não é o padrão porque embaralha PDFs em duas colunas, como os da ONU/OEA)
    if ls and sum(len(l.split()) for l in ls) / len(ls) < 2.5:
        t = pg.extract_text(extraction_mode='layout') or ''
    return [re.sub(r'\s+', ' ', l).strip() for l in t.splitlines()]


def pdf_blocos(conteudo):
    from pypdf import PdfReader
    paginas = [linhas_pdf(pg) for pg in PdfReader(io.BytesIO(conteudo)).pages]
    freq = Counter(l for pg in paginas for l in set(pg) if l)
    repetidas = {l for l, n in freq.items() if n >= max(3, len(paginas) * 0.3) and 10 <= len(l) < 120}
    blocos, atual = [], ''
    for pg in paginas:
        for l in pg:
            if not l or l in repetidas or re.fullmatch(r'(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|/)\s*\d+)?', l, re.I):
                continue
            nova = MARCA.match(l) or (atual.endswith(('.', ':', ';')) and l[0].isupper() and not ABREV.search(atual))
            if atual and nova:
                blocos.append(atual)
                atual = l
            elif atual.endswith('-') and l[:1].islower():
                atual = atual[:-1] + l
            else:
                atual = f'{atual} {l}'.strip()
    if atual:
        blocos.append(atual)
    return [[(b, frozenset())] for b in blocos]

# ---------- blocos -> saída ----------

TITULO = re.compile(r'^(PARTE|LIVRO|T[ÍI]TULO|CAP[ÍI]TULO|SE[ÇC][ÃA]O|SUBSE[ÇC][ÃA]O|Parte|Livro|T[íi]tulo|'
                    r'Cap[íi]tulo|Se[çc][ãa]o|Subse[çc][ãa]o)\s+([IVXLCDM]+\b|[ÚU]NIC[OA]|PRELIMINAR|GERAL|ESPECIAL|\d+)')
NIVEL = {'PARTE': 0, 'LIVRO': 0, 'TITULO': 1, 'TÍTULO': 1, 'CAPITULO': 2, 'CAPÍTULO': 2,
         'SECAO': 3, 'SEÇÃO': 3, 'SUBSECAO': 4, 'SUBSEÇÃO': 4}
# "\.?" extra: o Planalto tem erros como "Art. . 189" na CLT
ARTIGO = re.compile(r'^(?:Art\.?|Artigo|ARTIGO|ART\.)\s*\.?\s*(\d+(?:\.\d{3})*|[IVXLC]+\b)\s*[º°o]?(?:\s?-([A-Z]{1,2})\b)?')


def normaliza(trechos):
    """Junta trechos vizinhos com o mesmo formato e normaliza espaços."""
    out = []
    for t, f in trechos:
        t = re.sub(r'[\s ​]+', ' ', t)
        if out and out[-1][1] == f:
            out[-1] = (out[-1][0] + t, f)
        elif t:
            out.append((t, f))
    while out and not out[0][0].strip():
        out.pop(0)
    while out and not out[-1][0].strip():
        out.pop()
    if out:
        out[0] = (out[0][0].lstrip(), out[0][1])
        out[-1] = (out[-1][0].rstrip(), out[-1][1])
    return out


def romano(s):
    v = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100}
    return sum(-v[c] if i + 1 < len(s) and v[s[i + 1]] > v[c] else v[c] for i, c in enumerate(s))


def html_trecho(t, f):
    s = html.escape(t, quote=False)
    for tag in ('sub', 'sup', 'i', 'b', 's'):
        if tag in f:
            s = f'<{tag}>{s}</{tag}>'
    href = next((x[1] for x in f if isinstance(x, tuple)), None)
    if href:
        s = f'<a href="{html.escape(href)}" target="_blank" rel="noopener">{s}</a>'
    return s


def montar(blocos):
    """Retorna (blocos [[id, classe, html]], sumário [[id, rótulo, nível]], texto p/ hash)."""
    saida, sumario, usados, plano = [], [], Counter(), []
    for trechos in blocos:
        trechos = normaliza(trechos)
        texto = ''.join(t for t, _ in trechos)
        if not texto.strip():
            continue
        plano.append(texto)
        rev = not ''.join(t for t, f in trechos if 's' not in f).strip()
        classes, ident = [], ''
        if rev:
            classes.append('rev')
        m = ARTIGO.match(texto)
        if m and not rev:
            num = m.group(1)
            num = str(romano(num)) if num[0] in 'IVXLC' else num.replace('.', '')
            chave = f'a{num}' + (f'-{m.group(2)}' if m.group(2) else '')
            usados[chave] += 1
            ident = chave if usados[chave] == 1 else f'{chave}_{usados[chave]}'
        elif len(texto) < 200 and not rev and (TITULO.match(texto) or (
                texto.isupper() and len(texto) > 3 and not re.search(r'[:.]$|\d{3}', texto))):
            classes.append('h')
            ident = f't{len(saida)}'
            t = TITULO.match(texto)
            nivel = NIVEL.get(t.group(1).upper(), 2) if t else 5
            # "CAPÍTULO I" + "DOS DIREITOS..." viram uma só entrada do sumário
            if re.search(r'\(Arts?\.', texto):
                pass  # linha do sumário impresso no próprio PDF (ex.: Regimento) — não duplica
            elif sumario and nivel == 5 and sumario[-1][2] < 5 and saida and saida[-1][0] == sumario[-1][0]:
                sumario[-1][1] += ' — ' + texto
            else:
                sumario.append([ident, texto, nivel])
        saida.append([ident, ' '.join(classes), ''.join(html_trecho(t, f) for t, f in trechos)])
    # índice impresso no início do documento (ex.: Regimento em PDF) duplicaria o sumário real
    art1 = next((i for i, b in enumerate(saida) if b[0].startswith('a')), len(saida))
    chave = lambda rot: ' '.join(re.sub(r'\(arts?\..*|[^\w\s]', ' ', rot.lower()).split()[:4])
    sumario = [s for k, s in enumerate(sumario) if int(s[0][1:]) > art1 or (
        s[1].upper() != 'SUMÁRIO' and all(chave(x[1]) != chave(s[1]) for x in sumario[k + 1:]))]
    return saida, sumario, '\n'.join(plano)

# ---------- por norma ----------


def localizar_pdf(n):
    r = baixar(n['pagina'])
    m = re.search(n['padrao'], r.text)
    if not m:
        raise RuntimeError('link do PDF não encontrado na página oficial')
    return urljoin(n['pagina'], html.unescape(m.group(0)))


def processar(n):
    url = localizar_pdf(n) if n.get('pagina') else n['url']
    r = baixar(url)
    pdf = n.get('tipo') == 'pdf' or r.content[:5] == b'%PDF-'
    blocos = pdf_blocos(r.content) if pdf else html_blocos(decodificar(r.content), url, n.get('corte'))
    saida, sumario, plano = montar(blocos)
    if len(saida) < 3:
        raise RuntimeError('texto vazio ou irreconhecível')
    marcar_pos_edital(saida, plano.split('\n'), n.get('pos_edital', []))
    conferir = sorted({m.group(0) for m in ALTERACAO.finditer(plano) if m.group(1) >= EDITAL[:4]})
    return url, saida, sumario, conferir


def marcar_pos_edital(saida, textos, trechos):
    """Marca com a classe 'pos' os blocos alterados depois do edital; o 1º bloco de cada trecho leva a nota."""
    for t in trechos:
        ini = next((i for i, x in enumerate(textos) if re.search(t['de'], x)), None)
        if ini is None:
            raise RuntimeError(f'trecho pós-edital não encontrado: {t["de"]}')
        fim = next((i for i in range(ini, len(textos)) if re.search(t['ate'], textos[i])), None) if t.get('ate') else ini
        if fim is None:
            raise RuntimeError(f'fim do trecho pós-edital não encontrado: {t["ate"]}')
        for i in range(ini, fim + 1):
            saida[i][1] = (saida[i][1] + ' pos').strip()
        saida[ini].append(t['nota'])


def main(ids):
    cat = json.loads((BASE / 'normas.json').read_text(encoding='utf-8-sig'))
    # metadados da geração anterior: mantêm as normas não regeradas numa execução parcial
    antes = {}
    if INDICE.exists():
        s = INDICE.read_text(encoding='utf-8')
        antes = {n['id']: n for n in json.loads(s[s.index('{'):s.rindex('}') + 1])['normas']}
    TEXTOS.mkdir(parents=True, exist_ok=True)
    alvo = [n for n in cat['normas'] if n.get('tipo') != 'link' and (not ids or n['id'] in ids)]
    meta = {i: {k: n.get(k) for k in ('fonte', 'obtido', 'arts', 'erro') if n.get(k) is not None} for i, n in antes.items()}
    falhas, a_conferir = 0, []
    with cf.ThreadPoolExecutor(6) as ex:
        futuros = {ex.submit(processar, n): n for n in alvo}
        for fut in cf.as_completed(futuros):
            n = futuros[fut]
            m = meta.setdefault(n['id'], {})
            try:
                url, saida, sumario, conferir = fut.result()
                dados = json.dumps({'b': saida, 's': sumario}, ensure_ascii=False, separators=(',', ':'))
                (TEXTOS / f"{n['id']}.js").write_text(f'VM_RECEBE({json.dumps(n["id"])},{dados});\n', encoding='utf-8')
                m.update(fonte=url, obtido=HOJE, arts=sum(b[0].startswith('a') for b in saida))
                m.pop('erro', None)
                a_conferir += [(n['id'], c) for c in conferir]
                print(f"ok   {n['id']:22} {len(saida):6} blocos")
            except Exception as e:
                falhas += 1  # o texto anterior (se houver) fica como estava
                m['erro'] = str(e)
                print(f"ERRO {n['id']:22} {e}")

    normas = [{**n, **meta.get(n['id'], {})} for n in cat['normas']]
    indice = {'edital': EDITAL, 'disciplinas': cat['disciplinas'], 'normas': normas}
    INDICE.write_text('var VM_INDICE = ' + json.dumps(indice, ensure_ascii=False) + ';\n', encoding='utf-8')
    if a_conferir:
        print(f'\nAlterações de {EDITAL[:4]} em diante — confira se são anteriores ao edital ({EDITAL}):')
        for i, c in sorted(set(a_conferir)):
            print(f'  {i:22} {c[:150]}')
    print(f'\n{len(alvo) - falhas}/{len(alvo)} normas ok. Abra index.html.')
    return 1 if alvo and falhas == len(alvo) else 0


if __name__ == '__main__':
    sys.exit(main(set(sys.argv[1:])))
