/** Whether the window keeps its branches up with their remotes on its own. */

import Checkbox from "@mui/material/Checkbox";
import { useTranslation } from "react-i18next";

import { setFollowing, useFollowing } from "../../lib/follow";
import { Row } from "./Row";

/**
 * The one setting on this page that makes the window do something rather than
 * look like something, so it is the one that says what it will do.
 *
 * Off until it is asked for: reaching a remote is the window going out onto
 * somebody's network, and a window that did that the first time it was opened
 * would be doing it before anyone had said it could. The hint is the whole of
 * the promise — fetch, and take the branches that were only behind — because
 * the two things it will not do are what somebody deciding needs to know.
 */
export function FollowRow() {
  const { t } = useTranslation();
  const following = useFollowing();

  return (
    <Row label={t("settings.follow")} hint={t("settings.followHint")}>
      <Checkbox
        size="small"
        checked={following}
        onChange={(event) => setFollowing(event.target.checked)}
        slotProps={{ input: { "aria-label": t("settings.follow") } }}
      />
    </Row>
  );
}
