// Checagem da classificação pelo conteúdo, com texto inventado. npx tsx examples/checar-classificacao.ts
import assert from "node:assert/strict"
import { classificarTextoLocal as classificar, regras } from "../src/classificacao.js"
import { normalizar } from "../src/normalizar.js"

const tipo = (texto: string, paginas?: number) => classificar(texto, { paginas }).tipo

// Ligadura do PDF ("ﬁ" num caractere só) e ordinal ("1ª") não escondem o sinal nem contam duas vezes.
assert.equal(tipo("\uFB01CHA CADASTRAL do cliente"), "ficha_cadastro")
assert.deepEqual(classificar("CARTEIRA NACIONAL DE HABILITACAO 1ª HABILITACAO 01/01/2000").sinais, ["carteira nacional de habilitacao", "1a habilitacao"])

// Palavra curta vale solta: "fatura" dentro de "faturamento" não é conta de consumo.
assert.equal(tipo("NOTA FISCAL DE SERVICOS ELETRONICA Prestador ACME LTDA Tomador FULANO DE TAL Valor dos servicos 1.000,00 Faturamento mensal"), "outro")
assert.equal(tipo("Sua FATURA do mes. Codigo do cliente 123. Vencimento 10/10/2026"), "comprovante_residencia")
assert.equal(classificar("Valor das aliquotas aplicadas").sinais.includes("quotas"), false)

// --- Sinal que outros documentos citam não dá o tipo sozinho (review) ---
// Contrato que cita o FGTS não é extrato do FGTS (nem autorização).
assert.equal(
  tipo("INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA. VENDEDOR: FULANO DE TAL. COMPRADOR: BELTRANO DE TAL. O preco sera pago com recursos proprios e com o saldo da conta vinculada do FGTS do comprador, mediante uso do FGTS nas regras do Conselho Curador do FGTS."),
  "outro",
)
// Cartão do CPF cita a Receita Federal do Brasil, mas não é declaração de IR.
assert.equal(
  tipo("MINISTERIO DA FAZENDA RECEITA FEDERAL DO BRASIL Comprovante de Situacao Cadastral no CPF Numero 000.000.000-00 Nome FULANO DE TAL Data de nascimento 01/01/1980 Situacao cadastral REGULAR"),
  "outro",
)
// Escritura tem outorgante e outorgado e não é procuração...
assert.equal(
  tipo("ESCRITURA PUBLICA DE VENDA E COMPRA que fazem FULANO DE TAL, como outorgante vendedor, e BELTRANO DE TAL, como outorgado comprador, pelo preco certo e ajustado de R$ 300.000,00"),
  "outro",
)
// ... nem quando o vendedor assina por procuração.
assert.notEqual(
  tipo("ESCRITURA PUBLICA DE VENDA E COMPRA que fazem FULANO DE TAL, outorgante vendedor, neste ato representado por seu bastante procurador CICLANO, conforme procuracao lavrada no 1o Tabeliao, e BELTRANO DE TAL, outorgado comprador"),
  "procuracao",
)

// Contrato que cita a matrícula do imóvel não é a matrícula.
assert.equal(
  tipo("CONTRATO PARTICULAR DE COMPRA E VENDA. Objeto: o apartamento 12 da Rua Inventada, 100, objeto da matricula 12.345 do 1o Cartorio de Registro de Imoveis de Cidade Inventada."),
  "outro",
)

