alter table public.messages
  add column subject_variants text[] not null default '{}';

update public.messages
set subject_variants = case
  when edit_diff is not null
    and edit_diff ? 'subject_variants'
    and jsonb_typeof(edit_diff -> 'subject_variants') = 'array'
  then array(
    select jsonb_array_elements_text(edit_diff -> 'subject_variants')
  )
  else '{}'::text[]
end;

update public.messages
set edit_diff = edit_diff - 'subject_variants'
where edit_diff ? 'subject_variants';
