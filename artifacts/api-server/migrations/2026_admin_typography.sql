-- Per-ISP typography preferences used by the admin panel and captive portals.
alter table public.isp_admins
  add column if not exists font_family text not null default 'DM Sans',
  add column if not exists font_style text not null default 'normal',
  add column if not exists font_weight integer not null default 500,
  add column if not exists font_size integer not null default 18;

alter table public.isp_admins
  drop constraint if exists isp_admins_font_family_check;
alter table public.isp_admins
  add constraint isp_admins_font_family_check
  check (font_family in (
    'DM Sans', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
    'Poppins', 'Nunito', 'Source Sans 3', 'Merriweather', 'Georgia',
    'Arial', 'Verdana', 'Trebuchet MS', 'Courier New'
  ));

alter table public.isp_admins
  drop constraint if exists isp_admins_font_style_check;
alter table public.isp_admins
  add constraint isp_admins_font_style_check
  check (font_style in ('normal', 'italic', 'oblique'));

alter table public.isp_admins
  drop constraint if exists isp_admins_font_weight_check;
alter table public.isp_admins
  add constraint isp_admins_font_weight_check
  check (font_weight in (400, 500, 600, 700, 800));

alter table public.isp_admins
  drop constraint if exists isp_admins_font_size_check;
alter table public.isp_admins
  add constraint isp_admins_font_size_check
  check (font_size between 12 and 24);