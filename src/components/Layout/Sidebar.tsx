import { type ReactNode } from 'react';

interface SidebarProps {
  open: boolean;
  children: ReactNode;
}

export function Sidebar({ open, children }: SidebarProps) {
  return (
    <aside
      className={`
        absolute top-0 left-0 bottom-0 z-40
        w-[22.5rem] bg-white shadow-lg border-r border-fog-gray-dark/30
        transition-transform duration-300 ease-in-out overflow-y-auto
        ${open ? 'translate-x-0' : '-translate-x-full'}
      `}
    >
      {children}
    </aside>
  );
}
