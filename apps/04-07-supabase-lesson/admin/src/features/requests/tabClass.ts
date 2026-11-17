/** Классы вкладки-ссылки (активная / обычная). */
export const tabClass = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`;
