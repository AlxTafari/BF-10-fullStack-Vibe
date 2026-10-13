import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type Announcements,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

interface SortableListProps {
  /** id в порядке показа. */
  ids: string[];
  /** Перенос с позиции `from` на `to` (индексы в `ids`). */
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}

/**
 * Общий контейнер перетаскиваемого списка (FAQ, категории меню).
 * Мышь/тач — PointerSensor с порогом в 5px (чтобы клик по кнопке в строке не начинал перетаскивание);
 * клавиатура — Space на «ручке», стрелки, Space.
 */
export function SortableList({ ids, onMove, children }: SortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Тексты для скринридера (по умолчанию dnd-kit говорит по-английски).
  const position = (id: unknown) => `${ids.indexOf(String(id)) + 1} из ${ids.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Элемент поднят. Позиция ${position(active.id)}.`,
    onDragOver: ({ over }) => (over ? `Элемент над позицией ${position(over.id)}.` : "Элемент вне списка."),
    onDragEnd: ({ over }) => (over ? `Элемент перенесён на позицию ${position(over.id)}.` : "Элемент возвращён на место."),
    onDragCancel: () => "Перенос отменён. Элемент на прежнем месте.",
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from !== -1 && to !== -1) onMove(from, to);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "Чтобы переставить элемент, нажмите пробел, стрелками выберите место и снова нажмите пробел. Esc — отмена.",
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

interface ItemRenderProps {
  /** Вешается на корневой элемент строки (tr / li). */
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  /** Кнопка-«ручка»: единственное место, за которое можно тянуть. */
  handle: ReactNode;
}

interface SortableItemProps {
  id: string;
  /** Пока true, строку нельзя перетаскивать (идёт сохранение предыдущей перестановки). */
  disabled?: boolean;
  children: (props: ItemRenderProps) => ReactNode;
}

export function SortableItem({ id, disabled = false, children }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { position: "relative", zIndex: 10, opacity: 0.8 } : {}),
  };

  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      disabled={disabled}
      aria-label="Перетащить"
      // touch-none: иначе браузер перехватит жест как прокрутку страницы.
      className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-40"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-4" />
    </button>
  );

  return <>{children({ setNodeRef, style, handle })}</>;
}
