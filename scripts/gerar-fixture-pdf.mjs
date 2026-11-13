// Gera os PDFs de exemplo de fixtures/ — todos com dados FICTÍCIOS (nomes
// inventados; CPF 529.982.247-25 / 111.444.777-35, CNPJ 11.222.333/0001-81 e
// CNH 12345678900 são números de exemplo com dígito verificador válido).
//   npm run gerar-fixture
import { PDFDocument, StandardFonts } from "pdf-lib"
import { writeFile } from "node:fs/promises"

const LARGURA_UTIL = 495
const TAMANHO = 11

/** Um PDF de uma página com camada de texto, quebrando as linhas longas. */
async function gerar(arquivo, linhas) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([595, 842])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  let y = 790
  for (const linha of linhas) {
    let atual = ""
    for (const palavra of linha.split(" ")) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra
      if (font.widthOfTextAtSize(tentativa, TAMANHO) > LARGURA_UTIL) {
        page.drawText(atual, { x: 50, y, size: TAMANHO, font })
        y -= 16
        atual = palavra
      } else {
        atual = tentativa
      }
    }
    if (atual) page.drawText(atual, { x: 50, y, size: TAMANHO, font })
    y -= linha ? 20 : 10
  }
  await writeFile(`fixtures/${arquivo}`, await doc.save())
  console.log(`fixtures/${arquivo} criado`)
}

await gerar("exemplo-extrato.pdf", [
  "EXTRATO DE CONTA CORRENTE",
  "Banco Itau Unibanco S.A.",
  "Titular: Joao da Silva",
  "Saldo anterior: R$ 1.234,56",
  "Saldo em conta em 01/09/2026: R$ 2.000,00",
])

{
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  await writeFile("fixtures/exemplo-em-branco.pdf", await doc.save())
  console.log("fixtures/exemplo-em-branco.pdf criado")
}

await gerar("exemplo-cnh.pdf", [
  "REPÚBLICA FEDERATIVA DO BRASIL",
  "MINISTÉRIO DOS TRANSPORTES - SECRETARIA NACIONAL DE TRÂNSITO",
  "CARTEIRA NACIONAL DE HABILITAÇÃO",
  "2 e 1 NOME E SOBRENOME",
  "MARIA EXEMPLO DA SILVA",
  "3 DATA, LOCAL E UF DE NASCIMENTO",
  "15/04/1990, SANTOS, SP",
  "4a DATA EMISSÃO 4b VALIDADE",
  "10/01/2024 09/01/2034",
  "4c CPF",
  "529.982.247-25",
  "5 Nº REGISTRO 9 CAT HAB",
  "12345678900 B",
  "FILIAÇÃO",
  "JOSE EXEMPLO DA SILVA",
  "ANA EXEMPLO DA SILVA",
  "1ª HABILITAÇÃO 20/05/2010",
  "DEPARTAMENTO ESTADUAL DE TRÂNSITO",
  "LOCAL SANTOS, SP",
])

await gerar("exemplo-matricula.pdf", [
  "REGISTRO DE IMÓVEIS DA COMARCA DE SANTOS - ESTADO DE SÃO PAULO",
  "CERTIDÃO DE INTEIRO TEOR DA MATRÍCULA",
  "MATRÍCULA Nº 12.345 - FICHA 01 - LIVRO Nº 2 - REGISTRO GERAL",
  "IMÓVEL: casa, situada na Rua das Flores, nº 120, bairro Gonzaga, no município de Santos, com área construída de 120,00 m².",
  "R.1 - COMPRA E VENDA. TRANSMITENTE: CONSTRUTORA FICTÍCIA LTDA. ADQUIRENTE(S) COMPRADOR/A(ES): MARIA EXEMPLO DA SILVA, brasileira, CPF nº 529.982.247-25, e seu cônjuge JOSE EXEMPLO DA SILVA, brasileiro, CPF nº 111.444.777-35. PREÇO: R$ 350.000,00.",
  "R.2 - ALIENAÇÃO FIDUCIÁRIA: o imóvel foi alienado fiduciariamente ao Banco Fictício S.A., credor fiduciário, em garantia da dívida de R$ 280.000,00.",
  "",
  "O referido é verdade e dá fé. Santos, 10 de novembro de 2026.",
])

await gerar("exemplo-holerite.pdf", [
  "RECIBO DE PAGAMENTO DE SALÁRIO - HOLERITE",
  "Empregador: COMERCIO FICTICIO LTDA CNPJ: 11.222.333/0001-81",
  "Funcionário: MARIA EXEMPLO DA SILVA CPF: 529.982.247-25",
  "Cargo: Analista Administrativo Data de admissão: 01/03/2022",
  "Mês de referência: 10/2026",
  "Salário base 4.200,00 | INSS 389,64 | IRRF 105,30",
  "Total 4.200,00 494,94 Total Líquido 3.705,06",
])

await gerar("exemplo-comprovante.pdf", [
  "COMPANHIA FICTÍCIA DE ENERGIA S.A.",
  "CNPJ 11.222.333/0001-81 Av. Central, 1000 - Centro - CEP 01001-000 - São Paulo - SP",
  "CONTA DE ENERGIA ELÉTRICA - NOTA FISCAL",
  "MARIA EXEMPLO DA SILVA",
  "RUA DAS FLORES 120 - GONZAGA - CEP 11060-001 - SANTOS - SP",
  "Mês de referência: 10/2026",
  "Data de emissão: 03/11/2026",
  "Vencimento: 15/11/2026 Total a pagar: R$ 187,40",
  "Consumo do mês: 215 kWh",
])
