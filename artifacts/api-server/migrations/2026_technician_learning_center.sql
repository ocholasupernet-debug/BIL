-- Technician accounts and the read-only/published Learning Center.
-- Additive and safe to stage: this file is not applied by the app at runtime.

alter table public.employee_profiles
  add column if not exists account_type text not null default 'employee';

alter table public.employee_signup_requests
  add column if not exists account_type text not null default 'employee';

alter table public.employee_profiles
  drop constraint if exists employee_profiles_account_type_check;
alter table public.employee_profiles
  add constraint employee_profiles_account_type_check
  check (account_type in ('employee', 'technician'));

alter table public.employee_signup_requests
  drop constraint if exists employee_signup_requests_account_type_check;
alter table public.employee_signup_requests
  add constraint employee_signup_requests_account_type_check
  check (account_type in ('employee', 'technician'));

create table if not exists public.technician_learning_guides (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  summary text not null,
  category text not null check (category in (
    'setup','ports','wireless','recovery','connectivity','fiber','customer-care'
  )),
  brands text[] not null default '{}',
  models text[] not null default '{}',
  firmware_notes text not null default '',
  symptom_tags text[] not null default '{}',
  likely_causes text[] not null default '{}',
  safe_checks text[] not null default '{}',
  escalate_when text[] not null default '{}',
  warnings text[] not null default '{}',
  steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  diagrams jsonb not null default '[]'::jsonb check (jsonb_typeof(diagrams) = 'array'),
  image_url text,
  image_caption text not null default '',
  customer_script text not null default '',
  manual_url text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists technician_learning_guides_published_idx
  on public.technician_learning_guides(category, updated_at desc)
  where status = 'published';
create index if not exists technician_learning_guides_brands_gin
  on public.technician_learning_guides using gin(brands);
create index if not exists technician_learning_guides_models_gin
  on public.technician_learning_guides using gin(models);

create table if not exists public.technician_device_models (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  model text not null,
  device_type text not null,
  hardware_revisions text[] not null default '{}',
  firmware_variants text[] not null default '{}',
  notes text not null default '',
  warning text not null default '',
  manual_url text,
  image_url text,
  image_caption text not null default '',
  diagram jsonb check (diagram is null or jsonb_typeof(diagram) = 'object'),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brand, model)
);
create index if not exists technician_device_models_published_idx
  on public.technician_device_models(brand, model)
  where status = 'published';

alter table public.technician_learning_guides enable row level security;
alter table public.technician_device_models enable row level security;
revoke all on public.technician_learning_guides from public, anon, authenticated;
revoke all on public.technician_device_models from public, anon, authenticated;
grant all on public.technician_learning_guides to service_role;
grant all on public.technician_device_models to service_role;

create or replace function public.employee_complete_signup(
  p_email text,
  p_action_token_hash text,
  p_full_name text,
  p_phone text,
  p_password_hash text,
  p_account_type text
) returns table(outcome text)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_account_type text := coalesce(p_account_type, '');
  v_challenge public.employee_signup_otp_challenges%rowtype;
begin
  if v_email = '' or length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_action_token_hash is null or p_action_token_hash !~ '^[0-9a-f]{64}$'
     or p_full_name is null or length(trim(p_full_name)) not between 2 and 120
     or p_full_name ~ '[[:cntrl:]]'
     or p_phone is null or p_phone !~ '^254[17][0-9]{8}$'
     or p_password_hash is null
     or p_password_hash !~ '^scrypt\$[A-Za-z0-9_-]{16,32}\$[A-Za-z0-9_-]{80,100}$'
     or v_account_type not in ('employee','technician') then
    return query select 'invalid'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('staff-signup-otp:email:' || v_email, 0));
  select * into v_challenge
  from public.employee_signup_otp_challenges
  where email = v_email and action_token_hash = p_action_token_hash
    and verified_at is not null and action_expires_at > now()
    and consumed_at is null and invalidated_at is null
  for update;
  if not found then
    return query select 'invalid'::text;
    return;
  end if;

  update public.employee_signup_otp_challenges
  set consumed_at = now()
  where id = v_challenge.id;

  if exists (select 1 from public.employee_profiles where lower(trim(email)) = v_email)
     or exists (
       select 1 from public.employee_signup_requests
       where email = v_email and status = 'pending_approval'
     ) then
    return query select 'not_eligible'::text;
    return;
  end if;

  insert into public.employee_signup_requests(
    full_name, phone, email, password_hash, email_verified_at, account_type
  ) values (
    trim(p_full_name), p_phone, v_email, p_password_hash, v_challenge.verified_at, v_account_type
  );
  return query select 'accepted'::text;
end
$$;

