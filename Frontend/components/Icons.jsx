// A few line icons, drawn on a 16px grid. Decorative unless given a label by the caller.
const base = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const MenuIcon = () => <svg {...base}><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></svg>;
export const CloseIcon = () => <svg {...base}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
export const ChevronLeft = () => <svg {...base}><path d="M10 3.5L5.5 8l4.5 4.5" /></svg>;
export const ChevronRight = () => <svg {...base}><path d="M6 3.5L10.5 8 6 12.5" /></svg>;
export const ArrowRight = () => <svg {...base}><path d="M3 8h10M9 4l4 4-4 4" /></svg>;
export const PlusIcon = () => <svg {...base}><path d="M8 3v10M3 8h10" /></svg>;
export const UndoIcon = () => <svg {...base}><path d="M5 6.5H10a3 3 0 010 6H7M5 6.5L7.5 4M5 6.5L7.5 9" /></svg>;
