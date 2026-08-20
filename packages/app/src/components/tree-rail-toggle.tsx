import { useMemo } from "react";
import { Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";
import { FolderTree } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Theme } from "@/styles/theme";

const ThemedFolderTree = withUnistyles(FolderTree);
const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Opens and closes a `TreeRail`. Every panel that owns a tree rail uses this one
 * button so the affordance reads the same wherever the rail appears; only the
 * flag it drives is per-panel.
 */
export function TreeRailToggle({
  visible,
  testID,
  onToggle,
}: {
  visible: boolean;
  testID: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = t(visible ? "workspace.tree.hideFolderTree" : "workspace.tree.showFolderTree");
  const buttonStyle = useMemo(
    () =>
      ({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
        styles.button,
        (visible || Boolean(hovered) || pressed) && styles.buttonSelected,
      ],
    [visible],
  );
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          testID={testID}
          style={buttonStyle}
          onPress={onToggle}
        >
          <ThemedFolderTree size={14} uniProps={iconColorMapping} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    minWidth: { xs: 32, sm: 32, md: 24 },
    height: { xs: 32, sm: 32, md: 24 },
    paddingHorizontal: { xs: theme.spacing[2], sm: theme.spacing[2], md: theme.spacing[1] },
    borderRadius: theme.borderRadius.base,
    flexShrink: 0,
  },
  buttonSelected: {
    backgroundColor: theme.colors.surface2,
  },
  tooltipText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
}));
