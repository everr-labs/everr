import { dirname } from "node:path";
import { SourceMapper } from "@datadog/pprof";

/**
 * Source maps from the given directories, or from the entry script's: bundled
 * or compiled servers keep their maps next to it, pointing back at the
 * TypeScript sources. Without maps, frames stay as they ran.
 */
export async function loadSourceMaps(
  dirs: string[] | undefined,
): Promise<SourceMapper | undefined> {
  const entry = process.argv[1];
  const searchDirs = dirs ?? (entry ? [dirname(entry)] : []);
  if (searchDirs.length === 0) return undefined;
  const mapper = await SourceMapper.create(searchDirs).catch(() => undefined);
  if (!mapper) return undefined;

  // pprof turns an ES module's `file://` URL into a path by cutting the scheme
  // off without decoding it, while its maps are keyed by the path on disk. A
  // file whose name is escaped in its URL, such as a bundler's `+[...].mjs`
  // chunk, would never find its map. A CommonJS path is no URL and may hold a
  // literal `%`, so the path is tried as given first, decoded only as a fallback.
  const mappingInfo = mapper.mappingInfo.bind(mapper);
  mapper.mappingInfo = (location) => {
    if (mapper.hasMappingInfo(location.file)) return mappingInfo(location);
    const decoded = decodePath(location.file);
    return decoded !== undefined && mapper.hasMappingInfo(decoded)
      ? mappingInfo({ ...location, file: decoded })
      : mappingInfo(location);
  };
  return mapper;
}

function decodePath(file: string): string | undefined {
  if (!file.includes("%")) return undefined;
  try {
    return decodeURIComponent(file);
  } catch {
    return undefined;
  }
}
