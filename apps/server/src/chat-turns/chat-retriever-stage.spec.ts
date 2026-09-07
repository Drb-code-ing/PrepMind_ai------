import { ChatRetrieverStageService } from './chat-retriever-stage';

describe('ChatRetrieverStageService', () => {
  it('binds search to the owner and projects bounded verifier chunks', async () => {
    const search = {
      search: jest.fn().mockResolvedValue({
        hits: [
          {
            documentId: 'doc-1',
            documentName: '线代',
            chunkId: 'chunk-1',
            content: '矩阵的秩等于最大线性无关组所含向量个数。',
            score: 0.91,
            metadata: { safety: { riskLevel: 'low' } },
          },
        ],
      }),
    };
    const service = new ChatRetrieverStageService(search as never);

    const result = await service.run({ ownerId: 'owner-1', query: '矩阵的秩是什么？' });

    expect(search.search).toHaveBeenCalledWith('owner-1', {
      query: '矩阵的秩是什么？',
      topK: 4,
      minScore: 0.7,
    });
    expect(result).toEqual({
      degraded: false,
      chunks: [
        {
          documentId: 'doc-1',
          documentTitle: '线代',
          chunkId: 'chunk-1',
          content: '矩阵的秩等于最大线性无关组所含向量个数。',
          score: 0.91,
          metadata: { safety: { riskLevel: 'low' } },
        },
      ],
    });
  });

  it('fails closed on search errors or cancellation', async () => {
    const search = { search: jest.fn().mockRejectedValue(new Error('unavailable')) };
    const service = new ChatRetrieverStageService(search as never);
    await expect(service.run({ ownerId: 'owner-1', query: '资料' })).resolves.toEqual({
      chunks: [],
      degraded: true,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      service.run({ ownerId: 'owner-1', query: '资料', signal: controller.signal }),
    ).resolves.toEqual({ chunks: [], degraded: true });
    expect(search.search).toHaveBeenCalledTimes(1);
  });
});
