-- 由 docker-compose 首次初始化数据库时执行（POSTGRES_USER = hdip_owner）。
-- hdip_owner：表属主，跑迁移。
-- hdip_app：应用运行账号。它的表权限（SELECT / INSERT / UPDATE，没有 DELETE）
--           在迁移 0002 里用 ALTER DEFAULT PRIVILEGES 授予，从权限上保证业务表无物理删除。

CREATE ROLE hdip_app LOGIN PASSWORD 'hdip_app';
