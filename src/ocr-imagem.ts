import { fileURLToPath } from "node:url"
import { createScheduler, createWorker, PSM, type Scheduler } from "tesseract.js"

export interface ResultadoOcrImagem {
  texto: string
  confianca: number
}

// tesseract.js procura o cache de idioma em `${cachePath}/por.traineddata`, com
// cachePath default "." — ou seja, relativo ao cwd de quem CONSOME esta lib, não
// desta pasta. Quando outro projeto (ex: DocuWise) importa este pacote, o cwd é o
// dele, o cache local daqui (ja baixado, ver README/gitignore) fica invisivel, e
// cada leitura de imagem baixa ~2.4MB da CDN de novo — e' isso que tornava a OCR
// de foto lenta o bastante pra estourar timeout do lado de quem consome.
const DIRETORIO_PACOTE = fileURLToPath(new URL("..", import.meta.url))

export async function criarWorker() {
  const worker = await createWorker("por", 1, { cachePath: DIRETORIO_PACOTE })
  // Setar o modo de segmentacao explicitamente (mesmo o padrao, AUTO) faz o Tesseract
  // estimar a resolucao da imagem antes de segmentar - sem isso, fotos de celular em
  // alta resolucao (documento fisico, fundo com textura de seguranca) saem como lixo
  // (confianca ~36% em teste real). AUTO_OSD foi tentado primeiro mas depende de baixar
  // o pacote de idioma "osd" (deteccao de orientacao), que e incompativel com o motor
  // LSTM padrao e pode falhar o carregamento inteiro do worker - evitado por isso.
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
  return worker
}

/**
 * OCR de várias imagens de um mesmo documento. Reaproveita o worker do
 * Tesseract entre as imagens — criar um custa ~1 s (carrega o modelo de
 * idioma) — e, com `garantirWorkers(n)`, reconhece até n imagens em paralelo.
 * Nenhum worker nasce antes do primeiro uso: PDF com texto próprio não paga
 * por eles. Quem cria chama `encerrar()` no fim.
 */
export class LeitorOcr {
  private scheduler: Scheduler | undefined
  private workers = 0

  async reconhecer(bytes: Buffer): Promise<ResultadoOcrImagem> {
    await this.garantirWorkers(1)
    const { data } = await this.scheduler!.addJob("recognize", bytes)
    return { texto: data.text, confianca: data.confidence / 100 }
  }

  /** Sobe o total de workers até `total` (nunca desce). */
  async garantirWorkers(total: number): Promise<void> {
    const scheduler = (this.scheduler ??= createScheduler())
    const novos: Promise<void>[] = []
    // O contador sobe antes de qualquer await: duas chamadas simultâneas não criam worker a mais.
    for (; this.workers < total; this.workers++) {
      novos.push(criarWorker().then((worker) => void scheduler.addWorker(worker)))
    }
    await Promise.all(novos)
  }

  async encerrar(): Promise<void> {
    const scheduler = this.scheduler
    this.scheduler = undefined
    this.workers = 0
    if (scheduler) await scheduler.terminate()
  }
}

export async function ocrImagem(bytes: Buffer): Promise<ResultadoOcrImagem> {
  const leitor = new LeitorOcr()
  try {
    return await leitor.reconhecer(bytes)
  } finally {
    await leitor.encerrar()
  }
}
