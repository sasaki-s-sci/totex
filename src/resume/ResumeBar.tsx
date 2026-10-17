import { Box, Button, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { dismiss, resumeJob, useOffer } from "./runtime";

/**
 * Drawn over a terminal put back after it was lost, where its job was not simply run again: what
 * would be run, why it was held back, and the press that runs it.
 */
export function ResumeBar({ id }: { id: string }) {
  const { t } = useTranslation();
  const offer = useOffer(id);
  if (!offer) return null;
  const { job, doubts } = offer;

  return (
    <Stack
      direction="row"
      data-resume-offer={id}
      sx={{
        position: "absolute",
        left: 8,
        right: 8,
        bottom: 8,
        zIndex: 1,
        alignItems: "center",
        gap: 1,
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        bgcolor: "background.paper",
        boxShadow: 3,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          sx={{
            fontFamily: "monospace",
            fontSize: 12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {job.line}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {[
            t(`resume.lost.${job.lost?.why ?? "crash"}`),
            ...doubts.map((doubt) => t(`resume.doubt.${doubt}`)),
          ].join(" · ")}
        </Typography>
      </Box>
      <Button size="small" variant="contained" onClick={() => resumeJob(id, [id])}>
        {t("resume.run")}
      </Button>
      <Button size="small" color="inherit" onClick={() => dismiss(id)}>
        {t("resume.dismiss")}
      </Button>
    </Stack>
  );
}