create or replace function public.employee_review_signup_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text,
  p_actor_id text
) returns table(outcome text, email text, employee_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_request public.employee_signup_requests%rowtype;
  v_employee_id uuid;
  v_suffix text;
  v_username text;
  v_email text;
begin
  if p_request_id is null or p_decision not in ('approve', 'reject')
     or coalesce(p_actor_id, '') = ''
     or length(coalesce(p_review_note, '')) > 500 then
    return query select 'invalid'::text, null::text, null::uuid;
    return;
  end if;
  select * into v_request
  from public.employee_signup_requests
  where id = p_request_id and status = 'pending_approval'
  for update;
  if not found or v_request.email_verified_at is null then
    return query select 'invalid'::text, null::text, null::uuid;
    return;
  end if;

  v_email := v_request.email;
  perform pg_advisory_xact_lock(hashtextextended('staff-signup-otp:email:' || v_email, 0));
  if p_decision = 'reject' then
    update public.employee_signup_requests
    set status = 'rejected', password_hash = null, reviewed_by = p_actor_id,
        reviewed_at = now(), review_note = nullif(trim(coalesce(p_review_note, '')), '')
    where id = p_request_id;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'staff_signup_rejected', 'staff_signup_request', p_request_id::text);
    return query select 'rejected'::text, v_email, null::uuid;
    return;
  end if;

  if v_request.password_hash is null or exists (
    select 1 from public.employee_profiles where lower(trim(email)) = v_email
  ) then
    update public.employee_signup_requests
    set status = 'rejected', password_hash = null, reviewed_by = p_actor_id,
        reviewed_at = now(), review_note = 'The email address is already assigned to a Staff account.'
    where id = p_request_id;
    insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id)
    values ('super_admin', p_actor_id, 'staff_signup_rejected_duplicate', 'staff_signup_request', p_request_id::text);
    return query select 'duplicate'::text, v_email, null::uuid;
    return;
  end if;

  v_employee_id := gen_random_uuid();
  v_suffix := upper(left(replace(v_employee_id::text, '-', ''), 12));
  v_username := 'staff' || lower(v_suffix);
  insert into public.employee_profiles(
    id, employee_number, username, display_name, email, phone, subdomain,
    status, fixed_monthly_salary, account_type, created_by, email_verified_at
  ) values (
    v_employee_id, 'STAFF-' || left(v_suffix, 10), v_username, v_request.full_name,
    v_email, v_request.phone, 'staff-' || lower(v_suffix),
    'active', 0, v_request.account_type, p_actor_id, v_request.email_verified_at
  );
  insert into public.employee_credentials(employee_id, password_hash, must_change_password)
  values (v_employee_id, v_request.password_hash, false);
  update public.employee_signup_requests
  set status = 'approved', password_hash = null, employee_id = v_employee_id,
      reviewed_by = p_actor_id, reviewed_at = now(),
      review_note = nullif(trim(coalesce(p_review_note, '')), '')
  where id = p_request_id;
  insert into public.employee_audit_logs(actor_role, actor_id, action, entity_type, entity_id, details)
  values (
    'super_admin', p_actor_id, 'staff_signup_approved',
    'staff_signup_request', p_request_id::text,
    jsonb_build_object('staff_id', v_employee_id, 'account_type', v_request.account_type)
  );
  return query select 'approved'::text, v_email, v_employee_id;
end
$$;

