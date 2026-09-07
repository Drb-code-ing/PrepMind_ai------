import { Injectable } from '@nestjs/common';
import type { KnowledgeVerifierChunk } from '@repo/agent/knowledge-verifier';
import { knowledgeSearchRequestSchema } from '@repo/types/api/knowledge';

import { KnowledgeSearchService } from '../knowledge-documents/knowledge-search.service';

export type ChatRetrieverStageInput = Readonly<{
  ownerId: string;
  query: string;
  signal?: AbortSignal;
}>;

export type ChatRetrieverStageResult = Readonly<{
  chunks: readonly KnowledgeVerifierChunk[];
  degraded: boolean;
}>;

/** Owner-bound projection from the Server search service to the Verifier contract. */
@Injectable()
export class ChatRetrieverStageService {
  constructor(private readonly search: KnowledgeSearchService) {}

  async run(input: ChatRetrieverStageInput): Promise<ChatRetrieverStageResult> {
    if (input.signal?.aborted) return { chunks: [], degraded: true };
    const request = knowledgeSearchRequestSchema.parse({
      query: input.query,
      topK: 4,
      minScore: 0.7,
    });
    try {
      const response = await this.search.search(input.ownerId, request);
      if (input.signal?.aborted) return { chunks: [], degraded: true };
      return {
        chunks: response.hits.map((hit) => ({
          documentId: hit.documentId,
          documentTitle: hit.documentName,
          chunkId: hit.chunkId,
          content: hit.content,
          score: hit.score,
          ...(hit.metadata.safety
            ? {
                metadata: {
                  safety: hit.metadata.safety,
                },
              }
            : {}),
        })),
        degraded: false,
      };
    } catch {
      return { chunks: [], degraded: true };
    }
  }
}
