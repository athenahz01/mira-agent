alter table public.brands
  add column identity_key text not null default '';

with normalized as (
  select
    id,
    case
      when nullif(trim(domain), '') is not null then
        'domain:' ||
        regexp_replace(
          regexp_replace(
            regexp_replace(lower(trim(domain)), '^https?://', ''),
            '^www\.',
            ''
          ),
          '[/#?].*$',
          ''
        )
      when nullif(trim(instagram_handle), '') is not null then
        'ig:' ||
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(lower(trim(instagram_handle)), '^https?://', ''),
              '^www\.',
              ''
            ),
            '^instagram\.com/',
            ''
          ),
          '[/#?].*$',
          ''
        )
      when nullif(trim(tiktok_handle), '') is not null then
        'tt:' ||
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(lower(trim(tiktok_handle)), '^https?://', ''),
                '^www\.',
                ''
              ),
              '^tiktok\.com/',
              ''
            ),
            '^@',
            ''
          ),
          '[/#?].*$',
          ''
        )
      else
        'name:' ||
        trim(
          regexp_replace(
            regexp_replace(lower(name), '[^a-z0-9 ]+', ' ', 'g'),
            '[[:space:]]+',
            ' ',
            'g'
          )
        )
    end as next_identity_key
  from public.brands
)
update public.brands b
set identity_key = normalized.next_identity_key
from normalized
where b.id = normalized.id;

alter table public.brands
  add constraint brands_user_identity_key_unique unique (user_id, identity_key);
