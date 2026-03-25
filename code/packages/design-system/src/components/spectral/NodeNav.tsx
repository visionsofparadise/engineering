import { Icon } from "@iconify/react";

interface NodeNavProps {
  readonly currentNode: string;
  readonly prevNode: string;
  readonly nextNode: string;
}

export function NodeNav({ currentNode, prevNode, nextNode }: NodeNavProps) {
  return (
    <div className="flex h-8 items-center bg-void px-3">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center text-chrome-text-secondary hover:text-chrome-text"
        aria-label="Back to graph"
      >
        <Icon icon="lucide:layout-grid" width={16} height={16} />
      </button>

      <div className="ml-3 flex items-center gap-2">
        <button
          type="button"
          className="flex h-8 items-center gap-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
          aria-label={`Go to ${prevNode}`}
        >
          <Icon icon="lucide:chevron-left" width={14} height={14} />
          <span>{prevNode}</span>
        </button>

        <span className="font-body text-[length:var(--text-base)] font-medium text-chrome-text">
          {currentNode}
        </span>

        <button
          type="button"
          className="flex h-8 items-center gap-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text"
          aria-label={`Go to ${nextNode}`}
        >
          <span>{nextNode}</span>
          <Icon icon="lucide:chevron-right" width={14} height={14} />
        </button>
      </div>

      <div className="ml-auto">
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center text-chrome-text-secondary hover:text-chrome-text"
          aria-label="Settings"
        >
          <Icon icon="lucide:settings" width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
