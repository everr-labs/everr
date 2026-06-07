import { SQLDialect, sql } from "@codemirror/lang-sql";
import { CodeEditor } from "./code-editor";

const clickhouseDialect = SQLDialect.define({
  keywords:
    "select from where group by order limit offset having join left right inner outer cross full on using as with insert into values create table drop alter add column delete update set if exists not and or in between like ilike is null true false case when then else end distinct all any union except intersect format attach database detach dict engine enum event final first flatten grant materialized modify move optimize partition prewhere primary rename replace revoke row sample settings show system temporary to top truncate use watch",
  types:
    "UInt8 UInt16 UInt32 UInt64 UInt128 UInt256 Int8 Int16 Int32 Int64 Int128 Int256 Float32 Float64 Decimal String FixedString UUID Date Date32 DateTime DateTime64 Enum8 Enum16 Array Tuple Map Nullable LowCardinality Bool IPv4 IPv6 SimpleAggregateFunction AggregateFunction Nested",
  builtin:
    "count sum avg min max any anyLast argMin argMax groupArray groupUniqArray countDistinct uniq uniqExact uniqCombined uniqHLL12 quantile quantiles median quantileDeterministic quantileTiming quantileExact quantileTDigest topK covarSamp covarPop corr toUInt8 toUInt16 toUInt32 toUInt64 toInt8 toInt16 toInt32 toInt64 toFloat32 toFloat64 toDate toDateTime toString toFixedString toStringCutToZero reinterpretAsUInt8 reinterpretAsUInt16 reinterpretAsUInt32 reinterpretAsUInt64 reinterpretAsInt8 reinterpretAsInt16 reinterpretAsInt32 reinterpretAsInt64 reinterpretAsFloat32 reinterpretAsFloat64 reinterpretAsDate reinterpretAsDateTime toTypeName toColumnTypeName length empty notEmpty reverse concat substring substringUTF8 appendTrailingCharIfAbsent convertCharset base64Encode base64Decode lower upper lowerUTF8 upperUTF8 trimLeft trimRight trimBoth startsWith endsWith match extract extractAll like notLike multiMatchAny multiMatchAnyIndex multiSearchFirstPosition multiSearchFirstIndex multiSearchAny replaceOne replaceAll replaceRegexpOne replaceRegexpAll position positionUTF8 positionCaseInsensitive positionCaseInsensitiveUTF8 now today yesterday toYear toMonth toDayOfMonth toDayOfWeek toHour toMinute toSecond toStartOfDay toStartOfMonth toStartOfQuarter toStartOfYear toStartOfMinute toStartOfFiveMinutes toStartOfTenMinutes toStartOfFifteenMinutes toStartOfHour toTime dateDiff formatDateTime parseDateTimeBestEffort if multiIf ifNull nullIf coalesce assumeNotNull toNullable isNull isNotNull plus minus multiply divide modulo intDiv intDivOrZero negate abs gcd lcm greatest least round roundToExp2 roundDuration roundAge ceil floor trunc exp log log2 log10 sqrt cbrt pow arrayJoin arrayConcat arrayElement has hasAll hasAny indexOf countEqual arrayEnumerate arrayEnumerateUniq arrayPopBack arrayPopFront arrayPushBack arrayPushFront arrayResize arraySlice arraySort arrayReverseSort arrayUniq arrayDistinct arrayMap arrayFilter arrayFill arrayReverseFill arraySplit arrayFirst arrayFirstIndex arrayReduce dictGet dictGetOrDefault dictHas domainWithoutWWW topLevelDomain path protocol queryString fragment",
  operatorChars: "+-*/<>=!~&|^",
  identifierQuotes: '`"',
  specialVar: "@",
});

interface SqlEditorProps {
  /** Initial document. The editor mounts once; parents remount via `key` to reset. */
  defaultValue: string;
  onChange: (sql: string) => void;
  placeholder?: string;
  /** Sizing is left to the parent (e.g. `min-h-0 flex-1` or a fixed height). */
  className?: string;
}

export function SqlEditor({
  defaultValue,
  onChange,
  placeholder = "SELECT * FROM ...",
  className,
}: SqlEditorProps) {
  return (
    <CodeEditor
      language={sql({ dialect: clickhouseDialect })}
      defaultValue={defaultValue}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  );
}
