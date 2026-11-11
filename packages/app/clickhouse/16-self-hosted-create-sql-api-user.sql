-- One restricted SQL API identity for the whole installation. DEFAULT ROLE
-- also grants sql_api_role; GRANT does not accept a parameterized user name.
CREATE USER IF NOT EXISTS {sql_api_username:Identifier}
  IDENTIFIED WITH sha256_password BY {sql_api_password:String}
  SETTINGS PROFILE 'sql_api_profile'
  DEFAULT ROLE sql_api_role;
