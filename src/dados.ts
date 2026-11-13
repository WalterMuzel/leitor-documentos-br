/**
 * Do tipo + texto para os dados do documento: liga cada tipo aos extratores de
 * `extracao.ts` e devolve os campos com rótulo legível, prontos para mostrar.
 *
 * Tudo aqui é local e síncrono. O que precisa de consulta pública (endereço do
 * CEP, cidade validada pelo IBGE) fica em `lugares.ts`, opcional.
 */
import type { TipoDocumento } from "./tipos.js"
import {
  analisarMatricula,
  cnpjValido,
  cpfValido,
  extrairAdmissaoRotulada,
  extrairAvaliacaoRisco,
  extrairAvaliacaoRiscoExtras,
  extrairCeps,
  extrairCertidaoCasamento,
  extrairCidadeUf,
  extrairCnpj,
  extrairCpf,
  extrairCtpsDigital,
  extrairDataEmissaoCartorio,
  extrairDataNascimentoRotulada,
  extrairDatasCnh,
  extrairEmissaoComprovante,
  extrairEmpregador,
  extrairEmpresa,
  extrairEnderecoMatricula,
  extrairExtratoFgts,
  extrairFichaCadastroCaixa,
  extrairFiliacao,
  extrairHolerite,
  extrairIdentidade,
  extrairImpostoRenda,
  extrairLocalNascimento,
  extrairMencoesCidadeImovel,
  extrairMesDeReferencia,
  extrairNacionalidade,
  extrairNascimentoCnhAntiga,
  extrairNascimentoCnhRotulado,
  extrairProprietariosMatricula,
  extrairRgDaCnh,
  extrairSexoMrz,
  extrairValidadeComprovante,
  type IdentidadeLida,
  type PessoaLida,
} from "./extracao.js"

export interface CampoLido {
  /** Nome legível: "Nº do registro", "Validade". */
  rotulo: string
  valor: string
  /** Conferido por dígito verificador (CPF, CNPJ, CNH, PIS). */
  conferido?: boolean
  /** Algo que pede atenção: documento vencido, garantia ativa na matrícula. */
  alerta?: boolean
}

export interface DadosDocumento {
  campos: CampoLido[]
  /** Para a matrícula: as palavras depois de "município de"/"comarca de" — `lugares.ts` resolve a cidade. */
  mencoesCidade?: ReturnType<typeof extrairMencoesCidadeImovel>
  /** CEP mais provável de quem mora (comprovante) ou da sede (empresa) — `lugares.ts` completa o endereço. */
  cepPrincipal?: string
}

/** Validade da certidão de matrícula: 30 dias depois da expedição. */
const DIAS_VALIDADE_MATRICULA = 30

// ---------------------------------------------------------------------------
// Formatação

export const dataBr = (iso: string | undefined) => (iso ? iso.split("-").reverse().join("/") : undefined)
const mesBr = (iso: string | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : undefined)
const cpfBr = (d: string) => d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
const cnpjBr = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
export const cepBr = (d: string) => d.replace(/^(\d{5})(\d{3})$/, "$1-$2")
const reais = (n: number | undefined) =>
  n === undefined ? undefined : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const hoje = () => new Date().toISOString().slice(0, 10)

const ESTADO_CIVIL: Record<string, string> = {
  solteiro: "Solteiro(a)", casado: "Casado(a)", divorciado: "Divorciado(a)", viuvo: "Viúvo(a)", separado: "Separado(a)",
}
const REGIME: Record<string, string> = {
  comunhao_parcial: "Comunhão parcial de bens",
  comunhao_universal: "Comunhão universal de bens",
  separacao_total: "Separação total de bens",
  separacao_obrigatoria: "Separação obrigatória de bens",
  participacao_final_aquestos: "Participação final nos aquestos",
}