// --- Acertos que não podem quebrar ---
assert.equal(tipo("EXTRATO PARA USO DA CAIXA Historico emitido em 01/10/2026 CREDITO DE JAM 0,001234 Data de opcao 01/01/2010 FGTS Tipo de conta"), "extrato_fgts")
assert.deepEqual(classificar("CREDITO DE JAM FGTS").sinais, ["credito de jam", "fgts"]) // o fraco soma junto de um próprio
assert.equal(tipo("Recibo de pagamento de salario Salario base 3.000,00 Vencimentos Descontos INSS FGTS do mes"), "holerite")
assert.equal(tipo("RECEITA FEDERAL DO BRASIL DECLARACAO DE AJUSTE ANUAL IRPF 2026 Identificacao do contribuinte"), "imposto_renda")
assert.equal(tipo("ENERGIA ELETRICA FATURA Unidade consumidora 123456 Leitura anterior 01/09 Proxima leitura 01/10 150kWh"), "comprovante_residencia")
assert.equal(
  tipo("PROCURACAO BASTANTE que faz FULANA DE TAL, outorgante, a favor de BELTRANO DE TAL, outorgado, seu bastante procurador, com poderes especiais para vender, podendo substabelecer"),
  "procuracao",
)
assert.equal(
  tipo("ESCRITURA DE PACTO ANTENUPCIAL que fazem os nubentes FULANO e BELTRANA, reciprocamente outorgados e outorgantes, pelo regime da separacao total de bens"),
  "pacto_antenupcial",
)
assert.equal(
  tipo("REGISTRO DE IMOVEIS DA COMARCA DE CIDADE INVENTADA LIVRO 2 - REGISTRO GERAL MATRICULA 12.345 CNM 123456.2.0012345-00 IMOVEL: lote 1. R.1 - TRANSMITENTE: FULANO. ADQUIRENTE: BELTRANO. Prenotacao 999"),
  "matricula_imovel",
)

// --- Certidão de registro civil grande não vira matrícula (review) ---
// Desde 2010 toda certidão traz "MATRÍCULA" + 32 dígitos (a matrícula da certidão),
// e a de casamento com pacto cita o Registro de Imóveis.
const certidao =
  "REPUBLICA FEDERATIVA DO BRASIL REGISTRO CIVIL DAS PESSOAS NATURAIS CERTIDAO DE CASAMENTO Nome FULANO DE TAL e BELTRANA DE TAL " +
  "MATRICULA 123456 01 55 2015 2 00012 123 0001234 12 Oficial de Registro Civil Livro B-12. " +
  "Averbacao: pacto antenupcial registrado sob o no 1.234 no Livro 3 do 1o Registro de Imoveis. "
assert.equal(tipo(certidao), "certidao_estado_civil")
assert.equal(tipo(certidao, 4), "certidao_estado_civil") // 4 páginas
const longa = certidao + "Observacoes: nada mais consta. ".repeat(120)
assert.equal(tipo(longa + "\n" + longa), "certidao_estado_civil") // texto do Paddle e do Tesseract juntos
// A matrícula grande que cita a certidão dos donos continua matrícula.
const matriculaCitandoCertidao =
  "matricula 1.234 certidao de casamento civil das pessoas naturais oficial de registro. R.2 transmitente FULANO adquirente BELTRANO "
assert.equal(tipo(matriculaCitandoCertidao), "certidao_estado_civil")
assert.equal(tipo(matriculaCitandoCertidao + "x ".repeat(4000)), "matricula_imovel")
assert.equal(tipo(matriculaCitandoCertidao, 6), "matricula_imovel")

// --- Dois sinais são duas coisas, não o mesmo trecho contado duas vezes ---
for (const regra of regras) {
  const sinais = [...regra.sinais, ...(regra.fracos ?? [])].map((s) => (Array.isArray(s) ? s : [s]).map(normalizar))
  sinais.forEach((termos, i) =>
    sinais.forEach((outros, j) => {
      if (i !== j) for (const a of termos) for (const b of outros) assert.ok(!b.includes(a), `${regra.tipo}: "${a}" esta dentro de "${b}"`)
    }),
  )
}
assert.equal(classificar("CARTEIRA DE TRABALHO E PREVIDENCIA SOCIAL").sinais.length, 1)
assert.equal(classificar("CERTIDAO NEGATIVA DE DEBITOS").sinais.length, 1)

