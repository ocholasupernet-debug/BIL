-- Durable storage for tenant message templates, platform permissions, and
-- verified database backup artifacts. All writes are performed by the API
-- service role after the request has been authenticated.

create table if not exists isp_message_templates (
  id           bigserial primary key,
  admin_id     bigint not null references isp_admins(id) on delete cascade,
  template_key text not null,
  name         text not null,
  event        text not null,
  channels     jsonb not null default '[]'::jsonb,
  subject      text,
  body         text not null,
  enabled      boolean not null default true,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  constraint isp_message_templates_admin_key_unique unique (admin_id, template_key)
);
create index if not exists isp_message_templates_admin_idx
  on isp_message_templates(admin_id, updated_at desc);

create table if not exists platform_role_permissions (
  role_name      text not null,
  permission_key text not null,
  enabled        boolean not null default false,
  updated_by     text not null default 'system',
  updated_at     timestamptz not null default now(),
  primary key (role_name, permission_key)
);

create table if not exists platform_backup_jobs (
  id             bigserial primary key,
  name           text not null,
  backup_type    text not null default 'manual'
    check (backup_type in ('auto', 'manual')),
  status         text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'unavailable')),
  artifact_name  text,
  artifact_size  bigint check (artifact_size is null or artifact_size >= 0),
  artifact_sha256 text,
  failure_reason text,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists platform_backup_jobs_created_idx
  on platform_backup_jobs(created_at desc);

alter table isp_message_templates enable row level security;
alter table platform_role_permissions enable row level security;
alter table platform_backup_jobs enable row level security;

revoke all on table isp_message_templates from anon, authenticated;
revoke all on table platform_role_permissions from anon, authenticated;
revoke all on table platform_backup_jobs from anon, authenticated;
grant select, insert, update, delete on table isp_message_templates to service_role;
grant select, insert, update, delete on table platform_role_permissions to service_role;
grant select, insert, update on table platform_backup_jobs to service_role;
grant usage, select on sequence isp_message_templates_id_seq to service_role;
grant usage, select on sequence platform_backup_jobs_id_seq to service_role;

-- The role editor uses stable keys rather than display labels so renaming a
-- label in the UI cannot silently orphan permissions.
insert into platform_role_permissions (role_name, permission_key, enabled)
select role_name, permission_key, enabled
from (values
  ('super_admin', 'View Admins', true), ('super_admin', 'Create Admins', true),
  ('super_admin', 'Edit Admins', true), ('super_admin', 'Delete Admins', true),
  ('super_admin', 'Toggle Active', true), ('super_admin', 'View Customers', true),
  ('super_admin', 'Create Customers', true), ('super_admin', 'Edit Customers', true),
  ('super_admin', 'Delete Customers', true), ('super_admin', 'Export Customers', true),
  ('super_admin', 'View Routers', true), ('super_admin', 'Add Routers', true),
  ('super_admin', 'Edit Routers', true), ('super_admin', 'Delete Routers', true),
  ('super_admin', 'Push Config', true), ('super_admin', 'View Plans', true),
  ('super_admin', 'Create Plans', true), ('super_admin', 'Edit Plans', true),
  ('super_admin', 'Delete Plans', true), ('super_admin', 'View Vouchers', true),
  ('super_admin', 'Generate Vouchers', true), ('super_admin', 'Delete Vouchers', true),
  ('super_admin', 'Export Vouchers', true), ('super_admin', 'View Transactions', true),
  ('super_admin', 'Create Invoices', true), ('super_admin', 'Issue Refunds', true),
  ('super_admin', 'Configure Billing', true), ('super_admin', 'View Reports', true),
  ('super_admin', 'Export Reports', true), ('super_admin', 'Custom Reports', true),
  ('super_admin', 'View Settings', true), ('super_admin', 'Edit Settings', true),
  ('super_admin', 'Manage Gateways', true), ('super_admin', 'System Limits', true),
  ('super_admin', 'View Logs', true), ('super_admin', 'Manage API Keys', true),
  ('super_admin', 'Manage Backups', true), ('super_admin', 'Automation', true),
  ('isp_admin', 'View Admins', true), ('isp_admin', 'Create Admins', true),
  ('isp_admin', 'Edit Admins', true), ('isp_admin', 'Toggle Active', true),
  ('isp_admin', 'View Customers', true), ('isp_admin', 'Create Customers', true),
  ('isp_admin', 'Edit Customers', true), ('isp_admin', 'Delete Customers', true),
  ('isp_admin', 'Export Customers', true), ('isp_admin', 'View Routers', true),
  ('isp_admin', 'Add Routers', true), ('isp_admin', 'Edit Routers', true),
  ('isp_admin', 'Delete Routers', true), ('isp_admin', 'Push Config', true),
  ('isp_admin', 'View Plans', true), ('isp_admin', 'Create Plans', true),
  ('isp_admin', 'Edit Plans', true), ('isp_admin', 'Delete Plans', true),
  ('isp_admin', 'View Vouchers', true), ('isp_admin', 'Generate Vouchers', true),
  ('isp_admin', 'Delete Vouchers', true), ('isp_admin', 'Export Vouchers', true),
  ('isp_admin', 'View Transactions', true), ('isp_admin', 'Create Invoices', true),
  ('isp_admin', 'Issue Refunds', true), ('isp_admin', 'Configure Billing', true),
  ('isp_admin', 'View Reports', true), ('isp_admin', 'Export Reports', true),
  ('isp_admin', 'Custom Reports', true), ('isp_admin', 'View Settings', true),
  ('isp_admin', 'Edit Settings', true), ('isp_admin', 'View Logs', true),
  ('isp_admin', 'Manage API Keys', true), ('isp_admin', 'Automation', true)
) as seeded(role_name, permission_key, enabled)
on conflict (role_name, permission_key) do nothing;

insert into platform_role_permissions (role_name, permission_key, enabled)
select role_name, permission_key,
  case
    when role_name = 'sub_admin' then permission_key in
      ('View Customers', 'Edit Customers', 'View Routers', 'View Plans',
       'View Vouchers', 'Generate Vouchers', 'View Reports', 'View Transactions')
    when role_name = 'reseller' then permission_key in
      ('View Customers', 'Create Customers', 'View Plans', 'View Vouchers',
       'Generate Vouchers', 'View Transactions')
    when role_name = 'support' then permission_key in
      ('View Customers', 'View Routers', 'View Plans', 'View Vouchers',
       'View Reports', 'View Transactions', 'View Logs')
    else false
  end
from (values ('sub_admin'), ('reseller'), ('support')) as roles(role_name)
cross join (select distinct permission_key from platform_role_permissions) as permissions
on conflict (role_name, permission_key) do nothing;