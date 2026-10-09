# Criador de Mapas e Memoriais

Gera a **planta** (A4, em escala real) e o **memorial descritivo** de um imóvel a partir das coordenadas dos vértices.
Feito para o Cartório do 1º Ofício de Morrinhos/GO.

## Como usar

Abra `index.html` no navegador, com dois cliques. Não precisa de internet nem de instalação.

1. Cole as coordenadas (ou use **Importar arquivo…** / arraste o arquivo para a caixa).
2. Preencha lote, quadra, rua, setor, proprietário e responsável técnico.
3. Marque qual lado é a frente e, se quiser, os confrontantes de cada lado.
4. **Imprimir** — ou "Salvar como PDF" na janela de impressão.

**Salvar…** guarda o imóvel num `.json` para abrir depois.

## Coordenadas aceitas

O tipo é reconhecido sozinho; se precisar, escolha em "Tipo de coordenada".

| Tipo | Exemplos |
|---|---|
| UTM | `A 701200,00 8039500,00` · `N 8039500 E 701200` · `22K 701200 8039500` · `22 K 701200.00 m E 8039500.00 m S` |
| Geodésicas decimais | `-17,7225110 -49,1026540` · `17.7225110 S 49.1026540 W` |
| Graus, minutos e segundos | `17°43'21,04"S 49°06'09,55"W` · `-17 43 21.04 -49 06 09.55` · `17:43:21.04S` |
| Graus e minutos | `17°43,3507'S 49°06,1592'W` |
| GNSS (NMEA) | `$GPGGA,…,1743.3507,S,04906.1592,W,…` |
| Geocêntricas | `X Y Z` (cartesianas, saída de processamento GNSS) |
| Planilhas com cabeçalho | `Ponto;Este;Norte`, exportação Emlid, relatório do SIGEF (colunas de sigma são ignoradas) |
| Arquivos | KML (Google Earth), GPX, CSV, TXT |
| Locais | `X Y` em metros, sem georreferência |

- **Datum:** SIRGAS 2000 por padrão. WGS 84 (GPS/GNSS, KML, GPX) é usado como SIRGAS 2000, porque a diferença é de decímetros.
  **SAD 69** e **Córrego Alegre** são convertidos para SIRGAS 2000 com os parâmetros do IBGE (R.PR 1/2005).
  O datum escrito no texto ("SAD-69", "SIRGAS 2000 / UTM zone 22S") é reconhecido.
- **Fuso UTM:** lido da linha (`22K`), da coluna "Fuso" ou do texto; senão vale o escolhido na tela (padrão 22 Sul).
  Para coordenadas geodésicas, o fuso é calculado.
- **"22S" quer dizer fuso 22 Sul**, como se usa no Brasil (na nomenclatura internacional S seria uma banda do hemisfério norte).
- **Medidas e área** são calculadas no plano UTM ou, se escolhido, no plano topográfico local (com a altitude lida ou informada).

## Testes

Abra `tests/testes.html` no navegador. Cada formato da tabela acima tem um caso ali, e todos convertem o mesmo ponto
de Morrinhos; a conversão UTM confere com um ponto de referência publicado (Torre Eiffel, 31N 448252 5411933).

## Estrutura

Sem build e sem dependências: HTML e JavaScript clássico, para abrir direto do disco.

```
index.html          tela e estilos
js/util.js          números, extenso, datas, CPF/CNPJ
js/geodesia.js      elipsoides, datums, UTM, geocêntricas, plano local
js/coordenadas.js   leitura de todos os formatos de coordenada
js/app.js           formulário, desenho da planta e memorial
tests/testes.html   testes da leitura de coordenadas e da geodésia
```
