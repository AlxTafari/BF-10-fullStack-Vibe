-- Сцена игрока для пролога: деревня (стартовая локация) или костёр с терминалом.
alter table users add column scene text not null default 'village' check (scene in ('village', 'campfire'));
