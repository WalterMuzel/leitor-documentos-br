/**
 * Consultas públicas (sem chave) que completam os dados lidos — opcionais.
 * Só sai da máquina o CEP ou o nome da cidade, nunca o documento.
 *
 * - Cidade da matrícula: as menções do texto ("município de…", "comarca de…")
 *   cruzadas com a lista de municípios do IBGE, que também absorve OCR que
 *   cola palavras ("saopaulo") e desempata nome repetido em várias UFs.
 * - Endereço pelo CEP: rua, bairro e cidade na BrasilAPI.
 *
 * Sem rede, nada quebra: o campo só não aparece.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { TipoDocumento } from "./tipos.js"
import { ufsLogoDepoisDoNome, type MencaoCidadeImovel } from "./extracao.js"
import { cepBr, type DadosDocumento } from "./dados.js"

export interface Municipio {
  /** Código do IBGE. */
  id: string
  nome: string
  uf: string
}

const URL_MUNICIPIOS = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado"
const ARQUIVO_MUNICIPIOS = path.resolve("modelos", "municipios.json")
const TEMPO_LIMITE_MS = 12_000

const consultas = new Map<string, Promise<unknown>>()

/** GET com tempo limite e cache em memória; falha não fica em cache. */
function buscar<T>(url: string): Promise<T | undefined> {
  if (!consultas.has(url)) {
    consultas.set(
      url,
      (async () => {
        try {
          const resposta = await fetch(url, { signal: AbortSignal.timeout(TEMPO_LIMITE_MS) })
          return resposta.ok ? ((await resposta.json()) as T) : undefined
        } catch {
          return undefined
        }
      })().then((valor) => {
        if (valor === undefined) consultas.delete(url)
        return valor
      }),
    )
  }
  return consultas.get(url) as Promise<T | undefined>
}

const chave = (texto: string) =>
  texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")

let indice: Promise<Map<string, Municipio[]> | undefined> | undefined

/**
 * Municípios pelo nome sem acento nem espaço. A lista (~5.570 cidades) vem do
 * IBGE na primeira vez e fica guardada em `modelos/municipios.json`.
 */
function municipiosPorNome(): Promise<Map<string, Municipio[]> | undefined> {
  indice ??= (async () => {
    let lista: Municipio[] | undefined
    try {
      lista = JSON.parse(await readFile(ARQUIVO_MUNICIPIOS, "utf8")) as Municipio[]
    } catch {
      const bruto = await buscar<{ "municipio-id": number; "municipio-nome": string; "UF-sigla": string }[]>(URL_MUNICIPIOS)
      lista = bruto?.map((m) => ({ id: String(m["municipio-id"]), nome: m["municipio-nome"], uf: m["UF-sigla"] }))
      if (lista) {
        await mkdir(path.dirname(ARQUIVO_MUNICIPIOS), { recursive: true }).catch(() => {})
        await writeFile(ARQUIVO_MUNICIPIOS, JSON.stringify(lista)).catch(() => {})
      }
    }
    if (!lista) {
      indice = undefined // tenta de novo na próxima
      return undefined
    }
    const mapa = new Map<string, Municipio[]>()
    for (const m of lista) mapa.set(chave(m.nome), [...(mapa.get(chave(m.nome)) ?? []), m])
    return mapa
  })()
  return indice
}

const ESTADOS: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso do sul": "MS", "mato grosso": "MT",
  "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR",
  "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
}

/** Estados escritos por extenso ("Estado de São Paulo"), para desempatar nome de cidade repetido. */
function estadosPorExtenso(texto: string): Set<string> {
  const base = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  const achados = new Set<string>()
  for (const m of base.matchAll(/\bestado d[aeo] ([a-z ]{4,25})/g)) {
    const nome = Object.keys(ESTADOS)
      .sort((a, b) => b.length - a.length)
      .find((e) => m[1]!.startsWith(e))
    if (nome) achados.add(ESTADOS[nome]!)
  }
  return achados
}

/**
 * O nome mais longo primeiro ("sao jose dos campos" antes de "sao jose"). Nome
 * que existe em várias UFs desempata pela UF escrita junto ("Praia Grande-SP")
 * ou pelo estado por extenso; sem isso, não escolhe.
 */
