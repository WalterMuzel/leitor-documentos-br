// Checagem: nome do arquivo × tipo lido no conteúdo. npx tsx examples/checar-nome-arquivo.ts
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { lerDocumentoLocal } from "../src/index.js"

const extrato = readFileSync(new URL("../fixtures/exemplo-extrato.pdf", import.meta.url))
const semNome = await lerDocumentoLocal(extrato, "application/pdf")
assert.equal(semNome.tipo, "extrato_bancario")
assert.equal(semNome.tipoPeloConteudo, undefined)
assert.equal(semNome.tipoPeloNome, undefined)

// O nome manda, o motor confere: discordam e o conteúdo é firme (4 sinais de extrato) — vale o nome,
// e o que o motor leu vai junto, para o aviso.
const comNome = await lerDocumentoLocal(extrato, "application/pdf", { nomeArquivo: "Comprovante de residência.pdf" })
assert.equal(comNome.tipo, "comprovante_residencia")
assert.equal(comNome.tipoPeloNome, "comprovante_residencia")
assert.equal(comNome.tipoPeloConteudo, "extrato_bancario")

// Formato que o motor não lê: o nome do arquivo ainda dá o tipo, como num PDF sem texto.
assert.equal((await lerDocumentoLocal(Buffer.from("x"), "image/heic", { nomeArquivo: "RG.heic" })).tipo, "rg")
assert.equal((await lerDocumentoLocal(Buffer.from("x"), "image/heic", { nomeArquivo: "IMG_0001.heic" })).metodo, "nao_suportado")

// Concordam ou o nome não diz nada: o conteúdo, sem alerta.
assert.equal((await lerDocumentoLocal(extrato, "application/pdf", { nomeArquivo: "scan 24-09.pdf" })).tipoPeloConteudo, undefined)

// "Declaração - divergência de endereço" não é comprovante de residência (a palavra "endereço" no nome enganava).
const { classificarNomeArquivoLocal } = await import("../src/nome-arquivo.js")
const { classificarTextoLocal } = await import("../src/classificacao.js")
assert.equal(classificarNomeArquivoLocal("DECLARACAO - DIVERGENCIA DE ENDERECO.pdf"), null)
assert.equal(classificarNomeArquivoLocal("endereço fulano.jpg")?.tipo, "comprovante_residencia")
// "claro" (operadora) não vale dentro de "declaro"; vale solto.
assert.equal(classificarTextoLocal("Eu, fulano, declaro sob as penas da lei que nao possuo vinculo").sinais.includes("claro"), false)
assert.equal(classificarTextoLocal("Fatura Claro ... 150kWh").sinais.includes("claro"), true)

