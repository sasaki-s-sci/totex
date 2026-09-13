import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { askFetch, setFollowing, useFetching, useFollowing } from "../lib/follow";
import { PageButton, Row, TICK_SX } from "./Row";

export function FollowRows() {
  const { t } = useTranslation();
  const following = useFollowing();
  const fetching = useFetching();

  const asking = fetching === "asking";
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
      <Row label={t("settings.fetch")}>
        <PageButton danger={failed} disabled={asking} onClick={askFetch}>
          {asking ? t("settings.fetching") : failed ? t("settings.fetchFailed") : t("settings.now")}
        </PageButton>
      </Row>
    </>
  );
}
