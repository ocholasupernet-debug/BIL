-- Expand the curated per-ISP dashboard panel shape options.
alter table if exists isp_dashboard_preferences
  drop constraint if exists isp_dashboard_preferences_card_shape_check;

alter table if exists isp_dashboard_preferences
  add constraint isp_dashboard_preferences_card_shape_check
  check (card_shape in ('rounded', 'soft-square', 'compact', 'square', 'circle', 'star', 'triangle', 'diamond', 'hexagon', 'octagon', 'pill', 'leaf', 'arch', 'bevel', 'notched', 'ticket', 'squircle'));