// Conteúdo firme (2+ sinais) contra o nome: vale o nome, e o que o motor leu vai em tipoPeloConteudo (aviso).
const { comFallbackDeNomeArquivo } = await import("../src/index.js")
const lido = (tipo: string, sinais: string[]) => ({ texto: "x", metodo: "ocr_imagem" as const, tipo: tipo as never, confianca: sinais.length / 3, sinais })
const rgComoCnh = comFallbackDeNomeArquivo(lido("rg", ["registro geral", "carteira de identidade", "polegar"]), "CNH fulano.jpeg")
assert.equal(rgComoCnh.tipo, "cnh")
assert.equal(rgComoCnh.tipoPeloNome, "cnh")
assert.equal(rgComoCnh.tipoPeloConteudo, "rg")
assert.equal(rgComoCnh.metodo, "ocr_imagem")
assert.equal(comFallbackDeNomeArquivo(lido("extrato_bancario", ["a", "b"]), "Holerite.pdf").tipoPeloConteudo, "extrato_bancario")
// Documento com endereço serve de comprovante: a declaração de IR salva como comprovante continua comprovante.
const irComoComprovante = comFallbackDeNomeArquivo(lido("imposto_renda", ["irpf", "declaracao de ajuste anual"]), "Comprovante de residencia - IR.pdf")
assert.equal(irComoComprovante.tipo, "comprovante_residencia")
assert.equal(irComoComprovante.tipoPeloConteudo, "imposto_renda")
// Nome e conteúdo concordam: o tipo do nome vai junto, e a confiança continua a do conteúdo.
const concordam = comFallbackDeNomeArquivo(lido("matricula_imovel", ["livro 2", "onus reais", "cnm"]), "Matricula 12345.pdf")
assert.equal(concordam.tipoPeloNome, "matricula_imovel")
assert.equal(concordam.confianca, 1)
assert.equal(concordam.tipoPeloConteudo, undefined)
// Nome com dois tipos: vale o que o conteúdo firme confirma; sem conteúdo firme, o primeiro da lista.
assert.equal(comFallbackDeNomeArquivo(lido("matricula_imovel", ["livro 2", "onus reais", "cnm"]), "Matricula 12345 averbacao.pdf").tipo, "matricula_imovel")
const averbacao = comFallbackDeNomeArquivo(lido("certidao_estado_civil", ["certidao de casamento", "livro b"]), "Matricula 12345 averbacao.pdf")
assert.equal(averbacao.tipo, "certidao_estado_civil")
assert.equal(averbacao.tipoPeloConteudo, undefined)
assert.equal(comFallbackDeNomeArquivo(lido("iptu", ["valor venal", "exercicio"]), "IPTU Endereco.pdf").tipo, "iptu")
assert.equal(comFallbackDeNomeArquivo(lido("iptu", ["exercicio"]), "IPTU Endereco.pdf").tipo, "comprovante_residencia")
// Conteúdo fraco (1 sinal) contra o nome: vale o nome e não tem aviso — em 1.676 arquivos reais, nas 6
// vezes em que o conteúdo fraco discordou do nome, estava errado.
const fraco = comFallbackDeNomeArquivo(lido("rg", ["registro geral"]), "CNH fulano.jpeg")
assert.equal(fraco.tipo, "cnh")
assert.equal(fraco.tipoPeloConteudo, undefined)
assert.ok(fraco.confianca < 0.5)
// Conteúdo vazio: vale o nome, e o método diz que o tipo veio só dele.
const vazio = comFallbackDeNomeArquivo(lido("outro", []), "Comprovante de residencia - IR.pdf")
assert.equal(vazio.tipo, "comprovante_residencia")
assert.equal(vazio.metodo, "nome_arquivo")
// O nome não diz o tipo: fica o conteúdo, sem tipoPeloNome (aí quem decide se age é a confiança).
assert.equal(comFallbackDeNomeArquivo(lido("rg", ["registro geral", "polegar"]), "IMG_0001.jpeg").tipoPeloNome, undefined)

// Palavras que quem anexa já escreve e o motor ignorava (12/10/2026)...
for (const [nome, esperado] of [
  ["Cadastro Fulano.pdf", "ficha_cadastro"],
  ["Conta Corrente Fulano.pdf", "proposta_conta_corrente"],
  ["DPS assinada.pdf", "dps"],
  ["CTPS Fulana.pdf", "ctps"],
  ["CTPSContratosDigitais_000.000.000-00_01-01-2026.pdf", "ctps"],
  ["Extrato FGTS Fulano.pdf", "extrato_fgts"],
  ["Avaliação de Risco.pdf", "avaliacao_risco"],
  ["Residência Fulano.pdf", "comprovante_residencia"],
  ["COMP RES FULANA 06.pdf", "comprovante_residencia"],
  ["Certidão de Valor Venal.pdf", "iptu"],
  ["Certidao IPTU 01 - NEGATIVA DE DEBITO.pdf", "certidao_negativa_debitos"],
] as const) {
  assert.equal(classificarNomeArquivoLocal(nome)?.tipo, esperado, nome)
}
// ... sem pegar o que só parece.
assert.equal(classificarNomeArquivoLocal("Memorando - conta correta.pdf"), null)
assert.equal(classificarNomeArquivoLocal("Declaração de residência.pdf"), null)
assert.equal(classificarNomeArquivoLocal("JUCESP - FICHA CADASTRAL COMPLETA.pdf")?.tipo, "certidao_junta_comercial")
assert.equal(classificarNomeArquivoLocal("Pesquisa Cadastral - Fulano.pdf")?.tipo, "pesquisa_cadastral")
// O nome com dois tipos: "Matricula ... averbacao" é a matrícula (averbação tem nas duas); "IR" (token
// curto ambíguo) perde para o que o nome diz por extenso, mas sozinho ainda vale.
assert.equal(classificarNomeArquivoLocal("Matricula 12345 averbacao.pdf")?.tipo, "matricula_imovel")
assert.equal(classificarNomeArquivoLocal("Averbacao divorcio.pdf")?.tipo, "certidao_estado_civil")
assert.equal(classificarNomeArquivoLocal("Comprovante de residencia - IR.pdf")?.tipo, "comprovante_residencia")
assert.equal(classificarNomeArquivoLocal("CNH - mo.pdf")?.tipo, "cnh")
assert.equal(classificarNomeArquivoLocal("MO fulano.pdf")?.tipo, "mo_ateste")
assert.equal(classificarNomeArquivoLocal("ART.pdf")?.tipo, "art_rrt")

