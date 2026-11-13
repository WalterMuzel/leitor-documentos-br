# leitor-documentos

Motor de leitura local de documentos brasileiros — OCR (Tesseract + PaddleOCR) e regras, **sem IA**. Recebe um PDF ou foto e devolve:

1. **o tipo do documento**, entre 35 (RG, CNH, comprovante de residência, holerite, imposto de renda, extrato, matrícula de imóvel, IPTU, certidões, contrato social…), com a confiança e as palavras-chave que decidiram;
2. **os dados do documento** — nome, CPF e nº da CNH conferidos pelo dígito verificador, validade, filiação, naturalidade, proprietários e garantia (alienação fiduciária) da matrícula, renda bruta e líquida do holerite, titular e CEP do comprovante, CNPJ e representante da empresa…;
3. o texto extraído.

É uma biblioteca (sem banco de dados, sem API), pensada pra ser plugada num sistema — nasceu para o fluxo de documentos de financiamento imobiliário. Pra ver funcionando, tem uma demo web em `demo/`.

## Demo

```bash
npm install
npm run demo        # abre em http://localhost:3000
```

Arraste um PDF ou foto de documento na página — ou os exemplos fictícios de `fixtures/` (CNH, matrícula, holerite, comprovante, extrato) — e veja o tipo, a confiança, os sinais, como foi lido (texto do PDF ou OCR, e qual OCR) e **os dados**, cada um com rótulo: ✓ marca o que foi conferido (dígito verificador ou base pública) e o que pede atenção vem destacado (documento vencido, garantia ativa na matrícula).

Exemplo — `fixtures/exemplo-matricula.pdf`:

| Campo | Valor |
|---|---|
| Tipo | Matrícula de imóvel (100%, texto do PDF) |
| Nº da matrícula | 12.345 |
| Endereço do imóvel | Rua das Flores, 120 — Gonzaga |
| Proprietários | Maria Exemplo da Silva — CPF ✓ · Jose Exemplo da Silva — CPF ✓ |
| Garantia | ⚠ Alienação fiduciária ativa, sem baixa registrada |
| Certidão válida até | 10/12/2026 (expedição + 30 dias) |
| Cidade do imóvel | Santos/SP (conferida no IBGE) |

Na página dá pra escolher o OCR (Tesseract, PaddleOCR ou automático) e ligar as **consultas públicas**: cidade da matrícula pela lista de municípios do IBGE e endereço completo pelo CEP (BrasilAPI). Só o CEP ou o nome da cidade saem da máquina — o documento nunca. O servidor (`demo/servidor.ts`) só escuta em `localhost` e usa apenas `node:http`.

## Testes

```bash
npm run checar-extracao        # extração de campos (RG, CNH, matrícula, holerite, empresa…), com texto inventado
npx tsx examples/checar-classificacao.ts
npx tsx examples/checar-nome-arquivo.ts
npm run testar -- fixtures/exemplo-cnh.pdf   # um documento, com tipo, dados e texto
```

## Tecnologias