/** Monta a lista de campos pulando o que veio vazio. */
class Campos {
  readonly lista: CampoLido[] = []
  add(rotulo: string, valor: string | number | undefined | null, extra: Omit<CampoLido, "rotulo" | "valor"> = {}) {
    if (valor === undefined || valor === null || valor === "") return this
    this.lista.push({ rotulo, valor: String(valor), ...extra })
    return this
  }
  cpf(rotulo: string, digitos: string | undefined) {
    return digitos ? this.add(rotulo, cpfBr(digitos), { conferido: cpfValido(digitos) }) : this
  }
  cnpj(rotulo: string, digitos: string | undefined) {
    return digitos ? this.add(rotulo, cnpjBr(digitos), { conferido: cnpjValido(digitos) }) : this
  }
  /** Validade: alerta quando já passou. */
  validade(rotulo: string, iso: string | undefined) {
    if (!iso) return this
    const vencido = iso < hoje()
    return this.add(rotulo, `${dataBr(iso)}${vencido ? " (vencido)" : ""}`, vencido ? { alerta: true } : {})
  }
}

// ---------------------------------------------------------------------------
// Nome do titular (RG e CNH)

const NAO_E_NOME =
  /\b(?:REPUBLICA|FEDERATIVA|BRASIL|MINISTERIO|DEPARTAMENTO|CARTEIRA|NACIONAL|HABILITACAO|IDENTIDADE|REGISTRO|GERAL|FILIACAO|SOBRENOME|NOME|DATA|NASCIMENTO|VALIDADE|ASSINATURA|ESTADO|SECRETARIA|SEGURANCA|PUBLICA|INSTITUTO|DOC|CPF|CATEGORIA|PERMISSAO|LOCAL|EMISSAO|TRANSITO|VALIDA|TODO|TERRITORIO)\b/

/**
 * Nome do titular pelo rótulo "NOME" (RG, CNH, CNH-e: "2 e 1 NOME E SOBRENOME").
 * O valor é o primeiro trecho em maiúsculas, de 2 a 7 palavras, logo depois do
 * rótulo — na mesma linha ou na seguinte. Sem rótulo, não sai nada.
 */
export function extrairNomeTitular(texto: string): string | undefined {
  // Um caractere vira um (sem acento): a posição achada aqui vale no texto original.
  const semAcentos = [...texto].map((ch) => ch.normalize("NFD")[0]!).join("")
  for (const rotulo of semAcentos.matchAll(/\bNOME(?:\s+E\s+SOBRENOME|\s+SOCIAL|\s+CIVIL)?\b\s*:?/gi)) {
    const depois = semAcentos.slice(rotulo.index! + rotulo[0].length, rotulo.index! + rotulo[0].length + 120)
    for (const candidato of depois.matchAll(/[A-Z]{2,}(?:[ \t]+(?:D[AEO]S?|E|[A-Z]{2,})(?![A-Za-z])){1,6}/g)) {
      const nome = candidato[0].trim()
      const palavras = nome.split(/\s+/)
      if (NAO_E_NOME.test(nome) || palavras.length < 2 || palavras.at(-1)!.length < 2) continue
      // Volta para o texto original (com acento), mesma posição.
      const inicio = rotulo.index! + rotulo[0].length + candidato.index!
      return capitalizarNome(texto.slice(inicio, inicio + nome.length))
    }
  }
  return undefined
}

const NAO_E_PESSOA =
  /\b(?:LTDA|S\.?\s?A|ME|EPP|EIRELI|COMPANHIA|CIA|EMPRESA|ENERGIA|ELETRICA|SANEAMENTO|AGUA|ESGOTO|GAS|TELEFONICA|TELECOM|NOTA|FISCAL|CONTA|FATURA|RUA|AVENIDA|AV|TRAVESSA|ALAMEDA|ESTRADA|RODOVIA|CEP|BAIRRO|CENTRO|JARDIM|VILA|PARQUE|CNPJ|CPF|TOTAL|VALOR|VENCIMENTO|REFERENCIA|CONSUMO|ESTADO|BRASIL|BANCO|CLIENTE|ENDERECO|INSTALACAO|CODIGO|DOCUMENTO|DATA|LEITURA|MEDIDOR|TARIFA)\b/

/**
 * Quem é o titular de uma conta (luz, água, telefone): o comprovante não tem
 * rótulo "nome", mas o nome do cliente vem logo antes do endereço dele — é o
 * que `extrairCeps` usa para separar o CEP do cliente do da empresa. Testa
 * cada nome de pessoa em maiúsculas do texto; vale o primeiro que fica logo
 * antes de um CEP.
 */
