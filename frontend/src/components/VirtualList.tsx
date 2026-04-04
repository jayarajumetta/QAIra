import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export function VirtualList<T>({
  items,
  itemHeight,
  height,
  itemKey,
  renderItem,
  emptyState,
  ariaLabel,
  className = "",
  itemClassName = "",
  overscan = 4
}: {
  items: T[];
  itemHeight: number;
  height: number;
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  emptyState?: ReactNode;
  ariaLabel?: string;
  className?: string;
  itemClassName?: string;
  overscan?: number;
}) {
  const [scrollTop, setScrollTop] = useState(0);

  const visibleItems = useMemo(() => {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const endIndex = Math.min(
      items.length,
      Math.ceil((scrollTop + height) / itemHeight) + overscan
    );

    return {
      startIndex,
      endIndex,
      rows: items.slice(startIndex, endIndex)
    };
  }, [height, itemHeight, items, overscan, scrollTop]);

  if (!items.length) {
    return emptyState ? <>{emptyState}</> : null;
  }

  return (
    <div
      aria-label={ariaLabel}
      className={`virtual-list ${className}`.trim()}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      style={{ height: `${height}px` }}
    >
      <div className="virtual-list-spacer" style={{ height: `${items.length * itemHeight}px` }}>
        {visibleItems.rows.map((item, offset) => {
          const index = visibleItems.startIndex + offset;

          return (
            <div
              className={`virtual-list-item ${itemClassName}`.trim()}
              key={itemKey(item, index)}
              style={{
                height: `${itemHeight}px`,
                transform: `translateY(${index * itemHeight}px)`
              }}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