TypeScript (Node ≥ 20) · [pdf.js](https://github.com/mozilla/pdf.js) para texto e renderização de PDF · [Tesseract.js](https://github.com/naptha/tesseract.js) e [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) (PP-OCRv5 em ONNX) para OCR · classificação por regras, sem IA.

## Setup

```bash
npm install
npm run build
```

## Uso como biblioteca (dependência de outro projeto)

```ts
import { lerDocumentoLocal } from "leitor-documentos"

const resultado = await lerDocumentoLocal(bytes, "application/pdf", { nomeArquivo: "cnh.pdf" })
// resultado.tipo, resultado.confianca, resultado.sinais, resultado.texto, resultado.metodo
// resultado.dados.campos → [{ rotulo: "CPF", valor: "529.982.247-25", conferido: true }, …]
```

Os dados também saem sem o motor, a partir de um texto que você já tem, e os extratores estão expostos um a um:

```ts
import { extrairDados, completarComConsultas, extracao } from "leitor-documentos"

const dados = extrairDados("matricula_imovel", texto)           // local e síncrono
const completos = await completarComConsultas("matricula_imovel", texto, dados) // + IBGE e CEP (opcional, online)
extracao.extrairIdentidade(texto, "cnh")?.numero                 // registro da CNH, só se o dígito verificador fechar
extracao.analisarMatricula(texto).garantiaAtiva                  // alienação/hipoteca sem baixa
```

Pra usar num outro repositório (ex: o sistema que vai consumir o motor) antes de publicar num registro: dependência `file:` apontando pra essa pasta, e rodar `npm run build` aqui sempre que o código-fonte mudar (o `dist/` não é versionado, é gerado).

Aceita um terceiro parâmetro opcional `{ timeoutMs?: number }` (padrão 60000) — nunca lança exceção, em caso de erro ou timeout devolve `metodo: "erro"`. **Atenção**: o timeout é "soft" — devolve o controle pra quem chamou, mas não cancela um OCR que já esteja rodando por baixo dos panos.

## Uso via linha de comando (dev/debug)

```bash
npm run testar -- fixtures/algum-arquivo.pdf
npm run testar-lote -- fixtures
```

`testar` roda um arquivo por vez e mostra o texto extraído. `testar-lote` roda todos os arquivos de uma pasta (padrão `fixtures/`) e imprime uma tabela resumo (arquivo, método, tipo, confiança, nº de sinais) — útil pra checar regressão depois de mexer nas palavras-chave de `src/classificacao.ts`.

Coloque um PDF ou imagem (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.webp`) real dentro de `fixtures/` pra testar. `npm run gerar-fixture` recria os PDFs de exemplo sintéticos usados nos testes básicos.

## Como funciona (`lerDocumentoLocal`, em `src/index.ts`)

1. **PDF com camada de texto** (nato-digital, ex. extrato bancário digital) → extrai o texto direto via `pdfjs-dist`, sem OCR (`metodo: "texto_pdf"`).
2. **PDF cujo conteúdo real está numa imagem embutida** (comum em documentos oficiais digitais — ex: CNH digital, cujo PDF só traz um bloco de certificação como texto e o cartão em si como imagem) → extrai as imagens grandes da página (sem renderizar a página inteira, sem depender de canvas nativo) e roda OCR nelas (`metodo: "ocr_imagem_pdf"`).
3. **PDF que os passos 1 e 2 não enxergam** (conteúdo desenhado como vetor, como o DAMP da Caixa; scan em tons de cinza, preto e branco ou em faixas) → renderiza a página inteira e roda OCR (`metodo: "ocr_pagina_pdf"`), só enquanto o documento não classificou. Página com scan conta como "sem texto" mesmo quando traz o carimbo digital do cartório ("valide este documento…").
4. **Leitura completa, opt-in** (`opcoes.leituraCompleta`, ex. `["matricula_imovel"]`) → depois de classificar, OCR de todas as páginas escaneadas (até 40, duas em paralelo) e o texto remontado na ordem das páginas. Existe porque, na matrícula, a baixa da alienação fiduciária é a última averbação. O tipo continua o que foi decidido antes dessa leitura: o texto inteiro não reclassifica — a matrícula qualifica as partes citando "certidão de casamento" e "Registro Civil das Pessoas Naturais", e uma real passava a sair como certidão de estado civil. Matrícula real de 8 páginas: ~15 s. Quatro OCRs em paralelo não foram mais rápidos que dois e subiram o pico de memória de ~670 para ~900 MB.
5. **Imagem solta** (`png`/`jpeg`/`webp`, ex. foto de documento) → OCR direto via `tesseract.js` (`metodo: "ocr_imagem"`).
6. Texto obtido é classificado por palavras-chave em `src/classificacao.ts` (`examples/checar-classificacao.ts`). Confiança = sinais distintos / 3; termo que outros documentos só citam ("FGTS", "matrícula", "Receita Federal") é sinal fraco e não dá o tipo sozinho. O nome manda, o motor confere: se o nome do arquivo diz o tipo, vale o nome e ele vai em `tipoPeloNome` (quem consome pode agir sem olhar a confiança). Se o conteúdo, firme (2+ sinais), diz outro, esse vai em `tipoPeloConteudo` — quem consome avisa e oferece a troca, nunca troca sozinho. Conteúdo fraco (1 sinal) contra o nome não avisa (`examples/checar-nome-arquivo.ts`).

7. **Extração dos dados** (`src/dados.ts`, `src/extracao.ts`): com o tipo decidido, o texto passa pelos extratores daquele tipo. Tudo é heurística sobre texto que pode vir de OCR, então cada campo é sugestão — e o que dá para conferir é conferido: CPF, CNPJ, PIS e registro da CNH pelo dígito verificador (número que não fecha fica vazio: vazio é melhor que errado), datas validadas no calendário, holerite só quando vencimentos − descontos = líquido. Alguns cuidados que vieram de documento real: o registro da CNH igual ao CPF é descartado (é o CPF lido no lugar errado); na conta de luz, o CEP do cliente é o que vem logo depois do nome dele, não o da empresa (que vem depois do CNPJ); na matrícula, a garantia só está ativa se não houver baixa averbada depois dela, e os donos são os adquirentes da última compra e venda. `src/lugares.ts` completa, se você quiser, com a lista do IBGE (cidade da matrícula, inclusive OCR que cola palavras, "saopaulo") e o CEP.

O pdf.js recebe `wasmUrl` e `standardFontDataUrl` (`src/pdf.ts`). Sem o `wasmUrl`, a página de uma matrícula real escaneada em preto e branco (CCITT) renderizava em branco — o OCR só pegava o carimbo do rodapé (181 caracteres, contra 2.216 com o WASM) — e sem erro nenhum.

O motor só confia no texto direto do PDF (pula o OCR) quando pelo menos 2 sinais de palavra-chave batem — um único sinal isolado costuma vir de texto de capa/certificação, não do conteúdo real do documento (foi exatamente esse caso, com uma CNH digital real, que motivou o fallback de OCR em imagem embutida).

## Validado com dados reais

- PDF nato-digital com texto → classificação correta, `texto_pdf`.
- PDF em branco/sem texto → `sem_texto`, sem exceção.
- CNH digital real (PDF oficial Senatran/Serpro, cujo conteúdo é imagem embutida) → `ocr_imagem_pdf`, classificado corretamente como `cnh`.
- Foto real de CNH física (celular, fundo com textura de segurança) → `ocr_imagem`, classificado corretamente como `cnh`. Sem setar o modo de segmentação explicitamente, o Tesseract não estimava a resolução da imagem antes de segmentar e a foto (alta resolução) saía como lixo (confiança ~36%). Setando `PSM.AUTO` explicitamente (`src/ocr-imagem.ts`) — o mesmo modo padrão, só que setado explicitamente — a confiança subiu pra ~67-74% e o texto saiu legível. **Não usar `PSM.AUTO_OSD`**: parece ajudar a mesma coisa à primeira vista, mas depende de baixar o pacote de idioma `osd` (detecção de orientação), que é incompatível com o motor LSTM padrão do tesseract.js e pode falhar o carregamento do worker inteiro dependendo da rede/cache.

## OCR com PaddleOCR (opcional, `{ ocr: "paddle" }`)

Desligado por padrão. Com `lerDocumentoLocal(bytes, tipo, { ocr: "paddle" })` o OCR é do PaddleOCR (PP-OCRv5, modelo latino, em ONNX — `src/ocr-paddle.ts`); quando a leitura dele não sai firme (menos de 3 sinais — com 2, uma matrícula real saía IPTU), o Tesseract lê de novo e os dois textos vão juntos. Sem o passo cartão: o Paddle acha texto pequeno na folha e resolve o giro pela confiança do reconhecimento. Matrícula com leitura completa fica com o Tesseract.

Para ligar: `npm install` (as dependências `ppu-paddle-ocr` e `onnxruntime-node` são opcionais; o binário de CPU vem no pacote, o `postinstall` do onnxruntime só baixa CUDA e fica bloqueado em `allowScripts`) e `npm run baixar-modelos-paddle` (~12,8 MB em `modelos/`, fora do git). Sem dependências ou modelos, vale o Tesseract, sem erro.

Medido em documentos reais (01/10/2026, notebook i3 sem GPU), contra o Tesseract: valores conferidos achados no texto de 62% para 75% nos documentos que ninguém usou para ajustar; ganho maior em CNH e RG deitado/fotografado e em CEP de comprovante escaneado; certidão antiga fotografada fica com o Tesseract (reserva); os outros tipos continuam 100% classificados. Custo: ~15-20 s por documento contra ~10 s, e pico de ~3 GB de memória enquanto lê (onnxruntime). `examples/checar-montagem-paddle.ts` confere a montagem do texto.

## Fora do escopo por enquanto

- HEIC/HEIF (sem decodificador na stack).

## Constantes ajustadas empiricamente (não expostas como parâmetro público de propósito)

Todas foram calibradas testando contra documentos reais — mudar sem novo teste real pode piorar a precisão já validada:

- `CONFIANCA_MINIMA_PARA_CONFIAR_NO_TEXTO_DIRETO`, `MAX_PAGINAS`, `MAX_IMAGENS_OCR`, `MAX_PAGINAS_RENDERIZADAS`, `ESCALA_RENDERIZACAO`, `MAX_PAGINAS_LEITURA_COMPLETA`, `OCRS_EM_PARALELO` — `src/pdf.ts`
- `AREA_MINIMA_PIXELS`, `RAZAO_MAXIMA_LADO_A_LADO`, `AREA_MINIMA_IMAGEM_DE_PAGINA` — `src/imagens-pdf.ts`
- `LIMIAR_MINIMO_SINAIS`, `SINAIS_PARA_CONFIANCA_MAXIMA` — `src/classificacao.ts`

## TODO antes de qualquer deploy: hospedagem do idioma do Tesseract

Hoje `tesseract.js` baixa `por.traineddata` de um CDN externo na primeira execução (`src/ocr-imagem.ts`, `createWorker("por")`). Isso é aceitável em desenvolvimento local, mas depende de rede/CDN disponível em produção — e não deve ser resolvido às cegas antes de saber onde o sistema consumidor vai rodar (serverless muda a abordagem certa vs. VPS/Docker).

Fix concreto quando for a hora: baixar `por.traineddata` uma vez, versionar/empacotar como asset do projeto consumidor, e trocar `createWorker("por")` por `createWorker("por", 1, { langPath: "<caminho local>" })` em `src/ocr-imagem.ts`.
