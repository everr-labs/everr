-- The installation's one restricted SQL API identity. The deployment creates
-- the sql_api user with its password; this gives it the SQL API role and
-- limits.
GRANT sql_api_role TO sql_api;

ALTER USER sql_api DEFAULT ROLE sql_api_role SETTINGS PROFILE 'sql_api_profile';
