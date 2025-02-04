SELECT round(successful/(successful+others)*100, 2) as success_rate FROM (
    SELECT
        repo,
        count(*) as successful
    FROM pipelines_mv
    WHERE
        repo = 'citric-app/citric' AND
        timestamp BETWEEN parseDateTimeBestEffort('2024-11-01') AND parseDateTimeBestEffort('2024-12-02') AND
        status = 'success'
    GROUP BY repo
) A LEFT JOIN (
    SELECT
        repo,
        count(*) as others
    FROM pipelines_mv
    WHERE
        repo = 'citric-app/citric' AND
        timestamp BETWEEN parseDateTimeBestEffort('2024-11-01') AND parseDateTimeBestEffort('2024-12-02') AND
        status != 'success'
    GROUP BY repo
) B ON A.repo = B.




SELECT
    COUNT(*)::Int16 as value,
    toStartOfInterval(Timestamp , INTERVAL 1 SECOND) AS time
  FROM
    otel_logs
  WHERE
    TraceId = '8d760822ea960d391dd31a38915861d3'
    AND SpanId = '29b396e4e4994d13'
  GROUP BY time
  ORDER BY time
  WITH FILL STEP toIntervalSecond(1);