/**
 * 结构化模型进程内缓存 decorator（失败分析报告 §四.3：对齐调用复用）。
 *
 * temperature 0 + json_object 下，同 promptVersion + userPayload 的调用
 * 结果确定（provider 侧仍有非严格确定噪声，取首次结果即为一贯口径）。
 * 验收剧本对同一 struggle/expected 文本反复驱动（S4/S11 各至多 8 轮同文
 * 输入，对齐载荷不含 recent_events，完全同键）——缓存直接消掉这些重复
 * 网络调用，压低 timeout/budget 降级噪音与整跑时长。
 *
 * 只缓存成功结果（错误照抛，不缓存失败）；FIFO 淘汰（Map 插入序），
 * 默认 256 条（约 6 plan × 12 剧本的全部稳定对齐输入）。
 */
import type {
  StructuredCompletionRequest,
  StructuredCompletionResult,
  StructuredModelPort,
} from "../structuredModelPort";

export const STRUCTURED_MODEL_CACHE_MAX_ENTRIES = 256;

function cacheKey(request: StructuredCompletionRequest): string {
  return `${request.promptVersion}\u0000${JSON.stringify(request.userPayload)}`;
}

export function createCachedStructuredModel(
  model: StructuredModelPort,
  maxEntries: number = STRUCTURED_MODEL_CACHE_MAX_ENTRIES,
): StructuredModelPort {
  const cache = new Map<string, StructuredCompletionResult<unknown>>();
  return {
    provider: model.provider,
    modelId: model.modelId,
    async complete<T>(request: StructuredCompletionRequest): Promise<StructuredCompletionResult<T>> {
      const key = cacheKey(request);
      const hit = cache.get(key);
      if (hit) return hit as StructuredCompletionResult<T>;
      const result = await model.complete<T>(request);
      cache.set(key, result as StructuredCompletionResult<unknown>);
      while (cache.size > maxEntries) {
        // FIFO 淘汰：Map 保持插入序，首个键即最旧条目。
        const oldest = cache.keys().next().value as string;
        cache.delete(oldest);
      }
      return result;
    },
  };
}
