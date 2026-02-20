"use client";

interface SelectionPopoverProps {
  rect: DOMRect;
  onAddComment: () => void;
}

export function SelectionPopover({ rect, onAddComment }: SelectionPopoverProps) {
  const top = rect.bottom + window.scrollY + 8;
  const left = rect.left + rect.width / 2;

  return (
    <div
      className="selection-popover fixed z-40"
      style={{ top: rect.bottom + 8, left: rect.left + rect.width / 2, transform: "translateX(-50%)" }}
    >
      <button
        onMouseDown={(e) => {
          e.preventDefault(); // Prevent losing selection
          onAddComment();
        }}
        className="bg-gray-900 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
      >
        + Add Comment
      </button>
    </div>
  );
}
