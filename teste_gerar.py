"""Autoteste offline do parser: python teste_gerar.py"""
from gerar import html_blocos, montar, recortar

HTML = """
<p>Presidência da República</p>
<p align="center">CAPÍTULO II</p><p align="center">DA DURAÇÃO DO TRABALHO</p>
<p><strike>Art. 59 - A duração normal antiga.</strike></p>
<p>Art. 59. A duração diária <a href="L13467.htm#art1">(Redação dada pela Lei nº 13.467, de 2017)</a></p>
<p><span style="text-decoration:line-through">§ 4º Texto revogado.</span></p>
<p>Art. 59-A. Em exceção ao disposto no art. 59.</p>
<p>Art. 1.072. Revogam-se.</p>
<p>ARTIGO XII</p>
<p>Art. 1º Primeira ocorrência.</p><p>Art. 1º Segunda ocorrência.</p>
"""

blocos, sumario, _ = montar(html_blocos(HTML, 'https://www.planalto.gov.br/ccivil_03/leis/x.htm', None))
ids = [b[0] for b in blocos]
assert not any('Presidência' in b[2] for b in blocos), 'cabeçalho do Planalto não removido'
assert blocos[2][1] == 'rev' and blocos[2][0] == '', 'parágrafo tachado deve ser revogado e sem âncora'
assert 'a59' in ids and 'a59-A' in ids and 'a1072' in ids and 'a12' in ids, ids
assert 'a1' in ids and 'a1_2' in ids, 'repetição de artigo deve virar a1_2'
assert any(b[1] == 'rev' and '§ 4º' in b[2] for b in blocos), 'line-through deve contar como revogado'
assert sumario[0][1] == 'CAPÍTULO II — DA DURAÇÃO DO TRABALHO', sumario
assert 'href="https://www.planalto.gov.br/ccivil_03/leis/L13467.htm#art1"' in blocos[3][2], 'link relativo não resolvido'

# recorte: decreto que promulga tratado — fica só o texto do tratado, sem considerandos nem fecho
TRATADO = """
<p>DECRETO Nº 1, DE 1º DE JANEIRO DE 2000</p><p>Promulga a Convenção X.</p>
<p>O PRESIDENTE DA REPÚBLICA, no uso da atribuição, DECRETA:</p>
<p>Art. 1º A Convenção X, apensa por cópia ao presente Decreto, será executada e cumprida.</p>
<p>Art. 2º Este Decreto entra em vigor na data de sua publicação.</p>
<p>Brasília, 1º de janeiro de 2000.</p><p>FERNANDO HENRIQUE CARDOSO</p>
<p>CONVENÇÃO X</p><p>Os Estados Partes,</p><p>Considerando que a dignidade é inerente;</p><p>Acordaram o seguinte:</p>
<p>PARTE I</p><p>Artigo 1</p><p>1. Texto do artigo.</p><p>Artigo 2</p><p>2. Outro texto.</p>
<p>Em fé do quê, os abaixo-assinados assinaram.</p><p>*</p>
"""
b, _, plano = montar(recortar(html_blocos(TRATADO, 'https://x/', None)))
assert plano.split('\n') == ['PARTE I', 'Artigo 1', '1. Texto do artigo.', 'Artigo 2', '2. Outro texto.'], plano
assert [x[0] for x in b if x[0].startswith('a')] == ['a1', 'a2'], 'o Artigo 1 do tratado deve virar a1'

# lei comum: começa no CAPÍTULO logo acima do art. 1º e termina antes de local/data e assinaturas
LEI = """<p>LEI Nº 9, DE 2 DE MAIO DE 2000.</p><p>Mensagem de veto</p><p>Dispõe sobre X.</p>
<p>O PRESIDENTE DA REPÚBLICA Faço saber que o Congresso Nacional decreta e eu sanciono a seguinte Lei:</p>
<p>CAPÍTULO I</p><p>DISPOSIÇÕES GERAIS</p><p>Art. 1º Esta Lei dispõe sobre X.</p><p>Art. 2º Vigência.</p>
<p>Brasilia, 2 de maio de 2000.</p><p>MAURO BENEVIDES</p><p>Este texto não substitui o publicado no DOU</p>"""
_, _, plano = montar(recortar(html_blocos(LEI, 'https://x/', None)))
assert plano.split('\n') == ['CAPÍTULO I', 'DISPOSIÇÕES GERAIS', 'Art. 1º Esta Lei dispõe sobre X.', 'Art. 2º Vigência.'], plano
print('ok')
