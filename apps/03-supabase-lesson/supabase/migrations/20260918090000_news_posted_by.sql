-- posted_by: реальный автор поста (в отличие от author_id — который null и для филлера,
-- и для анонимных сплетен). Нужен только для подсчёта дневного лимита, наружу не отдаётся.
alter table news add column posted_by uuid references users (id);

create index news_posted_by_idx on news (posted_by);