// Matrícula grande que cita a certidão dos donos não é certidão de estado civil
// (precisa de um sinal próprio de matrícula: "matrícula" sozinho toda certidão tem).
const { classificarTextoLocal: classificar } = await import("../src/classificacao.js")
const citacao = "certidao de casamento civil das pessoas naturais oficial de registro matricula 1.234 transmitente "
assert.equal(classificar(citacao).tipo, "certidao_estado_civil")
assert.equal(classificar(citacao + "x".repeat(7000)).tipo, "matricula_imovel")
assert.equal(classificar(citacao, { paginas: 6 }).tipo, "matricula_imovel")
assert.equal(classificar("certidao de casamento civil das pessoas naturais oficial de registro", { paginas: 6 }).tipo, "certidao_estado_civil")

// Modo "auto": o Tesseract basta, exceto RG/CNH e leitura fraca (PDF com texto nunca sobe).
const { deveSubirParaPaddle } = await import("../src/index.js")
const ocr = (tipo: string, conf: number, metodo = "ocr_imagem_pdf") => ({ texto: "x", metodo: metodo as never, tipo: tipo as never, confianca: conf, sinais: [] })
assert.equal(deveSubirParaPaddle(ocr("cnh", 1)), true)
assert.equal(deveSubirParaPaddle(ocr("rg", 1)), true)
assert.equal(deveSubirParaPaddle(ocr("pesquisa_cadastral", 1)), false)
assert.equal(deveSubirParaPaddle(ocr("matricula_imovel", 2 / 3)), false)
assert.equal(deveSubirParaPaddle(ocr("holerite", 1 / 3)), true)
assert.equal(deveSubirParaPaddle(ocr("outro", 0)), true)
assert.equal(deveSubirParaPaddle(ocr("cnh", 1, "texto_pdf")), false)
// Matrícula fraca em PDF que já teve a leitura completa: não sobe (o Paddle repetiria as 40 páginas).
assert.equal(deveSubirParaPaddle(ocr("matricula_imovel", 1 / 3), ["matricula_imovel"]), false)
assert.equal(deveSubirParaPaddle(ocr("matricula_imovel", 1 / 3)), true)
assert.equal(deveSubirParaPaddle(ocr("matricula_imovel", 1 / 3, "ocr_imagem"), ["matricula_imovel"]), true) // foto: sem leitura completa
assert.equal(deveSubirParaPaddle(ocr("matricula_imovel", 1 / 3, "nome_arquivo"), ["matricula_imovel"]), true) // tipo só pelo nome

