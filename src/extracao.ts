import type { TipoDocumento } from "./tipos.js"

/**
 * Extração de campos a partir do texto que o motor leu.
 *
 * O motor (index.ts) diz o tipo do documento e devolve o texto; aqui esse texto
 * vira dados: CPF, número da CNH, filiação, proprietários da matrícula, renda
 * do holerite… Cada regex foi calibrada em documentos reais que tinham lido
 * errado — por isso o arquivo é grande e as funções se apoiam umas nas outras.
 *
 * Tudo aqui é heurística sobre texto que pode vir de OCR: cada campo é
 * sugestão, nunca verdade. Quando dá, o campo é conferido (dígito verificador
 * de CPF, CNPJ, CNH e PIS; datas validadas no calendário) — vazio é melhor que
 * errado. Quem junta tudo por tipo de documento é `extrairDados` (dados.ts).
 */

/** Código do IBGE, nome e UF — mesmo formato do `Municipality` do banco. */
export interface Municipio {
  id: string;
  nome: string;
  uf: string;
}

export type TipoMoradia = "casa" | "apartamento" | "sitio" | "chacara" | "fazenda" | "outro_imovel";

export type OcupacaoMoradia =
  | "propria_quitada"
  | "propria_financiada_caixa"
  | "propria_financiada_outros"
  | "alugada"
  | "com_pais"
  | "cedida"
  | "funcional"
  | "outra";

/** Sem acento e em caixa baixa — base de toda comparação de texto vindo de OCR. */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

/** Versão agressiva: sem acento, sem pontuação e com espaços colapsados. */
export function chaveTexto(texto: string): string {
  return semAcento(texto)
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Quantas letras é preciso trocar, tirar ou acrescentar para um texto virar o
 * outro (Levenshtein): tolera rótulo que o OCR leu errado.
 */
export function distanciaEdicao(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const atual = [i]
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j]! + 1, atual[j - 1]! + 1, anterior[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    anterior = atual
  }
  return anterior[b.length]!
}

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]

/** Valida os dígitos verificadores — OCR gera muito número parecido com CPF. */
export function cpfValido(valor: string): boolean {
  const d = valor.replace(/\D/g, "")
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  for (const tamanho of [9, 10]) {
    let soma = 0
    for (let i = 0; i < tamanho; i++) soma += Number(d[i]) * (tamanho + 1 - i)
    const resto = ((soma * 10) % 11) % 10
    if (resto !== Number(d[tamanho])) return false
  }
  return true
}

/**
 * Dígitos verificadores do registro da CNH (9 dígitos + 2). Conferido contra
 * 6 CNHs reais: todas fecham, e 593 de 594 trocas de um dígito não fecham. O
 * OCR troca dígito no número da CNH; sem esta conta, o número errado ia para
 * o formulário do banco.
 */
export function cnhValida(valor: string): boolean {
  const d = valor.replace(/\D/g, "")
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  let soma = 0
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (9 - i)
  let dv1 = soma % 11
  let desconto = 0
  if (dv1 >= 10) {
    dv1 = 0
    desconto = 2
  }
  soma = 0
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (i + 1)
  const resto = soma % 11
  const dv2 = resto >= 10 ? 0 : (resto - desconto + 11) % 11
  return Number(d[9]) === dv1 && Number(d[10]) === dv2
}

export function cnpjValido(valor: string): boolean {
  const d = valor.replace(/\D/g, "")
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const calcular = (tamanho: number) => {
    let soma = 0
    let peso = tamanho - 7
    for (let i = 0; i < tamanho; i++) {
      soma += Number(d[i]) * peso
      peso = peso - 1 < 2 ? 9 : peso - 1
    }
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  return calcular(12) === Number(d[12]) && calcular(13) === Number(d[13])
}

export function extrairCpf(texto: string): string | undefined {
  // "/" antes dos 2 últimos: o RG de SP imprime o CPF como "123456789/01".
  const candidatos = texto.match(/\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s/]?\d{2}/g) ?? []
  for (const c of candidatos) {
    if (cpfValido(c)) return c.replace(/\D/g, "")
  }
  return undefined
}

export function extrairCnpj(texto: string): string | undefined {
  const candidatos = texto.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g) ?? []
  for (const c of candidatos) {
    if (cnpjValido(c)) return c.replace(/\D/g, "")
  }
  return undefined
}

export interface CepCandidato {
  /** Só dígitos. */
  cep: string
  /** Posição no texto, usada para medir proximidade com nome e rótulos. */
  posicao: number
  /** Pontuação da heurística: quanto maior, mais provável ser do cliente. */
  pontos: number
  /** Por que ganhou ou perdeu pontos — vai para a tela quando há dúvida. */
  motivos: string[]
  /** O nome do cliente aparece logo antes deste CEP. */
  depoisDoNome: boolean
  /** Um rótulo do cliente ("código do cliente", "endereço de instalação"...) aparece logo antes. */
  depoisDeRotuloCliente: boolean
  /** Vem logo depois de um CNPJ, sem nome nem rótulo do cliente no meio — é o bloco de endereço da prestadora. */
  noBlocoDoCnpj: boolean
}

/** Rótulos que marcam o CLIENTE numa fatura de consumo — o endereço dele vem logo depois. */
const ROTULOS_ENDERECO_CLIENTE = [
  "endereco de instalacao",
  "endereco da instalacao",
  "local de instalacao",
  "endereco de entrega",
  "endereco de cobranca",
  "endereco do cliente",
  "endereco de correspondencia",
  "endereco do imovel",
  "instalado em",
  "codigo do cliente",
  "codigo cliente",
  "cod cliente",
  "numero do cliente",
  "unidade consumidora",
  "seu codigo",
]

/** Distância máxima, em caracteres, para um sinal ainda "explicar" o CEP. */
const ALCANCE_ROTULO = 200
const ALCANCE_NOME = 250
const ALCANCE_CNPJ = 150

// No texto normalizado a pontuação do CNPJ virou espaço: "02 558 157 0001 62".
const PADRAO_CNPJ_NORMALIZADO = /\b\d{2} ?\d{3} ?\d{3} ?\d{4} ?\d{2}\b/g

/**
 * Acha as posições em que o nome do cliente aparece no texto.
 *
 * Tolera OCR ruim e ordem diferente: considera "menção ao nome" todo ponto em
 * que pelo menos dois pedaços do nome aparecem próximos um do outro.
 */
function posicoesDoNome(textoNormalizado: string, nomeCliente: string, exigirPrimeiroNome = false): number[] {
  const partes = chaveTexto(nomeCliente)
    .split(" ")
    .filter((p) => p.length >= 4)
  if (partes.length === 0) return []

  const ocorrencias: { parte: string; posicao: number }[] = []
  for (const parte of partes) {
    let de = textoNormalizado.indexOf(parte)
    while (de >= 0) {
      ocorrencias.push({ parte, posicao: de })
      de = textoNormalizado.indexOf(parte, de + parte.length)
    }
  }
  ocorrencias.sort((a, b) => a.posicao - b.posicao)

  if (partes.length === 1) return ocorrencias.map((o) => o.posicao)

  // Para dizer DE QUEM é o documento, a menção é o primeiro nome com outro
  // pedaço do nome perto: casal e pais costumam ter os mesmos sobrenomes.
  if (exigirPrimeiroNome) {
    return ocorrencias
      .filter((o) => o.parte === partes[0] && ocorrencias.some((x) => x.parte !== o.parte && Math.abs(x.posicao - o.posicao) <= 40))
      .map((o) => o.posicao)
  }

  // Um nome só conta quando dois pedaços diferentes aparecem juntos: "silva"
  // sozinho aparece em qualquer lugar do documento.
  const mencoes: number[] = []
  for (let i = 0; i < ocorrencias.length; i++) {
    for (let j = i + 1; j < ocorrencias.length; j++) {
      if (ocorrencias[j]!.posicao - ocorrencias[i]!.posicao > 40) break
      if (ocorrencias[j]!.parte !== ocorrencias[i]!.parte) {
        mencoes.push(ocorrencias[i]!.posicao)
        break
      }
    }
  }
  return mencoes
}

/**
 * Lista os CEPs do documento, do mais provável para o menos.
 *
 * Numa fatura de consumo há sempre pelo menos dois endereços: o da prestadora
 * (no cabeçalho) e o do cliente. Distinguir os dois por rótulo não funciona —
 * numa conta real da operadora quem carrega o rótulo "CEP:" é justamente o
 * endereço da empresa. O que separa de verdade é o nome do cliente, que vem
 * imediatamente antes do endereço dele; na falta do nome, valem os rótulos de
 * endereço de instalação/entrega.
 */
export function extrairCeps(texto: string, nomeCliente?: string): CepCandidato[] {
  // Tudo aqui roda sobre o MESMO texto normalizado. Medir a posição do CEP no
  // texto original e a do nome no normalizado compara réguas diferentes: a
  // normalização tira pontuação e colapsa espaço, então o descompasso cresce ao
  // longo do documento e vira bônus para o endereço errado.
  const normalizado = chaveTexto(texto)
  const mencoesNome = nomeCliente ? posicoesDoNome(normalizado, nomeCliente) : []
  const fimDosCnpjs = [...normalizado.matchAll(PADRAO_CNPJ_NORMALIZADO)]
    .filter((achado) => cnpjValido(achado[0]))
    .map((achado) => (achado.index ?? 0) + achado[0].length)

  const candidatos = new Map<string, CepCandidato>()

  // No texto normalizado o hífen do CEP virou espaço.
  for (const achado of normalizado.matchAll(/\b(\d{5})\s?(\d{3})\b/g)) {
    const cep = `${achado[1]}${achado[2]}`
    const posicao = achado.index ?? 0
    const motivos: string[] = []
    let pontos = 0

    const nomeAntes = mencoesNome.filter((p) => p <= posicao && posicao - p <= ALCANCE_NOME).pop()
    if (nomeAntes !== undefined) {
      // Quanto mais colado no nome, mais forte: no bloco do cliente o endereço
      // vem logo depois do nome, sem nada no meio.
      const distancia = posicao - nomeAntes
      pontos += Math.max(15, 60 - Math.floor(distancia / 5))
      motivos.push(`o nome do cliente aparece ${distancia} caracteres antes deste endereço`)
    }

    let depoisDeRotuloCliente = false
    for (const rotulo of ROTULOS_ENDERECO_CLIENTE) {
      const de = normalizado.lastIndexOf(rotulo, posicao)
      if (de >= 0 && posicao - de <= ALCANCE_ROTULO) {
        pontos += Math.max(10, 40 - Math.floor((posicao - de) / 10))
        motivos.push(`vem logo depois de "${rotulo}"`)
        depoisDeRotuloCliente = true
        break
      }
    }

    // "O CEP da prestadora vem logo depois do CNPJ" só vale quando não há nada
    // do cliente no meio. Numa conta real da Vivo o CNPJ vem ANTES do nome e do
    // endereço do cliente — sem essa checagem, o CEP do cliente seria marcado
    // como sendo da prestadora.
    let noBlocoDoCnpj = false
    const fimCnpj = fimDosCnpjs.filter((fim) => fim <= posicao && posicao - fim <= ALCANCE_CNPJ).pop()
    if (fimCnpj !== undefined) {
      const nomeNoMeio = mencoesNome.some((p) => p > fimCnpj && p < posicao)
      const rotuloNoMeio = ROTULOS_ENDERECO_CLIENTE.some((rotulo) => {
        const de = normalizado.indexOf(rotulo, fimCnpj)
        return de >= 0 && de < posicao
      })
      if (!nomeNoMeio && !rotuloNoMeio) {
        noBlocoDoCnpj = true
        pontos -= 20
        motivos.push("vem logo depois do CNPJ da empresa — costuma ser o endereço da prestadora")
      }
    }

    // Mesmo CEP repetido em várias páginas conta uma vez só: fica com a melhor
    // pontuação e soma os sinais de todas as ocorrências.
    const existente = candidatos.get(cep)
    const depoisDoNome = nomeAntes !== undefined
    if (!existente) {
      candidatos.set(cep, { cep, posicao, pontos, motivos, depoisDoNome, depoisDeRotuloCliente, noBlocoDoCnpj })
    } else {
      const juntos: CepCandidato = {
        ...(pontos > existente.pontos ? { cep, posicao, pontos, motivos } : existente),
        depoisDoNome: existente.depoisDoNome || depoisDoNome,
        depoisDeRotuloCliente: existente.depoisDeRotuloCliente || depoisDeRotuloCliente,
        noBlocoDoCnpj: existente.noBlocoDoCnpj && noBlocoDoCnpj,
      }
      candidatos.set(cep, juntos)
    }
  }

  return [...candidatos.values()].sort((a, b) => b.pontos - a.pontos || a.posicao - b.posicao)
}

export interface CidadeUf {
  cidade: string
  uf: string
}

/** Palavras que aparecem antes do nome da cidade e não fazem parte dele. */
const RUIDO_ANTES_DA_CIDADE = new Set([
  "cidade",
  "municipio",
  "estado",
  "uf",
  "local",
  "bairro",
  "endereco",
  "cep",
  "de",
  "do",
  "da",
  "em",
  "instalacao",
  "entrega",
  "cobranca",
])

/**
 * Devolve candidatos a "cidade/UF" no texto ("SÃO PAULO - SP", "Santo André/SP",
 * "SAO PAULO SP"), do mais provável para o menos.
 *
 * São candidatos porque o texto corrido não diz onde o nome da cidade começa —
 * quem decide é a lista do IBGE, que descarta o que não existe.
 */
export function extrairCidadeUf(texto: string): CidadeUf[] {
  const padrao = new RegExp(
    String.raw`([A-Za-zÀ-ÿ'.\-]+(?:\s+[A-Za-zÀ-ÿ'.\-]+){0,3})\s*[-/,]?\s*\b(${UFS.join("|")})\b`,
    "gi",
  )

  const candidatos: CidadeUf[] = []
  const vistos = new Set<string>()

  for (const achado of texto.matchAll(padrao)) {
    const uf = achado[2]!.toUpperCase()
    const palavras = achado[1]!.split(/\s+/).filter(Boolean)

    // Tenta o nome mais curto primeiro (última palavra), depois vai
    // acrescentando as anteriores: "CENTRO SANTO ANDRE" gera "ANDRE",
    // "SANTO ANDRE", "CENTRO SANTO ANDRE".
    for (let inicio = palavras.length - 1; inicio >= 0; inicio--) {
      if (RUIDO_ANTES_DA_CIDADE.has(chaveTexto(palavras[inicio]!))) break
      const cidade = palavras.slice(inicio).join(" ")
      const chave = `${chaveTexto(cidade)}|${uf}`
      if (chaveTexto(cidade).length < 3 || vistos.has(chave)) continue
      vistos.add(chave)
      candidatos.push({ cidade, uf })
    }
  }

  return candidatos.slice(0, 12)
}

/** Datas no formato brasileiro encontradas no texto, em ordem de aparição. */
export function extrairDatas(texto: string): string[] {
  return (texto.match(/\b\d{2}[/.-]\d{2}[/.-]\d{4}\b/g) ?? []).map((d) => d.replace(/[.-]/g, "/"))
}

/** Monta uma data ISO validando o calendário — OCR gera muito "32/13/2020". */
function dataIso(dia: number, mes: number, ano: number): string | undefined {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 1900 || ano > 2100) return undefined
  const data = new Date(Date.UTC(ano, mes - 1, dia))
  if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
    return undefined
  }
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
}

/** "01/02/2015" -> "2015-02-01". Data que não existe (31/02) -> undefined. */
function dataBrParaIso(texto: string | undefined): string | undefined {
  const achado = texto?.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return achado ? dataIso(Number(achado[1]), Number(achado[2]), Number(achado[3])) : undefined
}

interface DataNoTexto {
  iso: string
  indice: number
}

// Duas formas: a normal (DD/MM/AAAA, com / . ou -) e a "meio comida" pelo OCR,
// em que a barra do meio some (DDMM/AAAA). A segunda só é aceita com 4 dígitos
// na frente, onde a leitura é inequívoca: com 3 ("107/2023") não dá pra saber
// se é 10/7 ou 1/07, e chutar aqui viraria uma data de emissão errada.
const PADRAO_DATA_NUMERICA = /\b(\d{2})[/.\-](\d{2})[/.\-](\d{4})\b|\b(\d{2})(\d{2})[/.\-](\d{4})\b/g

/** Todas as datas numéricas do texto, com a posição — a posição é o que permite ligar cada data ao rótulo dela. */
// O RG de SP (modelo antigo) escreve o mês abreviado: "13/DEZ/2012".
const MESES_ABREVIADOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
const PADRAO_DATA_MES_ABREVIADO = /\b(\d{2})\s?[/.\-]\s?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s?[/.\-]\s?(\d{4})\b/gi