function casarMunicipio(texto: string, palavras: string[], mapa: Map<string, Municipio[]>): Municipio | undefined {
  for (let tamanho = palavras.length; tamanho >= 1; tamanho--) {
    const candidatos = mapa.get(palavras.slice(0, tamanho).join(""))
    if (!candidatos) continue
    if (candidatos.length === 1) return candidatos[0]
    const [uf] = ufsLogoDepoisDoNome(texto, palavras.slice(0, tamanho))
    const pelaUf = candidatos.filter((c) => c.uf === uf)
    if (pelaUf.length === 1) return pelaUf[0]
    const estados = estadosPorExtenso(texto)
    const peloEstado = candidatos.filter((c) => estados.has(c.uf))
    return peloEstado.length === 1 ? peloEstado[0] : undefined
  }
  return undefined
}

/**
 * Cidade do imóvel na matrícula. A descrição manda ("situado… no município de
 * Y"): a certidão pode vir do cartório de outra comarca. Sem ela, a cidade
 * mais citada no cartório ("Registro de Imóveis da Comarca de Z").
 */
export async function cidadeDaMatricula(texto: string, mencoes: MencaoCidadeImovel[]): Promise<Municipio | undefined> {
  if (mencoes.length === 0) return undefined
  const mapa = await municipiosPorNome()
  if (!mapa) return undefined
  const gruposResolvidos = new Set<number>()
  const contagem = new Map<string, { cidade: Municipio; vezes: number }>()
  for (const mencao of mencoes) {
    if (gruposResolvidos.has(mencao.grupo)) continue
    const cidade = casarMunicipio(texto, mencao.palavras, mapa)
    if (!cidade) continue
    gruposResolvidos.add(mencao.grupo)
    if (mencao.origem === "descricao") return cidade
    contagem.set(cidade.id, { cidade, vezes: (contagem.get(cidade.id)?.vezes ?? 0) + 1 })
  }
  return [...contagem.values()].sort((a, b) => b.vezes - a.vezes)[0]?.cidade
}

export interface EnderecoDoCep {
  logradouro?: string
  bairro?: string
  cidade?: string
  uf?: string
}

/** Rua, bairro e cidade do CEP (BrasilAPI). */
export async function enderecoPorCep(cep: string): Promise<EnderecoDoCep | undefined> {
  const dados = await buscar<{ street?: string; neighborhood?: string; city?: string; state?: string }>(
    `https://brasilapi.com.br/api/cep/v2/${cep.replace(/\D/g, "")}`,
  )
  return dados && { logradouro: dados.street || undefined, bairro: dados.neighborhood || undefined, cidade: dados.city, uf: dados.state }
}

/**
 * Completa os dados com as consultas públicas: cidade da matrícula pelo IBGE
 * e endereço do CEP principal. Devolve uma cópia; sem rede, devolve igual.
 */
export async function completarComConsultas(tipo: TipoDocumento, texto: string, dados: DadosDocumento): Promise<DadosDocumento> {
  const campos = [...dados.campos]
  if (tipo === "matricula_imovel" && dados.mencoesCidade?.length) {
    const cidade = await cidadeDaMatricula(texto, dados.mencoesCidade)
    if (cidade) {
      const i = campos.findIndex((c) => c.rotulo === "Cidade (pelo texto)")
      const campo = { rotulo: "Cidade do imóvel", valor: `${cidade.nome}/${cidade.uf} (IBGE ${cidade.id})`, conferido: true }
      if (i >= 0) campos.splice(i, 1, campo)
      else campos.push(campo)
    }
  }
  if (dados.cepPrincipal) {
    const endereco = await enderecoPorCep(dados.cepPrincipal)
    if (endereco?.cidade) {
      const valor = [endereco.logradouro, endereco.bairro, `${endereco.cidade}/${endereco.uf}`].filter(Boolean).join(", ")
      campos.push({ rotulo: `Endereço do CEP ${cepBr(dados.cepPrincipal)}`, valor, conferido: true })
    }
  }
  return { ...dados, campos }
}
