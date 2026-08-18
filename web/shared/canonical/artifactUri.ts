/**
 * `artifact://` URI 语法与本地路径 resolver（P1-03，ADR-004 §4）。
 * 与 Python 侧 integrations/ai_teaching_contracts/artifact_uri.py 同一语法。
 */
import * as path from "path";

const URI_RE =
  /^artifact:\/\/([a-z][a-z0-9-]*)\/([A-Za-z0-9._~!$&'()*+,;=:%-]+)(?:@v([0-9]+))?((?:\/[A-Za-z0-9._~!$&'()*+,;=:%-]+)*)$/;

/** id-registry.yaml 登记的 namespace；新增必须先改 registry。 */
export const KNOWN_ARTIFACT_NAMESPACES: ReadonlySet<string> = new Set([
  "question-truth",
  "question-candidate",
  "source-evidence",
  "teaching-approach",
  "tutor-plan",
  "page-image",
  "audio",
  "transcript",
  "sut-config",
  "benchmark-output",
]);

export class ArtifactUriError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactUriError";
  }
}

export interface ArtifactUri {
  readonly raw: string;
  readonly namespace: string;
  readonly artifactId: string;
  /** "v1" 形式；null = 未版本化引用 */
  readonly version: string | null;
  readonly path: readonly string[];
}

export function parseArtifactUri(value: string): ArtifactUri {
  const match = typeof value === "string" ? value.match(URI_RE) : null;
  if (!match) {
    throw new ArtifactUriError(`invalid artifact URI: ${String(value)}`);
  }
  const [, namespace, artifactId, versionDigits, pathSuffix] = match;
  if (!KNOWN_ARTIFACT_NAMESPACES.has(namespace)) {
    throw new ArtifactUriError(
      `unregistered artifact namespace: ${namespace} (see contracts/mappings/id-registry.yaml)`,
    );
  }
  const segments = pathSuffix.split("/").filter((segment) => segment.length > 0);
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new ArtifactUriError(`path traversal not allowed in artifact URI: ${value}`);
    }
  }
  return {
    raw: value,
    namespace,
    artifactId,
    version: versionDigits ? `v${versionDigits}` : null,
    path: segments,
  };
}

/**
 * 把 artifact URI 映射到本仓本地路径。
 * 布局：<root>/<artifact-id>/<version>/<path…>；versionless 引用直接 <root>/<artifact-id>/<path…>。
 * 越界（解析结果逃出 namespace root）一律 fail closed。
 */
export class LocalArtifactResolver {
  private readonly roots: ReadonlyMap<string, string>;

  constructor(roots: Record<string, string>) {
    for (const namespace of Object.keys(roots)) {
      if (!KNOWN_ARTIFACT_NAMESPACES.has(namespace)) {
        throw new ArtifactUriError(`unregistered namespaces in roots: ${namespace}`);
      }
    }
    this.roots = new Map(Object.entries(roots));
  }

  resolve(uri: string | ArtifactUri): string {
    const parsed = typeof uri === "string" ? parseArtifactUri(uri) : uri;
    const root = this.roots.get(parsed.namespace);
    if (root === undefined) {
      throw new ArtifactUriError(`no local root configured for namespace ${parsed.namespace}`);
    }
    const segments = [
      parsed.artifactId,
      ...(parsed.version ? [parsed.version] : []),
      ...parsed.path,
    ];
    const target = path.resolve(root, ...segments);
    const rootAbsolute = path.resolve(root);
    if (target !== rootAbsolute && !target.startsWith(rootAbsolute + path.sep)) {
      throw new ArtifactUriError(`resolved path escapes namespace root: ${parsed.raw}`);
    }
    return target;
  }
}

export function resolverFromEnv(
  env: Record<string, string | undefined> = process.env,
): LocalArtifactResolver {
  const raw = (env.AI_TEACHING_ARTIFACT_ROOTS ?? "").trim();
  const roots: Record<string, string> = {};
  for (const chunk of raw.split(";").map((entry) => entry.trim()).filter(Boolean)) {
    const eq = chunk.indexOf("=");
    if (eq <= 0) {
      throw new ArtifactUriError(`bad AI_TEACHING_ARTIFACT_ROOTS entry: ${chunk}`);
    }
    roots[chunk.slice(0, eq)] = chunk.slice(eq + 1);
  }
  return new LocalArtifactResolver(roots);
}
