-- Правила посещения отдельным полем не ведём: ответы про детей, животных и бронь живут в faq_entries.
alter table restaurants drop column visit_rules;
