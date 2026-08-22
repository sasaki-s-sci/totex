import { Dialog, Stack } from "@mui/material";
import { ThemeToggle } from "./ThemeToggle";
import { UpdateButton } from "./UpdateButton";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * The one choice the window has, and the one thing it can do to itself.
 *
 * The choice: which of the two the window itself is drawn in, or the machine's
 * own answer. It is here rather than out in the band along the top because that
 * band is the one row the window reserves, and a thing set once is not worth a
 * mark standing in it.
 *
 * Below it, and only where it can work: replacing the app with a newer one. It
 * is last because it is not a choice — it is done once and the dialog is closed
 * again — and it is here rather than in the window's own band because that band
 * is for the window in front of you, not for the copy of the app on disk.
 */
export function SettingsDialog({ open, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose}>
      <Stack spacing={1} sx={{ p: 1.25, alignItems: "center" }}>
        <ThemeToggle />
        <UpdateButton />
      </Stack>
    </Dialog>
  );
}
