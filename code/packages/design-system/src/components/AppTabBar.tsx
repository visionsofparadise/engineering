import { IconButton } from "./IconButton";
import { DropdownButton } from "./DropdownButton";
import type { MenuItem } from "./DropdownButton";

export interface AppTabBarProps {
  readonly tabs: ReadonlyArray<{ id: string; label: string }>;
  readonly activeTabId: string;
  readonly onTabSelect?: (id: string) => void;
  readonly onTabClose?: (id: string) => void;
  readonly menuItems?: ReadonlyArray<MenuItem>;
  readonly onNewTab?: () => void;
}

export function AppTabBar({ tabs, activeTabId, onTabSelect, onTabClose, menuItems, onNewTab }: AppTabBarProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 bg-void px-2">
      {/* App menu */}
      {menuItems && menuItems.length > 0 && (
        <DropdownButton
          trigger={<IconButton icon="lucide:menu" label="Menu" size={16} />}
          items={menuItems}
        />
      )}

      <div className="h-4 w-px bg-chrome-border-subtle" />

      {/* Session tabs */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            className={`flex items-center gap-2 ${
              isActive ? "bg-primary text-void" : "bg-chrome-raised text-chrome-text"
            }`}
            onClick={() => onTabSelect?.(tab.id)}
          >
            <span className="font-body text-[length:var(--text-sm)]">{tab.label}</span>
            <IconButton icon="lucide:x" label="Close tab" size={10} dim onClick={() => onTabClose?.(tab.id)} />
          </div>
        );
      })}

      {/* New tab */}
      <IconButton
        icon="lucide:plus"
        label="New tab"
        active={!tabs.some((tab) => tab.id === activeTabId)}
        activeVariant="primary"
        onClick={onNewTab}
      />
    </div>
  );
}
