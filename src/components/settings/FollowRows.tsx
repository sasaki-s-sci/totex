/** The window and the remotes it follows: on its own, and when asked. */

import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { askFetch, setFollowing, useFetching, useFollowing } from "../../lib/follow";
import { PageButton, Row, TICK_SX } from "./Row";

/**
 * Whether the window keeps its branches up with their remotes on its own, and
 * the press that asks it to now.
 *
 * Two rows that are one subject read twice. Both do the same round — every
 * remote asked, every branch that was purely behind taken up to it — and the
 * only thing the checkbox decides is whether that happens with nobody there.
 * So the press is not something the checkbox turns on: it is what the checkbox
 * is an offer to do without being asked.
 *
 * Off until it is asked for: reaching a remote is the window going out onto
 * somebody's network, and a window that did that the first time it was opened
 * would be doing it before anyone had said it could. And the press is offered
 * under a checkbox that is off, which is the point of having it: somebody who
 * will not have this window on their network unasked is exactly the person who
 * needs somewhere to ask.
 */
export function FollowRows() {
  const { t } = useTranslation();
  const following = useFollowing();
  const fetching = useFetching();

  const asking = fetching === "asking";
  // A press that could not reach something is offered again rather than left
  // red: the network is the thing most likely to be different a moment later,
  // and pressing is what says so and takes the red off.
  const failed = fetching === "failed";

  return (
    <>
      <Row label={t("settings.follow")}>
        <Checkbox
          size="small"
          sx={TICK_SX}
          checked={following}
          onChange={(event) => setFollowing(event.target.checked)}
          slotProps={{ input: { "aria-label": t("settings.follow") } }}
        />
      </Row>

      {/* No mark on this one. The page keeps a mark only where it says
          something a word cannot — see `Row` — and what this button is doing is
          exactly what its word says it is doing. */}
      <Row label={t("settings.fetch")}>
        <PageButton danger={failed} disabled={asking} onClick={askFetch}>
          {asking ? t("settings.fetching") : failed ? t("settings.fetchFailed") : t("settings.now")}
        </PageButton>
      </Row>
    </>
  );
}