export function titularDoComprovante(texto: string): { nome: string; cep: string } | undefined {
  const plano = [...texto].map((ch) => ch.normalize("NFD")[0]!).join("")
  const vistos = new Set<string>()
  for (const m of plano.matchAll(/(?<![A-Za-z])[A-Z]{2,}(?:[ \t]+(?:D[AEO]S?|E|[A-Z]{2,})(?![A-Za-z])){1,7}(?![A-Za-z])/g)) {
    // O trecho em maiúsculas emenda no que vem antes e depois ("NOTA FISCAL
    // FULANA DE TAL RUA X"): os pedaços entre palavras que não são de nome.
    const palavras = [...m[0].matchAll(/\S+/g)]
    const pedacos: (typeof palavras)[] = [[]]
    for (const p of palavras) {
      if (NAO_E_PESSOA.test(p[0])) pedacos.push([])
      else pedacos.at(-1)!.push(p)
    }
    for (const pedaco of pedacos) {
      while (pedaco.length && /^(?:D[AEO]S?|E)$/.test(pedaco.at(-1)![0])) pedaco.pop()
      if (pedaco.length < 2) continue
      const inicio = m.index! + pedaco[0]!.index!
      const fim = m.index! + pedaco.at(-1)!.index! + pedaco.at(-1)![0].length
      const nome = plano.slice(inicio, fim)
      if (vistos.has(nome)) continue
      vistos.add(nome)
      const cep = extrairCeps(texto, nome).find((c) => c.depoisDoNome)
      if (cep) return { nome: capitalizarNome(texto.slice(inicio, fim)), cep: cep.cep }
    }
  }
  return undefined
}

/** "MARIA DA SILVA" → "Maria da Silva". */
function capitalizarNome(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_, espaco: string, letra: string) => espaco + letra.toUpperCase())
    .replace(/\s(D[aeo]s?|E)(?=\s)/g, (m) => m.toLowerCase())
}

// ---------------------------------------------------------------------------
// Blocos que se repetem entre tipos

function identidade(c: Campos, lida: IdentidadeLida | undefined, prefixo = "") {
  if (!lida) return
  const nome = lida.tipo === "CNH" ? "Nº do registro da CNH" : "Nº do RG"
  c.add(prefixo + nome, lida.numero, lida.tipo === "CNH" && lida.numero ? { conferido: true } : {})
  c.add(prefixo + "Órgão emissor", [lida.orgaoEmissor, lida.uf].filter(Boolean).join("/"))
  c.add(prefixo + (lida.tipo === "CNH" ? "Emissão" : "Expedição"), dataBr(lida.emissao))
  c.add(prefixo + "1ª habilitação", dataBr(lida.primeiraHabilitacao))
}

function pessoa(c: Campos, p: PessoaLida) {
  c.add("Nome", p.nome)
  c.cpf("CPF", p.cpf)
  c.add("Nascimento", dataBr(p.nascimento))
  c.add("Naturalidade", p.naturalidade)
  c.add("Sexo", p.sexo === "feminino" ? "Feminino" : p.sexo === "masculino" ? "Masculino" : undefined)
  c.add("Estado civil", p.estadoCivil && ESTADO_CIVIL[p.estadoCivil])
  c.add("Regime de bens", p.regimeBens && (REGIME[p.regimeBens] ?? p.regimeBens))
  c.add("Nome do pai", p.pai)
  c.add("Nome da mãe", p.mae)
  c.add("Nacionalidade", p.nacionalidade)
  c.add("Profissão", p.profissao)
  c.add("Grau de instrução", p.grauInstrucao)
  identidade(c, p.identidade)
  if (p.pis) c.add("PIS", p.pis, { conferido: true })
  c.add("Empregador", p.empregador)
  c.cnpj("CNPJ do empregador", p.empregadorCnpj)
  c.add("Admissão", dataBr(p.admissao))
  c.add("Situação", p.situacaoOcupacional === "empregado" ? "Empregado (contrato em aberto)" : undefined)
  c.add("Renda bruta", reais(p.rendaBruta))
  c.add("Renda líquida", reais(p.rendaLiquida))
  if (p.impostoRenda) c.add("Imposto de renda", `Declarante — exercício ${p.impostoRenda.exercicio}`)
  for (const conta of p.contasFgts ?? []) {
    c.add("Conta FGTS", `${conta.conta}${conta.valor !== undefined ? ` — saldo ${reais(conta.valor)}` : ""}`)
  }
  if (p.conjuge) {
    c.add("Cônjuge", p.conjuge.nome)
    c.cpf("CPF do cônjuge", p.conjuge.cpf)
  }
  if (p.moradia) {
    const m = p.moradia
    c.add("Endereço", [m.logradouro, m.numero, m.complemento, m.bairro].filter(Boolean).join(", "))
    c.add("CEP", m.cep && cepBr(m.cep))
    c.add("Cidade", m.cidade && `${m.cidade.cidade}/${m.cidade.uf}`)
  }
  c.add("E-mail", p.email)
  c.add("Telefone", p.telefone)
}

