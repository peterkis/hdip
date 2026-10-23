# 数据库表结构参考

> 由 `api/scripts/export_schema_doc.py` 从数据库生成，迁移版本 **0019**。
> 不要手改；改迁移后执行 `make db-doc`。设计说明见 [README.md](README.md)。

## 目录

- **配置与用户**：[`app_user`](#app_user)、[`option_item`](#option_item)、[`approval_rule`](#approval_rule)
- **变更申请**：[`change_request`](#change_request)
- **主体与院区**：[`institution`](#institution)、[`institution_version`](#institution_version)、[`campus`](#campus)、[`campus_version`](#campus_version)、[`operator_relation`](#operator_relation)
- **部门与服务单元**：[`department`](#department)、[`department_version`](#department_version)、[`department_alias`](#department_alias)、[`department_classification`](#department_classification)、[`department_institution`](#department_institution)、[`classification_scheme`](#classification_scheme)、[`classification_code`](#classification_code)、[`org_view`](#org_view)、[`department_hierarchy`](#department_hierarchy)、[`department_relation`](#department_relation)、[`service_unit`](#service_unit)、[`service_unit_version`](#service_unit_version)、[`service_unit_lineage`](#service_unit_lineage)、[`service_unit_classification`](#service_unit_classification)
- **外部标识（编码映射台账）**：[`source_system`](#source_system)、[`code_namespace`](#code_namespace)、[`external_code`](#external_code)、[`external_code_assignment`](#external_code_assignment)
- **其他（未登记说明）**：[`code_reservation`](#code_reservation)、[`department_change_event`](#department_change_event)、[`department_change_participant`](#department_change_participant)、[`person`](#person)、[`person_assignment`](#person_assignment)、[`person_duty`](#person_duty)、[`person_engagement`](#person_engagement)、[`person_version`](#person_version)、[`person_work_no`](#person_work_no)
- [触发器函数](#触发器函数)、[应用账号权限](#应用账号权限)、[配置表种子](#配置表种子)

## 配置与用户

### app_user

开发期用户与角色（认证方案确定后只换来源，保留本表作本地映射）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `username` | text | 是 |  |  |
| `display_name` | text | 是 |  |  |
| `roles` | text[] | 是 | '{}'::text[] |  |
| `is_active` | boolean | 是 | true |  |
| `created_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `app_user_pkey`（主键）：`PRIMARY KEY (id)`
- `app_user_username_uniq`（唯一）：`UNIQUE (username)`
- `app_user_roles_check`（检查）：`CHECK ((roles <@ ARRAY['maintainer'::text, 'confirmer'::text, 'viewer'::text]))`

### option_item

选项（院区节点角色、服务单元类型等）的码值与中文名

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `category` | text | 是 |  |  |
| `code` | text | 是 |  |  |
| `name` | text | 是 |  |  |
| `sort_order` | integer | 是 | 0 |  |
| `is_active` | boolean | 是 | true |  |

约束：

- `option_item_pkey`（主键）：`PRIMARY KEY (id)`
- `option_item_uniq`（唯一）：`UNIQUE (category, code)`

### approval_rule

确认规则：对象类型 × 动作 → 确认角色、是否允许自确认

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `object_type` | text | 是 |  |  |
| `action` | text | 是 |  |  |
| `confirmer_role` | text | 是 | 'confirmer'::text |  |
| `allow_self_confirm` | boolean | 是 | true |  |

约束：

- `approval_rule_pkey`（主键）：`PRIMARY KEY (id)`
- `approval_rule_uniq`（唯一）：`UNIQUE (object_type, action)`
- `approval_rule_role_check`（检查）：`CHECK ((confirmer_role = ANY (ARRAY['maintainer'::text, 'confirmer'::text])))`

## 变更申请

### change_request

唯一写入入口：一张申请含多个变更项，确认时在一个事务里全部应用

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `status` | text | 是 | 'draft'::text |  |
| `note` | text |  |  |  |
| `items` | jsonb | 是 | '[]'::jsonb |  |
| `results` | jsonb |  |  |  |
| `copied_from_id` | bigint |  |  | → `change_request` |
| `created_by` | bigint | 是 |  | → `app_user` |
| `created_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `updated_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `submitted_by` | bigint |  |  | → `app_user` |
| `submitted_at` | timestamp without time zone |  |  |  |
| `confirmed_by` | bigint |  |  | → `app_user` |
| `confirmed_at` | timestamp without time zone |  |  |  |
| `returned_by` | bigint |  |  | → `app_user` |
| `returned_at` | timestamp without time zone |  |  |  |
| `return_reason` | text |  |  |  |
| `cancelled_by` | bigint |  |  | → `app_user` |
| `cancelled_at` | timestamp without time zone |  |  |  |

约束：

- `change_request_pkey`（主键）：`PRIMARY KEY (id)`
- `change_request_confirmed_check`（检查）：`CHECK (((status <> 'confirmed'::text) OR ((confirmed_by IS NOT NULL) AND (results IS NOT NULL))))`
- `change_request_items_check`（检查）：`CHECK ((jsonb_typeof(items) = 'array'::text))`
- `change_request_returned_check`（检查）：`CHECK (((status <> 'returned'::text) OR ((returned_by IS NOT NULL) AND (btrim(return_reason) <> ''::text))))`
- `change_request_status_check`（检查）：`CHECK ((status = ANY (ARRAY['draft'::text, 'submitted'::text, 'confirmed'::text, 'returned'::text, 'cancelled'::text])))`
- `change_request_submitted_check`（检查）：`CHECK (((status <> ALL (ARRAY['submitted'::text, 'confirmed'::text, 'returned'::text])) OR (submitted_by IS NOT NULL)))`

索引：

- `change_request_status_idx`：`CREATE INDEX change_request_status_idx ON public.change_request USING btree (status)`

触发器：

- `change_request_guard`：`CREATE TRIGGER change_request_guard BEFORE UPDATE ON public.change_request FOR EACH ROW EXECUTE FUNCTION hdip_guard_change_request()`

## 主体与院区

### institution

主体身份（id、code 永久）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `created_change_id` | bigint | 是 |  | → `change_request` |
| `created_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `institution_pkey`（主键）：`PRIMARY KEY (id)`
- `institution_code_uniq`（唯一）：`UNIQUE (code)`
- `institution_code_check`（检查）：`CHECK ((code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text))`

触发器：

- `institution_guard`：`CREATE TRIGGER institution_guard BEFORE UPDATE ON public.institution FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### institution_version

主体属性版本

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `institution_id` | bigint | 是 |  | → `institution` |
| `version_no` | integer | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `name` | text | 是 |  |  |
| `nature` | text |  |  |  |
| `unified_credit_code` | text |  |  |  |
| `medical_reg_code` | text |  |  |  |
| `license_no` | text |  |  |  |
| `license_valid_from` | date |  |  |  |
| `license_valid_to` | date |  |  |  |

约束：

- `institution_version_pkey`（主键）：`PRIMARY KEY (id)`
- `institution_version_no_uniq`（唯一）：`UNIQUE (institution_id, version_no)`
- `institution_version_no_overlap`（排他）：`EXCLUDE USING gist (institution_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `institution_version_license_check`（检查）：`CHECK (((license_valid_to IS NULL) OR (license_valid_from IS NULL) OR (license_valid_to >= license_valid_from)))`
- `institution_version_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`
- `institution_version_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`

触发器：

- `institution_version_guard`：`CREATE TRIGGER institution_version_guard BEFORE UPDATE ON public.institution_version FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to')`

### campus

院区身份

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `created_change_id` | bigint | 是 |  | → `change_request` |
| `created_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `campus_pkey`（主键）：`PRIMARY KEY (id)`
- `campus_code_uniq`（唯一）：`UNIQUE (code)`
- `campus_code_check`（检查）：`CHECK ((code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text))`

触发器：

- `campus_guard`：`CREATE TRIGGER campus_guard BEFORE UPDATE ON public.campus FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### campus_version

院区属性版本（含运营状态）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `campus_id` | bigint | 是 |  | → `campus` |
| `version_no` | integer | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `name` | text | 是 |  |  |
| `node_role` | text |  |  |  |
| `address` | text |  |  |  |
| `admin_division_code` | text |  |  |  |
| `phone` | text |  |  |  |
| `actual_open_date` | date |  |  |  |
| `operating_status` | text | 是 |  |  |
| `public_name` | text |  |  |  |
| `pinyin` | text |  |  |  |

约束：

- `campus_version_pkey`（主键）：`PRIMARY KEY (id)`
- `campus_version_no_uniq`（唯一）：`UNIQUE (campus_id, version_no)`
- `campus_version_no_overlap`（排他）：`EXCLUDE USING gist (campus_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `campus_version_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`
- `campus_version_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`
- `campus_version_pinyin_check`（检查）：`CHECK ((pinyin ~ '^[A-Z0-9]{1,64}$'::text))`
- `campus_version_public_name_check`（检查）：`CHECK (((public_name IS NULL) OR (btrim(public_name) <> ''::text)))`
- `campus_version_status_check`（检查）：`CHECK ((operating_status = ANY (ARRAY['PLANNING'::text, 'TRIAL_RUNNING'::text, 'RUNNING'::text, 'SUSPENDED'::text])))`

触发器：

- `campus_version_guard`：`CREATE TRIGGER campus_version_guard BEFORE UPDATE ON public.campus_version FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to')`

### operator_relation

主体—院区关系，每行自带期间，端点不可改

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `institution_id` | bigint | 是 |  | → `institution` |
| `campus_id` | bigint | 是 |  | → `campus` |
| `relation_type` | text | 是 |  |  |
| `is_primary` | boolean | 是 | false |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `created_change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |
| `closed_at` | timestamp without time zone |  |  |  |
| `closed_by` | bigint |  |  | → `app_user` |

约束：

- `operator_relation_pkey`（主键）：`PRIMARY KEY (id)`
- `operator_relation_pair_excl`（排他）：`EXCLUDE USING gist (institution_id WITH =, campus_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&)`
- `operator_relation_primary_excl`（排他）：`EXCLUDE USING gist (campus_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&) WHERE (is_primary)`
- `operator_relation_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `operator_relation_primary_operate_check`（检查）：`CHECK (((NOT is_primary) OR (relation_type = 'OPERATE'::text)))`
- `operator_relation_type_check`（检查）：`CHECK ((relation_type = ANY (ARRAY['OPERATE'::text, 'REGISTER'::text, 'MANAGE'::text, 'CHARGE'::text])))`

索引：

- `operator_relation_institution_idx`：`CREATE INDEX operator_relation_institution_idx ON public.operator_relation USING btree (institution_id)`

触发器：

- `operator_relation_guard`：`CREATE TRIGGER operator_relation_guard BEFORE UPDATE ON public.operator_relation FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id', 'closed_at', 'closed_by')`

## 部门与服务单元

### department

部门身份（id、管理编码）；属性在 department_version

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `created_change_id` | bigint | 是 |  | → `change_request` |
| `created_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `department_pkey`（主键）：`PRIMARY KEY (id)`
- `department_code_uniq`（唯一）：`UNIQUE (code)`
- `department_code_check`（检查）：`CHECK ((code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text))`

触发器：

- `department_guard`：`CREATE TRIGGER department_guard BEFORE UPDATE ON public.department FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### department_version

部门属性版本：名称、生命周期、设立形式、行政级别、承担职责、依据

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `department_id` | bigint | 是 |  | → `department` |
| `version_no` | integer | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `name` | text | 是 |  |  |
| `short_name` | text |  |  |  |
| `description` | text |  |  |  |
| `establishment_form` | text | 是 | 'STANDING'::text |  |
| `temporary_until` | date |  |  |  |
| `lifecycle` | text | 是 |  |  |
| `admin_grade` | text |  |  |  |
| `duties` | text[] | 是 | '{}'::text[] |  |
| `basis_note` | text |  |  |  |
| `pinyin` | text |  |  |  |

约束：

- `department_version_pkey`（主键）：`PRIMARY KEY (id)`
- `department_version_no_uniq`（唯一）：`UNIQUE (department_id, version_no)`
- `department_version_no_overlap`（排他）：`EXCLUDE USING gist (department_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `department_version_form_check`（检查）：`CHECK ((establishment_form = ANY (ARRAY['STANDING'::text, 'TEMPORARY'::text])))`
- `department_version_lifecycle_check`（检查）：`CHECK ((lifecycle = ANY (ARRAY['PREPARING'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'REVOKED'::text, 'SUPERSEDED'::text])))`
- `department_version_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`
- `department_version_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`
- `department_version_pinyin_check`（检查）：`CHECK ((pinyin ~ '^[A-Z0-9]{1,64}$'::text))`
- `department_version_temporary_check`（检查）：`CHECK (((establishment_form = 'TEMPORARY'::text) = (temporary_until IS NOT NULL)))`

触发器：

- `department_version_guard`：`CREATE TRIGGER department_version_guard BEFORE UPDATE ON public.department_version FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to')`

### department_alias

部门别名与检索码

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `department_id` | bigint | 是 |  | → `department` |
| `kind` | text | 是 |  |  |
| `value` | text | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `department_alias_pkey`（主键）：`PRIMARY KEY (id)`
- `department_alias_dup_excl`（排他）：`EXCLUDE USING gist (department_id WITH =, kind WITH =, value WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&)`
- `department_alias_kind_check`（检查）：`CHECK ((kind = ANY (ARRAY['ALIAS'::text, 'SEARCH_CODE'::text])))`
- `department_alias_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `department_alias_value_check`（检查）：`CHECK ((btrim(value) <> ''::text))`

索引：

- `department_alias_value_idx`：`CREATE INDEX department_alias_value_idx ON public.department_alias USING btree (value)`

触发器：

- `department_alias_guard`：`CREATE TRIGGER department_alias_guard BEFORE UPDATE ON public.department_alias FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id')`

### department_classification

部门分类赋值（单选方案同一时点一个）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `department_id` | bigint | 是 |  | → `department` |
| `scheme_id` | bigint | 是 |  |  |
| `is_exclusive` | boolean | 是 |  |  |
| `code` | text | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `department_classification_pkey`（主键）：`PRIMARY KEY (id)`
- `department_classification_dup_excl`（排他）：`EXCLUDE USING gist (department_id WITH =, scheme_id WITH =, code WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&)`
- `department_classification_exclusive_excl`（排他）：`EXCLUDE USING gist (department_id WITH =, scheme_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&) WHERE (is_exclusive)`
- `department_classification_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`

索引：

- `department_classification_dept_idx`：`CREATE INDEX department_classification_dept_idx ON public.department_classification USING btree (department_id)`

触发器：

- `department_classification_guard`：`CREATE TRIGGER department_classification_guard BEFORE UPDATE ON public.department_classification FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id')`

### department_institution

部门主体归属

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `department_id` | bigint | 是 |  | → `department` |
| `institution_id` | bigint | 是 |  | → `institution` |
| `is_primary` | boolean | 是 | true |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `department_institution_pkey`（主键）：`PRIMARY KEY (id)`
- `department_institution_primary_excl`（排他）：`EXCLUDE USING gist (department_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&) WHERE (is_primary)`
- `department_institution_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`

索引：

- `department_institution_dept_idx`：`CREATE INDEX department_institution_dept_idx ON public.department_institution USING btree (department_id)`

触发器：

- `department_institution_guard`：`CREATE TRIGGER department_institution_guard BEFORE UPDATE ON public.department_institution FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id')`

### classification_scheme

分类方案（配置，维护人直接维护）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `name` | text | 是 |  |  |
| `version` | text | 是 |  |  |
| `purpose` | text |  |  |  |
| `is_exclusive` | boolean | 是 |  |  |
| `is_active` | boolean | 是 | true |  |
| `updated_by` | bigint |  |  | → `app_user` |
| `updated_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `meaning_for_department` | text |  |  |  |
| `meaning_for_unit` | text |  |  |  |

约束：

- `classification_scheme_pkey`（主键）：`PRIMARY KEY (id)`
- `classification_scheme_code_uniq`（唯一）：`UNIQUE (code)`
- `classification_scheme_exclusive_uniq`（唯一）：`UNIQUE (id, is_exclusive)`
- `classification_scheme_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`

触发器：

- `classification_scheme_guard`：`CREATE TRIGGER classification_scheme_guard BEFORE UPDATE ON public.classification_scheme FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('name', 'purpose', 'is_active', 'meaning_for_department', 'meaning_for_unit', 'updated_by', 'updated_at')`

### classification_code

分类代码（配置，代码值不可改、只停用）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `scheme_id` | bigint | 是 |  | → `classification_scheme` |
| `code` | text | 是 |  |  |
| `name` | text | 是 |  |  |
| `criterion` | text |  |  |  |
| `caution` | text |  |  |  |
| `sort_order` | integer | 是 | 0 |  |
| `is_active` | boolean | 是 | true |  |
| `updated_by` | bigint |  |  | → `app_user` |
| `updated_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `classification_code_pkey`（主键）：`PRIMARY KEY (id)`
- `classification_code_uniq`（唯一）：`UNIQUE (scheme_id, code)`
- `classification_code_code_check`（检查）：`CHECK ((code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text))`
- `classification_code_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`

触发器：

- `classification_code_guard`：`CREATE TRIGGER classification_code_guard BEFORE UPDATE ON public.classification_code FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('name', 'criterion', 'caution', 'sort_order', 'is_active', 'updated_by', 'updated_at')`

### org_view

组织视图：行政视图启用，运营、病案占位

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `name` | text | 是 |  |  |
| `purpose` | text |  |  |  |
| `single_parent` | boolean | 是 | true |  |
| `status` | text | 是 |  |  |
| `sort_order` | integer | 是 | 0 |  |

约束：

- `org_view_pkey`（主键）：`PRIMARY KEY (id)`
- `org_view_code_uniq`（唯一）：`UNIQUE (code)`
- `org_view_status_check`（检查）：`CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'PLANNED'::text])))`

### department_hierarchy

组织视图内的上下级边：同一视图同一时点一个直接上级，禁止成环

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `view_id` | bigint | 是 |  | → `org_view` |
| `parent_department_id` | bigint | 是 |  | → `department` |
| `child_department_id` | bigint | 是 |  | → `department` |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `department_hierarchy_pkey`（主键）：`PRIMARY KEY (id)`
- `department_hierarchy_single_parent_excl`（排他）：`EXCLUDE USING gist (view_id WITH =, child_department_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&)`
- `department_hierarchy_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `department_hierarchy_self_check`（检查）：`CHECK ((parent_department_id <> child_department_id))`

索引：

- `department_hierarchy_parent_idx`：`CREATE INDEX department_hierarchy_parent_idx ON public.department_hierarchy USING btree (view_id, parent_department_id)`

触发器：

- `department_hierarchy_guard`：`CREATE TRIGGER department_hierarchy_guard BEFORE UPDATE ON public.department_hierarchy FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id')`

### department_relation

部门管理关系：专业管理、协作、院区管理

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `kind` | text | 是 |  |  |
| `from_department_id` | bigint | 是 |  | → `department` |
| `to_department_id` | bigint |  |  | → `department` |
| `campus_id` | bigint |  |  | → `campus` |
| `scope` | text | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `department_relation_pkey`（主键）：`PRIMARY KEY (id)`
- `department_relation_dup_excl`（排他）：`EXCLUDE USING gist (kind WITH =, from_department_id WITH =, COALESCE(to_department_id, (0)::bigint) WITH =, COALESCE(campus_id, (0)::bigint) WITH =, scope WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&)`
- `department_relation_kind_check`（检查）：`CHECK ((kind = ANY (ARRAY['PROFESSIONAL_MGMT'::text, 'COLLABORATION'::text, 'CAMPUS_MGMT'::text])))`
- `department_relation_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `department_relation_scope_check`（检查）：`CHECK ((btrim(scope) <> ''::text))`
- `department_relation_self_check`（检查）：`CHECK (((to_department_id IS NULL) OR (to_department_id <> from_department_id)))`
- `department_relation_target_check`（检查）：`CHECK ((((kind = 'CAMPUS_MGMT'::text) AND (campus_id IS NOT NULL)) OR ((kind <> 'CAMPUS_MGMT'::text) AND (campus_id IS NULL) AND (to_department_id IS NOT NULL))))`

索引：

- `department_relation_from_idx`：`CREATE INDEX department_relation_from_idx ON public.department_relation USING btree (from_department_id)`
- `department_relation_to_idx`：`CREATE INDEX department_relation_to_idx ON public.department_relation USING btree (to_department_id)`

触发器：

- `department_relation_guard`：`CREATE TRIGGER department_relation_guard BEFORE UPDATE ON public.department_relation FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id')`

### service_unit

服务单元身份（单元类型属于身份，不可修订）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `unit_type` | text | 是 |  |  |
| `created_change_id` | bigint | 是 |  | → `change_request` |
| `created_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `service_unit_pkey`（主键）：`PRIMARY KEY (id)`
- `service_unit_code_uniq`（唯一）：`UNIQUE (code)`
- `service_unit_code_check`（检查）：`CHECK ((code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'::text))`
- `service_unit_type_check`（检查）：`CHECK ((unit_type = ANY (ARRAY['OPD'::text, 'IPD'::text, 'ED'::text, 'EXAM'::text, 'LAB'::text, 'PHARMACY'::text, 'OR'::text, 'OTHER'::text])))`

触发器：

- `service_unit_guard`：`CREATE TRIGGER service_unit_guard BEFORE UPDATE ON public.service_unit FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### service_unit_version

服务单元版本：部门 × 院区 × 运营主体 × 期间

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `service_unit_id` | bigint | 是 |  | → `service_unit` |
| `version_no` | integer | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `name` | text | 是 |  |  |
| `department_id` | bigint | 是 |  | → `department` |
| `campus_id` | bigint | 是 |  | → `campus` |
| `institution_id` | bigint | 是 |  | → `institution` |
| `status` | text | 是 | 'ACTIVE'::text |  |
| `phone` | text |  |  |  |
| `scope_note` | text |  |  |  |
| `pinyin` | text |  |  |  |

约束：

- `service_unit_version_pkey`（主键）：`PRIMARY KEY (id)`
- `service_unit_version_no_uniq`（唯一）：`UNIQUE (service_unit_id, version_no)`
- `service_unit_version_no_overlap`（排他）：`EXCLUDE USING gist (service_unit_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `service_unit_version_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`
- `service_unit_version_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`
- `service_unit_version_pinyin_check`（检查）：`CHECK ((pinyin ~ '^[A-Z0-9]{1,64}$'::text))`
- `service_unit_version_status_check`（检查）：`CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])))`

索引：

- `service_unit_version_campus_idx`：`CREATE INDEX service_unit_version_campus_idx ON public.service_unit_version USING btree (campus_id)`
- `service_unit_version_department_idx`：`CREATE INDEX service_unit_version_department_idx ON public.service_unit_version USING btree (department_id)`
- `service_unit_version_institution_idx`：`CREATE INDEX service_unit_version_institution_idx ON public.service_unit_version USING btree (institution_id)`

触发器：

- `service_unit_version_guard`：`CREATE TRIGGER service_unit_version_guard BEFORE UPDATE ON public.service_unit_version FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to')`

### service_unit_lineage

拆分 / 合并的前身 → 后继，只追加

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `predecessor_id` | bigint | 是 |  | → `service_unit` |
| `successor_id` | bigint | 是 |  | → `service_unit` |
| `lineage_type` | text | 是 |  |  |
| `effective_date` | date | 是 |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |

约束：

- `service_unit_lineage_pkey`（主键）：`PRIMARY KEY (id)`
- `service_unit_lineage_pair_uniq`（唯一）：`UNIQUE (predecessor_id, successor_id)`
- `service_unit_lineage_self_check`（检查）：`CHECK ((predecessor_id <> successor_id))`
- `service_unit_lineage_type_check`（检查）：`CHECK ((lineage_type = ANY (ARRAY['SPLIT'::text, 'MERGE'::text])))`

索引：

- `service_unit_lineage_successor_idx`：`CREATE INDEX service_unit_lineage_successor_idx ON public.service_unit_lineage USING btree (successor_id)`

触发器：

- `service_unit_lineage_guard`：`CREATE TRIGGER service_unit_lineage_guard BEFORE UPDATE ON public.service_unit_lineage FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### service_unit_classification

服务单元分类赋值（与部门分类相互独立，不下发）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `service_unit_id` | bigint | 是 |  | → `service_unit` |
| `scheme_id` | bigint | 是 |  |  |
| `is_exclusive` | boolean | 是 |  |  |
| `code` | text | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `service_unit_classification_pkey`（主键）：`PRIMARY KEY (id)`
- `service_unit_classification_dup_excl`（排他）：`EXCLUDE USING gist (service_unit_id WITH =, scheme_id WITH =, code WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&)`
- `service_unit_classification_exclusive_excl`（排他）：`EXCLUDE USING gist (service_unit_id WITH =, scheme_id WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&) WHERE (is_exclusive)`
- `service_unit_classification_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`

索引：

- `service_unit_classification_unit_idx`：`CREATE INDEX service_unit_classification_unit_idx ON public.service_unit_classification USING btree (service_unit_id)`

触发器：

- `service_unit_classification_guard`：`CREATE TRIGGER service_unit_classification_guard BEFORE UPDATE ON public.service_unit_classification FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id')`

## 外部标识（编码映射台账）

### source_system

来源系统实例（配置，维护人直接维护）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `name` | text | 是 |  |  |
| `kind` | text | 是 |  |  |
| `note` | text |  |  |  |
| `is_active` | boolean | 是 | true |  |
| `updated_by` | bigint |  |  | → `app_user` |
| `updated_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `source_system_pkey`（主键）：`PRIMARY KEY (id)`
- `source_system_code_uniq`（唯一）：`UNIQUE (code)`
- `source_system_code_check`（检查）：`CHECK ((code ~ '^[A-Z][A-Z0-9_]{0,63}$'::text))`
- `source_system_kind_check`（检查）：`CHECK ((kind = ANY (ARRAY['HIS'::text, 'MEDICAL_RECORD'::text, 'INTEROP'::text, 'OTHER'::text])))`
- `source_system_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`

触发器：

- `source_system_guard`：`CREATE TRIGGER source_system_guard BEFORE UPDATE ON public.source_system FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('name', 'kind', 'note', 'is_active', 'updated_by', 'updated_at')`

### code_namespace

来源系统里的一本字典（配置）；不限定只装一种对象

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `source_system_id` | bigint | 是 |  | → `source_system` |
| `code` | text | 是 |  |  |
| `name` | text | 是 |  |  |
| `note` | text |  |  |  |
| `is_active` | boolean | 是 | true |  |
| `updated_by` | bigint |  |  | → `app_user` |
| `updated_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `code_namespace_pkey`（主键）：`PRIMARY KEY (id)`
- `code_namespace_code_uniq`（唯一）：`UNIQUE (source_system_id, code)`
- `code_namespace_code_check`（检查）：`CHECK ((code ~ '^[A-Z][A-Z0-9_]{0,63}$'::text))`
- `code_namespace_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`

触发器：

- `code_namespace_guard`：`CREATE TRIGGER code_namespace_guard BEFORE UPDATE ON public.code_namespace FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('name', 'note', 'is_active', 'updated_by', 'updated_at')`

### external_code

台账里的一条源记录（经变更申请登记，身份行不可更新）

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `namespace_id` | bigint | 是 |  | → `code_namespace` |
| `code` | text | 是 |  |  |
| `source_name` | text |  |  |  |
| `semantic_note` | text |  |  |  |
| `created_change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |

约束：

- `external_code_pkey`（主键）：`PRIMARY KEY (id)`
- `external_code_uniq`（唯一）：`UNIQUE (namespace_id, code)`
- `external_code_code_check`（检查）：`CHECK (((btrim(code) = code) AND (code <> ''::text)))`

触发器：

- `external_code_guard`：`CREATE TRIGGER external_code_guard BEFORE UPDATE ON public.external_code FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### external_code_assignment

源记录在某段期间的解释：部门 / 服务单元 / 对象未建模，可带院区条件；同一条件同一时点只有一个

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `external_code_id` | bigint | 是 |  | → `external_code` |
| `target_type` | text | 是 |  |  |
| `department_id` | bigint |  |  | → `department` |
| `service_unit_id` | bigint |  |  | → `service_unit` |
| `unmodeled_type` | text |  |  |  |
| `campus_id` | bigint |  |  | → `campus` |
| `evidence_note` | text |  |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `external_code_assignment_pkey`（主键）：`PRIMARY KEY (id)`
- `external_code_assignment_single_excl`（排他）：`EXCLUDE USING gist (external_code_id WITH =, COALESCE(campus_id, (0)::bigint) WITH =, daterange(valid_from, valid_to, '[]'::text) WITH &&)`
- `external_code_assignment_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= valid_from)))`
- `external_code_assignment_target_check`（检查）：`CHECK ((((target_type = 'department'::text) AND (department_id IS NOT NULL) AND (service_unit_id IS NULL) AND (unmodeled_type IS NULL)) OR ((target_type = 'service_unit'::text) AND (service_unit_id IS NOT NULL) AND (department_id IS NULL) AND (unmodeled_type IS NULL)) OR ((target_type = 'unmodeled'::text) AND (unmodeled_type IS NOT NULL) AND (department_id IS NULL) AND (service_unit_id IS NULL))))`
- `external_code_assignment_unmodeled_check`（检查）：`CHECK (((unmodeled_type IS NULL) OR (unmodeled_type = ANY (ARRAY['NURSING_UNIT'::text, 'WARD'::text, 'LOCATION'::text, 'STAT_GROUP'::text, 'COMPOSITE'::text, 'OTHER'::text]))))`

索引：

- `external_code_assignment_code_idx`：`CREATE INDEX external_code_assignment_code_idx ON public.external_code_assignment USING btree (external_code_id)`
- `external_code_assignment_dept_idx`：`CREATE INDEX external_code_assignment_dept_idx ON public.external_code_assignment USING btree (department_id)`
- `external_code_assignment_unit_idx`：`CREATE INDEX external_code_assignment_unit_idx ON public.external_code_assignment USING btree (service_unit_id)`

触发器：

- `external_code_assignment_guard`：`CREATE TRIGGER external_code_assignment_guard BEFORE UPDATE ON public.external_code_assignment FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to', 'closed_change_id')`

## 其他（未登记说明）

### code_reservation

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `object_type` | text | 是 |  |  |
| `code` | text | 是 |  |  |
| `request_key` | text | 是 |  |  |
| `slot` | integer | 是 |  |  |
| `reserved_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `reserved_by` | bigint | 是 |  | → `app_user` |

约束：

- `code_reservation_pkey`（主键）：`PRIMARY KEY (id)`
- `code_reservation_code_uniq`（唯一）：`UNIQUE (code)`
- `code_reservation_request_uniq`（唯一）：`UNIQUE (request_key, object_type, slot)`
- `code_reservation_key_check`（检查）：`CHECK (((length(request_key) >= 8) AND (length(request_key) <= 100)))`
- `code_reservation_slot_check`（检查）：`CHECK ((slot >= 0))`
- `code_reservation_type_check`（检查）：`CHECK ((object_type = ANY (ARRAY['campus'::text, 'department'::text, 'service_unit'::text, 'person'::text])))`

触发器：

- `code_reservation_guard`：`CREATE TRIGGER code_reservation_guard BEFORE UPDATE ON public.code_reservation FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### department_change_event

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `event_type` | text | 是 |  |  |
| `effective_date` | date | 是 |  |  |
| `basis_note` | text | 是 |  |  |
| `scope_note` | text |  |  |  |
| `other_matters` | text |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |

约束：

- `department_change_event_pkey`（主键）：`PRIMARY KEY (id)`
- `department_change_event_basis_check`（检查）：`CHECK ((btrim(basis_note) <> ''::text))`
- `department_change_event_type_check`（检查）：`CHECK ((event_type = ANY (ARRAY['SPLIT'::text, 'SPLIT_OFF'::text, 'ABSORB'::text, 'MERGE'::text])))`

触发器：

- `department_change_event_guard`：`CREATE TRIGGER department_change_event_guard BEFORE UPDATE ON public.department_change_event FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### department_change_participant

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `event_id` | bigint | 是 |  | → `department_change_event` |
| `department_id` | bigint | 是 |  | → `department` |
| `role` | text | 是 |  |  |
| `outcome` | text | 是 |  |  |
| `scope_note` | text |  |  |  |

约束：

- `department_change_participant_pkey`（主键）：`PRIMARY KEY (id)`
- `department_change_participant_uniq`（唯一）：`UNIQUE (event_id, department_id, role)`
- `department_change_participant_outcome_check`（检查）：`CHECK ((outcome = ANY (ARRAY['CONTINUES'::text, 'EXITS'::text, 'NEW'::text])))`
- `department_change_participant_role_check`（检查）：`CHECK ((role = ANY (ARRAY['SOURCE'::text, 'RESULT'::text])))`

索引：

- `department_change_participant_department_idx`：`CREATE INDEX department_change_participant_department_idx ON public.department_change_participant USING btree (department_id)`

触发器：

- `department_change_participant_guard`：`CREATE TRIGGER department_change_participant_guard BEFORE UPDATE ON public.department_change_participant FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### person

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `code` | text | 是 |  |  |
| `created_change_id` | bigint | 是 |  | → `change_request` |
| `created_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |

约束：

- `person_pkey`（主键）：`PRIMARY KEY (id)`
- `person_code_uniq`（唯一）：`UNIQUE (code)`
- `person_code_check`（检查）：`CHECK ((code ~ '^P[0-9]{6}$'::text))`

触发器：

- `person_guard`：`CREATE TRIGGER person_guard BEFORE UPDATE ON public.person FOR EACH ROW EXECUTE FUNCTION hdip_guard_update()`

### person_assignment

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `engagement_id` | bigint | 是 |  | → `person_engagement` |
| `department_id` | bigint | 是 |  | → `department` |
| `kind` | text | 是 | 'PRIMARY'::text |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `person_assignment_pkey`（主键）：`PRIMARY KEY (id)`
- `person_assignment_additional_no_overlap`（排他）：`EXCLUDE USING gist (engagement_id WITH =, department_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&) WHERE ((kind = 'ADDITIONAL'::text))`
- `person_assignment_primary_no_overlap`（排他）：`EXCLUDE USING gist (engagement_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&) WHERE ((kind = 'PRIMARY'::text))`
- `person_assignment_kind_check`（检查）：`CHECK ((kind = ANY (ARRAY['PRIMARY'::text, 'ADDITIONAL'::text])))`
- `person_assignment_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`

索引：

- `person_assignment_department_idx`：`CREATE INDEX person_assignment_department_idx ON public.person_assignment USING btree (department_id)`
- `person_assignment_engagement_idx`：`CREATE INDEX person_assignment_engagement_idx ON public.person_assignment USING btree (engagement_id)`

触发器：

- `person_assignment_guard`：`CREATE TRIGGER person_assignment_guard BEFORE UPDATE ON public.person_assignment FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end()`

### person_duty

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `engagement_id` | bigint | 是 |  | → `person_engagement` |
| `department_id` | bigint | 是 |  | → `department` |
| `duty` | text | 是 |  |  |
| `mode` | text | 是 | 'FORMAL'::text |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `person_duty_pkey`（主键）：`PRIMARY KEY (id)`
- `person_duty_formal_head_excl`（排他）：`EXCLUDE USING gist (department_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&) WHERE (((duty = 'HEAD'::text) AND (mode = 'FORMAL'::text)))`
- `person_duty_presiding_excl`（排他）：`EXCLUDE USING gist (department_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&) WHERE (((duty = 'HEAD'::text) AND (mode <> 'FORMAL'::text)))`
- `person_duty_same_excl`（排他）：`EXCLUDE USING gist (engagement_id WITH =, department_id WITH =, duty WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `person_duty_duty_check`（检查）：`CHECK ((duty = ANY (ARRAY['HEAD'::text, 'DEPUTY'::text])))`
- `person_duty_mode_check`（检查）：`CHECK ((mode = ANY (ARRAY['FORMAL'::text, 'ACTING'::text, 'CARETAKER'::text])))`
- `person_duty_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`

索引：

- `person_duty_department_idx`：`CREATE INDEX person_duty_department_idx ON public.person_duty USING btree (department_id)`
- `person_duty_engagement_idx`：`CREATE INDEX person_duty_engagement_idx ON public.person_duty USING btree (engagement_id)`

触发器：

- `person_duty_guard`：`CREATE TRIGGER person_duty_guard BEFORE UPDATE ON public.person_duty FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end()`

### person_engagement

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `person_id` | bigint | 是 |  | → `person` |
| `institution_id` | bigint | 是 |  | → `institution` |
| `engagement_type` | text | 是 |  |  |
| `note` | text |  |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `person_engagement_pkey`（主键）：`PRIMARY KEY (id)`
- `person_engagement_owner_uniq`（唯一）：`UNIQUE (id, person_id, institution_id)`
- `person_engagement_no_overlap`（排他）：`EXCLUDE USING gist (person_id WITH =, institution_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `person_engagement_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`

索引：

- `person_engagement_person_idx`：`CREATE INDEX person_engagement_person_idx ON public.person_engagement USING btree (person_id)`

触发器：

- `person_engagement_guard`：`CREATE TRIGGER person_engagement_guard BEFORE UPDATE ON public.person_engagement FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end()`

### person_version

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `person_id` | bigint | 是 |  | → `person` |
| `version_no` | integer | 是 |  |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `name` | text | 是 |  |  |
| `pinyin` | text |  |  |  |
| `revise_reason` | text | 是 | 'INITIAL'::text |  |

约束：

- `person_version_pkey`（主键）：`PRIMARY KEY (id)`
- `person_version_no_uniq`（唯一）：`UNIQUE (person_id, version_no)`
- `person_version_no_overlap`（排他）：`EXCLUDE USING gist (person_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `person_version_name_check`（检查）：`CHECK ((btrim(name) <> ''::text))`
- `person_version_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`
- `person_version_pinyin_check`（检查）：`CHECK ((pinyin ~ '^[A-Z0-9]{1,64}$'::text))`
- `person_version_reason_check`（检查）：`CHECK ((revise_reason = ANY (ARRAY['INITIAL'::text, 'RENAME'::text, 'CORRECTION'::text])))`

索引：

- `person_version_person_idx`：`CREATE INDEX person_version_person_idx ON public.person_version USING btree (person_id)`

触发器：

- `person_version_guard`：`CREATE TRIGGER person_version_guard BEFORE UPDATE ON public.person_version FOR EACH ROW EXECUTE FUNCTION hdip_guard_update('valid_to')`

### person_work_no

| 列 | 类型 | 非空 | 默认 / 生成 | 引用 |
| --- | --- | --- | --- | --- |
| `id` | bigint | 是 | IDENTITY |  |
| `engagement_id` | bigint | 是 |  |  |
| `person_id` | bigint | 是 |  |  |
| `institution_id` | bigint | 是 |  |  |
| `work_no` | text | 是 |  |  |
| `revise_reason` | text | 是 | 'INITIAL'::text |  |
| `valid_from` | date | 是 |  |  |
| `valid_to` | date |  |  |  |
| `change_id` | bigint | 是 |  | → `change_request` |
| `recorded_at` | timestamp without time zone | 是 | LOCALTIMESTAMP |  |
| `recorded_by` | bigint | 是 |  | → `app_user` |
| `closed_change_id` | bigint |  |  | → `change_request` |

约束：

- `person_work_no_pkey`（主键）：`PRIMARY KEY (id)`
- `person_work_no_no_overlap`（排他）：`EXCLUDE USING gist (engagement_id WITH =, daterange(valid_from, (valid_to + 1)) WITH &&)`
- `person_work_no_one_owner`（排他）：`EXCLUDE USING gist (institution_id WITH =, work_no WITH =, person_id WITH <>)`
- `person_work_no_period_check`（检查）：`CHECK (((valid_to IS NULL) OR (valid_to >= (valid_from - 1))))`
- `person_work_no_reason_check`（检查）：`CHECK ((revise_reason = ANY (ARRAY['INITIAL'::text, 'CHANGE'::text, 'CORRECTION'::text])))`
- `person_work_no_value_check`（检查）：`CHECK (((work_no = btrim(work_no)) AND ((length(work_no) >= 1) AND (length(work_no) <= 64))))`

索引：

- `person_work_no_engagement_idx`：`CREATE INDEX person_work_no_engagement_idx ON public.person_work_no USING btree (engagement_id)`
- `person_work_no_value_idx`：`CREATE INDEX person_work_no_value_idx ON public.person_work_no USING btree (work_no)`

触发器：

- `person_work_no_guard`：`CREATE TRIGGER person_work_no_guard BEFORE UPDATE ON public.person_work_no FOR EACH ROW EXECUTE FUNCTION hdip_guard_open_end()`

## 触发器函数

### hdip_guard_change_request

```sql
CREATE OR REPLACE FUNCTION public.hdip_guard_change_request()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status IN ('confirmed', 'returned', 'cancelled') THEN
    RAISE EXCEPTION '变更申请已结束，不可修改'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  RETURN NEW;
END
$function$
```

### hdip_guard_open_end

```sql
CREATE OR REPLACE FUNCTION public.hdip_guard_open_end()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF (to_jsonb(NEW) - 'valid_to' - 'closed_change_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to' - 'closed_change_id') THEN
    RAISE EXCEPTION '历史记录不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF NEW.valid_to IS NOT DISTINCT FROM OLD.valid_to THEN
    IF NEW.closed_change_id IS DISTINCT FROM OLD.closed_change_id THEN
      RAISE EXCEPTION '关闭信息只能随结束日一起写入（%）', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.valid_to IS NOT NULL AND OLD.valid_to < OLD.valid_from THEN
    RAISE EXCEPTION '生效前已撤销的记录不可再改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF OLD.valid_to IS NOT NULL AND OLD.valid_to < current_date THEN
    RAISE EXCEPTION '结束日已经过去，不能再改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_period_passed';
  END IF;
  IF NEW.closed_change_id IS NULL THEN
    RAISE EXCEPTION '改结束日须记下本次申请（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  RETURN NEW;
END
$function$
```

### hdip_guard_update

```sql
CREATE OR REPLACE FUNCTION public.hdip_guard_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  mutable  text[] := coalesce(TG_ARGV, '{}'::text[]);
  old_row  jsonb := to_jsonb(OLD);
  new_row  jsonb := to_jsonb(NEW);
BEGIN
  IF (new_row - mutable) IS DISTINCT FROM (old_row - mutable) THEN
    RAISE EXCEPTION '历史记录不可修改（%）', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
  END IF;
  IF 'valid_to' = ANY (mutable) THEN
    IF old_row ->> 'valid_to' IS NOT NULL
       AND (new_row ->> 'valid_to') IS DISTINCT FROM (old_row ->> 'valid_to') THEN
      RAISE EXCEPTION '已结束的期间不可修改（%）', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
    END IF;
    IF (new_row - 'valid_to') IS DISTINCT FROM (old_row - 'valid_to')
       AND NOT (old_row ->> 'valid_to' IS NULL AND new_row ->> 'valid_to' IS NOT NULL) THEN
      RAISE EXCEPTION '关闭信息只能在结束时写入一次（%）', TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'hdip_history_immutable';
    END IF;
  END IF;
  RETURN NEW;
END
$function$
```

## 应用账号权限

应用以 `hdip_app` 连接；它没有 DELETE 权限，从权限上保证业务表无物理删除。

| 表 | 权限 |
| --- | --- |
| `app_user` | INSERT、SELECT、UPDATE |
| `approval_rule` | INSERT、SELECT、UPDATE |
| `campus` | INSERT、SELECT、UPDATE |
| `campus_version` | INSERT、SELECT、UPDATE |
| `change_request` | INSERT、SELECT、UPDATE |
| `classification_code` | INSERT、SELECT、UPDATE |
| `classification_scheme` | INSERT、SELECT、UPDATE |
| `code_namespace` | INSERT、SELECT、UPDATE |
| `code_reservation` | INSERT、SELECT、UPDATE |
| `department` | INSERT、SELECT、UPDATE |
| `department_alias` | INSERT、SELECT、UPDATE |
| `department_change_event` | INSERT、SELECT、UPDATE |
| `department_change_participant` | INSERT、SELECT、UPDATE |
| `department_classification` | INSERT、SELECT、UPDATE |
| `department_hierarchy` | INSERT、SELECT、UPDATE |
| `department_institution` | INSERT、SELECT、UPDATE |
| `department_relation` | INSERT、SELECT、UPDATE |
| `department_version` | INSERT、SELECT、UPDATE |
| `external_code` | INSERT、SELECT、UPDATE |
| `external_code_assignment` | INSERT、SELECT、UPDATE |
| `institution` | INSERT、SELECT、UPDATE |
| `institution_version` | INSERT、SELECT、UPDATE |
| `operator_relation` | INSERT、SELECT、UPDATE |
| `option_item` | INSERT、SELECT、UPDATE |
| `org_view` | INSERT、SELECT、UPDATE |
| `person` | INSERT、SELECT、UPDATE |
| `person_assignment` | INSERT、SELECT、UPDATE |
| `person_duty` | INSERT、SELECT、UPDATE |
| `person_engagement` | INSERT、SELECT、UPDATE |
| `person_version` | INSERT、SELECT、UPDATE |
| `person_work_no` | INSERT、SELECT、UPDATE |
| `service_unit` | INSERT、SELECT、UPDATE |
| `service_unit_classification` | INSERT、SELECT、UPDATE |
| `service_unit_lineage` | INSERT、SELECT、UPDATE |
| `service_unit_version` | INSERT、SELECT、UPDATE |
| `source_system` | INSERT、SELECT、UPDATE |

## 配置表种子

### option_item

| 类别 | 代码 | 名称 | 排序 | 启用 |
| --- | --- | --- | --- | --- |
| assignment_kind | `PRIMARY` | 主归属 | 10 | 是 |
| assignment_kind | `ADDITIONAL` | 附加归属 | 20 | 是 |
| campus_node_role | `HEADQUARTERS` | 本部院区 | 10 | 是 |
| campus_node_role | `HIGH_TECH` | 高新院区 | 20 | 是 |
| campus_node_role | `CITY_CENTER` | 中心院区 | 30 | 是 |
| duty | `HEAD` | 部长 | 10 | 是 |
| duty | `DEPUTY` | 副部长 | 20 | 是 |
| duty_mode | `FORMAL` | 正式 | 10 | 是 |
| duty_mode | `ACTING` | 主持工作（代理） | 20 | 是 |
| duty_mode | `CARETAKER` | 代管 | 30 | 是 |
| engagement_type | `STAFF` | 在编 | 10 | 是 |
| engagement_type | `CONTRACT` | 合同（人事代理） | 20 | 是 |
| engagement_type | `DISPATCH` | 劳务派遣 | 30 | 是 |
| engagement_type | `REHIRE` | 退休返聘 | 40 | 是 |
| engagement_type | `EXTERNAL` | 外聘专家 | 50 | 是 |
| engagement_type | `RESIDENT` | 规培 | 60 | 是 |
| engagement_type | `VISITING` | 进修 | 70 | 是 |
| engagement_type | `INTERN` | 实习 | 80 | 是 |
| person_relation_status | `ENGAGED` | 有有效任用 | 10 | 是 |
| person_relation_status | `PLANNED` | 仅有计划任用 | 20 | 是 |
| person_relation_status | `NONE` | 无有效任用 | 30 | 是 |
| service_unit_type | `OPD` | 门诊单元 | 10 | 是 |
| service_unit_type | `IPD` | 住院单元 | 20 | 是 |
| service_unit_type | `ED` | 急诊单元 | 30 | 是 |
| service_unit_type | `EXAM` | 检查执行单元 | 40 | 是 |
| service_unit_type | `LAB` | 检验执行单元 | 50 | 是 |
| service_unit_type | `PHARMACY` | 药房 | 60 | 是 |
| service_unit_type | `OR` | 手术服务单元 | 70 | 是 |
| service_unit_type | `OTHER` | 其他 | 80 | 是 |

### approval_rule

| 对象类型 | 动作 | 确认角色 | 允许自确认 |
| --- | --- | --- | --- |
| campus | change_status | confirmer | 是 |
| campus | create | confirmer | 是 |
| campus | revise | confirmer | 是 |
| department | affiliate | confirmer | 是 |
| department | alias_add | confirmer | 是 |
| department | alias_close | confirmer | 是 |
| department | change_lifecycle | confirmer | 是 |
| department | change_status | confirmer | 是 |
| department | classification_close | confirmer | 是 |
| department | classify | confirmer | 是 |
| department | create | confirmer | 是 |
| department | relation_close | confirmer | 是 |
| department | relation_create | confirmer | 是 |
| department | rename | confirmer | 是 |
| department | reorganize | confirmer | 是 |
| department | revise | confirmer | 是 |
| department | set_parent | confirmer | 是 |
| external_code | assign | confirmer | 是 |
| external_code | assignment_close | confirmer | 是 |
| external_code | register | confirmer | 是 |
| institution | create | confirmer | 是 |
| institution | revise | confirmer | 是 |
| operator_relation | close | confirmer | 是 |
| operator_relation | create | confirmer | 是 |
| person | assign | confirmer | 是 |
| person | assignment_set_end | confirmer | 是 |
| person | change_work_no | confirmer | 是 |
| person | create | confirmer | 是 |
| person | duty_assign | confirmer | 是 |
| person | duty_handover | confirmer | 是 |
| person | duty_set_end | confirmer | 是 |
| person | engage | confirmer | 是 |
| person | engagement_set_end | confirmer | 是 |
| person | revise | confirmer | 是 |
| person | transfer | confirmer | 是 |
| service_unit | change_department | confirmer | 是 |
| service_unit | change_status | confirmer | 是 |
| service_unit | classification_close | confirmer | 是 |
| service_unit | classify | confirmer | 是 |
| service_unit | create | confirmer | 是 |
| service_unit | merge | confirmer | 是 |
| service_unit | rebind | confirmer | 是 |
| service_unit | retire | confirmer | 是 |
| service_unit | revise | confirmer | 是 |
| service_unit | split | confirmer | 是 |

### app_user

| 用户名 | 显示名 | 角色 |
| --- | --- | --- |
| solo | 张三 | maintainer、confirmer |
| maintainer | 维护人 | maintainer |
| confirmer | 确认人 | confirmer |
| viewer | 只读 | viewer |