// Citam a matrícula do imóvel e liam como ela com 100% (07/10/2026).
const matriculaCitada = "objeto da matricula 20.788 do 2o cartorio de registro de imoveis, livro 2"
assert.equal(classificar(`PROCURACAO BASTANTE que faz FULANA. compareceu como outorgante FULANA; outorgado BELTRANO, seu bastante procurador, com poderes especiais para vender o imovel ${matriculaCitada}, podendo substabelecer`).tipo, "procuracao")
// Como o alvará real: o cabeçalho do foro e do processo vem antes do imóvel citado.
const cabecalhoAlvara = "fls. 303 Tribunal de Justica do Estado de Sao Paulo Comarca de Sao Paulo Foro Central Civel 6a Vara da Familia e Sucessoes Praca Joao Mendes s/n, 4o andar, Centro, CEP 01501-900 ALVARA Processo no 0000000-00.2025.8.26.0100 - Inventario Inventariante (ativo): FULANO DE TAL, CPF 000.000.000-00 Inventariado: Espolio de BELTRANA DE TAL, CPF 000.000.000-00"
assert.equal(classificar(`${cabecalhoAlvara} O MM. Juiz de Direito da 6a Vara da Familia e Sucessoes autoriza o inventariante FULANO a vender o imovel ${matriculaCitada}, depositando em conta judicial a disposicao deste juizo`).tipo, "documento_judicial")
// Certidão de casamento com o divórcio averbado repete a sentença, mas é a certidão.
assert.equal(classificar("CERTIDAO DE CASAMENTO Registro Civil das Pessoas Naturais. Averbacao: por sentenca do MM. Juiz de Direito da 2a Vara da Familia, transitada em julgado, o casal divorciou-se").tipo, "certidao_estado_civil")
// Registro do pacto: certidão do Livro 3 do Registro de Imóveis, mesmo cabeçalho da matrícula.
const registroPacto = "O 2o Oficial de Registro de Imoveis CERTIFICA que, revendo o Livro 3 - Registro Auxiliar, consta a matricula do seguinte teor: CNM 1124 Prenotacao no 421 PACTO ANTENUPCIAL acompanhada da certidao de casamento, civil das pessoas naturais, oficial de registro, regime da separacao total de bens"
assert.equal(classificar(registroPacto).tipo, "pacto_antenupcial")
assert.equal(classificarNomeArquivoLocal("Registro Pacto Antenupcial.pdf")?.tipo, "pacto_antenupcial")
assert.equal(classificarNomeArquivoLocal("Certidão casamento sem pacto.pdf")?.tipo, "certidao_estado_civil")
assert.equal(classificarNomeArquivoLocal("CNH procurador.pdf")?.tipo, "cnh")

// Imóvel novo (07/10/2026): habite-se lia CND, alvará lia IPTU/matrícula, ART lia "outro".
assert.equal(classificar("Prefeitura Municipal SECRETARIA DE OBRAS CARTA DE HABITACAO 095/2022 Certifico que o Prefeito Municipal expede a presente Carta de Habitacao a fim de que o predio construido a Rua X possa ser habitado. A construcao foi autorizada pelo Alvara 256/2014 e executada em conformidade com planta aprovada. Certidao negativa, quite com").tipo, "habite_se")
assert.equal(classificar("PREFEITURA MUNICIPAL ALVARA DE CONSTRUCAO No 03/2026 PROPRIETARIO: FULANA AUTOR DO PROJETO: BELTRANA fica concedida a licenca para execucao do projeto aprovado, objeto da Matricula no 57.285").tipo, "alvara_construcao")
assert.equal(classificar("Resolucao no 1.025/2009 ART Anotacao de Responsabilidade Tecnica CREA-SP www.confea.org.br Entidade de Classe Nenhuma").tipo, "art_rrt")
// A matrícula averbada cita o habite-se e o alvará, mas continua matrícula.
assert.equal(classificar("CARTORIO DE REGISTRO DE IMOVEIS LIVRO 2 - REGISTRO GERAL MATRICULA 1234 CNM prenotacao. AV.3 - CONSTRUCAO: conforme habite-se no 95/2022 e alvara de construcao 256/2014, a construcao foi concluida. R.4 transmitente FULANO adquirente BELTRANO").tipo, "matricula_imovel")
assert.equal(classificarNomeArquivoLocal("ALVARA.pdf"), null)
assert.equal(classificarNomeArquivoLocal("Habite-se_RRT.pdf")?.tipo, "habite_se")

// IR sem texto legível: o nome do arquivo diz.
assert.equal(classificarNomeArquivoLocal("Recibo IR Fulana.pdf")?.tipo, "imposto_renda")
assert.equal(classificarNomeArquivoLocal("52998224725-IRPF-A-2026-2025-DEC.pdf")?.tipo, "imposto_renda")
assert.equal(classificarNomeArquivoLocal("Imposto de Renda 2025.pdf")?.tipo, "imposto_renda")
assert.equal(classificarNomeArquivoLocal("ISENÇÃO IR ASSINADA.pdf"), null)

console.log("nome do arquivo × conteúdo: ok")
process.exit(0)