/** O que dá para tirar de qualquer documento: CPF, CNPJ e "cidade/UF". */
function genericos(c: Campos, texto: string) {
  c.cpf("CPF citado", extrairCpf(texto))
  c.cnpj("CNPJ citado", extrairCnpj(texto))
  // "cidade/UF" do texto corrido é só candidato: entra quando o nome é limpo.
  const cidade = extrairCidadeUf(texto).find((candidato) => /^\p{L}[\p{L}' ]{2,}$/u.test(candidato.cidade))
  c.add("Cidade citada", cidade && `${cidade.cidade}/${cidade.uf}`)
}

const PARTICULAS = new Set(["de", "da", "do", "das", "dos"])
const FIM_DA_CIDADE = new Set([
  "estado", "comarca", "cep", "matricula", "registro", "imovel", "imoveis", "livro", "ficha", "oficial", "cartorio",
  "bairro", "rua", "avenida", "lote", "quadra", "numero", "sob", "neste", "nesta", "com", "e", "o", "a",
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi",
  "rj", "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
])

/**
 * Palpite da cidade sem a lista do IBGE: as palavras depois de "município de"
 * até a primeira que não pode ser nome de cidade (sigla, número, palavra de
 * cartório). Com a lista, `lugares.ts` confere de verdade.
 */
function cidadeDasPalavras(palavras: string[]): string | undefined {
  const nome: string[] = []
  for (const p of palavras) {
    if (FIM_DA_CIDADE.has(p) || /\d/.test(p) || (p.length < 3 && !PARTICULAS.has(p))) break
    nome.push(p)
  }
  while (nome.length && PARTICULAS.has(nome.at(-1)!)) nome.pop()
  if (!nome.length) return undefined
  return nome.map((p) => (PARTICULAS.has(p) ? p : p[0]!.toUpperCase() + p.slice(1))).join(" ")
}

// ---------------------------------------------------------------------------
// Por tipo

/**
 * Os dados de um documento já classificado. Nunca lança: tipo sem extrator
 * próprio cai nos campos genéricos (CPF, CNPJ, cidade).
 */
export function extrairDados(tipo: TipoDocumento, texto: string): DadosDocumento {
  const c = new Campos()
  const saida: DadosDocumento = { campos: c.lista }
  if (!texto.trim()) return saida

  switch (tipo) {
    case "cnh": {
      const datas = extrairDatasCnh(texto)
      const rotulado = extrairNascimentoCnhRotulado(texto)
      const nome = extrairNomeTitular(texto)
      const local = extrairLocalNascimento(texto, nome) ?? rotulado.local
      c.add("Nome", nome)
      c.cpf("CPF", extrairCpf(texto))
      identidade(c, extrairIdentidade(texto, "cnh"))
      c.validade("Validade", datas.validade)
      c.add("Nascimento", dataBr(datas.nascimento ?? rotulado.nascimento ?? extrairNascimentoCnhAntiga(texto)))
      c.add("Naturalidade", local && `${local.cidade}/${local.uf}`)
      const sexo = extrairSexoMrz(texto)
      c.add("Sexo", sexo && (sexo === "feminino" ? "Feminino" : "Masculino"))
      const filiacao = extrairFiliacao(texto, nome)
      c.add("Nome do pai", filiacao?.pai)
      c.add("Nome da mãe", filiacao?.mae)
      identidade(c, extrairRgDaCnh(texto), "RG impresso — ")
      break
    }

    case "rg": {
      const nome = extrairNomeTitular(texto)
      const local = extrairLocalNascimento(texto, nome)
      c.add("Nome", nome)
      c.cpf("CPF", extrairCpf(texto))
      identidade(c, extrairIdentidade(texto, "rg"))
      c.add("Nascimento", dataBr(extrairDataNascimentoRotulada(texto)))
      c.add("Naturalidade", local && `${local.cidade}/${local.uf}`)
      const filiacao = extrairFiliacao(texto, nome)
      c.add("Nome do pai", filiacao?.pai)
      c.add("Nome da mãe", filiacao?.mae)
      // Só brasileiro tem RG (estrangeiro tem RNE/CRNM).
      c.add("Nacionalidade", extrairNacionalidade(texto, nome) ?? "Brasileira")
      break
    }

    case "comprovante_residencia": {
      const titular = titularDoComprovante(texto)
      const cep = titular?.cep ?? extrairCeps(texto).find((candidato) => !candidato.noBlocoDoCnpj && candidato.pontos > 0)?.cep
      const validade = extrairValidadeComprovante(texto)
      saida.cepPrincipal = cep
      c.add("Titular da conta", titular?.nome)
      c.add("CEP de quem mora", cep && cepBr(cep))
      c.add("Mês de referência", mesBr(extrairMesDeReferencia(texto)))
      c.add("Emissão", dataBr(extrairEmissaoComprovante(texto, validade?.vencimento)))
      c.add("Vencimento da fatura", dataBr(validade?.vencimento))
      c.validade("Vale como comprovante até", validade?.validade)
      c.cnpj("CNPJ da empresa emissora", extrairCnpj(texto))
      break
    }

    case "holerite": {
      const holerite = extrairHolerite(texto)
      c.add("Empregador", extrairEmpregador(texto))
      c.cnpj("CNPJ do empregador", extrairCnpj(texto))
      c.cpf("CPF do funcionário", extrairCpf(texto))
      c.add("Competência", mesBr(extrairMesDeReferencia(texto)))
      c.add("Admissão", dataBr(extrairAdmissaoRotulada(texto)))
      c.add("Total de vencimentos (bruto)", reais(holerite?.vencimentos))
      c.add("Líquido a receber", reais(holerite?.liquido))
      break
    }

    case "matricula_imovel": {
      const endereco = extrairEnderecoMatricula(texto)
      const garantia = analisarMatricula(texto)
      const emissao = extrairDataEmissaoCartorio(texto)
      const numero = texto.match(/\bmatr[íi]cula\s*(?:n[º°o.]*\s*)?:?\s*(\d{1,3}(?:\.\d{3})+|\d{2,7})\b/i)?.[1]
      c.add("Nº da matrícula", numero)
      c.add(
        "Endereço do imóvel",
        endereco && [`${endereco.logradouro}, ${endereco.numero}`, endereco.complemento, endereco.bairro].filter(Boolean).join(" — "),
      )
      c.add("CEP do imóvel", endereco?.cep && cepBr(endereco.cep))
      for (const dono of extrairProprietariosMatricula(texto) ?? []) {
        c.add("Proprietário", `${dono.nome}${dono.cpf ? ` — CPF ${cpfBr(dono.cpf)}` : ""}`, dono.cpf ? { conferido: true } : {})
      }
      if (garantia.garantiaAtiva) {
        c.add("Garantia (alienação/hipoteca)", "Ativa — sem baixa registrada depois", { alerta: true })
        c.add("Trecho da garantia", garantia.trechoGarantia)
      } else if (garantia.garantiaBaixada) {
        c.add("Garantia (alienação/hipoteca)", "Baixada (cancelamento averbado)")
      } else {
        c.add("Garantia (alienação/hipoteca)", "Nenhuma encontrada")
      }
      c.add("Emissão da certidão", dataBr(emissao))
      if (emissao) {
        const [a, m, d] = emissao.split("-").map(Number)
        const ate = new Date(Date.UTC(a!, m! - 1, d! + DIAS_VALIDADE_MATRICULA)).toISOString().slice(0, 10)
        c.validade("Certidão válida até", ate)
      }
      // Sem a lista do IBGE, a primeira menção já dá uma ideia da cidade.
      saida.mencoesCidade = extrairMencoesCidadeImovel(texto)
      const primeira = saida.mencoesCidade.find((m) => m.origem === "descricao") ?? saida.mencoesCidade[0]
      c.add("Cidade (pelo texto)", primeira && cidadeDasPalavras(primeira.palavras))
      break
    }

    case "certidao_estado_civil": {
      const casamento = extrairCertidaoCasamento(texto)
      if (casamento) {
        c.add("Situação", casamento.dissolvido ? "Casamento dissolvido (divórcio/separação averbado)" : "Casados")
        c.add("Data do casamento", dataBr(casamento.data))
        c.add("Regime de bens", casamento.regimeBens && (REGIME[casamento.regimeBens] ?? casamento.regimeBens))
        casamento.conjuges.forEach((conjuge, i) => {
          c.add(`Cônjuge ${i + 1}`, conjuge.nome)
          c.cpf(`CPF do cônjuge ${i + 1}`, conjuge.cpf)
        })
      }
      c.add("Emissão da certidão", dataBr(extrairDataEmissaoCartorio(texto)))
      if (!casamento) genericos(c, texto)
      break
    }

    case "imposto_renda":
      pessoa(c, extrairImpostoRenda(texto))
      break
    case "ctps":
      pessoa(c, extrairCtpsDigital(texto))
      break
    case "extrato_fgts":
      pessoa(c, extrairExtratoFgts(texto))
      break
    case "ficha_cadastro":
      pessoa(c, extrairFichaCadastroCaixa(texto))
      break

    case "avaliacao_risco": {
      const avaliacao = extrairAvaliacaoRisco(texto)
      const extras = extrairAvaliacaoRiscoExtras(texto)
      c.add("Programa", extras.programa === "mcmv" ? "Minha Casa Minha Vida" : extras.programa === "sbpe" ? "SBPE" : undefined)
      c.add("Modalidade", extras.modalidadeTexto)
      c.add("Origem do recurso", extras.origemRecurso)
      c.add("Sistema de amortização", extras.sistemaAmortizacao)
      c.add("Valor do imóvel", reais(avaliacao.valorImovel))
      c.add("Valor financiado", reais(avaliacao.valorFinanciamento))
      c.add("Prazo", avaliacao.prazoMeses && `${avaliacao.prazoMeses} meses`)
      c.validade("Aprovação válida até", avaliacao.validadeAte)
      c.add("Segundo proponente", avaliacao.participante?.nome)
      c.cpf("CPF do segundo proponente", avaliacao.participante?.cpf)
      for (const renda of extras.rendas) {
        c.add(`Renda aceita — CPF ${cpfBr(renda.cpf)}`, [reais(renda.bruta) && `bruta ${reais(renda.bruta)}`, reais(renda.liquida) && `líquida ${reais(renda.liquida)}`].filter(Boolean).join(", "))
      }
      break
    }

    case "cnd_federal":
    case "crf_fgts":
    case "certidao_junta_comercial":
    case "cartao_cnpj":
    case "contrato_social": {
      const empresa = extrairEmpresa(texto, tipo)
      c.add("Razão social", empresa.razaoSocial)
      c.cnpj("CNPJ", empresa.cnpj)
      c.add("CEP da sede", empresa.cepSede && cepBr(empresa.cepSede))
      c.add("Representante", empresa.representanteNome)
      c.cpf("CPF do representante", empresa.representanteCpf)
      saida.cepPrincipal = empresa.cepSede
      if (!c.lista.length) genericos(c, texto)
      break
    }

    default:
      genericos(c, texto)
  }
  return saida
}