function acharDatasNoTexto(texto: string): DataNoTexto[] {
  const achadas: DataNoTexto[] = []
  for (const achado of texto.matchAll(PADRAO_DATA_NUMERICA)) {
    const dia = Number(achado[1] ?? achado[4])
    const mes = Number(achado[2] ?? achado[5])
    const ano = Number(achado[3] ?? achado[6])
    const iso = dataIso(dia, mes, ano)
    if (iso) achadas.push({ iso, indice: achado.index ?? 0 })
  }
  for (const achado of texto.matchAll(PADRAO_DATA_MES_ABREVIADO)) {
    const iso = dataIso(Number(achado[1]), MESES_ABREVIADOS.indexOf(achado[2]!.toLowerCase()) + 1, Number(achado[3]))
    if (iso) achadas.push({ iso, indice: achado.index ?? 0 })
  }
  return achadas.sort((a, b) => a.indice - b.indice)
}

/** YYMMDD da MRZ para ISO. O século vem do tipo do campo: validade nunca é do século passado, nascimento nunca é futuro. */
function dataDaMrz(yymmdd: string, campo: "nascimento" | "validade"): string | undefined {
  const yy = Number(yymmdd.slice(0, 2))
  const mes = Number(yymmdd.slice(2, 4))
  const dia = Number(yymmdd.slice(4, 6))
  const anoAtual = new Date().getFullYear()

  if (campo === "validade") return dataIso(dia, mes, 2000 + yy)

  const comoDoisMil = 2000 + yy
  return dataIso(dia, mes, comoDoisMil <= anoAtual ? comoDoisMil : 1900 + yy)
}

