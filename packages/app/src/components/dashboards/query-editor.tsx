import { SQLDialect, sql } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { Button } from "@everr/ui/components/button";
import { Label } from "@everr/ui/components/label";
import { basicSetup } from "codemirror";
import { Play } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Panel, PanelQuery } from "@/data/dashboards/schema";

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

interface QueryEditorProps {
  draft: Panel;
  onChange: (panel: Panel) => void;
  onRunQuery: (sql: string) => void;
  isRunning?: boolean;
}

function getQueryText(draft: Panel): string {
  const firstQuery = draft.spec.queries?.[0];
  if (!firstQuery) return "";
  const querySpec = firstQuery.spec.plugin.spec;
  return typeof querySpec.query === "string" ? querySpec.query : "";
}

function setQueryText(draft: Panel, query: string): Panel {
  const newQuery: PanelQuery = {
    kind: "ClickHouseSQL",
    spec: {
      plugin: {
        kind: "ClickHouseSQL",
        spec: { query },
      },
    },
  };

  return {
    ...draft,
    spec: {
      ...draft.spec,
      queries: [newQuery, ...(draft.spec.queries?.slice(1) ?? [])],
    },
  };
}

export function QueryEditor({
  draft,
  onChange,
  onRunQuery,
  isRunning,
}: QueryEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const draftRef = useRef(draft);
  onChangeRef.current = onChange;
  draftRef.current = draft;

  const handleChange = useRef(
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const text = update.state.doc.toString();
        onChangeRef.current(setQueryText(draftRef.current, text));
      }
    }),
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: getQueryText(draft),
      extensions: [
        basicSetup,
        sql({ dialect: clickhouseDialect }),
        oneDark,
        handleChange.current,
        placeholder("SELECT * FROM ..."),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { fontFamily: "var(--font-mono, monospace)" },
        }),
        keymap.of([]),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create editor once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>ClickHouse SQL</Label>
        <Button
          variant="outline"
          size="sm"
          disabled={isRunning || !getQueryText(draft).trim()}
          onClick={() => onRunQuery(getQueryText(draft))}
        >
          <Play data-icon="inline-start" />
          {isRunning ? "Running…" : "Run Query"}
        </Button>
      </div>
      <div
        ref={containerRef}
        className="border-border min-h-0 flex-1 overflow-hidden rounded-md border"
      />
    </div>
  );
}