// --- Erros firmes achados em 1.676 arquivos reais (12/10/2026) ---
// Nome de banco não dá extrato sozinho (deu a 24 documentos, nenhum era); junto de um sinal próprio, soma.
assert.equal(tipo("DECLARACAO Eu, FULANO DE TAL, declaro que nao utilizei recursos do FGTS na aquisicao do imovel. Banco Itau Unibanco S.A."), "outro")
assert.deepEqual(classificar("Extrato de conta corrente Bradesco Saldo anterior 1.000,00").sinais, ["extrato de conta corrente", "saldo anterior", "bradesco"])
// Formulários do banco para o cliente assinar: Santander, Itaú e a proposta Credimóvel do Bradesco.
assert.equal(tipo("Santander Autorizacao do(s) Comprador(es) para Aquisicao de Imovel Nome do 1o Comprador: FULANO DE TAL O(s) Comprador(es) declara(m), sob as penas da Lei, que nao ha certidao negativa de debitos pendente"), "formulario_banco")
assert.equal(tipo("Formulario de Vendedor Pessoa Fisica Credito Imobiliario Itau Dados do(s) Vendedor(es) Nome completo (sem abreviacoes) FULANO DE TAL orgao expedidor DETRAN"), "formulario_banco")
assert.equal(tipo("dados cadastrais nome completo FULANO DE TAL tipo de documento CNH orgao expedidor DETRAN representante legal durante a contratacao do financiamento"), "formulario_banco")
assert.equal(tipo("bradesco Proposta Credimovel 01 - Dados do(s) Cliente(s) / Proponente(s) Nome FULANO DE TAL Conta Corrente Bradesco saldo em conta"), "formulario_banco")
// A página de instruções do DAMP lista carteira de trabalho, PIS/PASEP e empregador: não é a CTPS.
assert.notEqual(tipo("Dicas para Preenchimento do Formulario para Movimentacao de Conta Vinculada ao FGTS. Tenha em maos a carteira de trabalho (CTPS), o PIS/PASEP e os dados do empregador, com a data de admissao"), "ctps")
// "Assinatura do portador" também está na CTPS de papel: sozinho não faz CNH.
assert.equal(tipo("MINISTERIO DO TRABALHO CARTEIRA DE TRABALHO E PREVIDENCIA SOCIAL Numero 000000 Serie 00000 ASSINATURA DO PORTADOR"), "ctps")
assert.deepEqual(classificar("CARTEIRA NACIONAL DE HABILITACAO ASSINATURA DO PORTADOR").sinais, ["carteira nacional de habilitacao", "assinatura do portador"])
// O cadastro de clientes da Caixa traz o tipo do documento e o órgão emissor como campos: não é o RG.
assert.equal(tipo("Cadastro de Clientes DADOS CADASTRAIS Nome completo do cliente: FULANO DE TAL Tipo de documento de identificacao: carteira de identidade Orgao emissor: secretaria de seguranca publica"), "ficha_cadastro")
// Declaração que cita o IR não é o IR.
assert.notEqual(tipo("DECLARACAO - DIVERGENCIA DE ENDERECO. Eu, FULANA DE TAL, declaro que o endereco que consta em meu IRPF de exercicio 2026, ano-calendario 2025, diverge do atual"), "imposto_renda")
assert.notEqual(tipo("DECLARACAO DE ISENCAO DE IMPOSTO DE RENDA PESSOA FISICA. Declaro que estou dispensado da declaracao de ajuste anual do ano-calendario 2025"), "imposto_renda")
// Laudo de avaliação fala de fachada e implantação: não é o projeto aprovado.
assert.notEqual(tipo("LAUDO DE AVALIACAO Solicitante Banco. Relatorio fotografico: fachada do avaliando, vista da rua. Implantacao do imovel no terreno"), "projeto_aprovado")
// Matrícula curta: as averbações citam a certidão de casamento e a de óbito e empatavam com a certidão.
assert.equal(
  tipo("CNM: 000000.2.0000000-00 LIVRO No 2 REGISTRO GERAL Registro de Imoveis da Comarca Inventada MATRICULA 1.234 apartamento 12. AV.2 casamento, conforme certidao de casamento expedida pelo oficial de registro civil das pessoas naturais. AV.3 obito, conforme certidao de obito"),
  "matricula_imovel",
)

console.log("classificacao: ok")
