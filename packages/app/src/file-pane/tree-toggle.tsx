import { TreeRailToggle } from "@/components/tree-rail-toggle";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";

/**
 * Self-wired so `FilePanelBar` stays a leaf of the file pane tree — the bar is
 * rendered several components below `FilePanel`, which is where the rail lives,
 * and threading a callback down that path buys nothing.
 */
export function FileTreeToggle() {
  const isCompact = useIsCompactFormFactor();
  const visible = usePanelStore((state) => state.fileTreeVisible);
  const toggle = usePanelStore((state) => state.toggleFileTreeVisible);
  // Compact layouts reach the tree through the explorer panel; there is no rail
  // beside the file to open or close.
  if (isCompact) {
    return null;
  }
  return <TreeRailToggle visible={visible} testID="file-toggle-tree" onToggle={toggle} />;
}
