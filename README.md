# Vade Mecum — AJ-AJ TRT4

Vade mecum de estudo para o concurso de **Analista Judiciário — Área Judiciária do TRT da 4ª Região** (Edital nº 1/2026, FCC, publicado em 22/10/2026). Reúne a legislação do conteúdo programático, com texto integral obtido das fontes oficiais e fixado na data do edital.

**Acesse:** https://harvesteroe.github.io/vade-mecum/ (ou abra `index.html` direto do disco; funciona sem internet).

> Material de estudo não oficial. Na dúvida, confira o texto na fonte oficial indicada em cada norma.

## O que tem

- **68 normas com texto integral**: CF/88, CLT, CC, CPC, Lei 8.112, Lei 14.133, LGPD, LAI, tratados de direitos humanos, resoluções do CNJ e do CSJT, Regimento Interno e Código de Conduta do TRT4, entre outras. Mais **7 atalhos** para conteúdo só disponível em pesquisa online (súmulas do TST, súmulas vinculantes, teses de repercussão geral etc.).
- **Edital verticalizado**: os 243 tópicos do conteúdo programático, com caixa de "estudado" e atalhos que abrem a lei no artigo certo.
- **Ferramentas de estudo**, salvas no navegador:
  - clique no número do artigo para marcar como estudado, favoritar, anotar ou copiar com a citação;
  - selecione um trecho para grifar em quatro cores;
  - progresso por norma e por disciplina;
  - backup em "Meu estudo" (exportar e importar `.json`).
- **Leitura**:
  - remissões clicáveis ("art. 482"), com prévia do artigo ao passar o mouse;
  - trilha de localização (Título › Capítulo › Art.);
  - sumário filtrável;
  - "ir para artigo" (`g`) e busca na norma ou em todas (`/`), sem precisar de acentos;
  - temas claro, sépia e escuro;
  - opção de ocultar o texto revogado e as notas de alteração;
  - layout para celular.

Cada texto vai direto à redação da norma: ficam de fora a ementa, os "considerando", o decreto que promulga o tratado, o local e a data, as assinaturas e os anexos em tabela. O Preâmbulo da CF e os anexos da Res. CNJ 351 foram mantidos.

## Data de corte

Os textos refletem a legislação vigente em **22/10/2026**. Todas as alterações de 2026 encontradas nas fontes (leis, ECs 139 a 141, resoluções CNJ e CSJT) foram conferidas e são anteriores a essa data.

O edital cobra o **Regimento Interno até a RA 31/2026 (Assento 04/2026)**, mas o TRT4 retirou essa versão do site. Por isso o texto usado é o consolidado até a RA 41/2026, com os trechos alterados pelos Assentos 05 e 06/2026 marcados em âmbar.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html`, `assets/` | o leitor (HTML, CSS e JS puros, sem dependências) |
| `edital.js` | conteúdo programático e atalhos para os artigos |
| `normas.json` | catálogo: cada norma, sua disciplina e a URL oficial |
| `dados/` | textos já processados (gerados por `gerar.py`) |
| `gerar.py` | reconstrói `dados/` a partir das fontes oficiais (Python 3 + `requests` + `pypdf`) |
| `teste_gerar.py` | autoteste do processamento dos textos |

Para incluir uma norma: acrescente-a em `normas.json` e rode `python gerar.py <id>`. O script lista as alterações de 2026 em diante, para você conferir se são anteriores ao edital.
