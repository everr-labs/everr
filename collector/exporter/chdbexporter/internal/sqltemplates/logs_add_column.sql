ALTER TABLE {{ident .Database}}.{{ident .TableName}} {{.ClusterString}} ADD COLUMN IF NOT EXISTS {{ident .ColumnName}} {{.ColumnDefinition}}
