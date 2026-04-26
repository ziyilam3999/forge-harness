import { ingestFile, Chunk as IngestChunk } from "../ingestion/ingest";
import { VectorIndex, SearchResult } from "../index/vectorIndex";
import { generateAnswer, Chunk as LlmChunk, Citation } from "../llm/generate";

const DEFAULT_TOP_K = 5;
const NO_DOCUMENTS_ANSWER =
  "I couldn't find any relevant information in the indexed documents to answer this question.";

export interface QueryResult {
  answer: string;
  citations: Citation[];
}

export interface ServiceStatus {
  documentCount: number;
  watcherAlive: boolean;
  uptimeSeconds: number;
}

export interface AnswerGenerator {
  (question: string, chunks: LlmChunk[]): Promise<{ answer: string; citations: Citation[] }>;
}

export interface FileIngestor {
  (absolutePath: string): Promise<IngestChunk[]>;
}

export interface KnowledgeServiceOptions {
  index?: VectorIndex;
  ingest?: FileIngestor;
  generator?: AnswerGenerator;
  topK?: number;
  now?: () => number;
}

function toLlmChunk(result: SearchResult): LlmChunk {
  const out: LlmChunk = {
    id: result.id,
    text: result.text,
    source: result.source,
    score: result.score,
  };
  if (result.heading !== undefined) out.heading = result.heading;
  if (result.section !== undefined) out.section = result.section;
  return out;
}

export class KnowledgeService {
  private readonly index: VectorIndex;
  private readonly ingest: FileIngestor;
  private readonly generator: AnswerGenerator;
  private readonly topK: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private readonly indexedSources = new Set<string>();

  constructor(opts: KnowledgeServiceOptions = {}) {
    this.index = opts.index ?? new VectorIndex();
    this.ingest = opts.ingest ?? ingestFile;
    this.generator = opts.generator ?? generateAnswer;
    this.topK = opts.topK ?? DEFAULT_TOP_K;
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
  }

  async query(question: string): Promise<QueryResult> {
    if (typeof question !== "string") {
      throw new TypeError("KnowledgeService.query: question must be a string");
    }
    if (this.index.size() === 0) {
      return { answer: NO_DOCUMENTS_ANSWER, citations: [] };
    }
    const hits = await this.index.search(question, this.topK);
    const chunks = hits.map(toLlmChunk);
    return this.generator(question, chunks);
  }

  async indexFile(absolutePath: string): Promise<void> {
    if (typeof absolutePath !== "string" || absolutePath.length === 0) {
      throw new TypeError("KnowledgeService.indexFile: absolutePath must be a non-empty string");
    }
    const chunks = await this.ingest(absolutePath);
    if (chunks.length === 0) return;
    await this.index.add(chunks);
    for (const c of chunks) this.indexedSources.add(c.source);
  }

  getStatus(): ServiceStatus {
    return {
      documentCount: this.indexedSources.size,
      watcherAlive: false,
      uptimeSeconds: Math.max(0, Math.floor((this.now() - this.startedAt) / 1000)),
    };
  }
}
