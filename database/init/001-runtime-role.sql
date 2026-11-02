SELECT format('CREATE ROLE hms_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app')
\gexec
SELECT format('ALTER ROLE hms_app WITH LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', :'app_password')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO hms_app', current_database())
\gexec
SELECT 'GRANT USAGE ON SCHEMA public TO hms_app'
\gexec