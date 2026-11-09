"""Autoteste offline do parser: python teste_atualizar.py"""
from gerar import html_blocos, montar

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
print('ok')
