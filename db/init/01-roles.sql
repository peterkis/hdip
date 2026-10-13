-- 由 docker-compose 首次初始化数据库时执行（POSTGRES_USER = hdip_owner）。
-- hdip_owner：表属主，跑迁移。
-- hdip_app：应用运行账号，只有 SELECT / INSERT / UPDATE，没有 DELETE，
--           从权限上保证业务表无物理删除（设计文档第 11 节）。

CREATE ROLE hdip_app LOGIN PASSWORD 'hdip_app';

GRANT CONNECT ON DATABASE hdip TO hdip_app;
GRANT USAGE ON SCHEMA public TO hdip_app;

ALTER DEFAULT PRIVILEGES FOR ROLE hdip_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE ON TABLES TO hdip_app;
ALTER DEFAULT PRIVILEGES FOR ROLE hdip_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO hdip_app;