revoke all on function public.employee_complete_signup(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.employee_complete_signup(text, text, text, text, text, text) to service_role;
revoke all on function public.employee_review_signup_request(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.employee_review_signup_request(uuid, text, text, text) to service_role;

insert into public.technician_device_models(
  brand, model, device_type, hardware_revisions, firmware_variants, notes, warning, diagram, status, created_by, updated_by
) values
(
  'MikroTik', 'hAP lite (RB941-2nD)', 'Wi-Fi router',
  array['Check the rear label for exact revision'], array['RouterOS version varies by installation'],
  'Use the RouterOS menu appropriate to the installed software and confirm storage/resource limits before maintenance.',
  'Back up the existing RouterOS configuration before any authorized change. Do not run version-specific commands until the installed major version is confirmed.',
  '{"kind":"router-ports","caption":"Conceptual port map only. Confirm the printed port labels and exact board revision.","labels":["Ethernet ports","Power","Reset"]}'::jsonb,
  'published','system','system'
),
(
  'MikroTik', 'hAP ac² (RBD52G-5HacD2HnD)', 'Wi-Fi router',
  array['Confirm board revision on device label'], array['RouterOS v6 or v7; verify installed version'],
  'Wireless menus and capabilities differ by RouterOS major version and package set.',
  'Do not apply legacy wireless commands to newer radio stacks. Confirm the installed RouterOS version and menu family first.',
  '{"kind":"router-ports","caption":"Original conceptual diagram, not a product photo. Verify port numbering on the unit.","labels":["Ethernet ports","Power","Reset"]}'::jsonb,
  'published','system','system'
),
(
  'MikroTik', 'hAP ax² (C52iG-5HaxD2HaxD)', 'Wi-Fi router',
  array['Confirm board revision on device label'], array['RouterOS v7; verify exact release and WiFi package'],
  'The WiFi configuration model differs from classic wireless menus.',
  'Use only the installed WiFi menu. Keep inventory reads separate from unverified write procedures.',
  '{"kind":"router-ports","caption":"Conceptual only. Port positions and labels must be checked against the specific hardware revision.","labels":["Ethernet ports","Power","Reset"]}'::jsonb,
  'published','system','system'
),
(
  'Tenda', 'N301', 'Wireless router',
  array['Check hardware version on base label'], array['Firmware varies by hardware revision'],
  'Confirm the configured operating mode and the labels printed on the device before connecting an ISP handoff.',
  'WAN/LAN behavior is model- and mode-specific. For routed PPPoE use the WAN port only where the exact model documentation confirms it; Hotspot traffic should use a supported LAN/bridge path.',
  '{"kind":"router-ports","caption":"Conceptual port roles only; not a physical port-layout image.","labels":["WAN (verify label)","LAN (verify label)","Power","Reset"]}'::jsonb,
  'published','system','system'
),
(
  'Tenda', 'AC10', 'Dual-band wireless router',
  array['Check hardware version on base label'], array['Firmware varies by hardware revision'],
  'Do not assume all AC10 revisions expose the same menus or AP/bridge behavior.',
  'On designs intended for routed PPPoE, reserve the labeled WAN port for that routed service. Use a supported LAN/AP/bridge path for Hotspot uplinks; confirm the exact revision manual first.',
  '{"kind":"router-ports","caption":"Illustrative roles only. Verify exact port labels and the configured operating mode.","labels":["WAN (verify model)","LAN (verify model)","Power","Reset"]}'::jsonb,
  'published','system','system'
),
(
  'TP-Link', 'TL-WR840N', 'Wireless router',
  array['Confirm hardware version from base label'], array['Firmware is hardware-revision-specific'],
  'Administration menus and supported modes can differ between hardware revisions.',
  'Do not flash firmware or reset based on another revision. Confirm the printed hardware version and official manual.',
  '{"kind":"router-ports","caption":"Generic role diagram only. Use the device labels/manual for the actual port map.","labels":["WAN (check label)","LAN (check label)","Power","Reset"]}'::jsonb,
  'published','system','system'
),
(
  'TP-Link', 'Archer C6', 'Dual-band wireless router',
  array['Confirm hardware and region version'], array['Firmware varies by hardware/region'],
  'The available bridge/AP settings and interface wording vary by revision and region.',
  'Use the official manual for the exact hardware version; do not assume an Internet/WAN port can carry Hotspot bridging in every mode.',
  '{"kind":"router-ports","caption":"Conceptual role map; confirm printed labels for this exact revision.","labels":["Internet/WAN","LAN ports","Power","Reset"]}'::jsonb,
  'published','system','system'
),
(
  'Huawei', 'EchoLife HG8245H family', 'GPON ONT',
  array['Exact sub-model varies by provider'], array['Provider firmware varies'],
  'Provider-managed ONT configuration is not interchangeable across firmware or OLT profiles.',
  'Do not factory reset or change optical provisioning without explicit provider authorization. Escalate LOS/PON registration and provisioning issues.',
  '{"kind":"pon-leds","caption":"LED meanings are illustrative. Check the exact provider firmware manual.","labels":["Power","PON","LOS","LAN","WLAN"]}'::jsonb,
  'published','system','system'
),
(
  'ZTE', 'ZXHN F670L family', 'GPON ONT/router',
  array['Exact provider hardware revision varies'], array['Provider firmware varies'],
  'Ports and management menus can be locked or customized by the provider.',
  'Do not reset or edit PON/LOID/serial registration details without provider authorization.',
  '{"kind":"pon-leds","caption":"LED behavior is model/firmware-specific. Treat this as a checklist, not a definitive status chart.","labels":["Power","PON","LOS","LAN","WiFi"]}'::jsonb,
  'published','system','system'
),
(
  'Other / unlisted', 'Exact model required', 'Router / XPON / GPON / ONU / ONT',
  array['Read the complete label before procedure selection'], array['Record the firmware version if accessible'],
  'Use family-level safety checks only until the make, model, hardware revision, and firmware are known.',
  'Never infer port layout or reset behavior from a similar-looking device. Provider-managed optical equipment requires authorization before changes.',
  '{"kind":"router-ports","caption":"Reference only. Do not use as a physical port map.","labels":["Read labels","Confirm model","Confirm authorization"]}'::jsonb,
  'published','system','system'
)
on conflict (brand, model) do nothing;

insert into public.technician_learning_guides(
  slug,title,summary,category,brands,models,firmware_notes,symptom_tags,likely_causes,
  safe_checks,escalate_when,warnings,steps,diagrams,customer_script,manual_url,
  status,created_by,updated_by
) values
(
  'before-any-change',
  'Before any router or fiber change',
  'A short authorization and recovery checklist to use before troubleshooting or changing a customer network.',
  'setup', array['All'], array['All models'], 'Record the exact model, hardware revision, and firmware before using a model-specific procedure.',
  array['safety','authorization','backup'],
  array['Unclear ownership','Missing configuration backup','Unknown ISP handoff details'],
  array['Confirm the customer or network administrator authorized the work.','Record the current symptom and affected devices.','Identify the ISP handoff, VLAN, PPPoE service, and management access owner; never ask a customer to send secrets through an insecure channel.','Use an approved backup/export process and confirm where the backup is stored.','Photograph labels and cabling only when permitted; redact credentials and personal data.'],
  array['The device is ISP-owned or provider-managed and authorization is unclear.','The only management path is unavailable or a change may disconnect other customers.','A GPON/XPON ONU/ONT reset or provisioning change is being considered.'],
  array['A reset can erase settings and interrupt service.','Do not reset provider-managed GPON/XPON equipment without written authorization.','Never store or paste customer PPPoE passwords into this knowledge base.'],
  '[{"title":"Confirm authority","instruction":"Confirm the owner, scope, and approved maintenance window before touching configuration.","check":"Record who authorized the work and which service is affected."},{"title":"Protect the current state","instruction":"Capture an approved backup and note current port, VLAN, WAN, and service settings before changes.","caution":"Do not continue if a safe backup or recovery path is unavailable."},{"title":"Plan the rollback","instruction":"Agree how to restore service and who to call if the change fails.","check":"Keep a known-good management path available."}]'::jsonb,
  '[{"kind":"decision-tree","caption":"Stop if authority, backup, or rollback access is missing.","labels":["Authorized?","Backup verified?","Rollback path?","Proceed only if yes to all"]}]'::jsonb,
  '“Before I change anything, I will confirm the approved work, document the current setup, and make sure we have a safe way to restore service.”',
  null,'published','system','system'
),
(
  'identify-wan-lan-and-optical',
  'Identify WAN, LAN, and optical ports',
  'Use the printed labels and exact model manual; similar-looking routers can have different port roles.',
  'ports', array['All'], array['All models'], 'Port order and color are not reliable identifiers across models or revisions.',
  array['wrong-port','no-link','no-ip','hotspot-uplink'],
  array['ISP handoff connected to the wrong interface','Damaged cable or port','Model-specific WAN/AP mode behavior'],
  array['Read port labels on the unit, not from color alone.','Trace the cable to the upstream device and confirm which end is customer LAN versus ISP handoff.','For optical equipment, do not unplug fiber unless authorized and trained; never look into a fiber connector.','Confirm link indicators and negotiated status using the authorized device interface.'],
  array['Port labels are missing or the device is provider-managed.','A fiber connector or optical level issue is suspected.','Moving a cable could disconnect other customers or management access.'],
  array['This diagram is conceptual and is not a physical layout for any one model.','Do not place a Hotspot uplink on a Tenda WAN port unless that exact model and mode support the required AP/bridge behavior.'],
  '[{"title":"Read the exact labels","instruction":"Look for WAN/Internet, LAN/Ethernet, PON/OPTICAL, Power, and Reset markings on the device.","check":"Record the model and hardware revision from the device label."},{"title":"Trace both cable ends","instruction":"Follow the cable to its source and destination before moving it.","caution":"Do not unplug optical fiber as a routine cable check."},{"title":"Confirm operating mode","instruction":"Check whether the router is in routed, bridge, or access-point mode and verify the documented port path for that mode."}]'::jsonb,
  '[{"kind":"router-ports","caption":"Original role diagram only; port position varies by hardware. Follow the printed labels.","labels":["WAN / Internet (if present)","LAN / Ethernet (if present)","PON / OPTICAL (ONT only)","Power","Reset — avoid"]}]'::jsonb,
  '“I am checking the labels and tracing the cable path first, so I do not disconnect the wrong service.”',
  null,'published','system','system'
),
(
  'mikrotik-hotspot-safe-setup',
  'MikroTik Hotspot setup: safe sequence',
  'A model-aware checklist for an authorized MikroTik Hotspot deployment; it does not apply configuration automatically.',
  'setup', array['MikroTik'], array['RouterOS devices; select exact model first'],
  'RouterOS 6/7 and wireless package differences matter. Confirm the installed version and supported menu family.',
  array['hotspot','captive-portal','client-no-internet'],
  array['Hotspot bound to the wrong bridge/interface','DHCP or DNS path is incomplete','Unauthenticated traffic bypasses the portal'],
  array['Confirm service ownership, router model, RouterOS major version, and approved maintenance window.','Verify the intended client LAN/bridge path; do not assume a WAN interface is the Hotspot client path.','Review DHCP pool, gateway, DNS advertisement, walled-garden needs, and portal hostname before the change.','Use a configuration backup and a test client; verify both the login page and post-login access.'],
  array['The router is not reachable through the authorized management path.','The change would affect an existing production bridge, WAN, or customer portal.','You cannot verify unauthenticated clients remain behind Hotspot processing.'],
  array['Do not paste passwords or live customer configuration into notes.','Do not apply RouterOS 6 wireless commands to RouterOS 7 WiFi menus without checking the device family.'],
  '[{"title":"Confirm version and backup","instruction":"Read the installed RouterOS version and save an approved export/backup before maintenance."},{"title":"Map the service path","instruction":"Identify client interfaces, bridge membership, DHCP, DNS, and the upstream/WAN path. Preserve existing unrelated bridge members."},{"title":"Review the portal policy","instruction":"Confirm that unauthenticated users still reach Hotspot processing and only approved destinations are allowed before sign-in.","caution":"A blanket bridge-to-WAN allow rule can bypass the captive portal."},{"title":"Test with a controlled client","instruction":"Validate address assignment, portal loading, authentication, and expected post-login access without changing other customer services."}]'::jsonb,
  '[{"kind":"connection-path","caption":"Conceptual path; map the actual bridge and interface names for the selected RouterOS version.","labels":["Client LAN / bridge","DHCP + DNS","Hotspot portal","Authorized uplink"]}]'::jsonb,
  '“I will test the portal with one device first, then confirm that both the sign-in screen and normal service behave as expected.”',
  null,'published','system','system'
),
(
  'pppoe-routed-service',
  'PPPoE routed service on a customer router',
  'Check the WAN/Internet path and credentials owner before configuring a PPPoE client; exact menus depend on device and firmware.',
  'setup', array['MikroTik','Tenda','TP-Link','Huawei','ZTE','Other'], array['Exact model and revision required'],
  'Use the guide for the exact model and firmware; do not assume UI labels are identical.',
  array['pppoe','authentication','no-internet','wan'],
  array['Incorrect username/password','Wrong WAN/VLAN binding','ISP session not provisioned','Line or upstream outage'],
  array['Confirm the authorized PPPoE service and VLAN, if required, with the ISP administrator.','Connect the ISP feed to the labeled WAN/Internet port only when the exact model uses that port for routed PPPoE.','Enter credentials only in the authorized device UI; never send or record them in a ticket or this guide.','Check session state, assigned address, DNS, and one controlled client after authentication.'],
  array['The account is rejected repeatedly or an existing session may still be active.','The ISP requires VLAN or service-profile changes.','The WAN link is down or optical alarms are present.'],
  array['Never guess or share PPPoE credentials.','Tenda note: on models designed for routed PPPoE, WAN is for PPPoE. Hotspot uplinks typically use a supported LAN/bridge path; verify exact model/revision and AP/bridge mode before using WAN for Hotspot.'],
  '[{"title":"Confirm the service","instruction":"Have the ISP administrator confirm the correct line, VLAN, and credential owner before entry."},{"title":"Verify the port and mode","instruction":"Check the exact router manual and confirm the selected routed or AP/bridge mode before connecting the handoff."},{"title":"Check session status","instruction":"Verify link state, PPPoE negotiation, assigned address, and ISP-side session status using authorized tools."},{"title":"Test safely","instruction":"Use one test client and confirm DNS and internet reachability before closing the work."}]'::jsonb,
  '[{"kind":"connection-path","caption":"Routed PPPoE concept only. Hotspot and access-point paths may use different ports.","labels":["ISP handoff","WAN / Internet (if documented)","PPPoE client","LAN / Wi-Fi clients"]}]'::jsonb,
  '“I am checking the provider handoff and router mode first. If the account or VLAN needs to change, I will confirm it with the network administrator.”',
  null,'published','system','system'
),
(
  'bridge-access-point-mode',
  'Bridge or access-point mode',
  'Use a supported AP/bridge mode to avoid unintended double NAT while preserving the approved upstream path.',
  'setup', array['Tenda','TP-Link','MikroTik','Huawei','ZTE','Other'], array['Exact model and firmware required'],
  'Bridge/AP support and port behavior vary by device; follow the exact manual.',
  array['double-nat','hotspot','access-point','dhcp'],
  array['Router mode still active','Two DHCP servers','Uplink connected to an unsupported port'],
  array['Confirm whether the upstream router already provides DHCP, gateway, and Hotspot.','Check whether the target device has a documented AP/bridge mode.','Plan the management IP and disable only the duplicate DHCP service when the model procedure requires it.','Use the manufacturer manual to identify the supported uplink port for that mode.'],
  array['The AP would bridge customer traffic into a sensitive management or WAN network.','The upstream Hotspot portal or VLAN path is unclear.','The device mode changes would remove remote management.'],
  array['Do not assume WAN is usable as a bridge uplink on every router.','For Tenda, keep routed PPPoE and Hotspot LAN/bridge paths separate unless the exact revision manual confirms otherwise.'],
  '[{"title":"Map the upstream","instruction":"Identify which device owns DHCP, DNS, gateway, and any Hotspot service."},{"title":"Confirm AP support","instruction":"Check the exact hardware revision and firmware manual for AP/bridge mode and uplink port behavior."},{"title":"Prevent competing services","instruction":"Ensure only the intended device provides DHCP and routing; retain an approved management address."},{"title":"Test one client","instruction":"Check address assignment, portal behavior, and reachability before connecting other devices."}]'::jsonb,
  '[{"kind":"connection-path","caption":"Conceptual AP path. Verify supported uplink port and DHCP ownership on the selected model.","labels":["Upstream router / Hotspot","Documented AP uplink","LAN / Wi-Fi clients","One DHCP owner"]}]'::jsonb,
  '“I will confirm which device should provide addresses and sign-in before changing this router to access-point mode.”',
  null,'published','system','system'
),
(
  'wifi-safe-tuning',
  'Wi-Fi settings and coverage checks',
  'Improve coverage with low-risk checks before changing channels, power, or security settings.',
  'wireless', array['MikroTik','Tenda','TP-Link','Huawei','ZTE','Other'], array['Exact model and radio family required'],
  'Radio menus and supported bands vary by model, firmware, country, and RouterOS package.',
  array['weak-wifi','slow-wifi','interference','coverage'],
  array['Poor access-point placement','Congestion or interference','Unsupported channel/band','Client limitation'],
  array['Record which rooms/devices are affected and whether wired service is healthy.','Check access point placement, power, cable link, and current band/channel.','Confirm the region and allowed channel settings from the device manual.','Change one setting at a time and verify coverage with a controlled client.'],
  array['Wireless interference affects multiple networks or public safety equipment.','A change would interrupt a large customer area.','The device radio menu is not positively identified.'],
  array['Do not apply old RouterOS wireless commands to a new WiFi stack.','Do not increase transmit power beyond regulatory or provider limits.'],
  '[{"title":"Separate wired and Wi-Fi issues","instruction":"Test a wired client where possible before diagnosing radio coverage."},{"title":"Inspect placement","instruction":"Check obstacles, mounting, power, and cable before changing radio settings."},{"title":"Confirm radio family","instruction":"Read exact model, band support, firmware, and regulatory region from the device."},{"title":"Change one variable","instruction":"Make a single authorized adjustment, measure in the affected area, and record the outcome."}]'::jsonb,
  '[{"kind":"wifi-coverage","caption":"Original conceptual coverage diagram; walls, antennas, and radio patterns vary by site.","labels":["Access point","Test points","Walls / obstacles","Record signal at each location"]}]'::jsonb,
  '“I will test the connection in the affected rooms and check placement before changing wireless settings.”',
  null,'published','system','system'
),
(
  'safe-reset-recovery',
  'Safe reset and recovery',
  'A reset is a last resort. Confirm authority, backup, credentials, and local recovery access first.',
  'recovery', array['All'], array['All models'], 'Reset controls, hold time, LED patterns, and recovery methods are model-specific.',
  array['locked-out','lost-configuration','factory-reset'],
  array['Lost admin access','Corrupted configuration','Unrecorded provider provisioning'],
  array['Try approved non-destructive access recovery first.','Confirm the owner authorizes a reset and identify the exact model/revision.','Verify a current backup, ISP/VLAN/PPPoE details, and local management access.','Check whether the device is provider-managed; do not reset a GPON/XPON ONU/ONT without provider authorization.'],
  array['There is no verified backup or recovery credential.','The device carries other customer services or remote management.','The equipment is provider-managed or optical provisioning may be erased.'],
  array['Factory reset erases configuration and can disconnect service.','Never reset provider-managed GPON/XPON equipment without authorization.','Use only exact model instructions for recovery buttons or boot procedures.'],
  '[{"title":"Try non-destructive recovery","instruction":"Check approved account recovery, management access, and documented rollback options before reset."},{"title":"Confirm the recovery plan","instruction":"Obtain explicit authorization and verify the backup, access details, VLAN/service requirements, and onsite support."},{"title":"Check ownership","instruction":"Confirm whether an ISP or provider owns/manages the router or ONU/ONT.","caution":"Stop if ownership or optical provisioning authority is unclear."},{"title":"Follow exact manual","instruction":"Use the reset/recovery sequence for the exact hardware revision and verify each service after recovery."}]'::jsonb,
  '[{"kind":"decision-tree","caption":"Do not reset unless all recovery checks pass.","labels":["Authorized?","Backup verified?","Credentials/service details ready?","Provider-owned optical device?","Stop if any answer is unclear"]}]'::jsonb,
  '“A reset can erase the service settings. I will not proceed until the backup, authorization, and recovery details are confirmed.”',
  null,'published','system','system'
),
(
  'no-ip-dhcp',
  'Client cannot obtain an IP address',
  'Check power, link, VLAN/bridge path, and DHCP ownership before changing router settings.',
  'connectivity', array['All'], array['All models'], 'Use the exact model interface for link and DHCP status; do not assume menu names.',
  array['no-ip','dhcp','self-assigned-address','hotspot'],
  array['Loose cable or disabled port','Wrong VLAN/bridge','DHCP service or pool issue','Client-specific fault'],
  array['Check device power and cable seating without disturbing fiber.','Confirm link indicator and the client’s selected Wi-Fi/LAN network.','Check whether another client on the same path receives an address.','Have an authorized admin verify DHCP scope, VLAN, bridge, and pool status.'],
  array['Several customers are affected or the DHCP pool is exhausted.','The issue appears on the provider side or requires VLAN/bridge changes.'],
  array['Do not create a second DHCP server to “fix” the symptom.','Do not move production bridge ports without authorization.'],
  '[{"title":"Check power and link","instruction":"Confirm the router is powered and the correct LAN/Wi-Fi link is active."},{"title":"Compare clients","instruction":"Test one known-good client on the same segment to distinguish a client issue from a network issue."},{"title":"Verify service path","instruction":"Ask an authorized network administrator to check the expected VLAN/bridge and DHCP scope."},{"title":"Escalate shared failures","instruction":"If multiple users are affected, preserve evidence and escalate before making a broad change."}]'::jsonb,
  '[{"kind":"decision-tree","caption":"A safe sequence for isolating client, link, and DHCP scope issues.","labels":["One client or all?","Link active?","Correct network?","DHCP scope healthy?","Escalate shared failure"]}]'::jsonb,
  '“I am checking whether this affects one device or everyone, then I will verify the link and address service.”',
  null,'published','system','system'
),
(
  'no-internet-dns',
  'Connected but no internet: isolate DNS and upstream',
  'Separate local Wi-Fi, gateway, DNS, and upstream problems with safe, read-only checks.',
  'connectivity', array['All'], array['All models'], 'Diagnostics and status labels vary; use the authorized admin interface.',
  array['no-internet','dns','gateway','slow-connection'],
  array['ISP outage','WAN session down','DNS unavailable','Local device or captive portal state'],
  array['Check whether the customer is authenticated to Hotspot and connected to the expected SSID.','Compare a second device and, if authorized, a wired test.','Check gateway and WAN/session status without exposing credentials.','Have the network administrator test DNS and upstream reachability from the router.'],
  array['WAN/session is down, multiple subscribers are affected, or ISP escalation is required.','A suspected DNS change could affect other customers.'],
  array['Do not bypass a Hotspot portal or weaken filtering during diagnostics.','Never change DNS globally without administrator approval and a rollback plan.'],
  '[{"title":"Confirm the expected access state","instruction":"Check Wi-Fi association, Hotspot sign-in, and any captive portal message."},{"title":"Compare devices","instruction":"Try a second approved test device to see whether the issue is local or shared."},{"title":"Check gateway and upstream","instruction":"Ask an authorized admin to verify gateway, WAN, PPPoE, and provider status."},{"title":"Check DNS last","instruction":"If the gateway is healthy, verify DNS resolution using approved tools and escalate before changing shared resolver settings."}]'::jsonb,
  '[{"kind":"decision-tree","caption":"Isolate the problem without bypassing access controls.","labels":["Wi-Fi / link","Hotspot authenticated?","Gateway reachable?","WAN online?","DNS resolves?","Escalate upstream"]}]'::jsonb,
  '“Your device is connected. I am checking the sign-in, router path, provider connection, and name service in that order.”',
  null,'published','system','system'
),
(
  'pppoe-auth-failure',
  'PPPoE authentication or session failure',
  'Distinguish credential, service-profile, VLAN, and upstream causes without exposing secrets.',
  'connectivity', array['MikroTik','Tenda','TP-Link','Other'], array['Exact model required'],
  'PPPoE status and error text depend on the client device and firmware.',
  array['pppoe','authentication','wan'],
  array['Incorrect credentials','Service not active','VLAN mismatch','Stale concurrent session','Line fault'],
  array['Confirm the exact circuit and account owner with the ISP admin.','Read the device’s status/error without copying passwords into notes.','Check physical link and required VLAN against the approved service record.','Ask the provider admin to verify account status and any stale session.'],
  array['Provider rejects valid service credentials or several lines fail.','A VLAN or profile change is required.'],
  array['Never guess passwords or change them without the account owner.','Do not publish PPPoE usernames/passwords in screenshots or support messages.'],
  '[{"title":"Read the status safely","instruction":"Record the error category and timestamp only; redact usernames and all secrets."},{"title":"Verify the physical service","instruction":"Check link and approved VLAN mapping without moving production cables."},{"title":"Confirm account state","instruction":"Have the ISP administrator confirm credentials, plan status, and concurrent-session policy."},{"title":"Escalate with evidence","instruction":"Send the service reference, time, and redacted error to the provider team."}]'::jsonb,
  '[{"kind":"decision-tree","caption":"Separate line, VLAN, and account causes without sharing secrets.","labels":["Link up?","VLAN confirmed?","Account active?","Session clear?","Escalate provider-side rejection"]}]'::jsonb,
  '“I can see the connection is not authenticating. I will ask the account administrator to verify the service securely; please do not send the password in chat.”',
  null,'published','system','system'
),
(
  'gpon-los-pon-optical',
  'GPON/XPON LOS and PON alarm checks',
  'Handle optical alarms carefully and escalate provider registration or signal faults; do not reset an ONU/ONT.',
  'fiber', array['Huawei','ZTE','XPON','GPON','ONU','ONT','Other'], array['Exact make/model and provider firmware required'],
  'LED colors and blink patterns are model-specific. Check the provider manual for the exact unit.',
  array['LOS','PON','fiber','optical-signal','offline'],
  array['Fiber bend/break','Dirty or loose connector','Upstream outage','Unregistered ONU/ONT','Provider provisioning issue'],
  array['Read the exact model and note the LED state and time.','Check visible cable damage and sharp bends without looking into fiber.','Do not unplug or clean connectors unless trained, equipped, and authorized.','Ask the provider/NOC to verify optical level, OLT state, and ONU registration.'],
  array['LOS is active, PON never registers, multiple ONUs fail, or the fiber path is damaged.','A serial/LOID/ONT registration or optical-level change is needed.'],
  array['Never look into a fiber connector.','Do not factory reset a provider-managed GPON/XPON ONU/ONT without explicit provider authorization.','Do not change LOID, serial, or optical provisioning.'],
  '[{"title":"Observe and record","instruction":"Record Power, PON, LOS, and LAN indicator states using the exact model guide."},{"title":"Check physical safety","instruction":"Look for obvious damage or tight bends from a safe distance; do not inspect an open optical connector."},{"title":"Protect provisioning","instruction":"Do not reset or edit the ONU/ONT. Ask the provider/NOC to check optical signal and registration."},{"title":"Escalate","instruction":"Provide the model, alarm state, service reference, and time to the fiber/network administrator."}]'::jsonb,
  '[{"kind":"pon-leds","caption":"Illustrative indicators only. LED colors and blink meanings vary by model and firmware.","labels":["Power","PON","LOS","LAN","Record exact state; do not reset"]}]'::jsonb,
  '“The optical alarm needs a provider-side check. I have recorded the indicator state and will escalate it without resetting the ONT.”',
  null,'published','system','system'
),
(
  'power-cabling-first-checks',
  'Power and cabling: first checks',
  'Use a safe physical inspection before changing configuration.',
  'connectivity', array['All'], array['All models'], 'Power adapter and port requirements are model-specific; match the label.',
  array['no-power','link-down','intermittent','cabling'],
  array['Loose or damaged power adapter','Wrong voltage adapter','Damaged Ethernet cable','Port or upstream outage'],
  array['Read the power rating on the device and adapter; never substitute an unverified supply.','Check for visible damage, loose connectors, and link lights.','Test only with a known-good cable when authorized and when the service path is understood.','Keep fiber connectors protected and avoid sharp bends.'],
  array['There is heat, burning smell, exposed conductors, or electrical damage.','A shared uplink or provider cabinet would need to be disconnected.'],
  array['Do not open power supplies or work on energized electrical equipment.','Do not touch or look into optical connectors.'],
  '[{"title":"Check for hazards","instruction":"Stop if there is heat, burning smell, damaged mains wiring, or exposed conductors.","caution":"Do not open power adapters or energized equipment."},{"title":"Match power","instruction":"Use only the voltage/current/polarity specified on the device label."},{"title":"Check link and cable","instruction":"Inspect Ethernet cables and link indicators; do not disturb fiber or shared uplinks without authorization."}]'::jsonb,
  '[{"kind":"router-ports","caption":"A general check sequence, not a device layout. Match the device label before connecting power.","labels":["Correct labeled power supply","Ethernet link","Fiber: trained staff only","Stop on electrical damage"]}]'::jsonb,
  '“I am checking power and cable safety first. I will stop and escalate if I see electrical damage or a shared line that should not be disconnected.”',
  null,'published','system','system'
),
(
  'customer-communication',
  'Customer updates and appointment scripts',
  'Clear, respectful messages for outage checks, troubleshooting questions, appointments, and restoration.',
  'customer-care', array['All'], array['All models'], 'Do not promise a restoration time until the network administrator confirms it.',
  array['outage-update','customer-questions','appointment','restoration'],
  array['Unclear symptom history','Missed appointment expectations','Unconfirmed restoration estimate'],
  array['Ask when the issue began and which devices/services are affected.','Ask whether power, cables, or router lights changed recently.','Explain the next check in plain language and ask permission before interrupting service.','Give a confirmed next update time, even when the fix time is unknown.'],
  array['A safety hazard, repeated outage, or a provider-wide fault is reported.','The customer asks for a guaranteed restoration time that has not been confirmed.'],
  array['Do not request passwords or sensitive account information in an unsecured message.','Do not blame the customer or promise an unverified repair time.'],
  '[{"title":"Outage update","instruction":"“We have confirmed an interruption affecting your connection. Our network team is checking the provider path. I will update you by [time], even if the repair is still in progress.”"},{"title":"Troubleshooting questions","instruction":"“When did it start, and are all devices affected? Have any power or cable lights changed? Please do not reset the router while we check the service.”"},{"title":"Appointment","instruction":"“We can visit on [date] between [window]. May we access the router/fiber point? Please keep the equipment powered and do not send passwords by message.”"},{"title":"Restoration","instruction":"“Service has been restored. Please test your usual devices and tell us if anything still fails. We will monitor the connection and follow up if it drops again.”"}]'::jsonb,
  '[{"kind":"decision-tree","caption":"Keep updates clear, factual, and time-bound.","labels":["Listen","Confirm impact","Explain next check","Set update time","Confirm restoration"]}]'::jsonb,
  'Use the exact quoted scripts in the steps; replace bracketed placeholders with confirmed details only.',
  null,'published','system','system'
)
on conflict (slug) do nothing;