// Linha 2 da MRZ (padrão TD1) da CNH: YYMMDD nascimento + dígito + sexo +
// YYMMDD validade + dígito + nacionalidade. Ancorar em "BRA" e ler PRA TRÁS é
// o que torna isso confiável: o começo da linha costuma vir corrompido pelo
// OCR, mas os 7 caracteres colados no "BRA" quase sempre saem limpos.
const PADRAO_MRZ_VALIDADE = /(\d{6})[0-9A-Z]?BRA/
// Campo 3 da CNH: "DD/MM/AAAA, CIDADE, UF" — data e local de nascimento juntos.
const PADRAO_NASCIMENTO_CNH = /\b(\d{2})[/.\-](\d{2})[/.\-](\d{4})\s*,\s*([A-Za-zÀ-ÿ'.\s-]{2,40}?)\s*,\s*([A-Za-z]{2})\b/i

export interface DatasCnh {
  /** Data de emissão impressa no campo 4a. */
  emissao?: string
  /** Validade impressa no campo 4b — é a data que diz se a CNH está vencida. */
  validade?: string
  /** Data de nascimento do campo 3. */
  nascimento?: string
  /** Campo "1ª HABILITAÇÃO". */
  primeiraHabilitacao?: string
}

/**
 * Datas de uma CNH.
 *
 * O valor colado no rótulo é a fonte MENOS confiável aqui: numa CNH-e real de
 * teste, o OCR leu "22/02/2031" ao lado de "4b VALIDADE" enquanto a MRZ e uma
 * segunda ocorrência da mesma data no corpo diziam 22/02/2034 — o dígito final
 * se perdeu justamente no campo pequeno ao lado do rótulo. Por isso a validade
 * sai da MRZ quando ela existe, e só cai para o rótulo se a MRZ falhar.
 */
export function extrairDatasCnh(texto: string): DatasCnh {
  const datas = acharDatasNoTexto(texto)
  const anoAtual = new Date().getFullYear()
  const resultado: DatasCnh = {}

  const nascimentoCnh = texto.match(PADRAO_NASCIMENTO_CNH)
  if (nascimentoCnh) {
    resultado.nascimento = dataIso(
      Number(nascimentoCnh[1]),
      Number(nascimentoCnh[2]),
      Number(nascimentoCnh[3]),
    )
  }

  // "1ª HABILITAÇÃO": o OCR lê o ª como º, a, o ou 2. Não pode ser antes do
  // nascimento nem cair em cima de outra data do documento.
  const primeira = dataAposRotulo(texto, datas, /\b1\s*[ªºa°o2]?\s*habilita/i)
  if (primeira && anoDe(primeira) <= anoAtual && primeira !== resultado.nascimento && (!resultado.nascimento || primeira > resultado.nascimento)) {
    resultado.primeiraHabilitacao = primeira
  }

  // "EMISSÃO" não tem equivalente na MRZ: ou sai do campo 4a, ou não sai. Na
  // CNH digital vem "4a DATA EMISSÃO 4b VALIDADE [emissão] [validade]": a
  // primeira data depois do rótulo é a emissão.
  const emissao = dataAposRotulo(texto, datas, /emiss[aã]o/i)
  const conhecidas = new Set([resultado.nascimento, resultado.primeiraHabilitacao])
  if (emissao && anoDe(emissao) <= anoAtual && !conhecidas.has(emissao)) resultado.emissao = emissao

  // A 1ª habilitação não é posterior à emissão. Na CNH antiga os rótulos vêm em
  // fila ("VALIDADE · 1ª HABILITAÇÃO") e os valores depois, na ordem validade,
  // 1ª habilitação: a primeira data depois de "1ª HABILITAÇÃO" era a validade
  // (2026 numa CNH emitida em 2021) e ficava de fora da busca da validade
  // (06/10/2026: 13 CNHs reais sem validade). A 1ª habilitação passa a ser a
  // data mais antiga depois do nascimento.
  if (resultado.primeiraHabilitacao && resultado.emissao && resultado.primeiraHabilitacao > resultado.emissao) {
    delete resultado.primeiraHabilitacao
    const antes = [...new Set(datas.map((d) => d.iso))].filter((iso) => iso < resultado.emissao! && iso !== resultado.nascimento).sort()
    // Sem o nascimento lido, a data mais antiga do documento é ele.
    const candidata = resultado.nascimento ? antes[0] : antes[1]
    if (candidata) resultado.primeiraHabilitacao = candidata
  }

  // Validade: a MRZ, quando o OCR a pegou (numa CNH-e real, o campo 4b saiu com
  // o último dígito errado e a MRZ, certa). Sem ela, a data MAIS DISTANTE do
  // documento — regra: pelo rótulo, a CNH digital dava a
  // emissão, que fica ao lado da validade, e a CNH aparecia vencida. Fora as
  // datas que já se sabe o que são (numa CNH antiga sem a validade lida, a
  // mais distante era a emissão) e as impossíveis (CNH vale no máximo 10 anos).
  const mrz = texto.replace(/\s+/g, "").match(PADRAO_MRZ_VALIDADE)
  const pelaMrz = mrz ? dataDaMrz(mrz[1]!, "validade") : undefined
  // Com uma data só não há "mais distante": numa CNH mal lida, a única data era
  // de outro campo e a CNH saía vencida em 2007.
  const distintas = new Set(datas.map((d) => d.iso))
  const maisDistante = [...(distintas.size >= 2 ? distintas : [])]
    .filter((iso) => ![resultado.nascimento, resultado.primeiraHabilitacao, resultado.emissao].includes(iso))
    .filter((iso) => anoDe(iso) >= anoAtual - 20 && anoDe(iso) <= anoAtual + 11)
    .filter((iso) => !resultado.emissao || iso > resultado.emissao)
    .sort()
    .at(-1)
  const validade = pelaMrz ?? maisDistante
  if (validade) resultado.validade = validade
  if (resultado.emissao && validade && resultado.emissao >= validade) delete resultado.emissao

  return resultado
}

function anoDe(iso: string): number {
  return Number(iso.slice(0, 4))
}

/** Distância máxima, em caracteres, entre um rótulo e o valor que ele nomeia. */
const ALCANCE_ROTULO_DATA = 60

/** Primeira data que aparece logo depois do rótulo — o campo do documento fica colado nele. */
function dataAposRotulo(texto: string, datas: DataNoTexto[], rotulo: RegExp): string | undefined {
  const achado = texto.match(rotulo)
  if (achado?.index === undefined) return undefined

  const inicio = achado.index + achado[0].length
  return datas.find((d) => d.indice >= inicio && d.indice - inicio <= ALCANCE_ROTULO_DATA)?.iso
}

/**
 * Comprovante de residência vale até o fim do 2º mês seguinte ao do
 * vencimento da fatura, qualquer que seja o dia (vence em 09/2026 → vale até
 * 30/11/2026). A Caixa só pede mês e ano.
 */
export const MESES_VALIDADE_COMPROVANTE = 2

export interface ValidadeComprovante {
  /** Vencimento de pagamento impresso na fatura (YYYY-MM-DD). */
  vencimento: string
  /** Até quando a fatura serve como comprovante de residência (YYYY-MM-DD). */
  validade: string
}

/**
 * Validade de um comprovante de residência: conta pelo mês do VENCIMENTO da
 * fatura — não da emissão, nem do mês de referência — e vai até o último dia
 * do 2º mês seguinte.
 *
 * Olha todas as ocorrências de "vencimento", não só a primeira: a palavra
 * também aparece em texto corrido ("após o vencimento será cobrada multa"),
 * sem data colada, antes do campo de verdade. E descarta data implausível pra
 * uma conta — o OCR de conta de luz traz, na mesma região, data de leitura e
 * até data antiga do medidor.
 */
export function extrairValidadeComprovante(texto: string): ValidadeComprovante | undefined {
  const datas = acharDatasNoTexto(texto)
  const anoAtual = new Date().getFullYear()

  for (const achado of texto.matchAll(/vencimento/gi)) {
    const inicio = (achado.index ?? 0) + achado[0].length
    const data = datas.find((d) => d.indice >= inicio && d.indice - inicio <= ALCANCE_ROTULO_DATA)
    if (data && anoDe(data.iso) >= anoAtual - 5 && anoDe(data.iso) <= anoAtual + 1) {
      return { vencimento: data.iso, validade: fimDoMesDepois(data.iso, MESES_VALIDADE_COMPROVANTE) }
    }
  }
  return undefined
}

/**
 * Último dia do mês `meses` depois do da data ISO, sem passar pelo fuso local
 * (meia-noite local vira o dia anterior em UTC). Dia 0 do mês seguinte = último dia.
 */
function fimDoMesDepois(iso: string, meses: number): string {
  const [ano, mes] = iso.split("-").map(Number)
  return new Date(Date.UTC(ano!, mes! + meses, 0)).toISOString().slice(0, 10)
}

/**
 * Data de emissão de uma fatura, quando ela vem impressa com rótulo ("DATA DE
 * EMISSÃO: 10/04/2026", comum em nota fiscal de energia). Nem toda fatura traz:
 * a de telefonia da Vivo não imprime data de emissão nenhuma — só o vencimento
 * e o mês de referência — e aí o campo fica vazio em vez de virar chute.
 *
 * Mesmo cuidado do vencimento: "emissão" também aparece em frase corrida sem
 * data ("até a data de emissão dessa fatura"), então vale a primeira
 * ocorrência com data colada — e a data não pode ser futura nem posterior ao
 * vencimento da própria fatura.
 */
export function extrairEmissaoComprovante(texto: string, vencimento?: string): string | undefined {
  const datas = acharDatasNoTexto(texto)
  const hoje = new Date().toISOString().slice(0, 10)
  const anoAtual = Number(hoje.slice(0, 4))

  for (const achado of texto.matchAll(/emiss[aã]o/gi)) {
    const inicio = (achado.index ?? 0) + achado[0].length
    const data = datas.find((d) => d.indice >= inicio && d.indice - inicio <= ALCANCE_ROTULO_DATA)
    if (!data || anoDe(data.iso) < anoAtual - 5 || data.iso > hoje) continue
    if (vencimento && data.iso > vencimento) continue
    return data.iso
  }
  return undefined
}

/**
 * Data de nascimento em documento que traz o campo rotulado e tem uma pessoa
 * só (ficha de cadastro do banco, por exemplo). Não serve para certidão de
 * casamento, que tem duas datas de nascimento — uma por cônjuge.
 */
export function extrairDataNascimentoRotulada(texto: string): string | undefined {
  const datas = acharDatasNoTexto(texto)
  const nascimento =
    dataAposRotulo(texto, datas, /data\s+de\s+nascimento/i) ??
    // O OCR perde o "DATA" do rótulo miúdo do RG: "DE NASCIMENTO 01/02/1960".
    dataAposRotulo(texto, datas, /(?<!certid[aã]o\s|registro\s)\bde\s+nascimento/i)
  if (!nascimento) return undefined
  return anoDe(nascimento) <= new Date().getFullYear() - 14 ? nascimento : undefined
}

export interface LocalNascimento {
  cidade: string
  uf: string
}

// Certidões (nascimento/casamento) trazem "Natural de: Cidade-UF" e a ficha de
// cadastro do banco traz "Naturalidade: CIDADE / UF". A tolerância no meio
// cobre o que o OCR faz com o separador: "natural de Itapeva -:SP",
// "Natural de: Piracicaba-SP", "Naturalidade:   PIRACICABA / SP". A cidade não
// atravessa linha: no RG antigo o rótulo seguinte vem colado ("NATURALIDADE
// DATA DE NASCIMENTO" / "S.PAULO -SP") e virava a cidade "Data de Nascimento".
const PADRAO_NATURAL_DE =
  /natural(?:idade)?\s*(?:de)?\s*:?\s*([A-Za-zÀ-ÿ'. \t]{2,40}?)\s*[-–/:,]+\s*([A-Za-z]{2})\b/gi

// RG e Carteira de Identidade Nacional: os rótulos numa linha ("Naturalidade |
// Place of Birth  Data de Validade") e os valores na linha de baixo, a
// naturalidade primeiro ("SANTOS/SP  01/01/2030"). Roda no texto sem acento.
const PADRAO_NATURALIDADE_LINHA_DE_BAIXO = /naturalidade[^\n]{0,80}\n\s*([a-z][a-z' .]{1,40}?)\s*[-/]\s*([a-z]{2})\b/g
// RG de SP lido pelo PaddleOCR: o rótulo NATURALIDADE fica em outra coluna e
// a cidade cai entre "DATA DE NASCIMENTO" e a data ("NASCIMENTO SANTOS - SP 01/02/1960").
const PADRAO_NATURALIDADE_ANTES_DA_DATA = /nascimento\s+([a-z][a-z' .]{1,40}?)\s*-\s*([a-z]{2})\s+\d{2}\/\d{2}\/\d{4}/g

/**
 * Local de nascimento (naturalidade): cidade e UF.
 *
 * Sai de duas fontes — o campo 3 da CNH ("DD/MM/AAAA, CIDADE, UF") e o
 * "Natural de: Cidade-UF" das certidões. Uma certidão de casamento tem DOIS
 * (um por cônjuge), então quando o nome do cliente é conhecido vale o mais
 * próximo dele — mesma lógica que já separa o endereço do cliente do endereço
 * da prestadora numa fatura. Sem nome e com mais de um candidato, não escolhe:
 * devolve nada em vez de chutar o cônjuge errado.
 */
export function extrairLocalNascimento(texto: string, nomeCliente?: string): LocalNascimento | undefined {
  // Uma régua só para os dois lados da conta: a posição dos candidatos e a das
  // menções ao nome precisam sair do MESMO texto. `semAcento` serve porque
  // preserva a pontuação de que os padrões dependem ("Natural de: Cidade-UF") e
  // não colapsa espaço — medir candidato no texto cru e nome no texto colapsado
  // desalinha as duas ao longo do documento (foi o bug do extrairCeps).
  const base = semAcento(texto)
  const candidatos: { valor: LocalNascimento; indice: number }[] = []

  const nascimentoCnh = base.match(PADRAO_NASCIMENTO_CNH)
  if (nascimentoCnh?.index !== undefined) {
    const uf = nascimentoCnh[5]!.toUpperCase()
    if (UFS.includes(uf)) {
      candidatos.push({
        valor: { cidade: capitalizar(limparCidade(nascimentoCnh[4]!)), uf },
        indice: nascimentoCnh.index,
      })
    }
  }

  for (const padrao of [PADRAO_NATURAL_DE, PADRAO_NATURALIDADE_LINHA_DE_BAIXO, PADRAO_NATURALIDADE_ANTES_DA_DATA]) {
    for (const achado of base.matchAll(padrao)) {
      const cidade = limparCidade(achado[1]!)
      const uf = achado[2]!.toUpperCase()
      if (cidade.length >= 2 && UFS.includes(uf)) {
        candidatos.push({ valor: { cidade: capitalizar(cidade), uf }, indice: achado.index ?? 0 })
      }
    }
  }

  return escolherPeloNome(candidatos, base, nomeCliente, ALCANCE_NOME_NATURALIDADE)
}

/** Distância máxima entre o nome do cônjuge e um dado dele, no texto corrido da certidão. */
const ALCANCE_NOME_NATURALIDADE = 400

/**
 * Entre vários candidatos do mesmo tipo, o que é desta pessoa: o mais próximo
 * de uma menção ao nome dela, e sempre DEPOIS dessa menção — é assim que a
 * certidão se organiza (nome, nascimento, naturalidade, filiação, e repete
 * para o outro cônjuge). Sem nome, ou sem menção antes de algum candidato,
 * não escolhe: dado do cônjuge errado é pior que campo vazio.
 */
function escolherPeloNome<T>(
  candidatos: { valor: T; indice: number }[],
  base: string,
  nomeDaPessoa: string | undefined,
  alcance: number,
): T | undefined {
  if (candidatos.length === 0) return undefined
  // Um candidato só, ou todos dizendo a mesma coisa: não há o que escolher.
  if (new Set(candidatos.map((c) => JSON.stringify(c.valor))).size === 1) return candidatos[0]!.valor
  if (!nomeDaPessoa) return undefined

  const mencoes = posicoesDoNome(base, nomeDaPessoa)
  if (mencoes.length === 0) return undefined

  return candidatos
    .map((candidato) => {
      const anterior = mencoes.filter((posicao) => posicao <= candidato.indice).pop()
      return { candidato, distancia: anterior === undefined ? Infinity : candidato.indice - anterior }
    })
    .filter((item) => item.distancia <= alcance)
    .sort((a, b) => a.distancia - b.distancia)[0]?.candidato.valor
}

/** "laranjal paulista" -> "Laranjal Paulista": o texto base está todo em minúsculas. */
function capitalizar(valor: string): string {
  return valor
    .split(/\s+/)
    .map((palavra) =>
      palavra.length <= 2 ? palavra : palavra[0]!.toUpperCase() + palavra.slice(1).toLowerCase(),
    )
    .join(" ")
}

/** Tira rótulo vazado e pontuação solta que o OCR cola no nome da cidade. */
function limparCidade(bruto: string): string {
  return bruto
    .replace(/\s+/g, " ")
    .replace(/^[\s.:,-]+|[\s.:,-]+$/g, "")
    .replace(/^(?:de|da|do|em)\s+/i, "")
    .trim()
}

export interface Filiacao {
  pai?: string
  mae?: string
}

// Pai e mãe saem do rótulo escrito. O nome vai até o fim da linha, até a
// pontuação, até um número ou até o próximo rótulo — sem essa parada, num OCR
// que colapsa tudo numa linha só o nome do pai engole o rótulo seguinte e vira
// "joao da silva nome da". O texto base está sem acento e em minúsculas.
const PADRAO_PAI =
  /\b(?:nome\s+d[oe]\s+)?(?:pai|genitor)\s*:?\s*([a-z][a-z'\- ]{4,59}?)(?=\s*(?:[\n\r,;:|/]|\d|$|\b(?:nome|pai|mae|genitor|genitora|filiacao|nascid|natural|data|cpf|rg|estado|sexo|grau|profiss|nacional|avo|avos|residen|endereco|telefone|serie|orgao|expedi|matricula|livro|folha|termo)\b))/g

const PADRAO_MAE =
  /\b(?:nome\s+d[ae]\s+)?(?:mae|genitora)\s*:?\s*([a-z][a-z'\- ]{4,59}?)(?=\s*(?:[\n\r,;:|/]|\d|$|\b(?:nome|pai|mae|genitor|genitora|filiacao|nascid|natural|data|cpf|rg|estado|sexo|grau|profiss|nacional|avo|avos|residen|endereco|telefone|serie|orgao|expedi|matricula|livro|folha|termo)\b))/g

const PADRAO_NACIONALIDADE = /\bnacionalidade\s*:?\s*([a-z]{4,20})\b/g

/** Palavras que aparecem depois do rótulo mas não são nome de gente. */
const NAO_E_NOME = new Set(["nao", "sim", "consta", "nao consta", "ignorado", "desconhecido", "falecido", "falecida"])

/** "MARIA DAS GRACAS" -> "Maria das Gracas": partícula de nome vai minúscula. */
function capitalizarNome(valor: string): string {
  return capitalizar(valor)
    .split(" ")
    .map((palavra) => (PARTICULAS_DO_NOME.has(semAcento(palavra)) ? palavra.toLowerCase() : palavra))
    .join(" ")
}

/**
 * Só vira nome quem tem cara de nome: dois pedaços ou mais, sem dígito, e não
 * um "não consta" do cartório. O resto é ruído de OCR e vira campo vazio.
 */
function nomeDePessoa(bruto: string | undefined): string | undefined {
  const nome = bruto?.replace(/\s+/g, " ").trim()
  if (!nome || nome.length < 6 || nome.length > 60 || NAO_E_NOME.has(nome)) return undefined
  const palavras = nome.split(" ")
  if (palavras.some((p) => p.length < 2)) return undefined
  if (palavras.filter((p) => !PARTICULAS_DO_NOME.has(p)).length < 2) return undefined
  return capitalizarNome(nome)
}

const PARTICULAS_DO_NOME = new Set(["de", "da", "do", "das", "dos", "e"])

/**
 * Nome do pai e da mãe.
 *
 * Só sai de rótulo escrito ("Nome do Pai:", "Genitora:"). A forma sem rótulo
 * das certidões — "Filiação: FULANO e BELTRANA" — fica de fora de propósito:
 * ali a ordem é convenção, e quando um dos dois não consta não há como saber
 * qual sobrou. Pai e mãe trocados no formulário do banco é pior que vazio.
 *
 * Certidão de casamento traz a filiação dos DOIS cônjuges; com o nome da
 * pessoa em mãos vale o par mais próximo de uma menção a ela.
 */
/** Palavras que aparecem no meio da filiacao do RG e nao sao nome de gente. */
const RUIDO_NA_FILIACAO = [
  "filiacao", "data", "nascimento", "registro", "orgao", "expedidor", "expedicao", "emissao",
  "naturalidade", "documento", "origem", "cpf", "rg", "via", "assinatura", "polegar", "lei",
  "valida", "validade", "territorio", "nacional", "republica", "federativa", "brasil", "estado",
  "secretaria", "seguranca", "publica", "instituto", "identificacao", "diretor", "digital",
  "observacoes", "habilitacao", "categoria", "permissao", "condutor", "renach",
  // CNH digital: o carimbo "ASSINADO DIGITALMENTE / DEPARTAMENTO ESTADUAL DE TRÂNSITO".
  "assinado", "digitalmente", "departamento", "transito",
]

/**
 * Filiacao do RG e da CNH, onde nao ha rotulo por pessoa: vem a palavra
 * "Filiação" e, nas linhas seguintes, os dois nomes — com sujeira de OCR no
 * meio ("Filiação / JOSE DA SILVA / <lixo> MARIA DA SILVA").
 *
 * Aproveita que nesses documentos o nome vem em CAIXA ALTA e a sujeira nao:
 * pega as sequencias de duas ou mais palavras todas maiusculas e joga fora as
 * que tem palavra de rotulo dentro. Sem nenhuma sequencia assim, devolve nada.
 *
 * A ORDEM decide quem e quem (pai primeiro, mae depois), que e como esses
 * documentos sao impressos. Com um nome so nao da para saber de quem e — pai
 * ausente no registro e comum — entao nao escolhe.
 */
function filiacaoSemRotulo(texto: string): Filiacao | undefined {
  // Na CNH digital a marca d'água cobre o rótulo "FILIAÇÃO" (sai "cYanma n
  // cel"); os nomes vêm logo depois da nacionalidade, que é uma palavra só.
  const base = semAcento(texto)
  const cnh = /\bhabilitacao\b/.test(base)
  const rotulo = base.search(/\bfiliacao\b/)
  const inicio = rotulo >= 0 ? rotulo : cnh ? base.search(/\bnacionalidade\b/) : -1
  if (inicio < 0) return undefined

  // O próprio rótulo sai da frente: em documento todo em caixa alta ele gruda
  // no primeiro nome ("FILIACAO JOSE CARLOS").
  // Até a assinatura: depois dela vêm carimbo, categorias e local de emissão
  // ("SAO PAULO, SP"), e na CNH digital o "ASSINADO DIGITALMENTE" virava a mãe.
  const trecho = texto.slice(inicio, inicio + 400)
  const fim = trecho.search(/assinatura|assinado/i)
  const bloco = (fim > 0 ? trecho.slice(0, fim) : trecho).replace(/filia[cç][aã]o|nacionalidade/gi, " ")
  // `undefined` = havia um nome ali, mas ilegível: na CNH o OCR cola o nome
  // inteiro numa palavra só ("JOSEDASILVA"). Ele segura a posição, e o outro
  // continua sabendo se é o pai ou a mãe.
  const nomes: (string | undefined)[] = []
  // `[ \t]` e nao `\s`: nome nao atravessa linha, e com `\s` o "MARIA DAS
  // GRACAS" grudava no "DATA DE NASCIMENTO" da linha de baixo.
  for (const achado of bloco.matchAll(/[A-ZÀ-Ý][A-ZÀ-Ý'-]+(?:[ \t]+[A-ZÀ-Ý][A-ZÀ-Ý'-]+)+|^[ \t]*([A-ZÀ-Ý]{12,})[ \t]*$/gm)) {
    if (achado[1]) {
      if (cnh) nomes.push(undefined)
    } else {
      // Sigla e número colados antes do nome ("2 VIA", "SSP 12345 MARIA...").
      const palavras = achado[0]!.split(/\s+/).filter(Boolean)
      while (palavras.length > 2 && /\d/.test(palavras[0]!)) palavras.shift()

      const bruto = palavras.join(" ")
      const semAcentos = semAcento(bruto)
      if (semAcentos.split(" ").some((p) => RUIDO_NA_FILIACAO.includes(p))) continue
      if (!nomeDePessoa(semAcentos)) continue
      nomes.push(capitalizarNome(bruto))
    }
    if (nomes.length === 2) break
  }
  if (nomes.length < 2 || nomes.every((n) => !n)) return undefined
  return semVazios({ pai: nomes[0], mae: nomes[1] })
}

export function extrairFiliacao(texto: string, nomeDaPessoa?: string): Filiacao | undefined {
  const base = semAcento(texto)
  const acharTodos = (padrao: RegExp) =>
    [...base.matchAll(padrao)]
      .map((achado) => ({ valor: nomeDePessoa(achado[1]), indice: achado.index ?? 0 }))
      .filter((c): c is { valor: string; indice: number } => Boolean(c.valor))

  const pai = escolherPeloNome(acharTodos(PADRAO_PAI), base, nomeDaPessoa, ALCANCE_NOME_NATURALIDADE)
  const mae = escolherPeloNome(acharTodos(PADRAO_MAE), base, nomeDaPessoa, ALCANCE_NOME_NATURALIDADE)
  if (pai || mae) return semVazios({ pai, mae })

  // Sem rótulo por pessoa: é o RG e a CNH. Só vale o par completo.
  return filiacaoSemRotulo(texto)
}

/**
 * Nacionalidade ("Brasileira"). Sai do rótulo ou, no RG e no passaporte, do
 * "BRA" da zona de leitura mecânica. Quando o documento traz a de mais de uma
 * pessoa e todas dizem a mesma coisa, não há o que decidir.
 */
export function extrairNacionalidade(texto: string, nomeDaPessoa?: string): string | undefined {
  const base = semAcento(texto)
  // Palavra com maiúscula no meio ("cYanmaG") é a marca d'água da CNH digital
  // lida como texto, não nacionalidade.
  const misturadas = new Set((texto.match(/\p{L}*\p{Ll}\p{Lu}\p{L}*/gu) ?? []).map((p) => semAcento(p)))
  const candidatos = [...base.matchAll(PADRAO_NACIONALIDADE)]
    .filter((achado) => !NAO_E_NOME.has(achado[1]!) && !misturadas.has(achado[1]!))
    // A CNH imprime "BRASILEIRO(A)"; o formulário do banco pede "Brasileira",
    // como as outras leituras daqui já devolvem.
    .map((achado) => ({ valor: /^brasileir/.test(achado[1]!) ? "Brasileira" : capitalizar(achado[1]!), indice: achado.index ?? 0 }))

  if (candidatos.length > 0) return escolherPeloNome(candidatos, base, nomeDaPessoa, ALCANCE_NOME_NATURALIDADE)

  // Carteira de Identidade Nacional: "Nacionalidade / Nationality" numa linha e,
  // na de baixo, a data de nascimento e o código "BRA".
  if (/\bnacionalidade\b[^\n]{0,60}\n[^\n]{0,30}\bbra\b/.test(base)) return "Brasileira"
  return PADRAO_MRZ_VALIDADE.test(base.toUpperCase()) ? "Brasileira" : undefined
}

// Grau de instrução e tipo de documento de identificação: rótulo e valor curto,
// como a ficha de cadastro do banco escreve. O valor só passa se contiver uma
// palavra conhecida do campo — OCR torto costuma entregar o rótulo seguinte, e
// um valor plausível e errado vai direto para o formulário.
const PADRAO_GRAU_INSTRUCAO =
  /\b(?:grau\s+de\s+instrucao|escolaridade|instrucao)\s*:?\s*([a-z][a-z\- ]{2,39}?)(?=\s*(?:[\n\r,;:|/]|\d|$|\b(?:nome|pai|mae|cpf|rg|pis|nis|estado|sexo|data|naturalidade|nacionalidade|tipo|grau|ocupa|profiss|endereco|telefone|email)\b))/g

const PADRAO_TIPO_IDENTIDADE =
  /\btipo\s+de\s+(?:documento(?:\s+de\s+identificacao)?|identificacao|identidade)\s*:?\s*([a-z][a-z\- ]{1,39}?)(?=\s*(?:[\n\r,;:|/]|\d|$|\b(?:nome|pai|mae|cpf|rg|pis|nis|estado|sexo|data|naturalidade|nacionalidade|tipo|grau|ocupa|profiss|endereco|telefone|email|numero|orgao|emissor)\b))/g

const PALAVRAS_GRAU = [
  "analfabeto",
  "alfabetizado",
  "primario",
  "fundamental",
  "ginasio",
  "medio",
  "colegial",
  "tecnico",
  "superior",
  "tecnologo",
  "pos",
  "especializacao",
  "mestrado",
  "doutorado",
]

const PALAVRAS_IDENTIDADE = [
  "rg",
  "identidade",
  "cnh",
  "habilitacao",
  "passaporte",
  "rne",
  "crnm",
  "reservista",
  "funcional",
  "militar",
  "profissional",
]

/** "pos-graduacao" -> ["pos", "graduacao"]: o hifen tambem separa palavra. */
const palavrasDoValor = (valor: string) => valor.split(" ").flatMap((parte) => parte.split("-"))

/** "rg" -> "RG", "superior completo" -> "Superior Completo". */
function apresentar(valor: string): string {
  return valor.length <= 4 && !valor.includes(" ") ? valor.toUpperCase() : capitalizar(valor)
}

function valorComPalavraConhecida(
  base: string,
  padrao: RegExp,
  esperadas: string[],
  nomeDaPessoa: string | undefined,
): string | undefined {
  const candidatos = [...base.matchAll(padrao)]
    .map((achado) => ({ valor: achado[1]!.replace(/\s+/g, " ").trim(), indice: achado.index ?? 0 }))
    .filter((c) => palavrasDoValor(c.valor).some((palavra) => esperadas.includes(palavra)))
    .map((c) => ({ valor: apresentar(c.valor), indice: c.indice }))

  return escolherPeloNome(candidatos, base, nomeDaPessoa, ALCANCE_NOME_NATURALIDADE)
}

/** Grau de instrução, como o documento escreve ("Superior", "Medio Completo"). */
export function extrairGrauDeInstrucao(texto: string, nomeDaPessoa?: string): string | undefined {
  const base = semAcento(texto)
  return valorComPalavraConhecida(base, PADRAO_GRAU_INSTRUCAO, PALAVRAS_GRAU, nomeDaPessoa)
}

/** Que documento identifica a pessoa: RG, CNH, passaporte. */
export function extrairTipoDeIdentidade(texto: string, nomeDaPessoa?: string): string | undefined {
  const base = semAcento(texto)
  return valorComPalavraConhecida(base, PADRAO_TIPO_IDENTIDADE, PALAVRAS_IDENTIDADE, nomeDaPessoa)
}

/** O documento fala desta pessoa? É o que decide se os dados dele são dela. */
export function mencionaNome(texto: string, nome: string): boolean {
  return posicoesDoNome(semAcento(texto), nome).length > 0
}

/** Como `mencionaNome`, mas com o primeiro nome junto: "TESTE DA SILVEIRA" é o sobrenome do casal inteiro. */
export function citaPeloNome(texto: string, nome: string): boolean {
  return posicoesDoNome(semAcento(texto), nome, true).length > 0
}

/**
 * Num documento de duas pessoas (certidão de casamento), o pedaço que é de uma
 * delas: de cada menção ao nome dela até a próxima menção a outra. A certidão
 * se organiza assim — nome, nascimento, naturalidade, filiação, e repete para
 * o outro cônjuge —, então dado lido no pedaço de um nunca vai para o outro.
 * Sai sem acento e em minúsculas (é onde as posições do nome são medidas).
 */
export function trechoDaPessoa(texto: string, nome: string, outrosNomes: string[]): string {
  const base = semAcento(texto)
  const outras = outrosNomes.flatMap((n) => posicoesDoNome(base, n, true)).sort((a, b) => a - b)
  const pedacos: string[] = []
  let fimAnterior = -1
  for (const inicio of posicoesDoNome(base, nome, true).sort((a, b) => a - b)) {
    if (inicio < fimAnterior) continue
    fimAnterior = outras.find((p) => p > inicio) ?? base.length
    pedacos.push(base.slice(inicio, fimAnterior))
  }
  return pedacos.join("\n")
}

const MESES_POR_EXTENSO: Record<string, string> = {
  janeiro: "01",
  fevereiro: "02",
  marco: "03",
  abril: "04",
  maio: "05",
  junho: "06",
  julho: "07",
  agosto: "08",
  setembro: "09",
  outubro: "10",
  novembro: "11",
  dezembro: "12",
}

// Exige a vírgula logo antes do dia: é o "Local, DD de mês de AAAA" do
// fechamento de certidão de cartório (matrícula, certidões em geral) — uma
// data por extenso solta no meio do texto ("averbado em 10 de setembro de
// 2026") não tem essa vírgula, então não bate.
const PADRAO_DATA_CARTORIO =
  /,\s*(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})\b/gi

/**
 * Data de expedição de uma certidão de cartório (matrícula de imóvel,
 * certidões em geral), no formato "Local, DD de mês de AAAA" que fecha esse
 * tipo de documento — ex: "Piracicaba/SP, 10 de setembro de 2026."
 *
 * Diferente do resto da extração, aqui vale preencher sozinho: essa data é
 * inequívoca (o próprio cartório está datando a expedição da certidão, não é
 * uma data de vencimento nem um evento do corpo do documento) e sempre no
 * fechamento — por isso pega a ÚLTIMA ocorrência, não a primeira.
 */
export function extrairDataEmissaoCartorio(texto: string): string | undefined {
  const ocorrencias = [...texto.matchAll(PADRAO_DATA_CARTORIO)]
  const ultima = ocorrencias.at(-1)
  if (!ultima) return undefined

  const dia = ultima[1]!.padStart(2, "0")
  const mes = MESES_POR_EXTENSO[ultima[2]!.toLowerCase().replace(/ç/g, "c")]
  const ano = ultima[3]!
  if (!mes) return undefined

  return `${ano}-${mes}-${dia}`
}

/** Rótulo que antecede o nome do empregador na CTPS / no holerite. */
const ROTULO_EMPREGADOR =
  /(?:empregador|raz[aã]o\s+social|nome\s+do\s+empregador|empresa|estabelecimento)\s*[:\-–]?\s+/i

/** Onde o nome do empregador termina — o próximo campo do documento. */
const FIM_DO_NOME =
  /\s+(?:cnpj|cpf|cargo|fun[cç][aã]o|data\s+de\s+admiss[aã]o|admiss[aã]o|pis|pasep|endere[cç]o|remunera[cç][aã]o|sal[aá]rio|categoria|contrato|cbo|matr[ií]cula)\b/i

/**
 * Tenta o nome do empregador: acha o rótulo e pega o que vem depois, até o
 * próximo campo conhecido.
 */
export function extrairEmpregador(texto: string): string | undefined {
  const rotulo = texto.match(ROTULO_EMPREGADOR)
  if (!rotulo || rotulo.index === undefined) return undefined

  const depois = texto.slice(rotulo.index + rotulo[0].length)
  const fim = depois.match(FIM_DO_NOME)
  const bruto = (fim?.index !== undefined ? depois.slice(0, fim.index) : depois).split(/\r?\n/)[0] ?? ""

  const nome = bruto.replace(/\s+/g, " ").replace(/^[-:•.\s]+/, "").trim().slice(0, 120)
  return nome.length >= 4 ? nome : undefined
}

/**
 * Normaliza sem mudar o comprimento: cada caractere vira um só (sem acento,
 * minúsculo, e o que não é letra nem dígito vira espaço). Busca feita aqui
 * aponta pra mesma posição no texto original — dá pra recortar o trecho de
 * verdade pra tela. `chaveTexto` colapsa espaços e desalinha as posições.
 */
function normalizarNoLugar(texto: string): string {
  let saida = ""
  for (let i = 0; i < texto.length; i++) {
    // NFD separa a letra do acento ("ã" → "a" + til): a primeira unidade é a letra base.
    const letra = texto[i]!.normalize("NFD")[0]!.toLowerCase()
    saida += /^[a-z0-9]$/.test(letra) ? letra : " "
  }
  return saida
}

function recortar(texto: string, indice: number): string {
  const inicio = Math.max(0, indice - 90)
  const fim = Math.min(texto.length, indice + 130)
  return `${inicio > 0 ? "…" : ""}${texto.slice(inicio, fim).replace(/\s+/g, " ").trim()}${fim < texto.length ? "…" : ""}`
}

/**
 * Leitura da matrícula do imóvel para descobrir se ele ainda está financiado —
 * o que obriga o processo a ter Interveniente Quitante (IQ): o banco novo
 * precisa falar com o banco credor para quitar a dívida antes de registrar a
 * nova garantia.
 *
 * A matrícula é uma sequência cronológica de atos (R.n registros, AV.n
 * averbações), e a garantia é citada tanto no ato que a constitui quanto no
 * que a cancela ("CANCELAMENTO DE PROPRIEDADE FIDUCIÁRIA", "fica CANCELADO o
 * registro da hipoteca"). Por isso cada menção a garantia é julgada pelo que
 * vem logo antes: com palavra de baixa (cancelamento, quitação, desligado…)
 * nos 80 caracteres anteriores, a menção é do ato de baixa; sem, é garantia
 * (constituição, transporte de ônus, cessão, renegociação). Decide a ÚLTIMA
 * menção do texto.
 *
 * Conferido contra matrículas reais: duas alienações canceladas e uma
 * terceira, do comprador seguinte, ainda ativa; hipoteca de construtora
 * "desligada" e alienação depois cedida a banco; hipoteca e caução antigas
 * canceladas "nos termos da quitação". A lista fixa de frases de baixa usada
 * antes não tinha "cancelamento de propriedade fiduciária" e lia o próprio
 * cancelamento como garantia nova.
 *
 * Limite conhecido: cancelamento que só cita o número do ato ("cancelado o
 * R.5"), sem dizer que era alienação ou hipoteca, não é reconhecido. A
 * conclusão cai no lado seguro (garantia ativa) e o trecho vai junto pra
 * conferência.
 */
export interface AnaliseMatricula {
  /** Há garantia registrada e sem baixa posterior → provável IQ. */
  garantiaAtiva: boolean
  /** Havia garantia, mas com cancelamento averbado depois. */
  garantiaBaixada: boolean
  /** Termos encontrados, para o usuário conferir a conclusão. */
  sinais: string[]
  /** Trecho do texto em volta da última garantia. */
  trechoGarantia?: string
  /** Trecho em volta da baixa, quando é ela que fecha a matrícula. */
  trechoBaixa?: string
}

const PADRAO_GARANTIA =
  /alienacao\s+fiduciaria|propriedade\s+fiduciaria|credora?\s+fiduciari[ao]|divida\s+hipotecaria|hipoteca|caucao/g
const PADRAO_BAIXA =
  /cancelad[ao]|cancelamento|baixa\s+d[ao]|quitacao|extincao|desligad[ao]|liberacao\s+d[ao]|consolidacao\s+da\s+propriedade/g
const ALCANCE_BAIXA = 80

const juntarEspacos = (termo: string) => termo.replace(/\s+/g, " ")

export function analisarMatricula(texto: string): AnaliseMatricula {
  const normalizado = normalizarNoLugar(texto)
  const baixas = [...normalizado.matchAll(PADRAO_BAIXA)].map((b) => ({ indice: b.index ?? 0, termo: b[0] }))

  let garantia: { indice: number; termo: string } | undefined
  let baixa: { indice: number; termo: string; palavra: string } | undefined

  for (const mencao of normalizado.matchAll(PADRAO_GARANTIA)) {
    const indice = mencao.index ?? 0
    // (sem findLast: é o último que passa no filtro)
    const candidatas = baixas.filter((b: { indice: number; termo: string }) => b.indice < indice && indice - b.indice <= ALCANCE_BAIXA)
    const palavraDeBaixa = candidatas[candidatas.length - 1]
    if (palavraDeBaixa) baixa = { indice, termo: mencao[0], palavra: palavraDeBaixa.termo }
    else garantia = { indice, termo: mencao[0] }
  }

  if (!garantia && !baixa) return { garantiaAtiva: false, garantiaBaixada: false, sinais: [] }

  const ativa = !!garantia && !(baixa && baixa.indice > garantia.indice)
  const sinais = [
    ...(garantia ? [juntarEspacos(garantia.termo)] : []),
    ...(!ativa && baixa ? [`${juntarEspacos(baixa.palavra)} (${juntarEspacos(baixa.termo)})`] : []),
  ]

  return {
    garantiaAtiva: ativa,
    garantiaBaixada: !ativa,
    sinais,
    trechoGarantia: garantia ? recortar(texto, garantia.indice) : undefined,
    trechoBaixa: !ativa && baixa ? recortar(texto, baixa.indice) : undefined,
  }
}

export interface MencaoCidadeImovel {
  /** Até 5 palavras normalizadas depois de um "de": o nome da cidade está no começo delas. */
  palavras: string[]
  origem: "descricao" | "cartorio"
  /** Menções do mesmo ponto do texto (mesma âncora) — só a primeira que for cidade vale. */
  grupo: number
}

// O que vem depois de "de" no nome do cartório e não é cidade — "Registro" é
// município de SP, então "cartório de registro" precisa ser barrado antes.
const PALAVRAS_DE_CARTORIO = new Set([
  "registro", "imoveis", "imovel", "titulos", "documentos", "pessoa", "pessoas", "juridica", "juridicas",
  "notas", "protesto", "protestos", "justica", "direito", "oficio", "servico", "comarca", "circunscricao",
  "imobiliaria", "civil", "matricula",
])

/** Descrição do imóvel costuma dar rua e bairro antes do município: "situado na Rua X, nº Y, bairro Z, do município de…". */
const ALCANCE_DESCRICAO_MUNICIPIO = 300

function palavrasDepoisDoDe(normalizado: string, inicio: number, alcance: number): string[][] {
  const saida: string[][] = []
  for (const de of normalizado.slice(inicio, inicio + alcance).matchAll(/\bd[aeo]\s+/g)) {
    const depois = inicio + (de.index ?? 0) + de[0].length
    const palavras = [...normalizado.slice(depois, depois + 60).matchAll(/[a-z0-9]+/g)].slice(0, 5).map((p) => p[0])
    if (palavras.length > 0 && !PALAVRAS_DE_CARTORIO.has(palavras[0]!)) saida.push(palavras)
  }
  return saida
}

/**
 * Onde a matrícula diz em que cidade fica o imóvel, na ordem em que vale:
 *
 * 1. A descrição do imóvel ("situado na Rua X… no perímetro urbano do
 *    município e comarca de Y", ou "Cadastrado na Prefeitura Municipal de Y" —
 *    forma comum de referência ao cadastro de IPTU dentro da descrição).
 *    Quando existe, manda: a certidão pode vir do cartório de outra comarca —
 *    numa matrícula real, o imóvel ficava num município que ganhou cartório
 *    próprio depois de a matrícula ser aberta no vizinho.
 * 2. O cartório ("Oficial de Registro de Imóveis da Comarca de São Paulo").
 *    Muita matrícula só descreve rua e bairro; aí a cidade é a da comarca.
 *
 * Aqui só saem as palavras depois de cada "de". Onde o nome termina — e se
 * aquilo é mesmo uma cidade — quem decide é a lista de municípios do IBGE, em
 * `leitura.ts`. Isso também absorve OCR que cola palavras ("saopaulo").
 */
export function extrairMencoesCidadeImovel(texto: string): MencaoCidadeImovel[] {
  const normalizado = normalizarNoLugar(texto)
  const mencoes: MencaoCidadeImovel[] = []
  let grupo = 0

  for (const descricao of normalizado.matchAll(/\b(?:situad[oa]|localizad[oa]|imovel|terreno|apartamento|lote)\b/g)) {
    const inicio = descricao.index ?? 0
    // "município" ("...no município e comarca de X") ou "prefeitura" ("Cadastrado
    // na Prefeitura Municipal de X", forma comum de cadastro de IPTU na descrição)
    // — as duas dizem a cidade do imóvel, não a do cartório.
    const municipio = normalizado
      .slice(inicio, inicio + ALCANCE_DESCRICAO_MUNICIPIO)
      .match(/\bmunicipio\b|\bprefeitura\b/)
    if (!municipio) continue
    const depoisDoMunicipio = inicio + (municipio.index ?? 0) + municipio[0].length
    for (const palavras of palavrasDepoisDoDe(normalizado, depoisDoMunicipio, 90)) {
      mencoes.push({ palavras, origem: "descricao", grupo })
    }
    grupo++
    break
  }

  const ancorasDeCartorio: [RegExp, number][] = [
    [/\bregistro\s+de\s+imoveis\b/g, 90],
    [/\bcomarca\b/g, 12],
  ]
  for (const [ancora, alcance] of ancorasDeCartorio) {
    for (const achado of normalizado.matchAll(ancora)) {
      const depois = (achado.index ?? 0) + achado[0].length
      for (const palavras of palavrasDepoisDoDe(normalizado, depois, alcance)) {
        mencoes.push({ palavras, origem: "cartorio", grupo })
      }
      grupo++
    }
  }

  return mencoes
}

/** UFs escritas logo depois do nome da cidade em qualquer ponto do texto ("Bom Jesus-GO"), da mais citada pra menos. */
export function ufsLogoDepoisDoNome(texto: string, palavrasDoNome: string[]): string[] {
  const padrao = new RegExp(`\\b${palavrasDoNome.join("\\s+")}\\s+(${UFS.join("|").toLowerCase()})\\b`, "g")
  const contagem = new Map<string, number>()
  for (const achado of normalizarNoLugar(texto).matchAll(padrao)) {
    const uf = achado[1]!.toUpperCase()
    contagem.set(uf, (contagem.get(uf) ?? 0) + 1)
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([uf]) => uf)
}

// ---------------------------------------------------------------------------
// Dados da pessoa e do imóvel para os formulários dos bancos (DAMP, Formulário
// Cliente, Proposta…). Cada leitor conhece o layout de UM documento e só pega
// o que vem rotulado — layout diferente devolve vazio, nunca um palpite.
// ---------------------------------------------------------------------------

export type EstadoCivilLido = "solteiro" | "casado" | "divorciado" | "viuvo" | "separado"
export type RegimeBensLido =
  | "comunhao_parcial"
  | "comunhao_universal"
  | "separacao_total"
  | "separacao_obrigatoria"
  | "participacao_final_aquestos"

/** Número, órgão e datas do RG ou da CNH — o que a tela da Caixa pede depois do tipo de documento. */
export interface IdentidadeLida {
  tipo: "RG" | "CNH"
  /** Só dígitos (RG pode terminar em X). */
  numero?: string
  /** Sigla do órgão, sem a UF: "SSP", "DETRAN". */
  orgaoEmissor?: string
  /** UF do órgão emissor — não a de residência. */
  uf?: string
  emissao?: string
  /** Só a CNH traz. */
  validade?: string
  /** Só a CNH traz. */
  primeiraHabilitacao?: string
}

const ORGAOS_RG = "ssp|sds|sesp|sejusp|sspds|sesdc|iirgd|igp|ifp|dic|sjs|itep|pci|politec|dgpc|detran"
const PADRAO_ORGAO_UF = new RegExp(`\\b(${ORGAOS_RG})\\s*[/\\-]?\\s*([a-z]{2})\\b`, "g")
// O OCR do RG de SP cola "REGISTROGERAL" e lê os pontos do número como vírgula.
const PADRAO_NUMERO_RG = /\b(?:registro\s*geral|identidade|r\.?\s?g\.?)\s*(?:n[o°º.]*)?\s*:?\s*(\d[\d.,\s]{4,12}(?:\s*-\s*|\s)?[\dx])\b/
// Na CNH-e os rótulos vêm numa linha e os valores na seguinte: o registro (11
// dígitos seguidos) aparece depois do CPF, algumas dezenas de caracteres adiante.
// RG de SP: "12.345.678-9". O rótulo "REGISTRO GERAL" sai partido ("REGISTRO
// 12.345.678-9 … GERAL") ou some no OCR (letra miúda); o formato basta — o CPF
// tem 3 dígitos no 1º grupo e não casa.
const PADRAO_NUMERO_RG_SP = /(?<![\d.])(\d{1,2}\.\d{3}\.\d{3}\s?-\s?[\dxX])(?!\d)/
const ESTADOS: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso do sul": "MS", "mato grosso": "MT",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
}
const PADRAO_ESTADO = new RegExp(
  `estado\\s+d[eoa]\\s+(${Object.keys(ESTADOS).sort((a, b) => b.length - a.length).join("|")})\\b`,
)
const PADRAO_ONZE_DIGITOS = /(?<![\d.,-])\d{11}(?![\d.,-])/g
const PADRAO_UF_CNH_LOCAL = /departamento estadual de transito[\s\S]{0,60}?\bloca\w*\s+[a-z ]+,\s*([a-z]{2})\b/
const PADRAO_UF_CNH_RENACH = /departamento estadual de transito[\s\S]{0,60}?\b([a-z]{2})[0o][\doil]{7,}\b/

/**
 * Número, órgão emissor e UF do órgão de um RG ou CNH. Sem rótulo ao lado, não
 * sai nada: número solto num documento cheio de números é palpite.
 *
 * Na CNH o número é o registro e o órgão é o DETRAN — o RG que ela também
 * imprime (campo 4d) é outro documento e fica de fora. O registro igual ao CPF
 * é descartado: é o CPF lido no lugar errado. Registro que não fecha o dígito
 * verificador também (ver `cnhValida`): vazio é melhor que número errado.
 */
export function extrairIdentidade(texto: string, tipo: "rg" | "cnh"): IdentidadeLida | undefined {
  const base = semAcento(texto)
  const orgaoUf = (orgaos: RegExp) =>
    [...base.matchAll(PADRAO_ORGAO_UF)].find((m) => orgaos.test(m[1]!) && UFS.includes(m[2]!.toUpperCase()))

  let lida: IdentidadeLida
  if (tipo === "cnh") {
    const cpf = extrairCpf(texto)
    // O OCR lê o "Nº" de vários jeitos ("a° REGISTRO"): sem ele, vale "registro"
    // sozinho — o dígito verificador (`cnhValida`) barra o número errado.
    // Todas as vezes que o rótulo aparece: com o Paddle e o Tesseract juntos o
    // texto vem duas vezes, e na CNH digital só um dos dois lê o registro sem
    // errar dígito (a marca d'água passa por cima dele).
    const rotulos = [...base.matchAll(/\bregistro\b/g)].map((m) => m.index!)
    const numero = rotulos
      .flatMap((rotulo) => base.slice(Math.max(0, rotulo - 10), rotulo + 120).match(PADRAO_ONZE_DIGITOS) ?? [])
      .find((n) => n !== cpf && cnhValida(n))
    const datas = extrairDatasCnh(texto)
    // Quem emite CNH é sempre o DETRAN; a UF só entra se o texto disser —
    // "DETRAN SP", ou, logo depois de "Departamento Estadual de Trânsito", o
    // local de emissão ("SAO PAULO, SP") ou o RENACH, que começa pela UF
    // ("SP0..."; o OCR lê o zero como O ou I). O "SSP SP" da CNH é do RG.
    const uf = [
      orgaoUf(/^detran$/)?.[2],
      base.match(PADRAO_UF_CNH_LOCAL)?.[1],
      base.match(PADRAO_UF_CNH_RENACH)?.[1],
    ]
      .map((u) => u?.toUpperCase())
      .find((u) => u && UFS.includes(u))
    lida = {
      tipo: "CNH",
      numero,
      orgaoEmissor: "DETRAN",
      uf,
      emissao: datas.emissao,
      validade: datas.validade,
      primeiraHabilitacao: datas.primeiraHabilitacao,
    }
  } else {
    const noFormatoSp = texto.match(PADRAO_NUMERO_RG_SP)
    const numero = (base.match(PADRAO_NUMERO_RG)?.[1] ?? noFormatoSp?.[1])?.replace(/[^\dxX]/g, "").toUpperCase()
    const orgao = orgaoUf(/^(?!detran$)/)
    const datas = acharDatasNoTexto(texto)
    const nascimento = extrairDataNascimentoRotulada(texto)
    // "xpedi": o OCR troca o E inicial ("BXPEDICAO"). O rótulo vem partido em
    // duas linhas ("DATA DE 13/12/2012 … EXPEDIÇÃO") e a data cai antes dele;
    // sem rótulo nenhum, vale a data colada ao número — nunca a de nascimento.
    const expedicao = texto.search(/xpedi[cç][aã]o/i)
    const emissao =
      dataAposRotulo(texto, datas, /xpedi[cç][aã]o/i) ??
      (expedicao >= 0 ? datas.filter((d) => d.indice < expedicao && expedicao - d.indice <= 40).at(-1)?.iso : undefined) ??
      (noFormatoSp?.index !== undefined
        ? datas
            .filter((d) => d.iso !== nascimento && Math.abs(d.indice - noFormatoSp.index!) <= 60)
            .sort((a, b) => Math.abs(a.indice - noFormatoSp.index!) - Math.abs(b.indice - noFormatoSp.index!))[0]?.iso
        : undefined)
    lida = { tipo: "RG", numero: numero && numero.length >= 5 ? numero : undefined, emissao }
    if (orgao) Object.assign(lida, { orgaoEmissor: orgao[1]!.toUpperCase(), uf: orgao[2]!.toUpperCase() })
    else if (/seguranca\s+publica|secretaria\s+d[ae]\s+seguranca/.test(base)) {
      // Sem "SSP/SP" impresso: o cabeçalho diz quem emitiu ("Secretaria da
      // Segurança Pública … Estado de São Paulo").
      const uf = ESTADOS[base.match(PADRAO_ESTADO)?.[1] ?? ""]
      if (uf) Object.assign(lida, { orgaoEmissor: "SSP", uf })
    }
  }
  const { tipo: _, ...campos } = lida
  return Object.values(campos).some(Boolean) ? lida : undefined
}

/**
 * O que um documento diz sobre a pessoa dona dele. Os valores de estado civil
 * e regime são os mesmos do preenchedor-formularios, para gravar sem tradução.
 * De quem é essa pessoa (cliente, cônjuge) quem decide é quem grava, pelo nome
 * e pelo CPF.
 */
export interface PessoaLida {
  nome?: string
  /** Da ficha de cadastro ("Peso/Altura" ou "Peso (kg)" + "Altura (cm)"). */
  pesoKg?: number
  alturaCm?: number
  /** Só dígitos, com dígito verificador conferido. */
  cpf?: string
  sexo?: "masculino" | "feminino"
  estadoCivil?: EstadoCivilLido
  /** Só quando casado. */
  regimeBens?: RegimeBensLido
  /** Só dígitos, com dígito verificador conferido. */
  pis?: string
  profissao?: string
  /** Nome do pai e da mãe, só quando o documento traz o rótulo. */
  pai?: string
  mae?: string
  /** "Brasileira" — o formulário do banco pede, o documento diz. */
  nacionalidade?: string
  /** Como o documento escreve: "Superior", "Medio Completo". */
  grauInstrucao?: string
  /** Que documento identifica a pessoa: "RG", "CNH", "Passaporte". */
  tipoIdentidade?: string
  /** Do RG ou da CNH lidos — o tipo vai junto para não misturar os dois. */
  identidade?: IdentidadeLida
  rendaLiquida?: number
  /** Total de vencimentos do holerite. */
  rendaBruta?: number
  /** Admissão no emprego atual. */
  admissao?: string
  /** O documento lido que comprova a renda e a competência dele. */
  comprovanteRenda?: { tipo: TipoDocumento; data: string }
  /** Comprovante de residência: o resto do endereço e o mês de referência. */
  moradia?: MoradiaLida
  email?: string
  telefone?: string
  /**
   * Só "empregado": contrato em aberto na CTPS, ou "Assalariado" declarado na
   * ficha. A ausência de contrato não prova desemprego.
   */
  situacaoOcupacional?: "empregado"
  impostoRenda?: { situacao: "declarante"; exercicio: number }
  /** `valor` = saldo, quando o extrato permite ligar o saldo à conta. */
  contasFgts?: { conta: string; codigoEmpregador: string; valor?: number }[]
  conjuge?: { nome?: string; cpf?: string }
  /** AAAA-MM-DD. */
  nascimento?: string
  /** "Cidade/UF", como os formulários pedem. */
  naturalidade?: string
  /**
   * Cidades e empregador. Os do cliente continuam indo para a localização do
   * processo (é de onde o FGTS lê); aqui servem às outras pessoas.
   */
  residencia?: Municipio
  trabalho?: Municipio
  empregador?: string
  empregadorCnpj?: string
}

/** Uma pessoa do processo, como a leitura procura nos documentos. */
export interface PessoaDoProcesso {
  nome: string
  /** Só dígitos. */
  cpf?: string
}

/** O que o documento diz do endereço de quem mora ali (comprovante de residência, ficha de cadastro). */
export interface MoradiaLida {
  /** Só dígitos. */
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  /** Mês de referência (AAAA-MM-01) ou, sem ele, emissão ou vencimento. */
  comprovante?: string
  /** Só a ficha de cadastro diz — o comprovante não. */
  tipoImovel?: TipoMoradia
  ocupacao?: OcupacaoMoradia
  /** A cidade escrita na ficha da Caixa; quem consome pode transformar em município do IBGE. */
  cidade?: CidadeUf
}

export interface EnderecoImovelLido {
  logradouro: string
  numero: string
  /** "Apartamento 12, Bloco B" — a unidade dentro do condomínio. */
  complemento?: string
  bairro?: string
  /** Só dígitos. */
  cep?: string
}

const TIPOS_LOGRADOURO = "rua|avenida|av\\.|alameda|travessa|estrada|rodovia|pra[cç]a|largo|viela"
const PADRAO_LOGRADOURO_MATRICULA = new RegExp(
  // O número vem depois da vírgula ("Rua X, nº 12") ou colado na rua ("Rua X
  // ns. 441 e 433"). Colado, só com a marca de número — senão ", no 9º
  // Subdistrito", mais adiante, virava o número 9. "situado nesta cidade, na
  // Rua X" também vale.
  `situad[oa]\\s+(?:nest[ae]\\s+(?:cidade|comarca|munic[ií]pio)[^,]{0,40},\\s*)?(?:na|no|[aà])\\s+((?:${TIPOS_LOGRADOURO})\\s+[^,]{3,80}?)(?:,\\s*n[ºo°]?\\.?|\\s+n(?:[ºo°s]|os)?\\.)\\s*(\\d[\\d.]*[a-z]?)\\b`,
  "i",
)

/**
 * Endereço do imóvel na matrícula, só da descrição do imóvel ("IMÓVEL: …
 * situado na Rua X, nº N, … Bairro Y") — nunca do resto do texto, que traz o
 * endereço de residência de cada dono. Sem "situado na <logradouro>, nº" não
 * responde: rua sem número não fecha o campo do formulário.
 */
export function extrairEnderecoMatricula(texto: string): EnderecoImovelLido | undefined {
  const t = texto.replace(/\s+/g, " ")
  const inicio = t.search(/IM[ÓO]VEL\s*:/i)
  if (inicio < 0) return undefined
  const fimProprietarios = t.slice(inicio).search(/PROPRIET[ÁA]RIOS?\s*:/i)
  const bloco = t.slice(inicio, inicio + (fimProprietarios > 0 ? fimProprietarios : 1500))

  const rua = bloco.match(PADRAO_LOGRADOURO_MATRICULA)
  if (!rua) return undefined
  const antesDaRua = bloco.slice(0, rua.index)
  const unidade = antesDaRua.match(/\b(apartamento|casa|sala|loja|conjunto)\s+(?:de\s+)?n[ºo°]?\.?\s*(\d+(?:\.\d{3})*[a-z]?)/i)
  const predio = antesDaRua.match(/\bbloco\s+([a-z0-9]{1,3})\b/i)
  const complemento = [unidade && `${capitalizar(unidade[1]!.toLowerCase())} ${unidade[2]!.replace(/\./g, "")}`, predio && `Bloco ${predio[1]!.toUpperCase()}`]
    .filter(Boolean)
    .join(", ")

  return {
    logradouro: limpar(rua[1])!,
    numero: rua[2]!.replace(/\./g, ""),
    complemento: complemento || undefined,
    bairro: bloco.match(/\bbairro\s+([^,.;]{3,40})/i)?.[1]?.trim(),
    cep: bloco.match(/\bCEP[:\s]*(\d{5})-?(\d{3})\b/i)?.slice(1, 3).join(""),
  }
}

const VALOR = String.raw`(\d{1,3}(?:\.\d{3})*,\d{2})`

export interface HoleriteLido {
  /** Líquido impresso — é o que vai como renda líquida (decisão do usuário, mesmo com adiantamento descontado). */
  liquido: number
  /** Total de vencimentos: a renda bruta do mês. */
  vencimentos: number
}

/**
 * Líquido do holerite, nos layouts vistos em documento real:
 * "Total <vencimentos> <descontos> Total Líquido <líquido>", a tabela
 * "VENCIMENTOS DESCONTOS LÍQUIDO TOTAIS <v> <d> <l>" e o demonstrativo da
 * folha do Estado de SP, que imprime os rótulos num bloco e os três totais
 * juntos no fim do texto, longe deles. Só responde quando vencimentos −
 * descontos bate com o líquido (centavo de tolerância): OCR que trocou um
 * dígito não passa.
 */
export function extrairHolerite(texto: string): HoleriteLido | undefined {
  const t = texto.replace(/\s+/g, " ")
  const layouts = [
    new RegExp(String.raw`\bTotal\s+${VALOR}\s+${VALOR}\s+Total\s+L[ií]quido\s+${VALOR}`, "i"),
    new RegExp(String.raw`L[ÍI]QUIDO\s+TOTAIS\s+${VALOR}\s+${VALOR}\s+${VALOR}`, "i"),
  ]
  for (const layout of layouts) {
    const achado = t.match(layout)
    if (!achado) continue
    const [vencimentos, descontos, liquido] = achado.slice(1, 4).map((v) => numeroBr(v)!)
    if (Math.abs(vencimentos! - descontos! - liquido!) > 0.011) return undefined
    return { liquido: liquido!, vencimentos: vencimentos! }
  }

  // Sem rótulo colado nos totais: vale o trio de valores seguidos (só espaço
  // entre eles) que fecha a conta. Dois trios diferentes que fecham é dúvida.
  if (!/l[ií]quido/i.test(t)) return undefined
  const valores = [...t.matchAll(new RegExp(String.raw`(?<![\d.,])${VALOR}(?![\d,])`, "g"))]
  const trios = new Map<string, HoleriteLido>()
  for (let i = 0; i + 2 < valores.length; i++) {
    const trio = valores.slice(i, i + 3)
    const colados = trio.every((v, j) => j === 0 || !t.slice(trio[j - 1]!.index! + trio[j - 1]![0].length, v.index).trim())
    const [vencimentos, descontos, liquido] = trio.map((v) => numeroBr(v[1])!)
    if (colados && descontos! > 0 && liquido! > 0 && Math.abs(vencimentos! - descontos! - liquido!) <= 0.011) {
      trios.set(`${vencimentos}|${liquido}`, { liquido: liquido!, vencimentos: vencimentos! })
    }
  }
  return trios.size === 1 ? [...trios.values()][0] : undefined
}

/**
 * Mês de referência (ou competência) impresso: "Mês de referência: 08/2026",
 * "Referência AGO/2026", "Competência: Agosto/2026", "Mês/Ano 08/2026",
 * "FOLHA NORMAL - 08/2026" (folha do Estado de SP). Sai como o dia 01 do mês.
 * Ano fora de [atual − 2, atual + 1] é descartado: conta antiga ou OCR errado.
 */
export function extrairMesDeReferencia(texto: string): string | undefined {
  const anoAtual = new Date().getFullYear()
  const padrao =
    /\b(?:mes\s*(?:de\s*)?referencia|referencia|competencia|mes\s*\/\s*ano|folha\s+normal)\s*[:\-–]?\s*(?:(\d{1,2})|([a-z]{3,9}))\s*[/.\- ]\s*(\d{4})\b/g
  for (const achado of semAcento(texto).matchAll(padrao)) {
    const mes = achado[1]
      ? Number(achado[1])
      : MESES_POR_NOME.findIndex((nome) => nome.startsWith(achado[2]!.slice(0, 3))) + 1
    const ano = Number(achado[3])
    if (mes >= 1 && mes <= 12 && ano >= anoAtual - 2 && ano <= anoAtual + 1) return dataIso(1, mes, ano)
  }
  return undefined
}

/** Data de admissão rotulada ("Admissão: 01/02/2015", "Data Adm. 01/02/2015") — holerite. */
export function extrairAdmissaoRotulada(texto: string): string | undefined {
  const data = dataAposRotulo(texto, acharDatasNoTexto(texto), /admiss[aã]o|\bdata\s+adm\b/i)
  return data && anoDe(data) <= new Date().getFullYear() ? data : undefined
}

const TIPOS_LOGRADOURO_CHAVE =
  "rua|r|avenida|av|alameda|al|travessa|tv|estrada|estr|rodovia|rod|praca|pca|largo|lgo|viela|servidao|via|vila"
const COMPLEMENTO_ENDERECO =
  /^(?:ap(?:to|artamento)?|bl(?:oco)?|casa|sala|loja|conj(?:unto)?|cj|fundos|frente|sobrado|torre|lote|lt|quadra|qd)\b\s*[a-z0-9]{0,4}(?:\s+(?:bl(?:oco)?|torre|t|casa|ap(?:to)?)\b\s*[a-z0-9]{1,4})?/

/**
 * Número e complemento do endereço de moradia num comprovante. A rua já é
 * sabida (vem do CEP): acha o nome dela no texto — a ocorrência mais perto do
 * CEP — e pega o número logo depois e, se vier, o complemento ("AP 72",
 * "BL B CASA 2"). Sem achar a rua, não responde: número solto no meio de uma
 * fatura é qualquer coisa.
 */
export function extrairNumeroEComplemento(
  texto: string,
  logradouro: string,
  cep: string,
): { numero?: string; complemento?: string } | undefined {
  const t = chaveTexto(texto)
  const nomeRua = chaveTexto(logradouro).replace(new RegExp(`^(?:${TIPOS_LOGRADOURO_CHAVE})\\s+`), "")
  if (nomeRua.length < 4) return undefined

  const posicaoCep = t.search(new RegExp(`\\b${cep.slice(0, 5)} ?${cep.slice(5)}\\b`))
  const perto = [...t.matchAll(new RegExp(`\\b${nomeRua}\\b`, "g"))]
    .map((achado) => achado.index!)
    .filter((indice) => posicaoCep < 0 || Math.abs(indice - posicaoCep) <= 300)
    .sort((a, b) => Math.abs(a - posicaoCep) - Math.abs(b - posicaoCep))[0]
  if (perto === undefined) return undefined

  const depois = t.slice(perto + nomeRua.length).trimStart()
  const numero = depois.match(/^(?:n|no|numero|nr)?\s*(\d{1,6}[a-z]?|s n)\b/)
  if (!numero) return undefined

  const complemento = depois.slice(numero[0].length).trimStart().match(COMPLEMENTO_ENDERECO)?.[0]?.trim()
  return {
    numero: numero[1] === "s n" ? "S/N" : numero[1]!.toUpperCase(),
    complemento: complemento ? complemento.toUpperCase() : undefined,
  }
}

export interface ProprietarioLido {
  nome: string
  /** Só quando o dígito verificador confere. */
  cpf?: string
}

/**
 * Donos atuais pela matrícula: os adquirentes do ÚLTIMO registro de compra e
 * venda ("ADQUIRENTE(S) COMPRADOR/A(ES): FULANO, …, e seu cônjuge BELTRANA").
 *
 * Não responde quando algo depois dessa compra pode ter mudado o dono
 * (doação, partilha, arrematação, consolidação da propriedade pelo credor,
 * outro adquirente que não seja o credor fiduciário). O credor da alienação
 * fiduciária aparece como "ADQUIRENTE - CREDOR" e não é dono para a venda.
 */
export function extrairProprietariosMatricula(texto: string): ProprietarioLido[] | undefined {
  const t = texto.replace(/\s+/g, " ")
  const compras = [...t.matchAll(/ADQUIRENTE\s*\(S\)\s*COMPRADOR\/?A?\(?ES\)?\s*:/gi)]
  const ultima = compras.at(-1)
  if (!ultima) return undefined
  const depois = t.slice(ultima.index! + ultima[0].length)

  const fimDoBloco = depois.search(/OBJETO DO NEG[ÓO]CIO|PRE[ÇC]O\s*:|TRANSMITENTE/i)
  const bloco = depois.slice(0, fimDoBloco > 0 ? fimDoBloco : 700)
  const resto = depois.slice(bloco.length)
  if (/ADQUIRENTE(?![^:]{0,40}CREDOR)|DONAT[ÁA]RI|PARTILHA|ARREMATA|CONSOLIDA[ÇC][ÃA]O DA PROPRIEDADE/i.test(resto)) return undefined

  const nomeEm = (trecho: string) => trecho.match(/^\s*([A-ZÀ-Ú][A-ZÀ-Ú'.]+(?:\s+[A-ZÀ-Ú][A-ZÀ-Ú'.]+)+)\s*,/)?.[1]
  const cpfEm = (trecho: string) => cpfSeValido(trecho.match(/CPF\s*n?[ºo°]?\.?\s*([\d.\s]{11,16}-\s?\d{2})/i)?.[1]?.replace(/\s/g, ""))

  const conjuge = bloco.match(/\be\s+(?:seu\s+c[ôo]njuge|sua\s+(?:mulher|esposa)|seu\s+marido)\s*,?\s*/i)
  const primeiroTrecho = conjuge ? bloco.slice(0, conjuge.index) : bloco
  const primeiro = nomeEm(primeiroTrecho)
  if (!primeiro) return undefined

  const donos: ProprietarioLido[] = [{ nome: primeiro, cpf: cpfEm(primeiroTrecho) }]
  if (conjuge) {
    const segundoTrecho = bloco.slice(conjuge.index! + conjuge[0].length)
    const segundo = nomeEm(segundoTrecho)
    if (!segundo) return undefined // cônjuge anunciado e não lido: lista pela metade é pior que nenhuma
    donos.push({ nome: segundo, cpf: cpfEm(segundoTrecho) })
  }
  return donos.map((d) => (d.cpf ? d : { nome: d.nome }))
}

/** Dígito verificador do PIS/PASEP/NIT (pesos 3, 2, 9, 8, 7, 6, 5, 4, 3, 2). */
export function pisValido(valor: string): boolean {
  const d = valor.replace(/\D/g, "")
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const soma = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2].reduce((total, peso, i) => total + peso * Number(d[i]), 0)
  const digito = 11 - (soma % 11)
  return (digito >= 10 ? 0 : digito) === Number(d[10])
}

const limpar = (valor: string | undefined) => valor?.replace(/\s+/g, " ").trim() || undefined
const cpfSeValido = (valor: string | undefined) => (valor && cpfValido(valor) ? valor.replace(/\D/g, "") : undefined)
const pisSeValido = (valor: string | undefined) => (valor && pisValido(valor) ? valor.replace(/\D/g, "") : undefined)
const sexoDoTexto = (valor: string | undefined) => (valor ? (/^f/i.test(valor) ? "feminino" : "masculino") : undefined)

/** "1.234,56" → 1234.56 */
function numeroBr(valor: string | undefined): number | undefined {
  if (!valor) return undefined
  const numero = Number(valor.replace(/\./g, "").replace(",", "."))
  return Number.isFinite(numero) ? numero : undefined
}

export function semVazios<T extends object>(objeto: T): T {
  return Object.fromEntries(Object.entries(objeto).filter(([, valor]) => valor !== undefined)) as T
}

/**
 * Regime de bens escrito num campo curto. Palavra-chave, não a frase inteira:
 * cada palavra só existe em um regime, e isso sobrevive a OCR ruim ("DOLNHO
 * PARCIAL DE FENS" numa certidão fotografada). "Comunhão de bens" sem dizer
 * qual fica sem regime — em certidão antiga costuma ser a universal, mas isso
 * é interpretação, não leitura.
 */
function regimeDoTexto(valor: string): RegimeBensLido | undefined {
  const t = semAcento(valor)
  if (/\bparcial\b/.test(t)) return "comunhao_parcial"
  if (/\buniversal\b/.test(t)) return "comunhao_universal"
  if (/\bobrigatori|separacao\s+legal/.test(t)) return "separacao_obrigatoria"
  if (/separacao\s+(?:total|convencional|de\s+bens)/.test(t)) return "separacao_total"
  if (/aquesto|participacao\s+final/.test(t)) return "participacao_final_aquestos"
  return undefined
}

/** "CASADO (A) COM COMUNHÃO PARCIAL DE BENS" → casado + comunhão parcial. */
function estadoCivilDoTexto(valor: string): Pick<PessoaLida, "estadoCivil" | "regimeBens"> {
  const t = semAcento(valor)
  const estadoCivil: EstadoCivilLido | undefined = /\bcasad/.test(t)
    ? "casado"
    : /\bsolteir/.test(t)
      ? "solteiro"
      : /\bdivorciad/.test(t)
        ? "divorciado"
        : /\bviuv/.test(t)
          ? "viuvo"
          : /\bseparad/.test(t)
            ? "separado"
            : undefined
  if (estadoCivil !== "casado") return { estadoCivil }
  return { estadoCivil, regimeBens: regimeDoTexto(valor) }
}

const MESES_POR_NOME = [
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]

const VALOR_POR_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, primeiro: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezasseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60,
  setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400,
  quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, mil: 1000,
}

/** ["um", "mil", "e", "novecentos", "e", "sessenta", "e", "cinco"] → 1965. Palavra que não é número → undefined. */
function numeroPorExtenso(palavras: string[]): number | undefined {
  const uteis = palavras.filter((p) => p !== "e")
  if (uteis.length === 0) return undefined
  let total = 0
  let grupo = 0
  for (const palavra of uteis) {
    const valor = VALOR_POR_EXTENSO[palavra]
    if (valor === undefined) return undefined
    if (valor === 1000) {
      total += (grupo || 1) * 1000
      grupo = 0
    } else {
      grupo += valor
    }
  }
  return total + grupo
}

const isoSeValida = (ano: number, mes: number, dia: number) => {
  const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`
  return new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso) ? iso : undefined
}

/**
 * Primeira data por extenso do trecho — "vinte e quatro de junho de um mil e
 * novecentos e sessenta e cinco" → 1965-06-24. O dia são até três palavras
 * antes do "de <mês>"; o ano, as palavras-número depois do "de".
 */
export function dataPorExtenso(trecho: string): string | undefined {
  const palavras = chaveTexto(trecho).split(" ")
  for (let i = 1; i < palavras.length - 1; i++) {
    const mes = MESES_POR_NOME.indexOf(palavras[i]!)
    if (mes < 0 || palavras[i - 1] !== "de" || palavras[i + 1] !== "de") continue

    let dia: number | undefined
    for (let inicio = Math.max(0, i - 4); inicio < i - 1 && dia === undefined; inicio++) {
      const valor = numeroPorExtenso(palavras.slice(inicio, i - 1))
      if (valor !== undefined && valor >= 1 && valor <= 31) dia = valor
    }

    const doAno: string[] = []
    for (let j = i + 2; j < palavras.length; j++) {
      const palavra = palavras[j]!
      if (palavra !== "e" && VALOR_POR_EXTENSO[palavra] === undefined) break
      doAno.push(palavra)
    }
    const ano = numeroPorExtenso(doAno)

    if (dia !== undefined && ano !== undefined && ano >= 1900 && ano <= 2100) {
      const iso = isoSeValida(ano, mes + 1, dia)
      if (iso) return iso
    }
  }
  return undefined
}

export interface CasamentoLido {
  /** Data da celebração (aaaa-mm-dd). */
  data?: string
  regimeBens?: RegimeBensLido
  /** Os cônjuges como o cabeçalho da certidão traz: CPF (só dígitos, conferido) e, quando legível, o nome. */
  conjuges: { nome?: string; cpf?: string }[]
  /** Divórcio ou separação averbados: o casamento acabou, e a data não serve a quem está casado hoje. */
  dissolvido: boolean
}

/**
 * Certidão de casamento, nos modelos que chegam:
 *
 * - Atual (Central do Registro Civil): "NOME ATUAL DOS CÔNJUGES: NÚMERO DO
 *   CPF" com os pares nome/CPF, e "Data da celebração do casamento… <por
 *   extenso> Dia 17 Mês 12 Ano 1977". Números e extenso vêm juntos: se
 *   discordam (OCR), a data fica vazia em vez de escolher um dos dois.
 * - Antigo: só "DATA DO REGISTRO DO CASAMENTO (POR EXTENSO)" — no casamento
 *   civil é a própria data da celebração.
 *
 * Regime vem do campo "Regime de bens"; divórcio ou separação nas averbações
 * marcam o casamento como dissolvido.
 */
export function extrairCertidaoCasamento(texto: string): CasamentoLido | undefined {
  const t = texto.replace(/\s+/g, " ")
  const normalizado = normalizarNoLugar(t)
  if (!/casament/.test(normalizado) || /certidao\s+de\s+nascimento/.test(normalizado)) return undefined

  /** Trecho do texto original logo depois do rótulo (buscado no normalizado, que tem o mesmo comprimento). */
  const depoisDe = (rotulo: RegExp, alcance: number) => {
    const achado = normalizado.match(rotulo)
    if (!achado || achado.index === undefined) return undefined
    const inicio = achado.index + achado[0].length
    return t.slice(inicio, inicio + alcance)
  }

  // Rótulo de data achado pela forma "data d_ <palavra> d_ cas…", com a palavra
  // do meio conferida por semelhança: numa certidão fotografada o OCR entregou
  // "Data da celobração do castmento" e "Data de fegisiro do casemeíto".
  const depoisDoRotuloDeData = (palavra: "celebracao" | "registro") => {
    for (const achado of normalizado.matchAll(/data\s+d[aeo]\s+([a-z]{5,12})\s+d[aeo]\s+ca[sz][a-z]{3,6}/g)) {
      if (distanciaEdicao(achado[1]!, palavra) > 3) continue
      const inicio = (achado.index ?? 0) + achado[0].length
      return t.slice(inicio, inicio + 260)
    }
    return undefined
  }

  // Celebração antes do registro: no casamento religioso com efeito civil o
  // registro vem depois — numa certidão real, três meses depois.
  const trechoData = depoisDoRotuloDeData("celebracao") ?? depoisDoRotuloDeData("registro")
  let data: string | undefined
  if (trechoData) {
    const numeros = trechoData.match(/Dia\s+(\d{1,2})\s+M[eê]s\s+(\d{1,2})\s+Ano\s+(\d{4})/i)
    const porNumeros = numeros ? isoSeValida(Number(numeros[3]), Number(numeros[2]), Number(numeros[1])) : undefined
    const porExtenso = dataPorExtenso(trechoData)
    data = porNumeros && porExtenso ? (porNumeros === porExtenso ? porNumeros : undefined) : (porNumeros ?? porExtenso)
  }

  // Regime pelo rótulo; sem rótulo legível, pela frase do regime, que numa
  // certidão de casamento só aparece nesse campo.
  const regimeRotulado = depoisDe(/regime\s+de\s+[a-z]{3,5}\s+do\s+casamento|regime\s+de\s+bens/, 70)
  const regimeSolto = normalizado.match(
    /comunhao\s+(?:parcial|universal)|separacao\s+(?:total|obrigatoria|convencional|legal)|participacao\s+final/,
  )?.[0]
  const regimeBens = (regimeRotulado && regimeDoTexto(regimeRotulado)) || (regimeSolto && regimeDoTexto(regimeSolto)) || undefined

  // Cabeçalho: até a matrícula (modelo atual) ou o começo do documento.
  const fimCabecalho = normalizado.search(/\bmatricul/)
  const cabecalho = t.slice(0, fimCabecalho > 0 ? fimCabecalho : 900)
  const conjuges: CasamentoLido["conjuges"] = []
  for (const achado of cabecalho.matchAll(
    /(?:([A-ZÀ-Ú][A-ZÀ-Ú'.]*(?:\s+[A-ZÀ-Ú][A-ZÀ-Ú'.]*){1,6})[\s:|[\]-]{0,6})?(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})/g,
  )) {
    const cpf = cpfSeValido(achado[2])
    if (!cpf || conjuges.some((c) => c.cpf === cpf)) continue
    const nome = limpar(achado[1]?.replace(/^(?:NOME ATUAL DOS C[OÔ]NJUGES|N[UÚ]MERO DO CPF)\s*/g, ""))
    conjuges.push(semVazios({ cpf, nome }))
  }

  return {
    ...semVazios({ data, regimeBens }),
    conjuges,
    dissolvido: /\bdivorcio\b|separacao\s+(?:judicial|consensual|litigiosa)/.test(normalizado),
  }
}

/**
 * Ficha "Cadastro de Clientes" impressa do sistema da Caixa. No bloco de
 * identificação o valor vem DEPOIS do rótulo ("CPF do Cliente: 123…"); no de
 * endereço (a residência, não o imóvel) vem ANTES ("AV X Logradouro:"). O
 * cônjuge tem bloco próprio, com CPF e nome.
 *
 * A "Ocupação" dali é a da lista do banco: a mescla grava como profissão quando
 * o campo está vazio (junto com a CTPS).
 */
export function extrairFichaCadastroCaixa(texto: string): PessoaLida {
  const t = texto.replace(/\s+/g, " ")
  const campo = (padrao: RegExp) => limpar(t.match(padrao)?.[1])
  const estadoCivil = campo(/Estado Civil:\s*(.+?)\s+(?:PIS\/NIS:|Tipo de Ocupa|DADOS DO C)/i)
  const identidade = identidadeDaFichaCaixa(t, campo)
  const referenciaRenda = t.match(/Data de Ref\.? do Comprovante:\s*(\d{1,2})\/(\d{4})/i)
  const dataRenda = referenciaRenda ? dataIso(1, Number(referenciaRenda[1]), Number(referenciaRenda[2])) : undefined
  const tipoRenda = comprovanteDoTexto(campo(/Documento do Comprovante de Renda:\s*(.+?)\s+(?:Imposto de Renda|Data de Ref)/i))

  const pessoa: PessoaLida = {
    nome: campo(/Nome Completo do Cliente:\s*(.+?)\s+Nome Reduzido/i),
    cpf: cpfSeValido(campo(/CPF do Cliente:\s*([\d.\-]{11,14})/i)),
    sexo: sexoDoTexto(campo(/\bSexo:?\s+(MASCULINO|FEMININO)\b/i)),
    ...(estadoCivil ? estadoCivilDoTexto(estadoCivil) : {}),
    pis: pisSeValido(campo(/PIS\/NIS:\s*([\d.\-]{11,14})/i)),
    profissao:
      campo(/Tipo de Ocupa[cç][aã]o:\s*(.+?)\s+(?:Data\s+\S+\s+Habilita|DADOS DO C|ENDERE)/i) ??
      campo(/\bOcupa[cç][aã]o:\s*(.+?)\s+Admiss[aã]o:/i),
    rendaLiquida: numeroBr(campo(/L[ií]quida:\s*([\d.]+,\d{2})/i)),
    rendaBruta: numeroBr(campo(/\bBruta:\s*([\d.]+,\d{2})/i)),
    comprovanteRenda: tipoRenda && dataRenda ? { tipo: tipoRenda, data: dataRenda } : undefined,
    admissao: dataBrParaIso(campo(/Admiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i)),
    telefone: campo(/Telefone Celular:\s*(\(\d{2}\)\s*\d{4,5}-?\d{4})/i),
    email: campo(/E-mail:\s*(\S+@\S+\.[A-Za-z]{2,})/i)?.toLowerCase(),
    // O tipo curto ("CNH", "RG") é o que a mescla compara com o documento lido depois.
    tipoIdentidade: identidade?.tipo,
    identidade,
    moradia: moradiaDaFichaCaixa(t),
  }

  const cpfConjuge = cpfSeValido(campo(/DADOS DO C[OÔ]NJUGE\s+CPF:\s*([\d.\-]{11,14})/i))
  const nomeConjuge = campo(/DADOS DO C[OÔ]NJUGE\s+CPF:\s*[\d.\-]*\s*Nome:\s*(.+?)(?:\s+\d+)?\s+ENDERE/i)
  if (cpfConjuge || nomeConjuge) pessoa.conjuge = semVazios({ cpf: cpfConjuge, nome: nomeConjuge })

  return semVazios(pessoa)
}

/** O documento de identificação da ficha da Caixa: "CNH - CARTEIRA NACIONAL…" ou "DOCUMENTO DE IDENTIFICAÇÃO" + subtipo "CARTEIRA DE IDENTIDADE". */
function identidadeDaFichaCaixa(t: string, campo: (padrao: RegExp) => string | undefined): IdentidadeLida | undefined {
  const tipoEscrito = chaveTexto(
    `${campo(/Tipo de Documento de Identifica[cç][aã]o:\s*(.+?)\s+N[uú]mero do Documento:/i) ?? ""} ${
      campo(/SubTipo do Documento:\s*(.+?)\s+(?:DADOS DO C|ENDERE)/i) ?? ""
    }`,
  )
  const tipo = /\bcnh\b|habilitacao/.test(tipoEscrito) ? "CNH" : /identidade|\brg\b/.test(tipoEscrito) ? "RG" : undefined
  if (!tipo) return undefined
  const orgao = chaveTexto(campo(/[OÓ]rg[aã]o Emissor:\s*(.+?)\s+Data de Emiss/i) ?? "")
  // A UF do órgão vem logo depois da validade (vazia no RG): "Data de Validade: UF SP".
  const uf = t.match(/Data de Validade:\s*(?:\d{2}\/\d{2}\/\d{4}\s*)?UF\s+([A-Z]{2})\b/)?.[1]
  const lida: IdentidadeLida = semVazios({
    tipo,
    numero: campo(/N[uú]mero do Documento:\s*([\dXx.\-]{4,20})/i)?.replace(/[^\dXx]/g, "").toUpperCase(),
    orgaoEmissor: /transito|detran/.test(orgao) ? "DETRAN" : /seguranca publica|\bssp\b/.test(orgao) ? "SSP" : undefined,
    uf: uf && UFS.includes(uf) ? uf : undefined,
    emissao: dataBrParaIso(campo(/Data de Emiss[aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i)),
    primeiraHabilitacao: tipo === "CNH" ? dataBrParaIso(campo(/Data\s+\S{1,3}\s+Habilita[cç][aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i)) : undefined,
  })
  return Object.keys(lida).length > 1 ? lida : undefined
}

/**
 * Endereço de residência da ficha da Caixa, onde o valor vem antes do rótulo:
 * "11060001 CEP: R X Logradouro: 120 Complemento: AP 31 Número: SANTOS
 * Município: SP UF: GONZAGA Bairro: APARTAMENTO Tipo de Imóvel: 8/2026
 * Comprovante de Residência: ALUGADA Ocupação do Imóvel:". Número e
 * complemento saem trocados em relação aos rótulos (visto nas fichas reais):
 * vale o que tem cara de número.
 */
function moradiaDaFichaCaixa(t: string): MoradiaLida | undefined {
  const bloco = t.match(/\bENDERE[CÇ]O\s+(.+?)\s+Telefone Celular:/i)?.[1]
  if (!bloco) return undefined
  const antes = (rotulo: string) => limpar(bloco.match(new RegExp(String.raw`(?:^|:)\s*([^:]*?)\s*${rotulo}:`, "i"))?.[1])
  const [a, b] = [antes(String.raw`Complemento`), antes(String.raw`N[uú]mero`)]
  const numero = [a, b].find((v) => v && /^(?:\d{1,6}[A-Z]?|S\/?N)$/i.test(v))
  const referencia = antes(String.raw`Comprovante de Resid[eê]ncia`)?.match(/^(\d{1,2})\/(\d{4})$/)
  const cidade = antes(String.raw`Munic[ií]pio`)
  const uf = antes("UF")?.toUpperCase()
  const moradia: MoradiaLida = semVazios({
    cep: antes("CEP")?.replace(/\D/g, "").match(/^\d{8}$/)?.[0],
    logradouro: antes("Logradouro"),
    numero: numero?.toUpperCase(),
    complemento: [a, b].find((v) => v && v !== numero),
    bairro: antes("Bairro"),
    tipoImovel: tipoMoradiaDoTexto(antes(String.raw`Tipo de Im[oó]vel`)),
    ocupacao: ocupacaoDoTexto(antes(String.raw`Ocupa[cç][aã]o do Im[oó]vel`)),
    comprovante: referencia ? dataIso(1, Number(referencia[1]), Number(referencia[2])) : undefined,
    cidade: cidade && uf && UFS.includes(uf) ? { cidade, uf } : undefined,
  })
  return Object.keys(moradia).length > 0 ? moradia : undefined
}

/** Situação da moradia escrita na ficha. "Própria" sozinha não diz se é quitada ou financiada: fica vazia. */
function ocupacaoDoTexto(valor: string | undefined): OcupacaoMoradia | undefined {
  const t = chaveTexto(valor ?? "")
  if (/alugad/.test(t)) return "alugada"
  if (/\bpais\b|parente/.test(t)) return "com_pais"
  if (/cedid/.test(t)) return "cedida"
  if (/funcional/.test(t)) return "funcional"
  if (/propri/.test(t) && /quitad/.test(t)) return "propria_quitada"
  if (/propri/.test(t) && /financ/.test(t) && /caixa/.test(t)) return "propria_financiada_caixa"
  if (/^outr/.test(t)) return "outra"
  return undefined
}

function tipoMoradiaDoTexto(valor: string | undefined): TipoMoradia | undefined {
  const t = chaveTexto(valor ?? "")
  const tipos: [RegExp, TipoMoradia][] = [
    [/apartamento/, "apartamento"], [/\bcasa\b/, "casa"], [/sitio/, "sitio"], [/chacara/, "chacara"], [/fazenda/, "fazenda"],
  ]
  return tipos.find(([padrao]) => padrao.test(t))?.[1]
}

/** "CONTRACHEQUE/HOLERITE" → holerite. */
function comprovanteDoTexto(valor: string | undefined): TipoDocumento | undefined {
  const t = chaveTexto(valor ?? "")
  return /contracheque|holerite/.test(t) ? "holerite" : /imposto|irpf/.test(t) ? "imposto_renda" : /extrato/.test(t) ? "extrato_bancario" : undefined
}

/** Agência de relacionamento da ficha da Caixa: "AGÊNCIA DE RELACIONAMENTO UF: SP Município: X Código e Nome das Agências: 0354 NOME". */
export function extrairAgenciaFichaCaixa(texto: string): { codigo: string; cidade: CidadeUf } | undefined {
  const achado = texto
    .replace(/\s+/g, " ")
    .match(/AG[ÊE]NCIA DE RELACIONAMENTO\s+UF:\s*([A-Z]{2})\s+Munic[ií]pio:\s*(.+?)\s+C[óo]digo e Nome d[ao]s Ag[êe]ncias:\s*(\d{4})\b/i)
  const uf = achado?.[1]?.toUpperCase()
  const cidade = limpar(achado?.[2])
  return uf && cidade && UFS.includes(uf) ? { codigo: achado![3]!, cidade: { cidade, uf } } : undefined
}

export interface AvaliacaoRiscoLida {
  /** Segundo proponente da simulação (compõe renda) — não é necessariamente o cônjuge. */
  participante?: { nome?: string; cpf?: string }
  valorImovel?: number
  valorFinanciamento?: number
  prazoMeses?: number
  /** Fim do intervalo "Validade X a Y", quando a aprovação deixa de valer. */
  validadeAte?: string
}

/**
 * "Formulário de Impressão AVALIAÇÃO DE RISCO" da Caixa/SIOPI: resultado da
 * simulação, com os termos aprovados — não é o cadastro do cliente
 * (ficha_cadastro). Rótulo e valor já vêm lado a lado no texto porque o motor
 * reordena por posição na página (ver `textoDaPagina` em pdf.ts).
 *
 * Renda e ocupação do proponente/participante (página 2) ficam de fora: a
 * célula de ocupação quebra em duas linhas na tabela ("SERVIDOR PUBLICO" /
 * "ESTADUAL") e embaralha a leitura por posição — teria que remontar
 * coluna a coluna, não só linha a linha. Se isso for valioso, entra depois.
 */
export function extrairAvaliacaoRisco(texto: string): AvaliacaoRiscoLida {
  const participante = semVazios({
    nome: texto.match(/\bParticipante\s+(.+?)\s+CPF Participante\b/)?.[1]?.trim(),
    cpf: cpfSeValido(texto.match(/CPF Participante\s+([\d.\-]{11,14})/)?.[1]),
  })
  const prazo = texto.match(/Prazo \(Meses\)\s+(\d+)/i)?.[1]
  const validade = texto.match(/\bValidade\s+\d{2}\/\d{2}\/\d{4}\s+a\s+(\d{2})\/(\d{2})\/(\d{4})/)

  return semVazios({
    participante: Object.keys(participante).length > 0 ? participante : undefined,
    valorImovel: numeroBr(texto.match(/Valor do Imóvel\s+([\d.]+,\d{2})/i)?.[1]),
    valorFinanciamento: numeroBr(texto.match(/Valor Financiamento\s+([\d.]+,\d{2})/i)?.[1]),
    prazoMeses: prazo ? Number(prazo) : undefined,
    validadeAte: validade ? `${validade[3]}-${validade[2]}-${validade[1]}` : undefined,
  })
}

/**
 * "70 165", "70kg 1,65m", "70 / 1.65": peso em kg e altura em cm. Fora de
 * uma faixa humana, o número é descartado — melhor vazio que errado.
 */
export function pesoEAltura(texto: string | undefined): { pesoKg?: number; alturaCm?: number } {
  const [peso, altura] = (texto ?? "").match(/\d+(?:[.,]\d+)?/g)?.map((n) => Number(n.replace(",", "."))) ?? []
  const cm = altura !== undefined && altura < 3 ? Math.round(altura * 100) : altura
  return {
    pesoKg: peso !== undefined && peso >= 30 && peso <= 300 ? peso : undefined,
    alturaCm: cm !== undefined && cm >= 100 && cm <= 230 ? cm : undefined,
  }
}

/** Data digitada num formulário: "01/02/2015", "01022015" ou "2015-02-01" — no começo do valor, nunca futura. */
function dataDigitada(valor: string | undefined): string | undefined {
  const br = valor?.match(/^(\d{2})\/?(\d{2})\/?(\d{4})\b/)
  const iso = valor?.match(/^(\d{4})-(\d{2})-(\d{2})\b/)
  const data = br ? dataIso(Number(br[1]), Number(br[2]), Number(br[3])) : iso ? dataIso(Number(iso[3]), Number(iso[2]), Number(iso[1])) : undefined
  return data && data <= new Date().toISOString().slice(0, 10) ? data : undefined
}

/**
 * Carteira de Trabalho Digital (PDF da Dataprev). Os rótulos vêm em bloco
 * antes dos valores ("Nome civil CPF FULANO 123.456.789-00"). O contrato atual
 * é o que termina em "- Aberto": cargo e situação saem só dele — cargo de um
 * contrato encerrado não é a profissão de hoje.
 */
export function extrairCtpsDigital(texto: string): PessoaLida {
  const t = texto.replace(/\s+/g, " ")
  const identificacao = t.match(/Nome civil\s+CPF\s+(.+?)\s+(\d{3}\.\d{3}\.\d{3}-\d{2})/i)
  const inicioContratoAberto = t.search(/\d{2}\/\d{2}\/\d{4}\s*-\s*Aberto\b/i)
  const contratoAberto = inicioContratoAberto >= 0 ? t.slice(inicioContratoAberto, inicioContratoAberto + 1500) : ""

  return semVazios({
    nome: limpar(identificacao?.[1]),
    cpf: cpfSeValido(identificacao?.[2]),
    sexo: sexoDoTexto(t.match(/\bSexo\s+(Masculino|Feminino)\b/i)?.[1]),
    // Dois leiautes: "Cargo X CBO 1234-56" e "CBO Cargo X 1234-56" (rótulos
    // antes). No segundo, o "CBO" seguinte era o do PRÓXIMO contrato e o cargo
    // saía com um parágrafo inteiro.
    profissao: limpar(
      contratoAberto.match(/\bCBO\s+Cargo\s+(.+?)\s+\d{4}-\d{2}\b/)?.[1] ??
        contratoAberto.match(/\bCargo\s+(.{2,60}?)\s+CBO\b/)?.[1],
    ),
    // O contrato em aberto começa pela data de admissão: "01/02/2015 - Aberto".
    admissao: dataBrParaIso(contratoAberto.slice(0, 10)),
    // "Empregador RAZÃO SOCIAL CNPJ RAIZ: …".
    empregador: limpar(contratoAberto.match(/\bEmpregador\s+(.{3,80}?)\s+CNPJ\b/)?.[1]),
    situacaoOcupacional: /Rela[cç][aã]o de trabalho\s+Empregado/i.test(contratoAberto) ? ("empregado" as const) : undefined,
  })
}

/**
 * Recibo ou declaração de IR: quem declarou e de que exercício. "Declarante"
 * não é palpite — o documento existe. O CPF do titular vem rotulado no recibo
 * ("inscrito no CPF sob o nº") e na declaração ("Identificação do
 * contribuinte CPF:"); nos dois é também o primeiro CPF válido do texto.
 */
export function extrairImpostoRenda(texto: string): PessoaLida {
  const t = texto.replace(/\s+/g, " ")
  const exercicio = Number(t.match(/EXERC[IÍ]CIO\s+(\d{4})/i)?.[1])
  const anoAtual = new Date().getFullYear()
  const cpfConjuge = cpfSeValido(t.match(/CPF do c[oô]njuge ou companheiro\(a\):\s*([\d.\-]{14})/i)?.[1])

  return semVazios({
    nome: limpar(
      t.match(/Sr\(a\)\s+(.+?),\s+inscrit/i)?.[1] ??
        t.match(/Identifica[cç][aã]o do contribuinte\s+CPF:\s*[\d.\-]+\s+Nome:\s*(.+?)\s+Data de nascimento/i)?.[1],
    ),
    cpf:
      cpfSeValido(t.match(/inscrit[oa] no CPF sob o n[ºo°]\s*([\d.\-]{14})/i)?.[1]) ??
      cpfSeValido(t.match(/Identifica[cç][aã]o do contribuinte\s+CPF:\s*([\d.\-]{14})/i)?.[1]) ??
      extrairCpf(t),
    impostoRenda:
      exercicio >= 2000 && exercicio <= anoAtual + 1 ? { situacao: "declarante" as const, exercicio } : undefined,
    conjuge: cpfConjuge ? { cpf: cpfConjuge } : undefined,
  })
}

/**
 * Extrato do FGTS da Caixa, nos dois modelos que chegam:
 *
 * - Impresso pelo trabalhador: um bloco por vínculo, com "PIS/PASEP 123…" e
 *   "Nº DA CONTA (COD. ESTABELECIMENTO/CONTA) 1234… / 5678…"; o nome abre o
 *   documento, logo antes de "EMPREGADOR".
 * - Conectividade Social (emitido pelo empregador): rotulado — "Nome: X
 *   PIS/PASEP/NIT: … Cód. Estab.: … Categoria: … Nº Conta FGTS: …".
 *
 * Todas as contas vão como sugestão — qual sacar é decisão do analista.
 */
export function extrairExtratoFgts(texto: string): PessoaLida {
  const t = texto.replace(/\s+/g, " ")
  const contas = new Map<string, { conta: string; codigoEmpregador: string }>()
  // No extrato
  // impresso os rótulos vêm numa linha e os valores na seguinte, então logo
  // depois do rótulo da conta vêm a carteira de trabalho ("23528/237") e o
  // CNPJ do empregador, e só então "estabelecimento / conta". A folga de 60
  // caracteres pula os dois; "23528/237" não casa porque o estabelecimento
  // tem 6 dígitos ou mais.
  const padroesConta = [
    /N[ºo°]\s*DA\s+CONTA\s*\(COD\.?\s*ESTABELECIMENTO\s*\/\s*CONTA\)[\s\S]{0,60}?(\d{6,14})\s*\/\s*(\d{4,12})/gi,
    /C[óo]d\.?\s*Estab\.?:\s*(\d{6,14})\s+Categoria:\s*\d+\s+N[ºo°]\s*Conta\s+FGTS:\s*(\d{4,14})/gi,
  ]
  for (const padrao of padroesConta) {
    for (const achado of t.matchAll(padrao)) {
      contas.set(`${achado[1]}/${achado[2]}`, { codigoEmpregador: achado[1]!, conta: achado[2]! })
    }
  }

  // Extrato completo do app da Caixa, uma
  // conta por vínculo ("NOME: X EMPRESA: Y NÚMERO DA CONTA: 9970… / 12345").
  // O texto sai embaralhado dentro da página, mas cada conta abre a sua
  // página com o próprio "SALDO: R$ …" — página com uma conta e um saldo liga
  // os dois. Conta de saldo zero (emprego antigo, já sacada) não vai: só
  // encheria a tabela do formulário.
  const contasApp = new Map<string, { conta: string; codigoEmpregador: string; valor?: number }>()
  for (const pagina of t.split(/Pag:\s*\d+\s*\/\s*\d+/)) {
    const achadas = [...pagina.matchAll(/N[ÚU]MERO DA CONTA:\s*(\d{6,14})\s*\/\s*(\d{3,12})/g)]
    const saldos = [...pagina.matchAll(/SALDO:\s*R\$\s*([\d.]+,\d{2})/g)]
    for (const achado of achadas) {
      const valor = achadas.length === 1 && saldos.length === 1 ? numeroBr(saldos[0]![1]) : undefined
      contasApp.set(`${achado[1]}/${achado[2]}`, { codigoEmpregador: achado[1]!, conta: achado[2]!, valor })
    }
  }
  for (const [chave, conta] of contasApp) if (conta.valor !== 0) contas.set(chave, conta)

  // PIS colado no rótulo (Conectividade Social) ou, no extrato impresso, onde
  // estiver: lá o rótulo "PIS/PASEP" fica na linha dos rótulos e o número na
  // de baixo. O PIS impresso tem máscara própria (127.09582.85-8, 3.5.2-1),
  // diferente da do CPF, e ainda passa pelo dígito verificador.
  const pisRotulado = pisSeValido(t.match(/PIS\/PASEP(?:\/NIT)?:?\s*([\d.\-]{11,14})/i)?.[1])
  const pisMascarado = [...t.matchAll(/(\d{3}\.\d{5}\.\d{2}-\d)/g)]
    .map((achado) => pisSeValido(achado[1]))
    .find((valor) => valor !== undefined)

  return semVazios({
    nome: limpar(
      t.match(/^\s*([A-ZÀ-Ú][A-ZÀ-Ú ]+?)\s+EMPREGADOR\b/)?.[1] ??
        t.match(/\bNOME:\s*([A-ZÀ-Ú][A-ZÀ-Ú ]+?)\s+EMPRESA:/)?.[1] ??
        t.match(/\bNome:\s*(.+?)\s+PIS\/PASEP/i)?.[1],
    ),
    pis: pisRotulado ?? pisMascarado,
    contasFgts: contas.size > 0 ? [...contas.values()] : undefined,
  })
}

/**
 * Certidão de Dados Cadastrais do Imóvel (Prefeitura de São Paulo). O texto
 * sai com os valores antes dos rótulos — "BAIRRO CEP 00000-000 … AV X, 220 …
 * Local do Imóvel: Endereço para entrega da notificação:" — e o primeiro
 * endereço é o do imóvel, na ordem dos rótulos. Outro modelo de certidão ou
 * carnê devolve vazio.
 */
export function extrairEnderecoCertidaoDadosCadastrais(texto: string): EnderecoImovelLido | undefined {
  const t = texto.replace(/\s+/g, " ")
  if (!/Certid[aã]o de Dados Cadastrais do Im[oó]vel/i.test(t)) return undefined

  const logradouro = t.match(/\b((?:AV|R|RUA|AL|TV|PC|PCA|ESTR|ROD)\.?\s+[A-ZÀ-Ú0-9 .]+?),\s*(\d+[A-Z]?)\b/)
  if (!logradouro) return undefined
  const bairroCep = t.match(/(?:IPTU\s+)?([A-ZÀ-Ú][A-ZÀ-Ú0-9 .]*?)\s+CEP\s+(\d{5}-?\d{3})/)

  return semVazios({
    logradouro: limpar(logradouro[1])!,
    numero: logradouro[2]!,
    bairro: limpar(bairroCep?.[1]),
    cep: bairroCep?.[2]?.replace(/\D/g, ""),
  })
}

/** Os termos da operação aprovada, como a avaliação de risco da Caixa imprime. */
export interface ExtrasAvaliacaoRisco {
  /** "PMCMV" no texto = programa MCMV; senão, SBPE. */
  programa?: "sbpe" | "mcmv"
  /** Texto do campo "Modalidade", como veio ("Aquisição de imóvel novo"). */
  modalidadeTexto?: string
  /** "Origem de Recurso": FGTS, SBPE... como veio. */
  origemRecurso?: string
  sistemaAmortizacao?: "SAC" | "PRICE"
  /** Código da agência de relacionamento (4 dígitos). */
  agencia?: string
  /** Renda por CPF, como a Caixa aceitou. Ocupação fica de fora: a célula quebra. */
  rendas: { cpf: string; bruta?: number; liquida?: number; referencia?: string }[]
}

export function extrairAvaliacaoRiscoExtras(texto: string): ExtrasAvaliacaoRisco {
  const plano = texto.replace(/\s+/g, " ")
  const modalidade = plano.match(/\bModalidade\s+(.+?)\s+(?:PMCMV|Produto|Valor do Im[óo]vel)\b/i)?.[1]
  const sistema = plano.match(/Sistema de Amortiza[çc][ãa]o\s+(SAC|PRICE)\b/i)?.[1]?.toUpperCase()

  // "296.912.608-75 SERVIDOR PUBLICO 11.016,43 3.097,76 8/2026": o CPF abre a
  // linha e os dois valores em reais vêm na ordem bruta, líquida.
  const rendas = [...plano.matchAll(/(\d{3}\.\d{3}\.\d{3}-\d{2})\s+[^\d]{0,60}?([\d.]+,\d{2})\s+([\d.]+,\d{2})\s+(\d{1,2}\/\d{4})/g)]
    .map((linha) => ({
      cpf: linha[1]!.replace(/\D/g, ""),
      bruta: numeroBr(linha[2]),
      liquida: numeroBr(linha[3]),
      referencia: linha[4],
    }))
    .filter((r) => cpfValido(r.cpf))

  return {
    programa: /\bp?mcmv\b|minha casa/i.test(plano) ? "mcmv" : /\bsbpe\b/i.test(plano) ? "sbpe" : undefined,
    modalidadeTexto: modalidade?.trim(),
    origemRecurso: plano.match(/Origem de Recurso\s+([A-Za-zÁ-úç+ ]{3,20}?)\s+(?:Modalidade|Produto)\b/i)?.[1]?.trim(),
    sistemaAmortizacao: sistema === "SAC" || sistema === "PRICE" ? sistema : undefined,
    agencia: plano.match(/Ag[êe]ncia de relacionamento\s+(\d{3,4})\b/i)?.[1],
    rendas,
  }
}

/**
 * CNH sem MRZ legível (scan antigo, foto ruim): o campo 3 da carteira traz
 * "DATA, LOCAL E UF DE NASCIMENTO" e, logo depois, a data e a cidade/UF. O
 * rótulo "data de nascimento" não casa com esse, por isso o reforço.
 * O "DATA" do rótulo é opcional: o OCR come o D ("ATA LOCAL E UF...") e o
 * resto do rótulo só existe na CNH.
 */
export function extrairNascimentoCnhRotulado(texto: string): { nascimento?: string; local?: LocalNascimento } {
  const achado = texto.match(
    /(?:data[,.\s]+)?local\s+e\s+uf\s+de\s+nascimento\D{0,20}?(\d{2})\/(\d{2})\/(\d{4})(?:\s*[,.]?\s*([A-Za-zÀ-ÿ'. ]{2,40}?)\s*[-–/,]\s*([A-Za-z]{2})\b)?/i,
  )
  if (!achado) return {}
  const nascimento = dataIso(Number(achado[1]), Number(achado[2]), Number(achado[3]))
  // Quem nasceu ontem não assina financiamento: data fora da faixa é leitura errada.
  if (!nascimento || anoDe(nascimento) > new Date().getFullYear() - 14) return {}
  const cidade = achado[4] ? limparCidade(achado[4]) : undefined
  const uf = achado[5]?.toUpperCase()
  return { nascimento, local: cidade && uf && UFS.includes(uf) ? { cidade, uf } : undefined }
}

/**
 * Sexo da MRZ (CNH-e e Carteira de Identidade Nacional): na linha 2, entre o
 * nascimento (AAMMDD + dígito) e a validade (AAMMDD + dígito), vem M ou F,
 * colado no "BRA" da nacionalidade. Sem esse encaixe inteiro, não sai nada.
 */
export function extrairSexoMrz(texto: string): "masculino" | "feminino" | undefined {
  const achado = texto.replace(/\s+/g, "").toUpperCase().match(/\d{6}\d([MF])\d{6}[0-9A-Z]?BRA/)
  return achado ? (achado[1] === "F" ? "feminino" : "masculino") : undefined
}

/**
 * CNH modelo antigo: "CPF  DATA NASCIMENTO" numa linha e os valores na de
 * baixo. O rótulo do RG ("data DE nascimento") não casa.
 */
export function extrairNascimentoCnhAntiga(texto: string): string | undefined {
  const nascimento = dataAposRotulo(texto, acharDatasNoTexto(texto), /data\s+nascimento/i)
  return nascimento && anoDe(nascimento) <= new Date().getFullYear() - 14 ? nascimento : undefined
}

/**
 * O RG que a CNH imprime (campo 4d, "DOC. IDENTIDADE/ÓRG EMISSOR/UF"): número
 * colado em "SSP/SP". Na CNH o único órgão estadual é o do RG — o da própria
 * carteira é o DETRAN —, então o encaixe número + órgão + UF basta, mesmo com
 * o rótulo comido pelo OCR. Sem data de expedição: a CNH não imprime.
 */
export function extrairRgDaCnh(texto: string): IdentidadeLida | undefined {
  const orgaos = ORGAOS_RG.split("|").filter((o) => o !== "detran").join("|")
  const achado = semAcento(texto).match(
    new RegExp(String.raw`(?<![\d.])(\d[\d.]{4,11}(?:-?[\dx])?)\s*[-/.]?\s*(${orgaos})\s*[/\-.]?\s*([a-z]{2})\b`),
  )
  if (!achado || !UFS.includes(achado[3]!.toUpperCase())) return undefined
  const numero = achado[1]!.replace(/[^\dx]/g, "").toUpperCase()
  if (numero.length < 5) return undefined
  return { tipo: "RG", numero, orgaoEmissor: achado[2]!.toUpperCase(), uf: achado[3]!.toUpperCase() }
}

/** O que os documentos de uma empresa (vendedor PJ) dizem dela. */
export interface EmpresaLida {
  /** Só dígitos, com dígito verificador conferido. */
  cnpj?: string
  razaoSocial?: string
  /** CEP da sede, só dígitos: o resto do endereço sai da consulta do CEP. */
  cepSede?: string
  /** Quem assina pela empresa: o administrador. */
  representanteNome?: string
  representanteCpf?: string
}

const SUFIXO_EMPRESA = /^\s*:?\s*(.{3,120}?\b(?:LTDA|S\.?\s?\/?A|EIRELI|EPP|ME)\b\.?)/i
const CEP_COM_HIFEN = /\b(\d{2})\.?(\d{3})\s?-\s?(\d{3})\b/

/** "Nome: EMPRESA EXEMPLO LTDA CNPJ: ..." → a razão social logo depois do rótulo, até o LTDA/S.A./EIRELI. */
function empresaApos(texto: string, rotulo: RegExp): string | undefined {
  const achado = rotulo.exec(texto)
  if (!achado) return undefined
  const nome = texto.slice(achado.index + achado[0].length, achado.index + achado[0].length + 160).match(SUFIXO_EMPRESA)?.[1]
  return nome?.replace(/\s+/g, " ").replace(/\.$/, "").trim().toUpperCase()
}

function cepDepois(texto: string, de = 0): string | undefined {
  const achado = texto.slice(de, de + 400).match(CEP_COM_HIFEN)
  return achado ? `${achado[1]}${achado[2]}${achado[3]}` : undefined
}

/** Nome em maiúsculas, com 2 palavras ou mais. */
const NOME_MAIUSCULO = "([A-ZÀ-Ú][A-ZÀ-Ú]+(?: [A-ZÀ-Ú]{1,}){1,8})"

/**
 * O administrador: na certidão simplificada, o bloco "SÓCIO E ADMINISTRADOR
 * NOME ..."; no contrato, quem assina como "(Sócio-Administrador)" ou quem
 * "representada por seu administrador" apresenta. O CPF é o primeiro que vem
 * depois da primeira vez que o nome aparece (a qualificação dele).
 */
function representante(texto: string, tipo: string): Pick<EmpresaLida, "representanteNome" | "representanteCpf"> {
  const padroes =
    tipo === "certidao_junta_comercial"
      ? [new RegExp(`ADMINISTRADORA? NOME ${NOME_MAIUSCULO} ENDERE`)]
      : [
          new RegExp(String.raw`${NOME_MAIUSCULO}\s*\(\s*S[óo]ci[oa][\s-]*[Aa]dministrador[a]?\s*\)`),
          new RegExp(String.raw`representad[ao] por (?:seu|sua) (?:s[óo]ci[oa] e )?administrador[a]?,?\s*(?:Sr[a]?\.?\s*)?${NOME_MAIUSCULO}\s*[,(]`),
        ]
  for (const padrao of padroes) {
    const nome = texto.match(padrao)?.[1]?.trim()
    if (!nome) continue
    const inicio = texto.indexOf(nome)
    return { representanteNome: nome, representanteCpf: extrairCpf(texto.slice(inicio, inicio + 400)) }
  }
  return {}
}

/**
 * Vendedor PJ: CNPJ e razão social dos documentos de cadastro atuais (CND
 * federal, CRF, certidão da Junta, cartão CNPJ); do contrato social só a sede
 * e o administrador — ele cita sócios, outras empresas e nomes antigos da
 * própria (um real mudou de nome na 2ª alteração).
 */
export function extrairEmpresa(textoOriginal: string, tipo: string): EmpresaLida {
  const texto = textoOriginal.replace(/\s+/g, " ")
  if (tipo === "contrato_social") {
    const sede = /ter[áa] (?:a )?sede|sede e foro/i.exec(texto)
    return semVazios({ cepSede: sede ? cepDepois(texto, sede.index) : undefined, ...representante(texto, tipo) })
  }
  // Na CND, o CNPJ no rótulo: sem ele é a CND de uma pessoa, não de empresa.
  const cnpj = tipo === "cnd_federal" ? texto.match(/CNPJ:?\s*([\d.\/\-\s]{14,20})/)?.[1] : texto
  const cnpjLido = cnpj ? extrairCnpj(cnpj) : undefined
  if (!cnpjLido) return {}
  const rotulo = {
    cnd_federal: /\bNome:/,
    crf_fgts: /Raz[ãa]o(?:\s+social)?:?/i,
    certidao_junta_comercial: /NOME COMERCIAL/,
    cartao_cnpj: /NOME EMPRESARIAL/,
  }[tipo]
  return semVazios({
    cnpj: cnpjLido,
    razaoSocial: rotulo ? empresaApos(texto, rotulo) : undefined,
    cepSede: tipo === "cnd_federal" ? undefined : cepDepois(texto, Math.max(0, texto.search(/\bCEP\b|ENDERE[ÇC]O/i))) ?? cepDepois(texto),
    ...(tipo === "certidao_junta_comercial" ? representante(texto, tipo) : {}),
  })
}
